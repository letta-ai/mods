/**
 * Oath Keeper — Letta Code Mod
 *
 * "Cron is for things you plan. Oath Keeper is for things you promise."
 *
 * Architecture (dual-mode):
 * - If events.turns available: turn_end handler (Cameron's approach)
 * - If not (desktop app, channels): setInterval polling fallback
 * - State: local JSON file with builder-pattern StateStore
 */

import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";

const HOME = os.homedir();
const STATE_FILE = `${HOME}/.letta/mods/oath-keeper.state.json`;
const ENV_FILE = `${HOME}/.letta/extensions/oath-env.json`;
const DEBUG_FILE = `${HOME}/.letta/mods/oath-keeper-debug.json`;
const POLL_INTERVAL_MS = 15_000;
const DELAY_MS = 60_000;

function log(msg: string) {
  console.log("[oath-keeper] " + msg);
  addDebugLog(msg);
}

// ─── Debug log (readable by TUI) ─────────────────────────────────

interface DebugEntry {
  ts: number;
  msg: string;
}

function addDebugLog(msg: string) {
  try {
    const entry: DebugEntry = { ts: Date.now(), msg };
    const raw = fs.readFileSync(DEBUG_FILE, "utf8");
    const entries: DebugEntry[] = JSON.parse(raw);
    entries.push(entry);
    // Keep last 50 entries
    while (entries.length > 50) entries.shift();
    fs.writeFileSync(DEBUG_FILE, JSON.stringify(entries, null, 2));
  } catch (e) {
    // First write — create the file
    try {
      fs.writeFileSync(DEBUG_FILE, JSON.stringify([{ ts: Date.now(), msg }], null, 2));
    } catch (e2) {}
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
  createdAt: number;
  dueAt: number;
  status: "pending" | "queued" | "delivering" | "delivered" | "failed";
  result: string | null;
  deliveredAt: number | null;
}

interface StateData {
  oaths: Oath[];
  lastScannedMessageId: string | null;
  _pollVer: string;
}

/**
 * StateStore — builder pattern that forces saves.
 * load() returns a Transaction that MUST be committed via save().
 * If you mutate state without calling save(), the data is lost and
 * an error is logged on the next load (dirty flag check).
 */
class StateStore {
  private data: StateData;
  private dirty: boolean = false;
  private saved: boolean = false;
  private operation: string;

  private constructor(data: StateData, operation: string) {
    this.data = data;
    this.operation = operation;
  }

  static load(operation: string): StateStore {
    let data: StateData;
    try {
      const raw = fs.readFileSync(STATE_FILE, "utf8");
      const parsed = JSON.parse(raw);
      data = {
        oaths: parsed.oaths || [],
        lastScannedMessageId: parsed.lastScannedMessageId || null,
        _pollVer: parsed._pollVer || "",
      };
    } catch (e) {
      data = { oaths: [], lastScannedMessageId: null, _pollVer: "" };
    }
    log(`StateStore.load("${operation}") — ${data.oaths.length} oaths`);
    return new StateStore(data, operation);
  }

  /** Find an oath by ID */
  findOath(id: string): Oath | undefined {
    return this.data.oaths.find((o) => o.id === id);
  }

  /** Update an oath's status. Marks the store as dirty. */
  updateOath(id: string, updates: Partial<Oath>): StateStore {
    const oath = this.findOath(id);
    if (!oath) {
      log(`StateStore.updateOath("${id}") — OATH NOT FOUND`);
      return this;
    }
    const oldStatus = oath.status;
    Object.assign(oath, updates);
    this.dirty = true;
    log(`StateStore.updateOath("${id}") — status: ${oldStatus} -> ${oath.status}`);
    return this;
  }

  /** Add a new oath. Marks the store as dirty. */
  addOath(oath: Oath): StateStore {
    this.data.oaths.push(oath);
    this.dirty = true;
    log(`StateStore.addOath("${oath.id}") — promise: "${oath.promise.slice(0, 40)}..."`);
    return this;
  }

  /** Set the last scanned message ID */
  setScanned(msgId: string): StateStore {
    this.data.lastScannedMessageId = msgId;
    this.dirty = true;
    return this;
  }

  /** Prune old oaths (keep last 24h) */
  prune(now: number): StateStore {
    const before = this.data.oaths.length;
    this.data.oaths = this.data.oaths.filter((o) =>
      o.status === "pending" || o.status === "queued" || o.status === "delivering" ||
      (o.deliveredAt && (now - o.deliveredAt) < 86_400_000)
    );
    if (this.data.oaths.length !== before) {
      this.dirty = true;
      log(`StateStore.prune() — ${before} -> ${this.data.oaths.length} oaths`);
    }
    return this;
  }

  /** Set poll version marker */
  setPollVer(ver: string): StateStore {
    this.data._pollVer = ver;
    this.dirty = true;
    return this;
  }

  /** Get read-only access to oaths */
  get oaths(): Oath[] {
    return this.data.oaths;
  }

  get lastScannedMessageId(): string | null {
    return this.data.lastScannedMessageId;
  }

  get pollVer(): string {
    return this.data._pollVer;
  }

  /** Check if any oaths are pending or delivering */
  hasActiveOaths(): boolean {
    return this.data.oaths.some((o) => o.status === "pending" || o.status === "queued" || o.status === "delivering");
  }

  /**
   * Save the state to disk. MUST be called after any mutations.
   * If the store was dirty but not saved, logs an error.
   */
  save(): void {
    if (!this.dirty) {
      log(`StateStore.save() — nothing to save (not dirty)`);
      this.saved = true;
      return;
    }
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.data, null, 2));
      this.saved = true;
      log(`StateStore.save() — SAVED after "${this.operation}"`);
    } catch (e) {
      log(`StateStore.save() — FAILED: ${e}`);
    }
  }

  /** Check if save was called (for debugging) */
  get isSaved(): boolean {
    return this.saved;
  }

  /** Check if there are unsaved mutations */
  get isDirty(): boolean {
    return this.dirty;
  }
}

