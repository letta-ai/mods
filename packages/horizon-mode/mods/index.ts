import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_BUDGET_SECS = 72_000;
const DEFAULT_RESERVE_SECS = 600;
const STAGNANT_TURN_LIMIT = 3;
const REPOSITORY_SEARCH_DEPTH = 2;

type Mode = "auto" | "on" | "off";

type Submission = {
  commit: string;
  subject: string;
  repository: string;
  recordedAt: string;
  bundlePath?: string;
};

type ConversationState = {
  mode?: Mode;
  startedAt?: number;
  submissionCount?: number;
  submissions?: Submission[];
  totalBudgetSecs?: number;
  toolsThisTurn?: number;
  lastTurnCheckpoint?: string | null;
  lastAssistantFingerprint?: string | null;
  stagnantTurns?: number;
  pausedForStagnation?: boolean;
};

type PersistedState = {
  conversations: Record<string, ConversationState>;
};

let store: PersistedState = { conversations: {} };

export function getStatePath(): string {
  return process.env.HORIZON_STATE_PATH
    ? path.resolve(process.env.HORIZON_STATE_PATH)
    : path.join(homedir(), ".letta", "mods", "horizon-mode.state.json");
}

function conversationKey(ctx: any): string {
  return ctx.conversation?.id ?? ctx.agent?.id ?? "unknown";
}

function stateFor(ctx: any): ConversationState {
  const key = conversationKey(ctx);
  if (!store.conversations[key]) {
    store.conversations[key] = {
      mode: "auto",
      startedAt: Date.now(),
      submissionCount: 0,
      submissions: [],
      toolsThisTurn: 0,
      stagnantTurns: 0,
    };
  }
  return store.conversations[key];
}

function loadState(): void {
  const statePath = getStatePath();
  try {
    if (!existsSync(statePath)) {
      store = { conversations: {} };
      return;
    }
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.conversations) {
      store = parsed;
      return;
    }
  } catch {
    // A malformed state file should not prevent Letta Code from starting.
  }
  store = { conversations: {} };
}

function saveState(): void {
  const statePath = getStatePath();
  const temporary = `${statePath}.tmp`;
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  renameSync(temporary, statePath);
}

function parsePositiveInt(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function timerRemaining(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("sandbox-timer", ["remaining"], {
      timeout: 2_000,
      maxBuffer: 16_384,
    });
    const parsed = Number.parseInt(stdout.trim(), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

async function runtime(ctx: any): Promise<{
  active: boolean;
  remaining: number | null;
  elapsed: number;
  total: number;
  reserve: number;
}> {
  const state = stateFor(ctx);
  const envMode = process.env.HORIZON_MODE?.trim().toLowerCase();
  const mode: Mode = envMode === "1" || envMode === "on"
    ? "on"
    : envMode === "0" || envMode === "off"
      ? "off"
      : state.mode ?? "auto";
  const timer = mode === "off" ? null : await timerRemaining();
  const configuredTotal = parsePositiveInt(process.env.TASK_BUDGET_SECS);
  const total = configuredTotal ?? state.totalBudgetSecs ?? DEFAULT_BUDGET_SECS;
  const elapsed = Math.max(0, Math.floor((Date.now() - (state.startedAt ?? Date.now())) / 1_000));
  const remaining = timer ?? (mode === "on" ? Math.max(0, total - elapsed) : null);
  const reserve = parsePositiveInt(process.env.HORIZON_RESERVE_SECS) ?? DEFAULT_RESERVE_SECS;
  state.totalBudgetSecs = total;
  return {
    active: mode === "on" || (mode === "auto" && timer !== null),
    remaining,
    elapsed,
    total,
    reserve,
  };
}

function duration(seconds: number | null): string {
  if (seconds === null) return "unknown";
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function budgetLine(info: Awaited<ReturnType<typeof runtime>>): string {
  if (info.remaining === null) return "Remaining task budget: unknown.";
  const percentage = info.total > 0 ? Math.max(0, Math.min(100, Math.round((100 * info.remaining) / info.total))) : 0;
  return `Remaining task budget: ${duration(info.remaining)} (${percentage}%).`;
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function nestedGitRepositories(root: string, depth = REPOSITORY_SEARCH_DEPTH): string[] {
  const repositories: string[] = [];
  const visit = (directory: string, remaining: number) => {
    if (existsSync(path.join(directory, ".git"))) {
      repositories.push(directory);
      if (directory !== root) return;
    }
    if (remaining === 0) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".git" || entry.name === ".letta" || entry.name === "node_modules") continue;
      visit(path.join(directory, entry.name), remaining - 1);
    }
  };
  visit(path.resolve(root), depth);
  return repositories;
}

async function repositoryRoot(directory: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
    cwd: directory,
    timeout: 5_000,
    maxBuffer: 64_000,
  });
  return path.resolve(stdout.trim());
}

async function resolvesCommit(repository: string, requested: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", `${requested}^{commit}`], {
      cwd: repository,
      timeout: 5_000,
      maxBuffer: 64_000,
    });
    return true;
  } catch {
    return false;
  }
}

