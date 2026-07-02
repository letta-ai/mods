/**
 * Oath Keeper — Letta Code Mod
 *
 * "Cron is for things you plan. Oath Keeper is for things you promise."
 *
 * Passively detects when agents make follow-up promises and delivers on them.
 * Zero user setup. Zero agent cooperation required.
 *
 * Architecture:
 * - Detection: setInterval polls conversation API every 15s for new messages
 * - Delivery: POST to conversation API with retry on 409 (busy conversation)
 * - State: local JSON file
 *
 * Works with capabilities: { tools: true } only.
 */

import fs from "node:fs";
import os from "node:os";

// ─── Config ──────────────────────────────────────────────────────

const HOME = os.homedir();
const STATE_FILE = `${HOME}/.letta/mods/oath-keeper.state.json`;
const ENV_FILE = `${HOME}/.letta/extensions/oath-env.json`;
const POLL_INTERVAL_MS = 15_000;
const DELAY_MS = 60_000;             // 60s demo mode
const DEBUG = true;

function log(msg: string) {
  if (DEBUG) console.log(`[oath-keeper] ${msg}`);
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
  status: "pending" | "delivering" | "delivered" | "failed";
  result: string | null;
  deliveredAt: number | null;
}

interface State {
  oaths: Oath[];
  lastScannedMessageId: string | null;
}

function loadState(): State {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      oaths: parsed.oaths || [],
      lastScannedMessageId: parsed.lastScannedMessageId || null,
    };
  } catch {
    return { oaths: [], lastScannedMessageId: null };
  }
}

function saveState(state: State): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    log(`Failed to save state: ${e}`);
  }
}

// ─── Promise Detection ───────────────────────────────────────────
//
// Patterns are anchored to direct-to-user phrasing. We exclude:
// - Text inside quotes (explaining what the mod catches)
// - Text inside code blocks or markdown formatting
// - Oath Keeper's own injected messages

const PROMISE_PATTERNS = [
  /i'll get back to (?:you|you on that|you with)/i,
  /i'll follow up (?:with you|on that|shortly|soon)?/i,
  /i'll let you know/i,
  /let me check .* and (?:respond|get back|let you know)/i,
  /i'll look into (?:that|this)/i,
  /i'll investigate(?: .*?)? and (?:report back|respond|get back)/i,
  /i'll check on (?:this|that)/i,
  /let me (?:verify|research|dig into|confirm) (?:that|this|it)/i,
  /i'll circle back/i,
  /i'll update you/i,
  /i'll share (?:that|this|it|the results?) (?:with|to) you/i,
  /i'll send you (?:the|those|that|a)/i,
  /i'll have (?:an answer|results|an update) (?:for you|soon|shortly)/i,
  /i'll report back/i,
];

function detectPromise(text: string): { promise: string } | null {
  if (!text || typeof text !== "string") return null;

  // Skip our own messages
  if (text.includes("[Oath Keeper]") || text.includes("[Oath Delivered]")) return null;

  // Strip code blocks, inline code, and blockquotes before scanning
  const cleaned = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/^>\s.*$/gm, "");

  // Skip quoted text (lines starting with optional whitespace then a quote char)
  // Also strip sentences that are clearly about the mod rather than promises
  const lines = cleaned.split("\n");
  const nonQuoteText = lines
    .filter((l) => !l.trim().startsWith('"') && !l.trim().startsWith('"'))
    .join(" ");

  for (const pattern of PROMISE_PATTERNS) {
    const match = nonQuoteText.match(pattern);
    if (match) {
      const start = match.index || 0;
      const sentStart = nonQuoteText.lastIndexOf(".", start) + 1;
      const sentEnd = nonQuoteText.indexOf(".", start + match[0].length);
      const end = sentEnd === -1 ? nonQuoteText.length : sentEnd + 1;
      const promise = nonQuoteText.slice(sentStart, end).trim();
      if (promise.length > 10 && promise.length < 300) {
        return { promise };
      }
    }
  }
  return null;
}