// ─── Promise Detection ───────────────────────────────────────────

function detectPromiseRegex(text: string): { promise: string } | null {
  if (!text || typeof text !== "string") return null;
  if (text.includes("[Oath Keeper]") || text.includes("[Oath Delivered]")) return null;
  if (text.trim().length < 15) return null;

  const patterns = [
    /i'll get back to (?:you|you on that|you with)/i,
    /i'll follow up/i,
    /i'll tell you/i,
    /i'll let you know/i,
    /i'll look into (?:that|this)/i,
    /i'll check on (?:this|that)/i,
    /let me (?:verify|research|dig into|confirm) (?:that|this|it)/i,
    /i'll circle back/i,
    /i'll update you/i,
    /i'll report back/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const start = match.index || 0;
      const sentStart = text.lastIndexOf(".", start) + 1;
      const sentEnd = text.indexOf(".", start + match[0].length);
      const end = sentEnd === -1 ? text.length : sentEnd + 1;
      const promise = text.slice(sentStart, end).trim();
      if (promise.length > 10 && promise.length < 300) {
        return { promise };
      }
    }
  }
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────

function buildDeliveryPrompt(oath: Oath): string {
  return '[Oath Keeper] You previously promised the user:\n"'
    + oath.promise + '"\n\nDeliver on your promise now. '
    + 'Answer directly. If you need to check something, use Bash — not web_search. '
    + 'Keep it to 1-3 sentences. Start your response with "[Oath Delivered]".';
}

function createOath(promise: string, context: string, conversationId: string, agentId: string, sourceMessageId?: string): Oath {
  const now = Date.now();
  return {
    id: "oath-" + now + "-" + Math.random().toString(36).slice(2, 8),
    conversationId,
    agentId,
    promise,
    context,
    createdAt: now,
    dueAt: now + DELAY_MS,
    status: "pending",
    result: null,
    deliveredAt: null,
    sourceMessageId,
  };
}

function getApiConfig() {
  // The port changes on every app restart. process.env may have a stale port.
  // ALWAYS read baseUrl from the env file (kept updated by update-oath-env.sh).
  // For agentId/convId, use process.env if available, fall back to env file.
  let apiKey = process.env.LETTA_API_KEY;
  if (apiKey === "unset") apiKey = undefined;
  let agentId = process.env.LETTA_AGENT_ID || "";
  let convId = process.env.LETTA_CONVERSATION_ID || "";
  if (agentId === "unset") agentId = "";
  if (convId === "unset") convId = "";

  // ALWAYS read baseUrl from env file first
  let baseUrl = "";
  try {
    const env = JSON.parse(fs.readFileSync(ENV_FILE, "utf8"));
    baseUrl = env.LETTA_BASE_URL || "";
    agentId = agentId || env.LETTA_AGENT_ID || "";
    convId = convId || env.LETTA_CONVERSATION_ID || "";
  } catch (e) {}

  // If no baseUrl from env file, discover it dynamically
  if (!baseUrl) {
    try {
      const output = execSync("ss -tlnp 2>/dev/null | grep letta-code | head -1 | grep -oP '127\\.0\\.0\\.1:\\K\\d+'", { encoding: "utf8", timeout: 2000 }).trim();
      if (output) baseUrl = "http://localhost:" + output;
    } catch (e) {}
  }

  if (!baseUrl) {
    // Last resort: try process.env (may be stale but better than nothing)
    let envPort = process.env.LETTA_BASE_URL || "";
    if (envPort && envPort !== "unset") baseUrl = envPort;
    else baseUrl = "http://localhost:8283";
  }

  return { baseUrl, apiKey, agentId, convId };
}