async function resolveRepository(cwd: string, requested: string, supplied?: string): Promise<string> {
  const workspace = path.resolve(cwd);
  if (supplied) {
    const candidate = path.resolve(workspace, supplied);
    if (!isInside(workspace, candidate)) {
      throw new Error(`repository must be inside the active workspace (${workspace})`);
    }
    const root = await repositoryRoot(candidate);
    if (!isInside(workspace, root)) {
      throw new Error(`repository root must be inside the active workspace (${workspace})`);
    }
    if (!await resolvesCommit(root, requested)) {
      throw new Error(`commit ${requested} does not exist in ${root}`);
    }
    return root;
  }

  const candidates = new Set(nestedGitRepositories(workspace));
  try {
    const root = await repositoryRoot(workspace);
    if (isInside(workspace, root)) candidates.add(root);
  } catch {
    // The task root may contain a nested repository rather than being one.
  }
  const matches: string[] = [];
  for (const candidate of candidates) {
    if (await resolvesCommit(candidate, requested)) matches.push(candidate);
  }
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    const searched = [...candidates];
    throw new Error(searched.length
      ? `commit ${requested} was not found in: ${searched.join(", ")}`
      : `no Git repository found within ${REPOSITORY_SEARCH_DEPTH} levels of ${workspace}`);
  }
  throw new Error(`commit ${requested} is ambiguous; pass repository explicitly. Matches: ${matches.join(", ")}`);
}

async function gitCommit(repository: string, requested: string): Promise<{
  full: string;
  short: string;
  subject: string;
  dirty: string;
  head: string;
}> {
  const [{ stdout: full }, { stdout: dirty }, { stdout: head }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "--verify", `${requested}^{commit}`], {
      cwd: repository,
      timeout: 5_000,
      maxBuffer: 64_000,
    }),
    execFileAsync("git", ["status", "--porcelain"], {
      cwd: repository,
      timeout: 5_000,
      maxBuffer: 256_000,
    }),
    execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      timeout: 5_000,
      maxBuffer: 64_000,
    }),
  ]);
  const hash = full.trim();
  const { stdout: subject } = await execFileAsync("git", ["show", "-s", "--format=%s", hash], {
    cwd: repository,
    timeout: 5_000,
    maxBuffer: 64_000,
  });
  return { full: hash, short: hash.slice(0, 12), subject: subject.trim(), dirty: dirty.trim(), head: head.trim() };
}

