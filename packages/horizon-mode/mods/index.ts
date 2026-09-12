import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  promises as fs,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_BUDGET_SECS = 72_000;
const DEFAULT_RESERVE_SECS = 600;
const MAX_MEMORY_BYTES = 60_000;

type Mode = "auto" | "on" | "off";

type Submission = {
  commit: string;
  subject: string;
  recordedAt: string;
};

type ConversationState = {
  mode?: Mode;
  active?: boolean;
  startedAt?: number;
  turnNumber?: number;
  toolsThisTurn?: number;
  submissionCount?: number;
  submissions?: Submission[];
  pendingCommit?: string | null;
  pendingTurn?: number | null;
  confirmed?: boolean;
  totalBudgetSecs?: number;
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
      turnNumber: 0,
      toolsThisTurn: 0,
      submissionCount: 0,
      submissions: [],
      pendingCommit: null,
      pendingTurn: null,
      confirmed: false,
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

function memoryRoot(ctx: any): string | null {
  if (ctx.memfs?.memoryDir) return path.resolve(ctx.memfs.memoryDir);
  if (process.env.MEMORY_DIR) return path.resolve(process.env.MEMORY_DIR);
  if (ctx.agent?.id) {
    return path.join(homedir(), ".letta", "agents", ctx.agent.id, "memory");
  }
  return null;
}

async function memoryIndexExcerpt(ctx: any): Promise<string> {
  const root = memoryRoot(ctx);
  if (!root) return "";
  const candidates = [path.join(root, "reference", "MEMORY.md"), path.join(root, "MEMORY.md")];
  for (const candidate of candidates) {
    try {
      const text = await fs.readFile(candidate, "utf8");
      return `\n\nDeferred-memory index (use read_deferred_memory for linked files):\n${text.slice(0, 12_000)}`;
    } catch {
      // Try the next conventional index path.
    }
  }
  return "";
}

async function gitCommit(cwd: string, requested: string): Promise<{
  full: string;
  short: string;
  subject: string;
  dirty: string;
}> {
  const [{ stdout: full }, { stdout: dirty }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "--verify", `${requested}^{commit}`], {
      cwd,
      timeout: 5_000,
      maxBuffer: 64_000,
    }),
    execFileAsync("git", ["status", "--porcelain"], {
      cwd,
      timeout: 5_000,
      maxBuffer: 256_000,
    }),
  ]);
  const hash = full.trim();
  const { stdout: subject } = await execFileAsync("git", ["show", "-s", "--format=%s", hash], {
    cwd,
    timeout: 5_000,
    maxBuffer: 64_000,
  });
  return { full: hash, short: hash.slice(0, 12), subject: subject.trim(), dirty: dirty.trim() };
}