// ─── Message fetching ────────────────────────────────────────────

async function fetchLatestAgentMessage(): Promise<{ id: string; text: string; userContext: string; isDeliveryResponse: boolean } | null> {
  const { baseUrl, apiKey, agentId, convId } = getApiConfig();
  if (!agentId || !convId) return null;

  try {
    const fullUrl = baseUrl + "/v1/agents/" + agentId + "/messages?conversation_id=" + convId + "&limit=50";
    log("Fetching: " + fullUrl);
    const resp = await fetch(fullUrl,
      { headers: apiKey ? { Authorization: "Bearer " + apiKey } : {} }
    );
    if (!resp.ok) {
      log("fetchLatestAgentMessage: API " + resp.status);
      return null;
    }

    const data: any = await resp.json();
    const messages = Array.isArray(data) ? data : (data.messages || []);
    if (!messages.length) return null;

    messages.sort((a: any, b: any) =>
      new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
    );

    let assistantMsg: { id: string; text: string } | null = null;
    let userContext = "(no context)";

    for (const m of messages) {
      const mt = m.message_type || "";
      if (!assistantMsg && mt === "assistant_message") {
        const c = m.content;
        const text = typeof c === "string" ? c
          : Array.isArray(c) ? c.map((x: any) => typeof x === "string" ? x : (x?.text || "")).join(" ")
          : "";
        if (text.trim()) assistantMsg = { id: m.id || "", text };
      }
      if (userContext === "(no context)" && mt === "user_message") {
        const c = m.content;
        let text = typeof c === "string" ? c
          : Array.isArray(c) ? c.map((x: any) => typeof x === "string" ? x : (x?.text || "")).join(" ")
          : "";
        text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
        if (text) userContext = text.slice(0, 200);
      }
      if (assistantMsg && userContext !== "(no context)") break;
    }

    return assistantMsg ? {
      ...assistantMsg,
      userContext,
      isDeliveryResponse: userContext.includes("[Oath Keeper]")
    } : null;
  } catch (e) {
    log("fetchLatestAgentMessage error: " + e);
    return null;
  }
}

// ─── Delivery ────────────────────────────────────────────────────

/**
 * tryDeliverOath — single delivery attempt. Returns "busy" on 409 (no retry).
 * The poll cycle will naturally retry on the next cycle (every 15s).
 */
async function tryDeliverOath(oath: Oath): Promise<{ status: "ok" | "busy" | "fail"; answer: string }> {
  const { baseUrl, apiKey, convId } = getApiConfig();
  const targetConv = (oath.conversationId && oath.conversationId !== "default")
    ? oath.conversationId : convId;

  if (!targetConv || targetConv === "default") {
    return { status: "fail", answer: "No conversation ID" };
  }

  const prompt = buildDeliveryPrompt(oath);
  log("Attempting delivery for " + oath.id + " to " + targetConv);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);

    const resp = await fetch(
      baseUrl + "/v1/conversations/" + targetConv + "/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}),
        },
        body: JSON.stringify({ input: prompt, role: "user" }),
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (resp.status === 409) {
      // Conversation is busy — don't retry, just report busy
      log("Delivery deferred for " + oath.id + " (409 — conversation busy)");
      return { status: "busy", answer: "Conversation busy" };
    }

    if (resp.status === 429) {
      log("Delivery rate limited for " + oath.id + " (429)");
      return { status: "busy", answer: "Rate limited" };
    }

    if (!resp.ok) {
      log("Delivery failed for " + oath.id + " (HTTP " + resp.status + ")");
      return { status: "fail", answer: "HTTP " + resp.status };
    }

    // Read SSE stream incrementally — return on first assistant message
    const reader = resp.body?.getReader();
    let answer = "";
    let buffer = "";
    let done = false;

    if (reader) {
      const readTimeout = setTimeout(() => {
        done = true;
        reader.cancel().catch(() => {});
        log("Stream read timeout (30s) for oath " + oath.id);
      }, 30_000);

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
          try {
            const d = JSON.parse(data);
            if (d.message_type === "assistant_message" && d.content) {
              answer = String(d.content).slice(0, 2000);
              done = true;
              log("Got assistant_message from stream for oath " + oath.id);
              break;
            }
          } catch (e) {}
        }
      }
      clearTimeout(readTimeout);
      reader.cancel().catch(() => {});
    } else {
      const text = await resp.text();
      for (const line of text.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.message_type === "assistant_message" && d.content) {
            answer = String(d.content).slice(0, 2000);
          }
        } catch (e) {}
      }
    }

    log("Oath " + oath.id + " delivered, answer length: " + answer.length);
    return { status: "ok", answer: answer || "(delivered)" };
  } catch (e) {
    log("Delivery error for " + oath.id + ": " + e);
    return { status: "fail", answer: "Error: " + e };
  }
}