async function exportBundle(repository: string, commit: string, ctx: any): Promise<string | null> {
  const configured = process.env.HORIZON_CHECKPOINT_DIR?.trim();
  if (!configured) return null;
  const destination = path.resolve(configured);
  mkdirSync(destination, { recursive: true });
  const scope = conversationKey(ctx).replace(/[^A-Za-z0-9._-]/g, "_");
  const repositoryId = createHash("sha256").update(repository).digest("hex").slice(0, 12);
  const filename = `${scope}-${path.basename(repository)}-${repositoryId}-${commit}.bundle`;
  const finalPath = path.join(destination, filename);
  const temporary = `${finalPath}.tmp-${process.pid}`;
  await execFileAsync("git", ["bundle", "create", temporary, "HEAD"], {
    cwd: repository,
    timeout: 120_000,
    maxBuffer: 1_000_000,
  });
  try {
    await execFileAsync("git", ["bundle", "verify", temporary], {
      cwd: repository,
      timeout: 120_000,
      maxBuffer: 1_000_000,
    });
    renameSync(temporary, finalPath);
  } catch (error) {
    try {
      if (existsSync(temporary)) renameSync(temporary, `${temporary}.invalid`);
    } catch {
      // Preserve the original verification error.
    }
    throw error;
  }
  const manifestPath = `${finalPath}.json`;
  const manifestTemporary = `${manifestPath}.tmp-${process.pid}`;
  writeFileSync(manifestTemporary, `${JSON.stringify({
    version: 1,
    conversationId: conversationKey(ctx),
    repository,
    commit,
    bundlePath: finalPath,
    recordedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  renameSync(manifestTemporary, manifestPath);
  return finalPath;
}

function checkpointKey(state: ConversationState): string | null {
  const latest = state.submissions?.at(-1);
  return latest ? `${latest.repository}:${latest.commit}` : null;
}

function assistantFingerprint(message: unknown): string | null {
  const normalized = String(message ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return normalized ? createHash("sha256").update(normalized).digest("hex") : null;
}

function completionMessage(message: unknown): boolean {
  return /\b(task complete|completed|complete|finished|latest clean checkpoint|clean checkpoint)\b/i.test(String(message ?? ""));
}

function continuationPrompt(info: Awaited<ReturnType<typeof runtime>>, state: ConversationState): string {
  const latest = state.submissions?.at(-1);
  const checkpoint = latest
    ? `Latest workspace checkpoint: ${latest.commit.slice(0, 12)} (\"${latest.subject}\").`
    : "No workspace checkpoint has been recorded yet.";
  return [
    "<system-reminder>",
    "Horizon mode is active for this long-running task.",
    budgetLine(info),
    checkpoint,
    "Maintain /tmp/horizon/PROGRESS.md as a compact recovery ledger. Create it early, read it after compaction or continuation, and update it after objective measurements, checkpoints, strategy changes, and before long-running commands. Record the real baseline and best result, latest checkpoint, validation status, failed experiments, and next action.",
    "Continue working autonomously. Do not stop at a plausible implementation or a smoke test: measure the actual objective, search for another improvement, test held-out/generalization behavior, and preserve known-good checkpoints.",
    "Use submit({commit}) whenever you have a better clean checkpoint. Checkpointing is nonterminal and does not end Horizon mode; the external task budget controls when work stops.",
    `If you repeatedly report completion without using tools or producing a new checkpoint, Horizon pauses after ${STAGNANT_TURN_LIMIT} identical no-op turns.`,
    "</system-reminder>",
  ].join("\n");
}

function prependReminder(input: any[], reminder: string): any[] {
  let added = false;
  return input.map((message) => {
    if (added || message?.role !== "user") return message;
    added = true;
    const part = { type: "text", text: reminder };
    if (typeof message.content === "string") {
      return { ...message, content: [part, { type: "text", text: message.content }] };
    }
    if (Array.isArray(message.content)) {
      return { ...message, content: [part, ...message.content] };
    }
    return { ...message, content: [part] };
  });
}

export default function activate(letta: any) {
  loadState();
  const disposers: Array<() => void> = [];

  if (
    letta.capabilities.tools
    && letta.capabilities.events.turns
  ) {
    disposers.push(letta.tools.register({
      name: "submit",
      description: "Record a clean Git HEAD as the latest benchmark checkpoint without ending Horizon mode. Pass repository when the Git repository is nested below the active workspace.",
      parameters: {
        type: "object",
        properties: {
          commit: {
            type: "string",
            description: "Git commit hash or unambiguous revision to checkpoint.",
          },
          repository: {
            type: "string",
            description: "Optional repository path, relative to or inside the active workspace. Horizon otherwise searches the workspace and nested directories.",
          },
        },
        required: ["commit"],
        additionalProperties: false,
      },
      requiresApproval: false,
      parallelSafe: false,
      async run(ctx: any) {
        const state = stateFor(ctx);
        const active = await runtime(ctx);
        if (!active.active) {
          return { status: "error", content: "Horizon mode is inactive. Use /horizon on or provide sandbox-timer." };
        }
        const requested = String(ctx.args.commit ?? "").trim();
        if (!requested) return { status: "error", content: "commit is required" };

        let commit;
        let repository;
        try {
          repository = await resolveRepository(ctx.cwd, requested, String(ctx.args.repository ?? "").trim() || undefined);
          commit = await gitCommit(repository, requested);
        } catch (error: any) {
          return { status: "error", content: `Cannot submit ${requested}: ${error?.stderr?.trim() || error?.message || "not a git commit"}` };
        }
        if (commit.full !== commit.head) {
          return {
            status: "error",
            content: `Commit ${commit.short} is not HEAD of ${repository}. Commit or check out the exact checkpoint first (current HEAD: ${commit.head.slice(0, 12)}).`,
          };
        }
        if (commit.dirty) {
          return {
            status: "error",
            content: `Working tree is not clean, so commit ${commit.short} would omit changes. Commit or revert them first.\n${commit.dirty.slice(0, 4_000)}`,
          };
        }

        let bundlePath: string | null;
        try {
          bundlePath = await exportBundle(repository, commit.full, ctx);
        } catch (error: any) {
          return {
            status: "error",
            content: `Checkpoint ${commit.short} is clean, but external bundle export failed: ${error?.stderr?.trim() || error?.message || "unknown error"}`,
          };
        }
        const info = active;

        state.submissionCount = (state.submissionCount ?? 0) + 1;
        state.submissions = [
          ...(state.submissions ?? []),
          {
            commit: commit.full,
            subject: commit.subject,
            repository,
            recordedAt: new Date().toISOString(),
            ...(bundlePath ? { bundlePath } : {}),
          },
        ];
        state.stagnantTurns = 0;
        state.pausedForStagnation = false;
        await saveState();
        const durability = bundlePath
          ? `Verified external bundle: ${bundlePath}.`
          : "Workspace checkpoint only; HORIZON_CHECKPOINT_DIR is not configured, so this commit will not survive sandbox deletion.";
        return `Submission #${state.submissionCount} recorded from ${repository} at commit ${commit.short} (\"${commit.subject}\"). ${durability} ${budgetLine(info)} Update /tmp/horizon/PROGRESS.md with this checkpoint and its validation evidence. This is nonterminal: continue improving and submit again when you have a better clean checkpoint.`;
      },
    }));
  }

  if (letta.capabilities.commands && letta.capabilities.events.turns) {
    disposers.push(letta.commands.register({
      id: "horizon",
      description: "Control long-horizon autonomous work mode",
      args: "on|off|auto|status|reset",
      async run(ctx: any) {
        const action = ctx.args.trim().toLowerCase() || "status";
        const state = stateFor(ctx);
        if (["on", "off", "auto"].includes(action)) {
          state.mode = action as Mode;
          state.startedAt = Date.now();
          state.pausedForStagnation = false;
          state.stagnantTurns = 0;
          await saveState();
        } else if (action === "reset") {
          store.conversations[conversationKey(ctx)] = { mode: state.mode ?? "auto", startedAt: Date.now() };
          await saveState();
        } else if (action !== "status") {
          return { type: "output", output: "Usage: /horizon on|off|auto|status|reset" };
        }
        const current = stateFor(ctx);
        const info = await runtime(ctx);
        return {
          type: "output",
          output: [
            `Horizon mode: ${current.mode ?? "auto"} (${info.active ? "active" : "inactive"})`,
            budgetLine(info),
            `Submissions: ${current.submissionCount ?? 0}`,
            `Latest checkpoint: ${current.submissions?.at(-1)?.commit.slice(0, 12) ?? "none"}`,
            `Repository: ${current.submissions?.at(-1)?.repository ?? "none"}`,
            `External bundle: ${current.submissions?.at(-1)?.bundlePath ?? "none"}`,
            `Continuation: ${current.pausedForStagnation ? "paused after stagnant completion turns" : "running"}`,
          ].join("\n"),
        };
      },
    }));
  }

  if (letta.capabilities.events.turns) {
    disposers.push(letta.events.on("turn_start", async (event: any, ctx: any) => {
      const state = stateFor(ctx);
      const info = await runtime(ctx);
      if (!info.active) {
        return;
      }
      state.pausedForStagnation = false;
      state.toolsThisTurn = 0;
      event.input = prependReminder(event.input, continuationPrompt(info, state));
      await saveState();
      return { input: event.input };
    }));

    disposers.push(letta.events.on("turn_end", async (event: any, ctx: any) => {
      const state = stateFor(ctx);
      const info = await runtime(ctx);
      if (!info.active) return;
      if (info.remaining !== null && info.remaining <= info.reserve) return;
      const stop = String(event.stopReason ?? "").toLowerCase();
      if (/(error|cancel|interrupt|abort)/.test(stop)) return;

      if (letta.capabilities.events.tools) {
        const currentCheckpoint = checkpointKey(state);
        const fingerprint = assistantFingerprint(event.assistantMessage);
        const completionOnly = (state.toolsThisTurn ?? 0) === 0
          && currentCheckpoint === (state.lastTurnCheckpoint ?? null)
          && fingerprint !== null
          && completionMessage(event.assistantMessage);
        state.stagnantTurns = completionOnly
          ? fingerprint === state.lastAssistantFingerprint
            ? (state.stagnantTurns ?? 0) + 1
            : 1
          : 0;
        state.lastTurnCheckpoint = currentCheckpoint;
        state.lastAssistantFingerprint = fingerprint;
        if ((state.stagnantTurns ?? 0) >= STAGNANT_TURN_LIMIT) {
          state.pausedForStagnation = true;
          await saveState();
          return;
        }
      }
      await saveState();
      return { continue: continuationPrompt(info, state) };
    }));
  }

  if (letta.capabilities.events.tools) {
    disposers.push(letta.events.on("tool_start", async (event: any, ctx: any) => {
      const state = stateFor(ctx);
      if (event.toolName !== "submit") {
        state.toolsThisTurn = (state.toolsThisTurn ?? 0) + 1;
        state.stagnantTurns = 0;
        state.pausedForStagnation = false;
        await saveState();
      }
    }));
  }

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