function continuationPrompt(info: Awaited<ReturnType<typeof runtime>>, state: ConversationState): string {
  const pending = state.pendingCommit
    ? `Checkpoint ${state.pendingCommit.slice(0, 12)} is recorded, but final submission is not confirmed.`
    : "No final submission is confirmed.";
  return [
    "<system-reminder>",
    "Horizon mode is active for this long-running task.",
    budgetLine(info),
    pending,
    "Continue working autonomously. Do not stop at a plausible implementation or a smoke test: measure the actual objective, search for another improvement, test held-out/generalization behavior, and preserve known-good checkpoints.",
    "When certain the best clean commit is ready, call submit({commit}) once to record it, then call submit with the same commit as the only tool action of a later turn to confirm and end.",
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
    && letta.capabilities.events.tools
  ) {
    disposers.push(letta.tools.register({
      name: "submit",
      description: "Record a clean git commit as a benchmark checkpoint. Call again with the same commit as the only tool action of a later turn to confirm the final submission and end the run.",
      parameters: {
        type: "object",
        properties: {
          commit: {
            type: "string",
            description: "Git commit hash or unambiguous revision to checkpoint.",
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
        try {
          commit = await gitCommit(ctx.cwd, requested);
        } catch (error: any) {
          return { status: "error", content: `Cannot submit ${requested}: ${error?.stderr?.trim() || error?.message || "not a git commit"}` };
        }
        if (commit.dirty) {
          return {
            status: "error",
            content: `Working tree is not clean, so commit ${commit.short} would omit changes. Commit or revert them first.\n${commit.dirty.slice(0, 4_000)}`,
          };
        }

        const samePending = state.pendingCommit === commit.full;
        const laterTurn = (state.turnNumber ?? 0) > (state.pendingTurn ?? -1);
        const onlyToolThisTurn = (state.toolsThisTurn ?? 0) <= 1;
        const info = active;

        if (samePending && laterTurn && onlyToolThisTurn) {
          state.confirmed = true;
          state.pendingCommit = null;
          state.pendingTurn = null;
          await saveState();
          return `Final submission confirmed for ${commit.short} (\"${commit.subject}\"). Ending the session.`;
        }

        state.submissionCount = (state.submissionCount ?? 0) + 1;
        state.submissions = [
          ...(state.submissions ?? []),
          { commit: commit.full, subject: commit.subject, recordedAt: new Date().toISOString() },
        ];
        state.pendingCommit = commit.full;
        state.pendingTurn = state.turnNumber ?? 0;
        state.confirmed = false;
        await saveState();
        const suffix = samePending && !laterTurn
          ? " Confirmation must occur in a later turn."
          : "";
        return `Submission #${state.submissionCount} recorded from commit ${commit.short} (\"${commit.subject}\"). ${budgetLine(info)} You can continue working and submit again later; this checkpoint is preserved. If certain nothing more can be gained, call submit again with the same commit as your only tool action in a later turn to confirm the final submission.${suffix}`;
      },
    }));
  }

  if (letta.capabilities.tools) {
    disposers.push(letta.tools.register({
      name: "read_deferred_memory",
      description: "Read a deferred memory index or linked Markdown file from the active agent's MemFS. Call this at the start of a long-running task when system memory names reference files that are not in the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path relative to the memory root. Defaults to reference/MEMORY.md.",
          },
        },
        additionalProperties: false,
      },
      requiresApproval: false,
      parallelSafe: true,
      async run(ctx: any) {
        const root = memoryRoot(ctx);
        if (!root) return { status: "error", content: "This agent has no projected memory directory." };
        const requested = String(ctx.args.path ?? "reference/MEMORY.md");
        if (path.isAbsolute(requested) || path.win32.isAbsolute(requested)) {
          return { status: "error", content: "Path must be relative to the agent memory directory." };
        }
        const relative = requested.replace(/^\/+/, "");
        const target = path.resolve(root, relative);
        if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
          return { status: "error", content: "Path must remain inside the agent memory directory." };
        }
        if (!target.endsWith(".md")) {
          return { status: "error", content: "Only Markdown memory files can be read." };
        }
        try {
          const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
          if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${path.sep}`)) {
            return { status: "error", content: "Linked memory file resolves outside the agent memory directory." };
          }
          if (!realTarget.endsWith(".md")) {
            return { status: "error", content: "Only Markdown memory files can be read." };
          }
          const text = await fs.readFile(realTarget, "utf8");
          if (Buffer.byteLength(text, "utf8") > MAX_MEMORY_BYTES) {
            return `${text.slice(0, MAX_MEMORY_BYTES)}\n\n[Truncated; request a more specific linked file.]`;
          }
          return text;
        } catch (error: any) {
          return { status: "error", content: `Cannot read ${relative}: ${error?.message ?? "file not found"}` };
        }
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
          state.confirmed = false;
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
            `Pending: ${current.pendingCommit?.slice(0, 12) ?? "none"}`,
            `Final confirmed: ${current.confirmed ? "yes" : "no"}`,
          ].join("\n"),
        };
      },
    }));
  }

  if (letta.capabilities.events.turns) {
    disposers.push(letta.events.on("turn_start", async (event: any, ctx: any) => {
      const state = stateFor(ctx);
      const info = await runtime(ctx);
      state.active = info.active;
      if (!info.active) {
        return;
      }
      state.turnNumber = (state.turnNumber ?? 0) + 1;
      state.toolsThisTurn = 0;
      const memory = await memoryIndexExcerpt(ctx);
      event.input = prependReminder(event.input, `${continuationPrompt(info, state)}${memory}`);
      await saveState();
      return { input: event.input };
    }));

    disposers.push(letta.events.on("turn_end", async (event: any, ctx: any) => {
      const state = stateFor(ctx);
      const info = await runtime(ctx);
      await saveState();
      if (!info.active || state.confirmed) return;
      if (info.remaining !== null && info.remaining <= info.reserve) return;
      const stop = String(event.stopReason ?? "").toLowerCase();
      if (/(error|cancel|interrupt|abort)/.test(stop)) return;
      return { continue: continuationPrompt(info, state) };
    }));
  }

  if (letta.capabilities.events.tools) {
    disposers.push(letta.events.on("tool_start", async (event: any, ctx: any) => {
      const state = stateFor(ctx);
      if (!state.active) return;
      state.toolsThisTurn = (state.toolsThisTurn ?? 0) + 1;
      if (event.toolName !== "submit") {
        state.pendingCommit = null;
        state.pendingTurn = null;
        state.confirmed = false;
      }
      await saveState();
    }));
  }

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
