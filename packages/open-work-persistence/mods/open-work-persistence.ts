// open-work-persistence — lets the agent resume declared open work without a
// user message. The agent maintains a small registry file; when a turn ends
// with work still open, this mod chains one follow-up turn, up to a durable
// budget that prevents runaway loops. Cross-session resumption still needs a
// cron or the next user message — this mod only continues an active session.
//
// Registry (JSON, agent-maintained), default path /var/lib/letta/workspace/OPEN-WORK.json
// (override with OPEN_WORK_REGISTRY). Shape:
//   {
//     "task": "short description of the open work",
//     "status": "open" | "done",
//     "conversation": "default",           // only chain inside this conversation
//     "chain_budget": 2,                    // max auto-chained turns, decremented durably
//     "updated_at": "2026-09-12T...Z"      // older than 6h => stale, never chain
//   }
//
// Guardrails: budget, staleness, conversation match, malformed file => never chain.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MAX_AGE_MS = 6 * 60 * 60 * 1000;

interface OpenWork {
  task?: unknown;
  status?: unknown;
  conversation?: unknown;
  chain_budget?: unknown;
  updated_at?: unknown;
}

function registryPath(): string {
  return process.env.OPEN_WORK_REGISTRY ?? "/var/lib/letta/workspace/OPEN-WORK.json";
}

function readRegistry(): OpenWork | null {
  try {
    const path = registryPath();
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as OpenWork;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export default function activate(letta: any) {
  if (!letta.capabilities?.events?.turns || !letta.events) return;

  return letta.events.on("turn_end", (event: any, _ctx: any) => {
    const registry = readRegistry();
    if (!registry) return;
    if (registry.status !== "open") return;

    // Only continue in the conversation where the work was declared.
    const conversationId = event?.conversationId;
    if (typeof conversationId !== "string" || registry.conversation !== conversationId) return;

    // Stale declarations are never chained — the world may have moved on.
    const updated = Date.parse(String(registry.updated_at ?? ""));
    if (!Number.isFinite(updated) || Date.now() - updated > MAX_AGE_MS) {
      letta.diagnostics?.report?.({
        message: "OPEN-WORK.json is open but older than 6h — not chaining. Update or close it.",
        severity: "warning",
      });
      return;
    }

    // Durable budget: decrement before chaining so a crash cannot reset it.
    const budget = Number(registry.chain_budget);
    if (!Number.isInteger(budget) || budget < 1) {
      letta.diagnostics?.report?.({
        message: "OPEN-WORK.json is open but chain_budget is exhausted or invalid — not chaining. Arrange a cron for cross-session resumption.",
        severity: "warning",
      });
      return;
    }
    try {
      const path = registryPath();
      const next: OpenWork = { ...registry, chain_budget: budget - 1, updated_at: new Date().toISOString() };
      writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
    } catch {
      return; // could not persist the decrement — do not chain
    }

    const task = typeof registry.task === "string" ? registry.task : "the open task";
    return {
      continue:
        `Automatic continuation (open-work-continuity mod, ${budget - 1} chain(s) left): ` +
        `the declared open work is: ${task}. Continue it now if genuinely still active and within ` +
        `its original authorization. If it is complete or blocked, update OPEN-WORK.json ` +
        `(status "done", or the precise blocker) and stop. Do not start unrelated new work.`,
    };
  });
}

export const __file = import.meta.url ? fileURLToPath(import.meta.url) : undefined;
