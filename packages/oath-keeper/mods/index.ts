/**
 * Oath Keeper — Letta Code Mod
 *
 * "Cron is for things you plan. Oath Keeper is for things you promise."
 *
 * Architecture:
 * - Detection: turn_end (CLI v0.27.25+) + setInterval polling (desktop/listener)
 * - Delivery: queued state + API POST with 409 retry
 * - State: local JSON file with builder-pattern StateStore
 *
 * CLI LIMITATION: Oath delivery fires into the conversation via API POST.
 * The delivery appears in the desktop app. CLI may not display it until
 * the next user message or CLI restart.
 */

import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";

const HOME = os.homedir();
const STATE_FILE = `${HOME}/.letta/mods/oath-keeper.state.json`;
const ENV_FILE = `${HOME}/.letta/extensions/oath-env.json`;
const DEBUG_FILE = `${HOME}/.letta/mods/oath-keeper-debug.json`;
const FALSE_POSITIVE_FILE = `${HOME}/.letta/mods/oath-keeper-false-positives.json`;
const POLL_INTERVAL_MS = 15_000;
const DEFAULT_DELAY_MS = 300_000; // 5 minutes fallback if LLM doesn't specify
const VERBOSE_FILE = `${HOME}/.letta/mods/oath-keeper.verbose`;
const CONFIG_FILE = `${HOME}/.letta/mods/oath-keeper.config.json`;

function isVerbose(): boolean {
  try { return fs.existsSync(VERBOSE_FILE); } catch (e) { return false; }
}

interface OathConfig {
  classifierAgentId?: string; // Agent ID to use for promise classification (defaults to same agent)
}

function loadConfig(): OathConfig {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch (e) {
    return {};
  }
}

/** Get the agent ID to use for LLM classification calls.
 *  Falls back to the env file's agent ID if not configured. */
function getClassifierAgentId(): string {
  const config = loadConfig();
  if (config.classifierAgentId) return config.classifierAgentId;
  return getApiConfig().agentId;
}

function log(msg: string) {
  addDebugLog(msg);
  if (isVerbose()) console.log("[oath-keeper] " + msg);
}

// ─── Debug log ───────────────────────────────────────────────────

interface DebugEntry { ts: number; msg: string; }

function addDebugLog(msg: string) {
  try {
    const entry: DebugEntry = { ts: Date.now(), msg };
    const raw = fs.readFileSync(DEBUG_FILE, "utf8");
    const entries: DebugEntry[] = JSON.parse(raw);
    entries.push(entry);
    while (entries.length > 500) entries.shift();
    fs.writeFileSync(DEBUG_FILE, JSON.stringify(entries, null, 2));
  } catch (e) {
    try { fs.writeFileSync(DEBUG_FILE, JSON.stringify([{ ts: Date.now(), msg }], null, 2)); } catch (e2) {}
  }
}

// ─── State ───────────────────────────────────────────────────────

interface Oath {
  id: string;
  conversationId: string;
  agentId: string;
  promise: string;
  context: string;
  sourceMessageId?: string;
  deliveryMode?: "turn_end" | "polling";
  createdAt: number;
  dueAt: number;
  status: "pending" | "queued" | "delivering" | "delivered" | "failed" | "false_positive" | "prefilter_rejected";
  result: string | null;
  deliveredAt: number | null;
  ngramScore?: number;
}

interface StateData {
  oaths: Oath[];
  lastScannedMessageId: string | null;
  _pollVer: string;
}

class StateStore {
  private data: StateData;
  private dirty: boolean = false;
  private saved: boolean = false;
  private operation: string;

  private constructor(data: StateData, operation: string) { this.data = data; this.operation = operation; }

  static load(operation: string): StateStore {
    let data: StateData;
    try {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      data = { oaths: parsed.oaths || [], lastScannedMessageId: parsed.lastScannedMessageId || null, _pollVer: parsed._pollVer || "" };
    } catch (e) {
      data = { oaths: [], lastScannedMessageId: null, _pollVer: "" };
    }
    log(`StateStore.load("${operation}") — ${data.oaths.length} oaths`);
    return new StateStore(data, operation);
  }

  findOath(id: string): Oath | undefined { return this.data.oaths.find((o) => o.id === id); }
  updateOath(id: string, updates: Partial<Oath>): StateStore {
    const oath = this.findOath(id);
    if (!oath) return this;
    Object.assign(oath, updates);
    this.dirty = true;
    log(`StateStore.updateOath("${id}") — ${Object.keys(updates).join(",")}`);
    return this;
  }
  addOath(oath: Oath): StateStore { this.data.oaths.push(oath); this.dirty = true; log(`StateStore.addOath("${oath.id}")`); return this; }
  setScanned(msgId: string): StateStore { this.data.lastScannedMessageId = msgId; this.dirty = true; return this; }
  setPollVer(ver: string): StateStore { this.data._pollVer = ver; this.dirty = true; return this; }
  prune(now: number): StateStore {
    const before = this.data.oaths.length;
    this.data.oaths = this.data.oaths.filter((o) =>
      o.status === "pending" || o.status === "queued" || o.status === "delivering" ||
      (o.deliveredAt && (now - o.deliveredAt) < 86_400_000)
    );
    if (this.data.oaths.length !== before) this.dirty = true;
    return this;
  }
  get oaths(): Oath[] { return this.data.oaths; }
  get lastScannedMessageId(): string | null { return this.data.lastScannedMessageId; }
  get pollVer(): string { return this.data._pollVer; }
  hasActiveOaths(): boolean { return this.data.oaths.some((o) => o.status === "pending" || o.status === "queued" || o.status === "delivering"); }

