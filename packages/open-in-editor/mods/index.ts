// Open files in your editor as the agent touches them.
//
// Two modes, auto-selected based on environment:
// - Inside tmux: split-pane with :e send-keys (preserves buffers, auto-open)
// - Outside tmux: fullscreen editor handoff — exits the alt screen, blocks
//   the event loop while the editor runs with inherited stdio, then
//   re-enters and forces a re-render. No external dependencies needed.
//
// Commands: /edit [path], /editclose
// Config: ~/.letta/mods/editor-config.json
//   { "editor": "nvim", "autoOpen": true, "tmuxSize": 38 }

import { execFileSync, execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ─── Config ──────────────────────────────────────────────────────────

const CONFIG_PATH = join(homedir(), ".letta", "mods", "editor-config.json");

interface EditorConfig {
  /** Editor binary name (default: $VISUAL, $EDITOR, or "nvim") */
  editor: string;
  /** Auto-open files when the agent edits them — tmux only (default: true) */
  autoOpen: boolean;
  /** tmux split pane width as percentage of the window (default: 38) */
  tmuxSize: number;
}

const DEFAULTS: EditorConfig = {
  editor: process.env.VISUAL || process.env.EDITOR || "nvim",
  autoOpen: true,
  tmuxSize: 38,
};

let configError: string | null = null;

function loadConfig(): EditorConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      return { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) };
    }
  } catch (err) {
    configError = err instanceof Error ? err.message : String(err);
  }
  return { ...DEFAULTS };
}

// ─── Process helpers ─────────────────────────────────────────────────

function exec(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5_000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });
}

function inTmux(): boolean {
  return !!process.env.TMUX;
}

function isVimLike(editor: string): boolean {
  const e = editor.toLowerCase().trim();
  return e === "nvim" || e === "vim" || e === "vi" || e === "neovim";
}

