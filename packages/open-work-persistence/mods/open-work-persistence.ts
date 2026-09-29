// Identity-scoped bounded continuation; never creates or replenishes declarations.
import fs from "node:fs";
import { join, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

export const MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const MAX_BUDGET = 15;
export function defaultRegistryRoot(home: string = homedir()): string {
  return join(home, ".letta", "open-work-v2");
}
const DEFAULT_ROOT = defaultRegistryRoot();
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

interface TurnEnd {
  agentId?: unknown;
  conversationId?: unknown;
  stopReason?: unknown;
}

// IDs are opaque single path components, never inferred from process agent env.
export function registryPath(root: string, agent: unknown, conversation: unknown): string | undefined {
  if (!isAbsolute(root) || typeof agent !== "string" || !ID.test(agent) ||
      typeof conversation !== "string" || !ID.test(conversation)) return;
  return join(root, agent, `${conversation}.json`);
}

function consume(root: string, event: TurnEnd): { continue: string } | undefined {
  const path = registryPath(root, event.agentId, event.conversationId);
  if (!path || event.stopReason !== "end_turn") return;
  const lock = `${path}.lock`;
  let lockFd: number | undefined;
  let fileFd: number | undefined;
  let dirFd: number | undefined;
  let temp: string | undefined;
  let result: { continue: string } | undefined;
  let failed = false;
  try {
    // Reject symlinked roots or ancestors in the trusted local registry tree.
    // This is a deployment check, not a defense against hostile same-UID races.
    if (fs.realpathSync.native(root) !== root || !fs.lstatSync(root).isDirectory()) return;
    // Exclusive creation coordinates independent processes. Never steal stale locks.
    lockFd = fs.openSync(lock, "wx", 0o600);
    dirFd = fs.openSync(join(root, event.agentId as string),
      fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    fileFd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fileFd);
    if (!stat.isFile() || stat.size > 16384) return;
    const record = JSON.parse(fs.readFileSync(fileFd, "utf8"));
    fs.closeSync(fileFd);
    fileFd = undefined;
    if (!record || Array.isArray(record) || record.schema_version !== 2 ||
        record.agent_id !== event.agentId || record.conversation_id !== event.conversationId ||
        record.status !== "open" || typeof record.task !== "string" ||
        !record.task.trim() || record.task.length > 4096 ||
        !Number.isSafeInteger(record.chain_budget) || record.chain_budget < 1 ||
        record.chain_budget > MAX_BUDGET || typeof record.updated_at !== "string") return;
    const updated = Date.parse(record.updated_at);
    const now = Date.now();
    // Canonical UTC timestamps only; no parser normalization or future declarations.
    if (!Number.isFinite(updated) || new Date(updated).toISOString() !== record.updated_at ||
        updated > now || now - updated >= MAX_AGE_MS) return;
    const remaining = record.chain_budget - 1;
    // Preserve declaration age: automatic turns must not refresh authorization.
    const next = { ...record, chain_budget: remaining };
    temp = `${path}.${randomUUID()}.tmp`;
    fileFd = fs.openSync(temp, "wx", 0o600);
    fs.writeFileSync(fileFd, JSON.stringify(next, null, 2) + "\n");
    fs.fsyncSync(fileFd);
    fs.closeSync(fileFd);
    fileFd = undefined;
    fs.renameSync(temp, path);
    temp = undefined;
    fs.fsyncSync(dirFd);
    result = {
      continue: `Automatic continuation (open-work-persistence, ${remaining} chain(s) left): ` +
        `the declared open work is: ${record.task}. Continue only if genuinely still active and ` +
        `within its original authorization. If complete or blocked, stop and mark this identity's ` +
        `v2 registry done or blocked. Never replenish the budget automatically, bypass consent, ` +
        `or start unrelated work.`,
    };
  } catch {
    failed = true; // Includes contention and every persistence failure: never chain.
  } finally {
    for (const fd of [fileFd, dirFd]) {
      if (fd !== undefined) try { fs.closeSync(fd); } catch { failed = true; }
    }
    if (temp) try { fs.unlinkSync(temp); } catch { failed = true; }
    if (lockFd !== undefined) {
      try {
        // A replaced lock pathname belongs to another owner. Retain our FD
        // while comparing; never intentionally unlink a different inode.
        const ours = fs.fstatSync(lockFd);
        const current = fs.lstatSync(lock);
        if (ours.dev !== current.dev || ours.ino !== current.ino) failed = true;
        else fs.unlinkSync(lock);
      } catch { failed = true; }
      try { fs.closeSync(lockFd); } catch { failed = true; }
    }
  }
  return failed ? undefined : result;
}

export default function activate(letta: any) {
  if (!letta.capabilities?.events?.turns || typeof letta.events?.on !== "function") return;
  // Capture configuration, not identity. Legacy OPEN_WORK_REGISTRY is never read.
  const root = process.env.OPEN_WORK_REGISTRY_ROOT ?? DEFAULT_ROOT;
  let disposed = false;
  const unsubscribe = letta.events.on("turn_end", (event: TurnEnd) => {
    if (disposed || !event || typeof event !== "object") return;
    return consume(root, event);
  });
  return () => {
    disposed = true;
    if (typeof unsubscribe === "function") unsubscribe();
  };
}

export const __file = fileURLToPath(import.meta.url);