  /** Get active oaths (pending, queued, or delivering) for LLM dedup comparison */
  activeOaths(): Oath[] {
    return this.data.oaths.filter((o) => o.status === "pending" || o.status === "queued" || o.status === "delivering");
  }

  /** Strong dedup: returns true if an oath with the same promise text exists from the last N minutes */
  hasRecentPromise(promiseText: string, withinMs: number = 300_000): boolean {
    const now = Date.now();
    const snippet = promiseText.slice(0, 60).toLowerCase();
    return this.data.oaths.some((o) =>
      o.createdAt > (now - withinMs) &&
      o.promise.toLowerCase().includes(snippet)
    );
  }

  save(): void {
    if (!this.dirty) { this.saved = true; return; }
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(this.data, null, 2)); this.saved = true; log(`StateStore.save() — SAVED after "${this.operation}"`); }
    catch (e) { log(`StateStore.save() — FAILED: ${e}`); }
  }
}

/** LLM dedup — checks if a new promise is semantically the same as any existing active oath */
async function isDuplicatePromise(newPromise: string, existingOaths: Oath[]): Promise<boolean> {
  if (existingOaths.length === 0) return false;
  const { baseUrl, apiKey } = getApiConfig();
  const classifierAgentId = getClassifierAgentId();
  if (!classifierAgentId) return false;

  const list = existingOaths.map((o, i) => `${i + 1}. "${o.promise}"`).join("\n");
  const prompt =
    'You are a duplicate detector. A new oath promise has been detected.\n'
    + 'Check if it is semantically the same promise as any existing active oath.\n\n'
    + 'New promise: "' + newPromise + '"\n\n'
    + 'Existing active oaths:\n' + list + '\n\n'
    + 'Respond with ONLY a JSON object:\n'
    + '- Duplicate: {"is_duplicate": true, "matching_index": <number>}\n'
    + '- Not duplicate: {"is_duplicate": false}';

  try {
    const convResp = await fetch(baseUrl + "/v1/conversations?agent_id=" + classifierAgentId, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}) },
      body: "{}",
    });
    if (!convResp.ok) return false;
    const convData: any = await convResp.json();
    const classConvId = convData.id || "";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const resp = await fetch(baseUrl + "/v1/conversations/" + classConvId + "/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}) },
      body: JSON.stringify({ input: prompt, role: "user" }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    try {
      await fetch(baseUrl + "/v1/conversations/" + classConvId, {
        method: "DELETE",
        headers: apiKey ? { Authorization: "Bearer " + apiKey } : {},
      });
    } catch (e) {}

    if (!resp.ok) return false;
    const respText = await resp.text();
    let answer = "";
    for (const line of respText.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") break;
      try {
        const d = JSON.parse(data);
        if (d.message_type === "assistant_message" && d.content) {
          answer = String(d.content).slice(0, 500);
          break;
        }
      } catch (e) {}
    }

    const jsonMatch = answer.match(/\{[^}]*\}/);
    if (!jsonMatch) return false;
    const parsed = JSON.parse(jsonMatch[0]);
    const isDup = parsed.is_duplicate === true;
    if (isDup) log("isDuplicatePromise: DUPLICATE of oath #" + parsed.matching_index);
    else log("isDuplicatePromise: not a duplicate");
    return isDup;
  } catch (e) {
    log("isDuplicatePromise error: " + e);
    return false;
  }
}

// ─── Promise Detection ───────────────────────────────────────────

