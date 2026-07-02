/**
 * Oath Keeper — Letta Code Mod
 *
 * "Cron is for things you plan. Oath Keeper is for things you promise."
 *
 * Passively detects when agents make follow-up promises and delivers on them.
 * Uses LLM-based detection for robust promise classification.
 *
 * Architecture:
 * - Detection: setInterval polls conversation API every 15s, LLM classifies
 * - Delivery: POST to conversation API with retry on 409
 * - State: local JSON file
 */

import fs from "node:fs";
import os from "node:os";

const HOME = os.homedir();
const STATE_FILE = `${HOME}/.letta/mods/oath-keeper.state.json`;
const ENV_FILE = `${HOME}/.letta/extensions/oath-env.json`;
const POLL_INTERVAL_MS = 15_000;
const DELAY_MS = 60_000;
const DEBUG = process.env.OATH_KEEPER_DEBUG === "1";

function log(msg: string) {
  if (DEBUG) console.log("[oath-keeper] " + msg);
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
  } catch (e) {
    return { oaths: [], lastScannedMessageId: null };
  }
}

function saveState(state: State): void {
  try {
    fs.mkdirSync(`${HOME}/.letta/mods`, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    log("Failed to save state: " + e);
  }
}

// ─── Promise Detection (LLM-based) ───────────────────────────────

// Cleanup helper: delete throwaway classification conversations
function cleanupConversation(baseUrl: string, apiKey: string | undefined, convId: string) {
  if (!convId) return;
  try {
    fetch(baseUrl + "/v1/conversations/" + convId, {
      method: "DELETE",
      headers: apiKey ? { Authorization: "Bearer " + apiKey } : {},
    }).catch(() => {});
    log("Cleaned up classification conversation " + convId);
  } catch (e) {
    // Non-critical — don't log, just move on
  }
}

async function detectPromise(text: string): Promise<{ promise: string } | null> {
  if (!text || typeof text !== "string") return null;
  if (text.includes("[Oath Keeper]") || text.includes("[Oath Delivered]")) return null;
  if (text.trim().length < 15) return null;

  // Quick pre-filter — skip messages with no promise indicators
  const hasIntent = /\b(i|i'll|ill|let me|i will)\b/i.test(text)
    && /\b(will|'ll|check|look|get back|follow up|back to you|report|update|send|share|verify|investigate|confirm|research|circle|dig)\b/i.test(text);
  if (!hasIntent) return null;

  // LLM classification via a separate conversation to avoid blocking
  const { baseUrl, apiKey, agentId } = getApiConfig();
  if (!agentId) return null;

  const classificationPrompt =
    'Analyze this assistant message. Does the assistant make a specific promise to do something LATER (after this response)? '
    + 'A promise means committing to follow up — not just answering inline.\n\n'
    + 'Message: """' + text.slice(0, 800) + '"""\n\n'
    + 'Respond with ONLY a JSON object:\n'
    + '- Promise found: {"promise": "<what they promise to do>"}\n'
    + '- No promise: {}';

  try {
    // Create a throwaway conversation for classification
    const convResp = await fetch(
      baseUrl + "/v1/conversations?agent_id=" + agentId,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}),
        },
        body: "{}",
      }
    );

    let classConvId = "";
    if (convResp.ok) {
      const convData: any = await convResp.json();
      classConvId = convData.id || "";
    }

    if (!classConvId) {
      log("Could not create classification conversation, falling back to regex");
      return detectPromiseRegex(text);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    const resp = await fetch(
      baseUrl + "/v1/conversations/" + classConvId + "/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}),
        },
        body: JSON.stringify({ input: classificationPrompt, role: "user" }),
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (!resp.ok) {
      log("Classification API returned " + resp.status + ", falling back to regex");
      // Cleanup: delete the throwaway conversation
      cleanupConversation(baseUrl, apiKey, classConvId);
      return detectPromiseRegex(text);
    }

    const respText = await resp.text();
    let result: { promise: string } | null = null;
    for (const line of respText.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        const d = JSON.parse(line.slice(6));
        if (d.message_type === "assistant_message" && d.content) {
          const jsonMatch = String(d.content).match(/\{[^}]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.promise && typeof parsed.promise === "string") {
              result = { promise: parsed.promise.slice(0, 300) };
              break;
            }
          }
        }
      } catch (e) {}
    }

    // Cleanup: delete the throwaway conversation
    cleanupConversation(baseUrl, apiKey, classConvId);

    return result;
  } catch (e) {
    log("LLM detection error: " + e + ", falling back to regex");
    return detectPromiseRegex(text);
  }
}