// ─── Conversation API ────────────────────────────────────────────

// Runtime-captured IDs — set by the first tool call (list_oaths) via ctx.
// Falls back to env vars or oath-env.json for headless/polling-only mode.
let runtimeAgentId = "";
let runtimeConvId = "";

function captureRuntimeIds(agentId: string, convId: string) {
  if (agentId && !runtimeAgentId) runtimeAgentId = agentId;
  if (convId && !runtimeConvId) runtimeConvId = convId;
}

function getApiConfig() {
  const baseUrl = process.env.LETTA_BASE_URL || "http://localhost:8283";
  const apiKey = process.env.LETTA_API_KEY;
  // TUI process sets these to the literal string "unset" — treat as empty
  let agentId = runtimeAgentId || process.env.LETTA_AGENT_ID || "";
  let convId = runtimeConvId || process.env.LETTA_CONVERSATION_ID || "";
  if (agentId === "unset") agentId = "";
  if (convId === "unset") convId = "";

  if (!agentId || !convId) {
    try {
      const env = JSON.parse(fs.readFileSync(ENV_FILE, "utf8"));
      agentId = agentId || env.LETTA_AGENT_ID || "";
      convId = convId || env.LETTA_CONVERSATION_ID || "";
    } catch (e) {}
  }

  return { baseUrl, apiKey, agentId, convId };
}

async function fetchLatestAgentMessage(): Promise<{ id: string; text: string; userContext: string } | null> {
  const { baseUrl, apiKey, agentId, convId } = getApiConfig();
  if (!agentId || !convId) return null;

  try {
    const resp = await fetch(
      `${baseUrl}/v1/agents/${agentId}/messages?conversation_id=${convId}&limit=20`,
      { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} },
    );
    if (!resp.ok) return null;

    const data = await resp.json();
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
      if (assistantMsg) break;
    }

    return assistantMsg ? { ...assistantMsg, userContext } : null;
  } catch (e) {
    log(`fetchLatestAgentMessage error: ${e}`);
    return null;
  }
}

