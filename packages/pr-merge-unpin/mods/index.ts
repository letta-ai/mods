import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const LETTA_HOME = join(homedir(), ".letta");
const PINNED_FILE = join(LETTA_HOME, "pinned-conversations.json");
const STATE_FILE = join(LETTA_HOME, "mods", "pr-merge-unpin.state.json");
const CHECK_MS = 5 * 60 * 1000;

function readJson(file, fallback) {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function entryKey(agentId, conversationId) {
  return `${agentId}:${conversationId}`;
}

function readPinnedAgents() {
  const parsed = readJson(PINNED_FILE, {});
  const source = parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.agents && typeof parsed.agents === "object"
    ? parsed.agents
    : parsed;
  const agents = {};
  if (!source || typeof source !== "object" || Array.isArray(source)) return agents;
  for (const [agentId, ids] of Object.entries(source)) {
    if (Array.isArray(ids)) {
      agents[agentId] = [...new Set(ids.filter((id) => typeof id === "string" && id.trim()))];
    }
  }
  return agents;
}

function removePinnedConversation(agentId, conversationId) {
  const agents = readPinnedAgents();
  const current = agents[agentId] ?? [];
  const next = current.filter((id) => id !== conversationId);
  if (next.length === current.length) return false;
  if (next.length > 0) agents[agentId] = next;
  else delete agents[agentId];
  writeJson(PINNED_FILE, { version: 1, agents });
  return true;
}

function isPinnedConversation(agentId, conversationId) {
  return (readPinnedAgents()[agentId] ?? []).includes(conversationId);
}

function readState() {
  const state = readJson(STATE_FILE, { version: 1, entries: {} });
  if (!state || typeof state !== "object" || Array.isArray(state)) return { version: 1, entries: {} };
  if (!state.entries || typeof state.entries !== "object" || Array.isArray(state.entries)) {
    state.entries = {};
  }
  return state;
}

async function gitRoot(cwd) {
  if (!cwd || !existsSync(cwd)) return null;
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 2_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function prForCurrentBranch(repoRoot) {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "view", "--json", "number,url,state,mergedAt"],
      { cwd: repoRoot, timeout: 5_000, maxBuffer: 1024 * 1024 },
    );
    const pr = JSON.parse(stdout);
    if (typeof pr.number !== "number") return null;
    return pr;
  } catch {
    return null;
  }
}

async function prByNumber(repoRoot, prNumber) {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "view", String(prNumber), "--json", "number,url,state,mergedAt"],
      { cwd: repoRoot, timeout: 5_000, maxBuffer: 1024 * 1024 },
    );
    const pr = JSON.parse(stdout);
    if (typeof pr.number !== "number") return null;
    return pr;
  } catch {
    return null;
  }
}

async function trackConversation(state, agentId, conversationId, cwd) {
  if (!agentId || !conversationId || conversationId === "default") return null;
  const repoRoot = await gitRoot(cwd);
  if (!repoRoot) return null;
  const pr = await prForCurrentBranch(repoRoot);
  if (!pr) return null;
  const key = entryKey(agentId, conversationId);
  state.entries[key] = {
    agentId,
    conversationId,
    repoRoot,
    prNumber: pr.number,
    prUrl: pr.url,
    state: pr.state,
    mergedAt: pr.mergedAt || null,
    updatedAt: new Date().toISOString(),
  };
  return state.entries[key];
}

async function checkTrackedEntries(state) {
  let checked = 0;
  let unpinned = 0;

  for (const [key, entry] of Object.entries({ ...state.entries })) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const { agentId, conversationId, repoRoot, prNumber } = entry;
    if (typeof agentId !== "string" || typeof conversationId !== "string" || typeof repoRoot !== "string") continue;
    if (typeof prNumber !== "number") continue;

    checked++;
    const pr = await prByNumber(repoRoot, prNumber);
    if (!pr) continue;
    entry.state = pr.state;
    entry.prUrl = pr.url;
    entry.mergedAt = pr.mergedAt || null;
    entry.updatedAt = new Date().toISOString();

    if (pr.state === "MERGED" || pr.mergedAt) {
      const hadPriorAttempt = Boolean(entry.unpinAttemptedAt);
      if (removePinnedConversation(agentId, conversationId)) unpinned++;
      entry.unpinAttemptedAt = new Date().toISOString();
      entry.unpinAttempts = Number(entry.unpinAttempts ?? 0) + 1;
      // Desktop renderer localStorage can briefly repopulate the durable pin file
      // from a stale in-memory snapshot. Keep merged entries until a later check
      // confirms the conversation stayed unpinned.
      if (hadPriorAttempt && !isPinnedConversation(agentId, conversationId)) {
        delete state.entries[key];
      }
    }
  }

  return { checked, unpinned };
}

async function runCheck(activeContext) {
  const state = readState();

  if (activeContext?.agentId && activeContext?.conversationId && activeContext?.cwd) {
    await trackConversation(state, activeContext.agentId, activeContext.conversationId, activeContext.cwd);
  }

  const result = await checkTrackedEntries(state);
  writeJson(STATE_FILE, state);
  return { ...result, tracking: Object.keys(state.entries).length };
}

export default function activate(letta) {
  const disposers = [];
  let running = false;

  const check = async (activeContext) => {
    if (running) return { skipped: true };
    running = true;
    try {
      return await runCheck(activeContext);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void check().catch((error) => {
      letta.diagnostics?.report?.({ severity: "warning", message: `pr-merge-unpin check failed: ${error?.message ?? error}` });
    });
  }, CHECK_MS);
  disposers.push(() => clearInterval(timer));

  void check().catch(() => {});

  if (letta.capabilities.events.lifecycle) {
    disposers.push(letta.events.on("conversation_open", (event, ctx) => {
      void check({ agentId: event.agentId, conversationId: event.conversationId, cwd: ctx.cwd }).catch(() => {});
    }));
  }

  if (letta.capabilities.commands) {
    disposers.push(letta.commands.register({
      id: "pr-merge-unpin",
      description: "Track pinned PR conversations and unpin them after merge",
      async run(ctx) {
        const result = await check({
          agentId: ctx.agent?.id,
          conversationId: ctx.conversation?.id,
          cwd: ctx.cwd,
        });
        if (result?.skipped) return { type: "output", output: "PR merge unpin check already running." };
        return {
          type: "output",
          output: `PR merge unpin: checked ${result.checked}, tracking ${result.tracking}, unpinned ${result.unpinned}.`,
        };
      },
    }));
  }

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