// Regex fallback (used when LLM classification is unavailable)
function detectPromiseRegex(text: string): { promise: string } | null {
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

// ─── Conversation API ────────────────────────────────────────────

function getApiConfig() {
  const baseUrl = process.env.LETTA_BASE_URL || "http://localhost:8283";
  const apiKey = process.env.LETTA_API_KEY;
  let agentId = process.env.LETTA_AGENT_ID || process.env.AGENT_ID || "";
  let convId = process.env.LETTA_CONVERSATION_ID || process.env.CONVERSATION_ID || "";
  if (agentId === "unset") agentId = "";
  if (convId === "unset") convId = "";

  if (!agentId || !convId) {
    try {
      const env = JSON.parse(fs.readFileSync(ENV_FILE, "utf8"));
      agentId = agentId || env.LETTA_AGENT_ID || env.AGENT_ID || "";
      convId = convId || env.LETTA_CONVERSATION_ID || env.CONVERSATION_ID || "";
    } catch (e) {}
  }

  return { baseUrl, apiKey, agentId, convId };
}

async function fetchLatestAgentMessage(): Promise<{ id: string; text: string; userContext: string } | null> {
  const { baseUrl, apiKey, agentId, convId } = getApiConfig();
  if (!agentId || !convId) return null;

  try {
    const resp = await fetch(
      baseUrl + "/v1/agents/" + agentId + "/messages?conversation_id=" + convId + "&limit=20",
      { headers: apiKey ? { Authorization: "Bearer " + apiKey } : {} }
    );
    if (!resp.ok) return null;

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
      if (assistantMsg) break;
    }

    return assistantMsg ? { ...assistantMsg, userContext } : null;
  } catch (e) {
    log("fetchLatestAgentMessage error: " + e);
    return null;
  }
}

async function deliverOath(oath: Oath): Promise<{ success: boolean; answer: string }> {
  const { baseUrl, apiKey, convId } = getApiConfig();
  const targetConv = (oath.conversationId && oath.conversationId !== "default")
    ? oath.conversationId : convId;

  if (!targetConv || targetConv === "default") {
    return { success: false, answer: "No conversation ID" };
  }

  const prompt = '[Oath Keeper] You previously promised the user:\n"'
    + oath.promise + '"\n\nOriginal context:\n"' + oath.context
    + '"\n\nDeliver on your promise now. Use your tools to investigate if needed. '
    + 'Provide a specific, concise answer. Start your response with "[Oath Delivered]".';

  log("Delivering oath " + oath.id + " to conversation " + targetConv + "...");

  for (let attempt = 1; attempt <= 5; attempt++) {
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
        log("Oath " + oath.id + " delivered on attempt " + attempt);
        return { success: true, answer: answer || "(delivered)" };
      } else if (resp.status === 409 || resp.status === 429) {
        log("Attempt " + attempt + ": API " + resp.status + ", retrying in 15s...");
        if (attempt < 5) { await new Promise(r => setTimeout(r, 15_000)); continue; }
        return { success: false, answer: "API " + resp.status + " after " + attempt + " attempts" };
      } else {
        return { success: false, answer: "API " + resp.status };
      }
    } catch (e) {
      log("Delivery attempt " + attempt + " error: " + e);
      if (attempt < 5) { await new Promise(r => setTimeout(r, 15_000)); continue; }
      return { success: false, answer: "Error: " + e };
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
    const { convId } = getApiConfig();
    const latest = await fetchLatestAgentMessage();
    if (latest && state.lastScannedMessageId !== latest.id) {
      state = loadState();
      state.lastScannedMessageId = latest.id;
      saveState(state);

      // LLM-based detection
      const detection = await detectPromise(latest.text);
      if (detection) {
        state = loadState();
        const exists = state.oaths.some((o) => o.sourceMessageId === latest.id);
        if (!exists) {
          const { agentId } = getApiConfig();
          const oath: Oath = {
            id: "oath-" + now + "-" + Math.random().toString(36).slice(2, 8),
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
          log('Promise detected: "' + detection.promise.slice(0, 60) + '..." -> oath ' + oath.id);
        }
      }
      saveState(state);
    }
  } catch (e) {
    log("Poll error: " + e);
  }
}

// ─── Mod Activation ──────────────────────────────────────────────

export default function activate(letta: any) {
  const disposers: Array<() => void> = [];

  if (!letta.capabilities.tools) {
    log("No tools capability — mod inactive");
    return () => {};
  }

  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(pollCycle, POLL_INTERVAL_MS);
  pollCycle();

  log("Polling started");

  disposers.push(
    letta.tools.register({
      name: "list_oaths",
      description:
        "List all pending and recently delivered oaths (promises tracked by Oath Keeper).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      requiresApproval: false,
      parallelSafe: true,

      async run() {
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
          "Oath Keeper — " + pending.length + " pending, " + recent.length + " recent",
        ];
        for (const o of pending) {
          const secs = Math.max(0, Math.round((o.dueAt - Date.now()) / 1000));
          lines.push('PENDING (' + secs + 's): "' + o.promise.slice(0, 80) + '"');
        }
        for (const o of recent) {
          lines.push(
            (o.status === "delivered" ? "OK" : "FAIL") + ': "' + o.promise.slice(0, 80) + '"'
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