async function deliverOath(oath: Oath): Promise<{ success: boolean; answer: string }> {
  const { baseUrl, apiKey, agentId, convId } = getApiConfig();
  const targetConv = (oath.conversationId && oath.conversationId !== "default")
    ? oath.conversationId : convId;

  if (!targetConv || targetConv === "default") {
    return { success: false, answer: "No conversation ID" };
  }

  const prompt = `[Oath Keeper] You previously promised the user:
"${oath.promise}"

Original context:
"${oath.context}"

Deliver on your promise now. Use your tools to investigate if needed. Provide a specific, concise answer. Start your response with "[Oath Delivered]".`;

  log(`Delivering oath ${oath.id} to conversation ${targetConv}...`);

  // Retry on 409 (conversation busy) with backoff
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45_000);

      const resp = await fetch(
        `${baseUrl}/v1/conversations/${targetConv}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({ input: prompt, role: "user" }),
          signal: controller.signal,
        }
      );
      clearTimeout(timeout);

      if (resp.ok) {
        const text = await resp.text();
        const lines = text.split("\n").filter((l) => l.startsWith("data: "));
        let answer = "";
        for (const line of lines) {
          try {
            const d = JSON.parse(line.slice(6));
            if (d.message_type === "assistant_message" && d.content) {
              answer = String(d.content).slice(0, 2000);
            }
          } catch (e) {}
        }
        log(`Oath ${oath.id} delivered on attempt ${attempt}`);
        return { success: true, answer: answer || "(delivered)" };
      } else if (resp.status === 409 || resp.status === 429) {
        log(`Attempt ${attempt}: API ${resp.status}, retrying in 15s...`);
        if (attempt < 5) { await new Promise(r => setTimeout(r, 15_000)); continue; }
        return { success: false, answer: `API ${resp.status} after ${attempt} attempts` };
      } else {
        return { success: false, answer: `API ${resp.status}` };
      }
    } catch (e) {
      log(`Delivery attempt ${attempt} error: ${e}`);
      if (attempt < 5) { await new Promise(r => setTimeout(r, 15_000)); continue; }
      return { success: false, answer: `Error: ${e}` };
    }
  }

  return { success: false, answer: "Max retries exceeded" };
}

// ─── Main Loop ───────────────────────────────────────────────────

let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function pollCycle() {
  try {
    let state = loadState();
    const now = Date.now();

    // 1. Deliver due oaths
    for (const oath of state.oaths) {
      if (oath.status === "pending" && oath.dueAt <= now) {
        oath.status = "delivering";
        saveState(state);

        const result = await deliverOath(oath);

        state = loadState();
        const o = state.oaths.find((x) => x.id === oath.id);
        if (o) {
          o.status = result.success ? "delivered" : "failed";
          o.result = result.answer?.slice(0, 500) || null;
          o.deliveredAt = Date.now();
        }
      }
    }

    // 2. Scan for new promises
    const { agentId, convId } = getApiConfig();
    saveState(state);
    const latest = await fetchLatestAgentMessage();
    if (latest && state.lastScannedMessageId !== latest.id) {
      state = loadState();
      state.lastScannedMessageId = latest.id;

      const detection = detectPromise(latest.text);
      if (detection) {
        const exists = state.oaths.some((o) => o.sourceMessageId === latest.id);
        if (!exists) {
          const oath: Oath = {
            id: `oath-${now}-${Math.random().toString(36).slice(2, 8)}`,
            conversationId: convId,
            agentId,
            promise: detection.promise,
            context: latest.userContext,
            sourceMessageId: latest.id,
            createdAt: now,
            dueAt: now + DELAY_MS,
            status: "pending",
            result: null,
            deliveredAt: null,
          };
          state.oaths.push(oath);
          log(`Promise detected: "${detection.promise.slice(0, 60)}..." → oath ${oath.id}`);
        }
      }
      saveState(state);
    }
  } catch (e) {
    log(`Poll error: ${e}`);
  }
}

// ─── Mod Activation ──────────────────────────────────────────────

export default function activate(letta: any) {
  const disposers: Array<() => void> = [];

  if (!letta.capabilities.tools) {
    log("No tools capability — mod inactive");
    return () => {};
  }

  // Start polling
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(pollCycle, POLL_INTERVAL_MS);
  pollCycle();

  log("Polling started");

  // list_oaths tool
  disposers.push(
    letta.tools.register({
      name: "list_oaths",
      description:
        "List all pending and recently delivered oaths (promises tracked by Oath Keeper).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      requiresApproval: false,
      parallelSafe: true,

      async run(ctx: any) {
        // Capture runtime IDs from tool context — eliminates need for oath-env.json
        if (ctx?.conversation?.id) captureRuntimeIds(ctx.agent?.id || "", ctx.conversation.id);
        if (ctx?.agent?.id) captureRuntimeIds(ctx.agent.id, ctx?.conversation?.id || "");

        const state = loadState();
        const pending = state.oaths.filter((o) => o.status === "pending");
        const recent = state.oaths.filter(
          (o) =>
            (o.status === "delivered" || o.status === "failed") &&
            o.deliveredAt &&
            Date.now() - o.deliveredAt < 3_600_000
        );

        if (pending.length === 0 && recent.length === 0) {
          return "No oaths. Agents have kept their word.";
        }

        const lines: string[] = [
          `Oath Keeper — ${pending.length} pending, ${recent.length} recent`,
        ];
        for (const o of pending) {
          const mins = Math.max(0, Math.round((o.dueAt - Date.now()) / 60_000));
          lines.push(`PENDING (${mins}m): "${o.promise.slice(0, 80)}"`);
        }
        for (const o of recent) {
          lines.push(
            `${o.status === "delivered" ? "OK" : "FAIL"}: "${o.promise.slice(0, 80)}"`
          );
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
