import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REFRESH_MS = 4_000;
const EXEC_TIMEOUT_MS = 1_500;
// Long branch names can overflow narrow statuslines, so cap the displayed
// length and add an ellipsis. The full name is never hidden in detached mode
// (we already show a short SHA there).
const MAX_BRANCH_CHARS = 22;

function truncateBranch(name: string): string {
  if (name.length <= MAX_BRANCH_CHARS) return name;
  return `${name.slice(0, MAX_BRANCH_CHARS - 1)}…`;
}

interface GitState {
  /** Current branch name (or short SHA when detached). */
  branch: string;
  /** True when in detached HEAD. */
  detached: boolean;
  /** Number of untracked / newly added files. */
  added: number;
  /** Number of modified (staged or unstaged) files. */
  modified: number;
  /** Number of deleted files. */
  deleted: number;
  /** Commits ahead of upstream. */
  ahead: number;
  /** Commits behind upstream. */
  behind: number;
  /** Whether an upstream is configured. */
  hasUpstream: boolean;
}

const EMPTY_STATE: GitState = {
  branch: "",
  detached: false,
  added: 0,
  modified: 0,
  deleted: 0,
  ahead: 0,
  behind: 0,
  hasUpstream: false,
};

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    timeout: EXEC_TIMEOUT_MS,
    windowsHide: true,
  });
  return stdout;
}

async function readGitState(cwd: string): Promise<GitState | null> {
  // Bail quietly if we are not inside a work tree.
  try {
    const inside = (
      await git(["rev-parse", "--is-inside-work-tree"], cwd)
    ).trim();
    if (inside !== "true") return null;
  } catch {
    return null;
  }

  const state: GitState = { ...EMPTY_STATE };

  // Use porcelain v2 with branch headers: a single call gives us branch,
  // upstream, ahead/behind, and per-file status.
  let porcelain = "";
  try {
    porcelain = await git(
      ["status", "--porcelain=v2", "--branch", "--untracked-files=all"],
      cwd,
    );
  } catch {
    return state;
  }

  for (const line of porcelain.split("\n")) {
    if (!line) continue;

    if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length).trim();
      if (head === "(detached)") {
        state.detached = true;
      } else {
        state.branch = head;
      }
      continue;
    }

    if (line.startsWith("# branch.oid ") && state.detached) {
      // Show a short SHA for detached HEAD.
      const oid = line.slice("# branch.oid ".length).trim();
      if (oid && oid !== "(initial)") state.branch = oid.slice(0, 7);
      continue;
    }

    if (line.startsWith("# branch.ab ")) {
      // Format: "# branch.ab +N -M"
      const ab = line.slice("# branch.ab ".length).trim().split(" ");
      const ahead = Number.parseInt(ab[0]?.replace("+", ""), 10);
      const behind = Number.parseInt(ab[1]?.replace("-", ""), 10);
      if (Number.isFinite(ahead)) state.ahead = ahead;
      if (Number.isFinite(behind)) state.behind = behind;
      state.hasUpstream = true;
      continue;
    }

    // Untracked entries start with "? ".
    if (line.startsWith("? ")) {
      state.added += 1;
      continue;
    }

    // Changed entries: "1" (ordinary) or "2" (renamed/copied). The XY field
    // is the 2nd token (e.g. ".M", "M.", "MM", "D.", ".D").
    if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const xy = line.split(" ")[1] ?? "..";
      if (xy.includes("A")) {
        // Staged additions count as "added".
        state.added += 1;
      } else if (xy.includes("D")) {
        state.deleted += 1;
      } else {
        state.modified += 1;
      }
    }
  }

  return state;
}

function formatSegment(state: GitState): string {
  const parts: string[] = [];

  // Branch (truncated if long).
  const rawBranch = state.branch || (state.detached ? "detached" : "?");
  parts.push(` ${truncateBranch(rawBranch)}`);

  // Ahead/behind vs upstream.
  if (state.hasUpstream && (state.ahead || state.behind)) {
    const ab: string[] = [];
    if (state.ahead) ab.push(`↑${state.ahead}`);
    if (state.behind) ab.push(`↓${state.behind}`);
    parts.push(ab.join(""));
  }

  // File counts, or a clean marker.
  const fileParts: string[] = [];
  if (state.added) fileParts.push(`+${state.added}`);
  if (state.modified) fileParts.push(`~${state.modified}`);
  if (state.deleted) fileParts.push(`-${state.deleted}`);

  if (fileParts.length > 0) {
    parts.push(fileParts.join(" "));
  } else {
    parts.push("✓");
  }

  return parts.join(" ");
}

export default function activate(letta: any) {
  if (!letta.capabilities.ui.panels) return;

  let latest: GitState | null = null;
  let currentCwd = process.cwd();

  // Track the live working directory from turn_start events so polling
  // follows the session's current directory rather than the launch directory.
  if (letta.capabilities.events?.turns) {
    letta.events.on("turn_start", (_event: any, context: any) => {
      if (typeof context.cwd === "string" && context.cwd) {
        currentCwd = context.cwd;
      }
    });
  }

  const update = async () => {
    let state: GitState | null = null;
    try {
      state = await readGitState(currentCwd);
    } catch {
      state = null;
    }

    latest = state;
    panel.update();
  };

  const panel = letta.ui.openPanel({
    id: "git-status",
    order: 0,
    render({ width, agent, model, row, chalk }: any) {
      const left = latest ? formatSegment(latest) : "";
      const dirty =
        !!latest && latest.added + latest.modified + latest.deleted > 0;
      const coloredLeft = left
        ? (dirty ? chalk.yellow : chalk.green)(left)
        : "";
      const right = `${chalk.dim(agent.name ?? "Letta")} · ${chalk.dim(model.displayName ?? model.id ?? "unknown")}`;
      return row(coloredLeft, right, width);
    },
  });

  void update();
  const timer = setInterval(() => void update(), REFRESH_MS);

  return () => {
    clearInterval(timer);
    panel.close();
  };
}