// ─── Polling fallback ────────────────────────────────────────────

let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function pollCycle() {
  const store = StateStore.load("pollCycle");
  const now = Date.now();

  try {
    // Mark poll version for debugging
    if (store.pollVer !== "v2-builder") {
      store.setPollVer("v2-builder");
      store.save();
    }

    // 1. Transition due oaths to "queued" (non-blocking — just mark them ready)
    for (const oath of store.oaths) {
      if (oath.status === "pending" && oath.dueAt <= now) {
        store.updateOath(oath.id, { status: "queued" });
        log("Oath " + oath.id + " timer expired → queued");
      }
    }
    store.save();

    // 2. Try to deliver queued oaths (one at a time, no retry loop)
    const onDeck = store.oaths.find((o) => o.status === "queued");
    if (onDeck) {
      // Mark as "delivering" IMMEDIATELY and save — prevents next poll cycle
      // from also trying to deliver the same oath (race condition fix)
      store.updateOath(onDeck.id, { status: "delivering" });
      store.save();
      log("Oath " + onDeck.id + " queued → delivering (locked)");

      // Now attempt the delivery
      const result = await tryDeliverOath(onDeck);

      // Reload state fresh, update with result, SAVE
      const updateStore = StateStore.load("delivery-result");
      if (result.status === "busy") {
        // Conversation is busy — go back to queued, try next cycle
        updateStore.updateOath(onDeck.id, { status: "queued" });
        updateStore.save();
        log("Oath " + onDeck.id + " delivery deferred (conversation busy) — back to queued");
      } else if (result.status === "ok") {
        updateStore.updateOath(onDeck.id, {
          status: "delivered",
          result: result.answer?.slice(0, 500) || null,
          deliveredAt: Date.now(),
        });
        updateStore.save();
        log("Oath " + onDeck.id + " delivered successfully");
      } else {
        updateStore.updateOath(onDeck.id, {
          status: "failed",
          result: result.answer?.slice(0, 500) || null,
          deliveredAt: Date.now(),
        });
        updateStore.save();
        log("Oath " + onDeck.id + " delivery failed: " + result.answer);
      }
    }

    // Handle stuck "delivering" oaths — if delivering for more than 5 minutes, reset to queued
    // RELOAD from disk first — the delivery block above may have already updated the state
    const postDeliveryStore = StateStore.load("post-delivery-check");
    const fiveMinAgo = now - 300_000;
    for (const oath of postDeliveryStore.oaths) {
      if (oath.status === "delivering" && oath.dueAt < fiveMinAgo) {
        postDeliveryStore.updateOath(oath.id, { status: "queued" });
      }
    }
    postDeliveryStore.prune(now);
    postDeliveryStore.save();

    // 2. Scan for new promises — ALWAYS reload fresh state here
    // (the delivery block above may have changed state on disk)
    const scanStore = StateStore.load("scan-phase");
    if (scanStore.hasActiveOaths()) {
      log("Skipping scan — active oaths exist");
      return;
    }

    const { convId } = getApiConfig();
    const latest = await fetchLatestAgentMessage();

    if (latest && scanStore.lastScannedMessageId !== latest.id) {
      scanStore.setScanned(latest.id);
      scanStore.save();

      // Skip delivery responses
      if (latest.isDeliveryResponse) {
        log("Skipping detection — response to Oath Keeper delivery");
        return;
      }

      const detection = detectPromiseRegex(latest.text);
      if (detection) {
        const exists = scanStore.oaths.some((o) => o.sourceMessageId === latest.id);
        if (!exists) {
          const { agentId } = getApiConfig();
          const oath = createOath(detection.promise, latest.userContext, convId, agentId, latest.id);
          scanStore.addOath(oath);
          scanStore.save();
        }
      }
    } else if (!latest) {
      log("No latest message found");
    }
  } catch (e) {
    log("Poll error: " + e);
  }
}