const PROMISE_PATTERNS: Array<[RegExp, number]> = [
  // Strong signals (3.0)
  [/i'll get back to/i, 3.0],
  [/i'll follow up/i, 3.0],
  [/i'll circle back/i, 3.0],
  [/get back to you/i, 3.0],
  [/follow up (?:on|with|in)/i, 3.0],
  [/i'll let you know/i, 3.0],
  [/i'll update you/i, 3.0],
  [/check back (?:in|with|later|after)/i, 2.5],

  // Moderate signals (2.0-2.5)
  [/i'll (?:check|verify|look into|investigate|research|dig into|confirm)/i, 2.5],
  [/let me (?:check|verify|look into|investigate|research|dig into|confirm)/i, 2.5],
  [/i'll (?:send|provide|share|post|publish|deliver)/i, 2.0],
  [/i'll (?:have|get) (?:an answer|results|something|a response)/i, 2.5],
  [/i'll tell you.*(?:later|after|when)/i, 2.5],

  // Weak signals (1.0-1.5)
  [/i'll (?:try|attempt|see|find out|work on)/i, 1.5],
  [/i (?:will|shall) (?:check|verify|look|investigate|research|test|review|analyze)/i, 2.0],
  [/i'm going to (?:check|verify|look|investigate|research|test|review)/i, 2.0],
  [/(?:in|after) (?:\d+|a few|some) (?:minutes|seconds|hours|moments)/i, 1.5],
  [/\blater (?:today|this week|tonight)\b/i, 1.0],
];

function computeNgramScore(text: string): number {
  let score = 0;
  for (const [pattern, weight] of PROMISE_PATTERNS) {
    if (pattern.test(text)) score += weight;
  }
  return score;
}

function detectPromiseRegex(text: string): { match: string; score: number } | null {
  if (!text || typeof text !== "string") return null;
  if (text.includes("[Oath Keeper]") || text.includes("[Oath Delivered]")) return null;
  if (text.trim().length < 15) return null;

  // Negative filter: code-heavy messages are rarely promises
  const codeChars = (text.match(/[{}()[\];=]/g) || []).length;
  if (text.length > 50 && codeChars / text.length > 0.05) return null;

  const score = computeNgramScore(text);

  if (score > 1.5) return { match: "ngram-score-" + score, score };
  return null;
}

/**
 * LLM confirmation — given a candidate message,
 * ask the LLM to determine whether it's a genuine promise to follow up later.
 * Returns the specific promise text or null if not a real promise.
 */
/** Log a false positive in the state file with its own status (deduplicated) */
function logFalsePositive(matchedPattern: string, text: string, source: string, ngramScore?: number) {
  try {
    const store = StateStore.load("false-positive");
    // Deduplicate — skip if a false positive with the same text already exists
    const textSnippet = text.slice(0, 60);
    const exists = store.oaths.some((o) =>
      o.status === "false_positive" &&
      o.promise.includes(textSnippet)
    );
    if (exists) { log("False positive already logged — skipping duplicate"); return; }
    const now = Date.now();
    store.addOath({
      id: "fp-" + now + "-" + Math.random().toString(36).slice(2, 6),
      conversationId: "",
      agentId: "",
      promise: "[FALSE POSITIVE] " + matchedPattern + ": " + text.slice(0, 60),
      context: text.slice(0, 200),
      createdAt: now,
      dueAt: now,
      status: "false_positive",
      result: "LLM rejected — not a genuine promise",
      deliveredAt: now,
      ngramScore,
    });
    store.save();
    log("False positive logged: " + matchedPattern);
  } catch (e) {
    log("Failed to log false positive: " + e);
  }
}

/** Log a pre-filter rejection — message didn't score high enough for LLM classification */
function logPreFilterRejection(text: string, reason: string, ngramScore?: number) {
  try {
    const store = StateStore.load("prefilter-reject");
    const textSnippet = text.slice(0, 60);
    // Deduplicate — don't log the same rejection repeatedly
    const exists = store.oaths.some((o) =>
      o.status === "prefilter_rejected" &&
      o.promise.includes(textSnippet)
    );
    if (exists) return;
    const now = Date.now();
    store.addOath({
      id: "pf-" + now + "-" + Math.random().toString(36).slice(2, 6),
      conversationId: "",
      agentId: "",
      promise: text.slice(0, 120),
      context: reason,
      createdAt: now,
      dueAt: now,
      status: "prefilter_rejected",
      result: reason,
      deliveredAt: now,
      ngramScore,
    });
    store.save();
    log("Pre-filter rejected: " + reason + " (score=" + (ngramScore ?? 0) + ") — " + textSnippet);
  } catch (e) {
    log("Failed to log pre-filter rejection: " + e);
  }
}

/**
 * LLM confirmation — given a candidate message that matched the regex pre-filter,
 * ask the LLM to confirm whether it's a genuine promise to follow up later.
 * Returns the specific promise text or null if not a real promise.
 */
async function confirmPromise(text: string): Promise<{ promise: string; delayMs: number } | null> {
  const { baseUrl, apiKey } = getApiConfig();
  const classifierAgentId = getClassifierAgentId();
  if (!classifierAgentId) return null;

  // Truncate to keep the classification fast
  const snippet = text.slice(0, 1000);
  const classificationPrompt =
    'You are a promise detector. Read this assistant message and determine:\n'
    + 'Does the assistant make a GENUINE promise to do something AFTER the current response?\n\n'
    + 'Rules:\n'
    + '- YES = agent commits to following up later (e.g., "I\'ll get back to you after I check")\n'
    + '- YES = agent says "I\'ll tell you X in 60 seconds" — the "in 60 seconds" means it will happen LATER\n'
    + '- YES = agent mentions a specific time delay ("in N minutes/seconds", "later", "after")\n'
    + '- NO = agent is doing it right now with no delay (e.g., "I\'ll tell you the time" immediately followed by the actual answer with no time gap)\n'
    + '- NO = quoting or explaining what someone else said\n'
    + '- NO = describing how the mod works\n'
    + '- NO = hypothetical examples\n\n'
    + 'Message:\n"""' + snippet + '"""\n\n'
    + 'Respond with ONLY a JSON object:\n'
    + '- Genuine promise: {"is_promise": true, "promise": "<what they specifically promise to do>", "delay_seconds": <integer>}\n'
    + '  - delay_seconds: how many seconds until the agent should deliver on this promise.\n'
    + '    - If the agent specified a time ("in 5 minutes" → 300, "in an hour" → 3600, "tomorrow" → 86400), use that.\n'
    + '    - If no specific time, estimate based on the task (quick check → 60-120, investigation → 300-600, deep work → 900+).\n'
    + '    - Any positive integer.\n'
    + '- Not a promise: {"is_promise": false}';

  try {
    // Create throwaway conversation for classification
    const convResp = await fetch(
      baseUrl + "/v1/conversations?agent_id=" + classifierAgentId,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}) },
        body: "{}",
      }
    );
    if (!convResp.ok) { log("confirmPromise: could not create conversation"); return null; }
    const convData: any = await convResp.json();
    const classConvId = convData.id || "";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const resp = await fetch(
      baseUrl + "/v1/conversations/" + classConvId + "/messages",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}) },
        body: JSON.stringify({ input: classificationPrompt, role: "user" }),
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    // Cleanup conversation regardless of result
    try {
      await fetch(baseUrl + "/v1/conversations/" + classConvId, {
        method: "DELETE",
        headers: apiKey ? { Authorization: "Bearer " + apiKey } : {},
      });
    } catch (e) {}

    if (!resp.ok) { log("confirmPromise: classification API " + resp.status); return null; }

    const respText = await resp.text();
    let answer = "";
    for (const line of respText.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") break;
      try {
        const d = JSON.parse(data);
        if (d.message_type === "assistant_message" && d.content) {
          answer = String(d.content).slice(0, 2000);
          break;
        }
      } catch (e) {}
    }

    if (!answer) { log("confirmPromise: no response from LLM"); return null; }

    // Parse the JSON response
    const jsonMatch = answer.match(/\{[^}]*\}/);
    if (!jsonMatch) { log("confirmPromise: no JSON in response: " + answer.slice(0, 100)); return null; }

    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.is_promise === true && parsed.promise && typeof parsed.promise === "string") {
      // Parse delay from LLM, clamp to sane bounds, default to 5 min if missing/invalid
      let delayMs = DEFAULT_DELAY_MS;
      if (typeof parsed.delay_seconds === "number" && parsed.delay_seconds > 0) {
        delayMs = parsed.delay_seconds * 1000;
      }
      log("confirmPromise: CONFIRMED — " + parsed.promise.slice(0, 60) + " (delay: " + (delayMs / 1000) + "s)");
      return { promise: parsed.promise.slice(0, 300), delayMs };
    }
    log("confirmPromise: REJECTED — not a genuine promise");
    return null;
  } catch (e) {
    log("confirmPromise error: " + e);
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function buildDeliveryPrompt(oath: Oath): string {
  let prompt = '[Oath Keeper] You previously promised the user:\n"' + oath.promise + '"\n\n'
    + 'Deliver on that promise now. You have full tool access — use whatever tools you need to follow through.\n'
    + 'Start your response with "[Oath Delivered]".';

  if (oath.context && oath.context !== "(turn_end)" && oath.context !== "(no context)") {
    prompt += '\n\nFor context, the user originally said:\n"' + oath.context + '"';
  }

  try {
    const now = new Date();
    const timeStr = now.toLocaleString("en-US", { timeZone: "America/Chicago" });
    prompt += '\n\nCurrent time: ' + timeStr + ' CDT';
  } catch (e) {}

  return prompt;
}

function createOath(promise: string, context: string, conversationId: string, agentId: string, sourceMessageId?: string, deliveryMode?: "turn_end" | "polling", delayMs?: number): Oath {
  const now = Date.now();
  const due = now + (delayMs || DEFAULT_DELAY_MS);
  return { id: "oath-" + now + "-" + Math.random().toString(36).slice(2, 8), conversationId, agentId, promise, context, sourceMessageId, deliveryMode, createdAt: now, dueAt: due, status: "pending", result: null, deliveredAt: null };
}

function getApiConfig() {
  let apiKey = process.env.LETTA_API_KEY;
  if (apiKey === "unset") apiKey = undefined;
  let baseUrl = "";
  let agentId = "";
  let convId = "";

  // ALWAYS read from env file first — process.env in the listener process
  // belongs to a DIFFERENT agent (the Telegram channel adapter's agent).
  // The env file is the source of truth for which conversation to watch.
  try {
    const env = JSON.parse(fs.readFileSync(ENV_FILE, "utf8"));
    baseUrl = env.LETTA_BASE_URL || "";
    agentId = env.LETTA_AGENT_ID || "";
    convId = env.LETTA_CONVERSATION_ID || "";
  } catch (e) {}

  // Port discovery: use env file port first (it's manually updated).
  // Only use ss discovery as a FALLBACK if the env file doesn't have a port.
  // ss in the listener's context may return stale/wrong results.
  if (!baseUrl) {
    let discoveredPort = "";
    try {
      const output = execSync("ss -tlnp 2>/dev/null | grep letta-code | head -1 | grep -oP '127\\.0\\.0\\.1:\\K\\d+' 2>/dev/null", { encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"] }).trim();
      if (output) discoveredPort = output;
    } catch (e) {}
    if (discoveredPort) {
      baseUrl = "http://localhost:" + discoveredPort;
    }
  }
  if (!baseUrl) {
    let envPort = process.env.LETTA_BASE_URL || "";
    if (envPort && envPort !== "unset") baseUrl = envPort;
    else baseUrl = "http://localhost:8283";
  }

  addDebugLog("getApiConfig: baseUrl=" + baseUrl + " agentId=" + (agentId ? agentId.slice(0,12) : "NONE") + " convId=" + (convId ? convId.slice(0,12) : "NONE"));
  return { baseUrl, apiKey, agentId, convId };
}

/** Check if the conversation has an active run by looking at recent messages.
 *  If the last message is an approval_request or tool_call without a matching
 *  return/response, the conversation is busy. */
async function isConversationBusy(baseUrl: string, apiKey: string | undefined, convId: string, agentId?: string): Promise<boolean> {
  try {
    const checkAgentId = agentId || getApiConfig().agentId;
    if (!checkAgentId) return false;
    const resp = await fetch(
      baseUrl + "/v1/agents/" + checkAgentId + "/messages?conversation_id=" + convId + "&limit=3",
      { headers: apiKey ? { Authorization: "Bearer " + apiKey } : {} }
    );
    if (!resp.ok) return false;
    const data: any = await resp.json();
    const messages = Array.isArray(data) ? data : (data.messages || []);
    if (!messages.length) return false;

    // Check the most recent message type
    const latest = messages[0];
    const latestType = latest.message_type || "";

    // If the latest message is an approval_request, tool_call, or assistant_message
    // without a following tool_return, the conversation is likely busy
    if (latestType === "approval_request_message") return true;

    // Check if there's a pending run by looking at run_ids
    // If the latest message has a run_id different from older messages,
    // and there's no completion signal, the run might still be active
    return false;
  } catch (e) {
    return false;
  }
}

/** Try to deliver an oath. Returns "busy" on 409 or empty response. */
async function tryDeliverOath(oath: Oath): Promise<{ status: "ok" | "busy" | "fail"; answer: string }> {
  const { baseUrl, apiKey, convId } = getApiConfig();
  const targetConv = (oath.conversationId && oath.conversationId !== "default") ? oath.conversationId : convId;
  if (!targetConv || targetConv === "default") return { status: "fail", answer: "No conversation ID" };

  // Check if conversation is busy before attempting delivery
  if (await isConversationBusy(baseUrl, apiKey, targetConv, oath.agentId || undefined)) {
    log("Oath " + oath.id + " delivery deferred — conversation has pending approval");
    return { status: "busy", answer: "Conversation busy (pending approval)" };
  }

  const prompt = buildDeliveryPrompt(oath);
  log("Attempting delivery for " + oath.id + " to " + targetConv);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    const resp = await fetch(baseUrl + "/v1/conversations/" + targetConv + "/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}) },
      body: JSON.stringify({ input: prompt, role: "user" }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (resp.status === 409 || resp.status === 429) { log("Delivery deferred (409/429)"); return { status: "busy", answer: "Conversation busy" }; }
    if (!resp.ok) { log("Delivery HTTP " + resp.status); return { status: "fail", answer: "HTTP " + resp.status }; }

    // Read SSE stream incrementally
    const reader = resp.body?.getReader();
    let answer = "", buffer = "", done = false;
    if (reader) {
      const readTimeout = setTimeout(() => { done = true; reader.cancel().catch(() => {}); }, 30_000);
      while (!done) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += new TextDecoder().decode(value);
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") { done = true; break; }
          try { const d = JSON.parse(data); if (d.message_type === "assistant_message" && d.content) { answer = String(d.content).slice(0, 2000); done = true; break; } } catch (e) {}
        }
      }
      clearTimeout(readTimeout);
      reader.cancel().catch(() => {});
    }
    // If no assistant_message was captured, the conversation was busy.
    // The POST was accepted (200) but the agent hasn't responded yet.
    // Treat as "busy" so the oath retries on the next poll cycle.
    if (answer.length === 0) {
      log("Oath " + oath.id + " POST accepted but no response (conversation busy) — retrying");
      return { status: "busy", answer: "No response in stream" };
    }
    log("Oath " + oath.id + " delivered, answer length: " + answer.length);
    return { status: "ok", answer };
  } catch (e) {
    log("Delivery error for " + oath.id + ": " + e);
    return { status: "fail", answer: "Error: " + e };
  }
}

// ─── Polling ─────────────────────────────────────────────────────

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let turnEventsActive = false;

/** Delivery cycle — runs on every poll regardless of mode.
 *  Handles: delivery-check, queue transition, delivery, stuck recovery, prune.
 *  Does NOT scan for new promises (turn_end or pollCycle handles that). */
async function pollDeliveryCycle() {
  const store = StateStore.load("deliveryCycle");
  const now = Date.now();

  try {
    // 1. Check if any queued/delivering oaths have already been delivered
    const { convId: checkConvId } = getApiConfig();
    if (checkConvId) {
      const checkStore = StateStore.load("delivery-check");
      let checkChanged = false;
      try {
        const { baseUrl, apiKey, agentId } = getApiConfig();
        const resp = await fetch(
          baseUrl + "/v1/agents/" + agentId + "/messages?conversation_id=" + checkConvId + "&limit=10",
          { headers: apiKey ? { Authorization: "Bearer " + apiKey } : {} }
        );
        if (resp.ok) {
          const data: any = await resp.json();
          const msgs = Array.isArray(data) ? data : (data.messages || []);
          let recentText = "";
          for (const m of msgs) {
            const mt = m.message_type || "";
            if (mt === "user_message") {
              const parts = m.content;
              const text = typeof parts === "string" ? parts
                : Array.isArray(parts) ? parts.map((x: any) => typeof x === "string" ? x : (x?.text || "")).join(" ") : "";
              recentText += " " + text;
            } else if (mt === "assistant_message") {
              const c = m.content;
              const text = typeof c === "string" ? c : "";
              recentText += " " + text;
            }
          }
          for (const oath of checkStore.oaths) {
            if (oath.status === "queued" || oath.status === "delivering") {
              const promptSnippet = oath.promise.slice(0, 40);
              if (recentText.includes("[Oath Keeper]") && recentText.includes(promptSnippet)) {
                if (recentText.includes("[Oath Delivered]")) {
                  checkStore.updateOath(oath.id, { status: "delivered", result: "Confirmed via conversation history", deliveredAt: Date.now() });
                  checkChanged = true;
                  log("Oath " + oath.id + " confirmed delivered (found in conversation history)");
                } else {
                  checkStore.updateOath(oath.id, { status: "delivering" });
                  checkChanged = true;
                  log("Oath " + oath.id + " delivery prompt found in history (waiting for response)");
                }
              }
            }
          }
        }
      } catch (e) {
        log("Delivery check error: " + e);
      }
      if (checkChanged) checkStore.save();
    }

    // 2. Transition due oaths to queued
    const queueStore = StateStore.load("queue-transition");
    for (const oath of queueStore.oaths) {
      if (oath.status === "pending" && oath.dueAt <= now) {
        queueStore.updateOath(oath.id, { status: "queued" });
        log("Oath " + oath.id + " → queued");
      }
    }
    queueStore.save();

    // 3. Try to deliver one queued oath (REST API — only when turn_end is NOT active)
    // When turn_end IS active, delivery happens via { continue } on the next turn_end event
    if (turnEventsActive) {
      log("Skipping REST delivery — turn_end will handle via { continue }");
    }
    const queuedOath = turnEventsActive ? undefined : queueStore.oaths.find((o) => o.status === "queued");
    if (queuedOath) {
      store.updateOath(queuedOath.id, { status: "delivering" });
      store.save();
      log("Oath " + queuedOath.id + " queued → delivering (locked)");

      const result = await tryDeliverOath(queuedOath);
      const updateStore = StateStore.load("delivery-result");
      const currentOath = updateStore.findOath(queuedOath.id);
      if (currentOath && currentOath.status === "delivered") {
        log("Oath " + queuedOath.id + " already delivered (history check) — skipping result update");
      } else if (result.status === "busy") {
        updateStore.updateOath(queuedOath.id, { status: "queued" });
        updateStore.save();
        log("Oath " + queuedOath.id + " back to queued (busy)");
      } else if (result.status === "ok") {
        updateStore.updateOath(queuedOath.id, { status: "delivered", result: result.answer.slice(0, 500), deliveredAt: Date.now() });
        updateStore.save();
        log("Oath " + queuedOath.id + " delivered");
      } else {
        updateStore.updateOath(queuedOath.id, { status: "failed", result: result.answer.slice(0, 500), deliveredAt: Date.now() });
        updateStore.save();
        log("Oath " + queuedOath.id + " failed: " + result.answer);
      }
    }

    // 4. Reset stuck delivering oaths (>5 min)
    const resetStore = StateStore.load("stuck-check");
    const fiveMinAgo = now - 300_000;
    for (const oath of resetStore.oaths) {
      if (oath.status === "delivering" && oath.dueAt < fiveMinAgo) {
        resetStore.updateOath(oath.id, { status: "queued" });
        log("Oath " + oath.id + " stuck → queued");
      }
    }
    resetStore.prune(now);
    resetStore.save();
  } catch (e) {
    log("Delivery cycle error: " + e);
  }
}

/** Full poll cycle — delivery + scanning. Only used when turn_end is NOT available. */
async function pollCycle() {
  const now = Date.now();

  try {
    // Run delivery logic first
    await pollDeliveryCycle();

    // Then scan for new promises — SKIP when turn_end handles detection
    if (turnEventsActive) return;
    const scanStore = StateStore.load("scan-phase");
    if (scanStore.hasActiveOaths()) { log("Skipping scan — active oaths"); return; }

    const { convId, agentId } = getApiConfig();
    const latest = await fetchLatestAgentMessage();
    if (latest && scanStore.lastScannedMessageId !== latest.id) {
      if (latest.isDeliveryResponse) { log("Skipping — delivery response"); return; }
      const preFilter = detectPromiseRegex(latest.text);
      if (preFilter) {
        log("Regex pre-filter matched: " + preFilter.match + " — confirming with LLM");
        const confirmed = await confirmPromise(latest.text);
        if (!confirmed) {
          logFalsePositive(preFilter.match, latest.text, "polling", preFilter.score);
          scanStore.setScanned(latest.id);
          scanStore.save();
        }
        if (confirmed) {
          scanStore.setScanned(latest.id);
          const alreadyExists = scanStore.hasRecentPromise(confirmed.promise) ||
                                scanStore.oaths.some((o) => o.sourceMessageId === latest.id);
          if (!alreadyExists) {
            const oath = createOath(confirmed.promise, latest.userContext, convId, agentId, latest.id, "polling", confirmed.delayMs);
            scanStore.addOath(oath);
            scanStore.save();
          }
        }
      } else {
        scanStore.setScanned(latest.id);
        scanStore.save();
      }
    }
  } catch (e) {
    log("Poll error: " + e);
  }
}

// ─── Message fetching ────────────────────────────────────────────

async function fetchLatestAgentMessage(): Promise<{ id: string; text: string; userContext: string; isDeliveryResponse: boolean } | null> {
  const { baseUrl, apiKey, agentId, convId } = getApiConfig();
  if (!agentId || !convId) return null;
  try {
    const resp = await fetch(baseUrl + "/v1/agents/" + agentId + "/messages?conversation_id=" + convId + "&limit=50", { headers: apiKey ? { Authorization: "Bearer " + apiKey } : {} });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    const messages = Array.isArray(data) ? data : (data.messages || []);
    if (!messages.length) return null;
    messages.sort((a: any, b: any) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
    let assistantMsg: { id: string; text: string } | null = null;
    let userContext = "(no context)";
    for (const m of messages) {
      const mt = m.message_type || "";
      if (!assistantMsg && mt === "assistant_message") {
        const c = m.content;
        const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((x: any) => typeof x === "string" ? x : (x?.text || "")).join(" ") : "";
        if (text.trim()) assistantMsg = { id: m.id || "", text };
      }
      if (userContext === "(no context)" && mt === "user_message") {
        const c = m.content;
        let text = typeof c === "string" ? c : Array.isArray(c) ? c.map((x: any) => typeof x === "string" ? x : (x?.text || "")).join(" ") : "";
        text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
        if (text) userContext = text.slice(0, 200);
      }
      if (assistantMsg && userContext !== "(no context)") break;
    }
    return assistantMsg ? { ...assistantMsg, userContext, isDeliveryResponse: userContext.includes("[Oath Keeper]") } : null;
  } catch (e) { log("fetchLatestAgentMessage error: " + e); return null; }
}

// ─── Mod Activation ──────────────────────────────────────────────

export default function activate(letta: any) {
  const disposers: Array<() => void> = [];
  const hasTurnEvents = letta.capabilities.events?.turns === true;
  turnEventsActive = hasTurnEvents;
  log("Capabilities: " + JSON.stringify(letta.capabilities));
  log("hasTurnEvents: " + hasTurnEvents);
  try { letta.diagnostics.report({ message: "Capabilities: " + JSON.stringify(letta.capabilities) + " hasTurnEvents: " + hasTurnEvents, severity: "warning" }); } catch (e) {}

  if (!letta.capabilities.tools) { log("No tools — inactive"); return () => {}; }

  // ── turn_end — uses event context for conversation/agent scoping (no env file)
  if (hasTurnEvents) {
    disposers.push(
      letta.events.on("turn_end", async (event: any, ctx: any) => {
        log("turn_end FIRED");

        // Extract conversation/agent IDs from event context — NOT env file
        const eventConvId = event.conversationId || ctx?.conversation?.id || "";
        const eventAgentId = event.agentId || ctx?.agent?.id || "";
        const lastMsg = event.assistantMessage || "";

        // ── STEP 1: Check for queued oaths ready for delivery (via { continue })
        // This uses the mod event surface instead of REST API — tools work properly
        const deliverStore = StateStore.load("turn_end-deliver");
        const dueOath = deliverStore.oaths.find((o) =>
          (o.status === "queued") &&
          o.conversationId === eventConvId
        );

        if (dueOath) {
          log("turn_end: delivering oath via { continue } — " + dueOath.id);
          deliverStore.updateOath(dueOath.id, { status: "delivering" });
          deliverStore.save();

          const prompt = buildDeliveryPrompt(dueOath);
          return { continue: prompt };
        }

        // ── STEP 2: Mark delivered oaths if the response contains [Oath Delivered]
        if (lastMsg.includes("[Oath Delivered]")) {
          const store = StateStore.load("turn_end-mark");
          for (const oath of store.oaths) {
            if (oath.status === "delivering" || oath.status === "queued") {
              store.updateOath(oath.id, { status: "delivered", result: lastMsg.slice(0, 500), deliveredAt: Date.now() });
            }
          }
          store.save();
          return;
        }

        // Skip detection for [Oath Keeper] delivery prompts
        if (lastMsg.includes("[Oath Keeper]")) return;

        // ── STEP 3: Detect promises in the assistant message
        const msgText = event.assistantMessage || "";
        if (!msgText || !msgText.trim()) { log("turn_end: no assistant message in event"); return; }

        const scanStore = StateStore.load("turn_end-detect");

        // Pre-filter: n-gram scoring before LLM
        const preFilter = detectPromiseRegex(msgText);
        if (!preFilter) {
          // Compute score for debugging even on rejection
          const rejectScore = computeNgramScore(msgText);
          logPreFilterRejection(msgText, "ngram score <= 1.5 or negative filter", rejectScore);
          return;
        }
        log("turn_end: pre-filter passed (score=" + preFilter.score + ") — sending to LLM...");
        const detection = await confirmPromise(msgText);
        log("turn_end LLM: " + (detection ? "CONFIRMED: " + detection.promise.slice(0, 60) + " delay=" + (detection.delayMs/1000) + "s" : "REJECTED"));

        if (!detection) {
          logFalsePositive("llm", msgText, "turn_end", preFilter.score);
          scanStore.save();
          return;
        }

        // Dedup: LLM checks semantic similarity against active oaths
        const existing = scanStore.activeOaths();
        const isDup = existing.length > 0 ? await isDuplicatePromise(detection.promise, existing) : false;
        if (isDup) {
          log("turn_end: duplicate promise — skipping");
          return;
        }
        // Also check string-based dedup as a fast fallback
        const alreadyExists = scanStore.hasRecentPromise(detection.promise);
        if (!alreadyExists) {
          const oath = createOath(detection.promise, "(turn_end)", eventConvId, eventAgentId, undefined, "turn_end", detection.delayMs);
          oath.ngramScore = preFilter.score;
          scanStore.addOath(oath);
          scanStore.save();
          log("turn_end: oath created — " + oath.id + " conv=" + eventConvId.slice(0,12) + " score=" + preFilter.score + " delay=" + (detection.delayMs/1000) + "s");
        }
      })
    );
    log("turn_end handler registered");
  }

  // ── Polling — always enabled for delivery timing
  // Scanning is disabled when turn_end handles detection (avoid duplicate oaths)
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(pollCycle, POLL_INTERVAL_MS);
  pollCycle();
  log("Polling started (turn_end active: " + hasTurnEvents + ")");

  // ── list_oaths tool ─────────────────────────────────────────
  disposers.push(
    letta.tools.register({
      name: "list_oaths",
      description: "List all pending and recently delivered oaths (promises tracked by Oath Keeper).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      requiresApproval: false,
      parallelSafe: true,
      async run() {
        const store = StateStore.load("list_oaths");
        const pending = store.oaths.filter((o) => o.status === "pending" || o.status === "queued");
        const delivering = store.oaths.filter((o) => o.status === "delivering");
        const recent = store.oaths.filter((o) => (o.status === "delivered" || o.status === "failed") && o.deliveredAt && Date.now() - o.deliveredAt < 3_600_000);
        const falsePositives = store.oaths.filter((o) => o.status === "false_positive" && o.deliveredAt && Date.now() - o.deliveredAt < 3_600_000);
        const prefiltered = store.oaths.filter((o) => o.status === "prefilter_rejected" && o.deliveredAt && Date.now() - o.deliveredAt < 3_600_000);
        if (pending.length === 0 && delivering.length === 0 && recent.length === 0 && falsePositives.length === 0 && prefiltered.length === 0) return "No oaths. Agents have kept their word.";
        const lines = [`Oath Keeper — ${pending.length} pending, ${delivering.length} delivering, ${recent.length} recent, ${falsePositives.length} false positive, ${prefiltered.length} prefiltered`];
        for (const o of [...pending, ...delivering]) {
          const secs = Math.max(0, Math.round((o.dueAt - Date.now()) / 1000));
          const score = o.ngramScore ? ` [${o.ngramScore}]` : "";
          lines.push(`${o.status.toUpperCase()} (${secs}s)${score}: "${o.promise.slice(0, 80)}"`);
        }
        for (const o of recent) lines.push(`${o.status === "delivered" ? "OK" : "FAIL"}: "${o.promise.slice(0, 80)}"`);
        for (const o of falsePositives) lines.push(`FP: "${o.promise.slice(0, 80)}"`);
        for (const o of prefiltered) lines.push(`PF: "${o.promise.slice(0, 80)}"`);
        return lines.join("\n");
      },
    })
  );

  log("list_oaths registered");

  return () => {
    for (const d of disposers.reverse()) { try { d(); } catch (e) {}
    }
    if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  };
}