/** Escape a path for use inside vim's :e command */
function escapeVimPath(path: string): string {
  return path
    .replace(/\\/g, "\\\\")
    .replace(/ /g, "\\ ")
    .replace(/#/g, "\\#")
    .replace(/%/g, "\\%");
}

/** Escape a path for use inside single-quoted shell arguments */
function escapeShellSingle(path: string): string {
  return path.replace(/'/g, "'\\''");
}

/** Shorten a file path for display in the panel */
function shortenPath(path: string, max = 48): string {
  if (path.length <= max) return path;
  const parts = path.split("/");
  if (parts.length <= 2) return path;
  return "\u2026/" + parts.slice(-2).join("/");
}

// ─── File tracking ───────────────────────────────────────────────────

const FILE_TOOLS = new Set(["Edit", "Write", "Read"]);
const AUTO_OPEN_TOOLS = new Set(["Edit", "Write"]);

function extractFilePath(args: Record<string, unknown>): string | null {
  const fp = args.file_path;
  return typeof fp === "string" && fp.length > 0 ? fp : null;
}

// ─── Fullscreen editor handoff ────────────────────────────────────────
//
// Exits the alt screen buffer, disables raw mode, and blocks the event
// loop while the editor runs with inherited stdio. When the editor exits,
// re-enters the alt screen and sends SIGWINCH to force Ink to re-render.
// Same pattern `git commit` uses to open $EDITOR — no tmux or deps needed.

function openEditorFullscreen(filePath: string, editor: string): string {
  const stdin = process.stdin as any;
  const stdout = process.stdout;

  // Save terminal state
  const wasRaw = typeof stdin.isRaw === "boolean" ? stdin.isRaw : false;

  // Release terminal for the editor
  if (wasRaw) {
    try { stdin.setRawMode(false); } catch {}
  }
  // Exit alt screen + clear
  stdout.write("\x1b[?1049l\x1b[2J\x1b[H");

  let errorMsg: string | null = null;
  try {
    execFileSync(editor, [filePath], {
      stdio: "inherit",
      timeout: 0,
    });
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      errorMsg = `Editor '${editor}' not found on PATH.`;
    } else if (err?.signal) {
      // Killed by signal (e.g. Ctrl-C) — not an error
    } else if (err?.status != null && err.status !== 0) {
      errorMsg = `Editor exited with code ${err.status}.`;
    }
  }

  // Reclaim terminal
  stdout.write("\x1b[?1049h");
  if (wasRaw) {
    try { stdin.setRawMode(true); } catch {}
  }

  // Force Ink to re-render by simulating a terminal resize
  try { process.kill(process.pid, "SIGWINCH"); } catch {}

  return errorMsg ?? `Opened ${shortenPath(filePath)} in ${editor}`;
}

// ─── tmux pane management ────────────────────────────────────────────

let tmuxPaneId: string | null = null;

async function tmuxPaneAlive(): Promise<boolean> {
  if (!tmuxPaneId) return false;
  try {
    await exec("tmux", ["display-message", "-p", "-t", tmuxPaneId, "#{pane_id}"]);
    return true;
  } catch {
    tmuxPaneId = null;
    return false;
  }
}

/** Search the current tmux window for a pane running the editor (recovery after reload) */
async function findEditorPane(editor: string): Promise<string | null> {
  try {
    const { stdout } = await exec("tmux", [
      "list-panes", "-F", "#{pane_id}\t#{pane_current_command}",
    ]);
    const target = editor.toLowerCase().trim();
    for (const line of stdout.trim().split("\n")) {
      const [paneId, cmd] = line.split("\t");
      if (cmd && cmd.toLowerCase().trim() === target) return paneId;
    }
  } catch {}
  return null;
}

async function tmuxOpenFile(filePath: string, config: EditorConfig): Promise<string> {
  if (!tmuxPaneId) {
    tmuxPaneId = await findEditorPane(config.editor);
  }

  if (await tmuxPaneAlive()) {
    if (isVimLike(config.editor)) {
      const escaped = escapeVimPath(filePath);
      await exec("tmux", [
        "send-keys", "-t", tmuxPaneId!,
        "Escape", `:e ${escaped}`, "Enter",
      ]);
    } else {
      await exec("tmux", [
        "send-keys", "-t", tmuxPaneId!,
        `${config.editor} '${escapeShellSingle(filePath)}'`, "Enter",
      ]);
    }
    return `Opened ${shortenPath(filePath)} in editor`;
  }

  try {
    const shellCmd = `${config.editor} '${escapeShellSingle(filePath)}'`;
    const { stdout } = await exec("tmux", [
      "split-window", "-h", "-p", String(config.tmuxSize),
      "-P", "-F", "#{pane_id}", shellCmd,
    ]);
    tmuxPaneId = stdout.trim();
    return `Opened ${shortenPath(filePath)} in new editor pane`;
  } catch (err) {
    return `Failed to create editor pane: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function tmuxClosePane(): Promise<string> {
  if (!tmuxPaneId) return "No editor pane to close";
  try {
    await exec("tmux", ["kill-pane", "-t", tmuxPaneId]);
    tmuxPaneId = null;
    return "Editor pane closed";
  } catch {
    tmuxPaneId = null;
    return "Editor pane was already closed";
  }
}

// ─── Open dispatcher ─────────────────────────────────────────────────

async function openFile(filePath: string, config: EditorConfig): Promise<string> {
  if (inTmux()) {
    return tmuxOpenFile(filePath, config);
  }
  // Fullscreen editor handoff — no tmux needed
  return openEditorFullscreen(filePath, config.editor);
}

// Serialize auto-open calls to prevent tmux key interleaving when the
// agent edits multiple files in rapid succession.
let opening = false;
let queued: string | null = null;

async function autoOpen(filePath: string, config: EditorConfig): Promise<void> {
  if (opening) {
    queued = filePath;
    return;
  }
  opening = true;
  try {
    await openFile(filePath, config);
  } catch {} finally {
    opening = false;
    if (queued) {
      const next = queued;
      queued = null;
      void autoOpen(next, config);
    }
  }
}

// ─── Activation ─────────────────────────────────────────────────────

export default function activate(letta: any) {
  const config = loadConfig();
  const disposers: Array<() => void> = [];

  if (configError) {
    letta.diagnostics?.report?.({
      severity: "warning",
      message: `editor-config.json: ${configError}. Using defaults.`,
    });
  }

  let lastFile: string | null = null;
  let lastTool: string | null = null;

  const useTmux = inTmux();

  // ── Status panel ──
  let panel: any = null;
  if (letta.capabilities.ui?.panels) {
    panel = letta.ui.openPanel({
      id: "open-in-editor",
      order: 100,
      render: ({ width, row, chalk }: any) => {
        if (!lastFile) return "";
        const left = `${chalk.cyan("edit")} ${shortenPath(lastFile)} ${chalk.gray(`(${lastTool})`)}`;
        const right = useTmux
          ? (tmuxPaneId
            ? `${chalk.green("open")} ${chalk.gray(tmuxPaneId)}`
            : chalk.gray("/edit"))
          : chalk.gray("/edit to open");
        return row(left, right, width);
      },
    });
    disposers.push(() => panel?.close());
  }

  // ── Tool end: track files and auto-open (tmux only) ──
  if (letta.capabilities.events?.tools) {
    disposers.push(
      letta.events.on("tool_end", (event: any) => {
        if (event.status !== "success") return;
        if (!FILE_TOOLS.has(event.toolName)) return;
        const filePath = extractFilePath(event.args ?? {});
        if (!filePath) return;

        lastFile = filePath;
        lastTool = event.toolName;
        panel?.update();

        // Auto-open only in tmux — fullscreen would block the event loop
        if (AUTO_OPEN_TOOLS.has(event.toolName) && config.autoOpen && useTmux) {
          void autoOpen(filePath, config).then(() => panel?.update());
        }
      }),
    );
  }

  // ── /edit command ──
  if (letta.capabilities.commands) {
    disposers.push(
      letta.commands.register({
        id: "edit",
        description: "Open a file in your editor (defaults to last touched file)",
        args: "[path]",
        async run(ctx: any) {
          const filePath = (ctx.args ?? "").trim() || lastFile;
          if (!filePath) {
            return {
              type: "output",
              output: "No file to open. Use /edit <path> or have the agent edit a file first.",
            };
          }
          const result = await openFile(filePath, config);
          panel?.update();
          return { type: "output", output: result };
        },
      }),
    );

    disposers.push(
      letta.commands.register({
        id: "editclose",
        description: "Close the editor pane (tmux only)",
        async run() {
          const result = useTmux
            ? await tmuxClosePane()
            : "Not in tmux \u2014 use :q in the editor to close";
          panel?.update();
          return { type: "output", output: result };
        },
      }),
    );
  }

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