// ─── Mod Activation ──────────────────────────────────────────────

export default function activate(letta: any) {
  const disposers: Array<() => void> = [];
  const hasTurnEvents = letta.capabilities.events?.turns === true;
  log("Capabilities: " + JSON.stringify(letta.capabilities));
  log("hasTurnEvents: " + hasTurnEvents);
  try { letta.diagnostics.report({ message: "Capabilities: " + JSON.stringify(letta.capabilities) + " hasTurnEvents: " + hasTurnEvents, severity: "warning" }); } catch (e) {}

  if (!letta.capabilities.tools) {
    log("No tools capability — mod inactive");
    return () => {};
  }

  // ── Mode 1: turn_end events ──────────────────────────────────
  if (hasTurnEvents) {
    disposers.push(
      letta.events.on("turn_end", async (event: any, _ctx: any) => {
        log("turn_end FIRED — assistantMessage length: " + (event.assistantMessage || "").length);
        const assistantMessage = event.assistantMessage || "";

        if (assistantMessage.includes("[Oath Keeper]") || assistantMessage.includes("[Oath Delivered]")) {
          if (assistantMessage.includes("[Oath Delivered]")) {
            const store = StateStore.load("turn_end-delivery-mark");
            for (const oath of store.oaths) {
              if (oath.status === "delivering") {
                store.updateOath(oath.id, {
                  status: "delivered",
                  result: assistantMessage.slice(0, 500),
                  deliveredAt: Date.now(),
                });
              }
            }
            store.save();
          }
          return;
        }

        const now = Date.now();
        const store = StateStore.load("turn_end-detect");

        const detection = detectPromiseRegex(assistantMessage);
        if (detection) {
          const exists = store.oaths.some(
            (o) => o.promise === detection.promise && o.status === "pending"
          );
          if (!exists) {
            const oath = createOath(
              detection.promise, "(from turn_end event)",
              event.conversationId || "", event.agentId || ""
            );
            store.addOath(oath);
            store.save();
          }
        }

        const dueOath = store.oaths.find((o) => o.status === "pending" && o.dueAt <= now);
        if (dueOath) {
          store.updateOath(dueOath.id, { status: "delivering" });
          store.save();
          return { continue: buildDeliveryPrompt(dueOath) };
        }
      })
    );
    log("turn_end handler registered (event mode)");
  }

  // ── Mode 2: setInterval polling ──────────────────────────────
  if (!hasTurnEvents) {
    if (intervalHandle) clearInterval(intervalHandle);
    intervalHandle = setInterval(pollCycle, POLL_INTERVAL_MS);
    pollCycle();
    log("Polling started (fallback mode)");
  }

  // ── list_oaths tool ──────────────────────────────────────────
  disposers.push(
    letta.tools.register({
      name: "list_oaths",
      description: "List all pending and recently delivered oaths (promises tracked by Oath Keeper).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      requiresApproval: false,
      parallelSafe: true,

      async run() {
        const store = StateStore.load("list_oaths");
        const pending = store.oaths.filter((o) => o.status === "pending");
        const recent = store.oaths.filter(
          (o) =>
            (o.status === "delivered" || o.status === "failed") &&
            o.deliveredAt && Date.now() - o.deliveredAt < 3_600_000
        );

        if (pending.length === 0 && recent.length === 0) {
          return "No oaths. Agents have kept their word.";
        }

        const mode = hasTurnEvents ? "events" : "polling";
        const lines = [`Oath Keeper (${mode}) — ${pending.length} pending, ${recent.length} recent`];
        for (const o of pending) {
          const secs = Math.max(0, Math.round((o.dueAt - Date.now()) / 1000));
          lines.push(`PENDING (${secs}s): "${o.promise.slice(0, 80)}"`);
        }
        for (const o of recent) {
          lines.push(`${o.status === "delivered" ? "OK" : "FAIL"}: "${o.promise.slice(0, 80)}"`);
        }
        return lines.join("\n");
      },
    })
  );

  log("list_oaths tool registered");

  return () => {
    for (const d of disposers.reverse()) {
      try { d(); } catch (e) {}
    }
    if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  };
}
