// Open files in your editor as the agent touches them.
//
// When the agent edits or writes a file, the mod can auto-open it in a
// tmux split pane (nvim/vim) or launch an external editor command.
// Provides /edit and /editclose commands and a status panel.
//
// Config: ~/.letta/mods/editor-config.json
//   { "editor": "nvim", "autoOpen": true, "tmuxSize": 38 }

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ─── Config ──────────────────────────────────────────────────────────

const CONFIG_PATH = join(homedir(), ".letta", "mods", "editor-config.json");

interface EditorConfig {
  /** Editor binary name (default: "nvim") */
  editor: string;
  /** Auto-open files when the agent edits them (default: true) */
  autoOpen: boolean;
  /** tmux split pane width as percentage of the window (default: 38) */
  tmuxSize: number;
}

const DEFAULTS: EditorConfig = {
  editor: "nvim",
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
      "list-panes",
      "-F",
      "#{pane_id}\t#{pane_current_command}",
    ]);
    const target = editor.toLowerCase().trim();
    for (const line of stdout.trim().split("\n")) {
      const [paneId, cmd] = line.split("\t");
      if (cmd && cmd.toLowerCase().trim() === target) return paneId;
    }
  } catch {
    // not in tmux or no panes
  }
  return null;
}

async function tmuxOpenFile(
  filePath: string,
  config: EditorConfig,
): Promise<string> {
  // Recover pane tracking after a reload
  if (!tmuxPaneId) {
    tmuxPaneId = await findEditorPane(config.editor);
  }

  if (await tmuxPaneAlive()) {
    if (isVimLike(config.editor)) {
      // Send :e to the running nvim/vim instance
      const escaped = escapeVimPath(filePath);
      await exec("tmux", [
        "send-keys",
        "-t",
        tmuxPaneId!,
        "Escape",
        `:e ${escaped}`,
        "Enter",
      ]);
    } else {
      // For non-vim editors, re-run the editor command in the pane
      await exec("tmux", [
        "send-keys",
        "-t",
        tmuxPaneId!,
        `${config.editor} '${escapeShellSingle(filePath)}'`,
        "Enter",
      ]);
    }
    return `Opened ${shortenPath(filePath)} in editor`;
  }

  // Create a new split pane with the editor
  try {
    const shellCmd = `${config.editor} '${escapeShellSingle(filePath)}'`;
    const { stdout } = await exec("tmux", [
      "split-window",
      "-h",
      "-p",
      String(config.tmuxSize),
      "-P",
      "-F",
      "#{pane_id}",
      shellCmd,
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

async function openFile(
  filePath: string,
  config: EditorConfig,
): Promise<string> {
  if (inTmux()) {
    return tmuxOpenFile(filePath, config);
  }

  // Non-tmux: try nvr (neovim-remote) for nvim-like editors
  if (isVimLike(config.editor)) {
    try {
      await exec("nvr", [filePath]);
      return `Opened ${shortenPath(filePath)} via nvr`;
    } catch {
      return "Not in tmux. Run /edit inside tmux for split-pane, or install nvr for remote nvim.";
    }
  }

  // Generic: try to launch the editor directly
  try {
    await exec(config.editor, [filePath]);
    return `Opened ${shortenPath(filePath)} in ${config.editor}`;
  } catch {
    return `Could not launch ${config.editor}. Run inside tmux for best results.`;
  }
}

// Serialize auto-open calls to prevent tmux key interleaving when the
// agent edits multiple files in rapid succession.
let opening = false;
let queued: string | null = null;

async function autoOpen(
  filePath: string,
  config: EditorConfig,
): Promise<void> {
  if (opening) {
    queued = filePath;
    return;
  }
  opening = true;
  try {
    await openFile(filePath, config);
  } catch {
    // errors are surfaced via the returned string in manual /edit
  } finally {
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

  // ── Status panel ──
  let panel: any = null;
  if (letta.capabilities.ui?.panels) {
    panel = letta.ui.openPanel({
      id: "open-in-editor",
      order: 100,
      render: ({ width, row, chalk }: any) => {
        if (!lastFile) return "";
        const left = `${chalk.cyan("edit")} ${shortenPath(lastFile)} ${chalk.gray(`(${lastTool})`)}`;
        const right = tmuxPaneId
          ? `${chalk.green("open")} ${chalk.gray(tmuxPaneId)}`
          : chalk.gray("/edit");
        return row(left, right, width);
      },
    });
    disposers.push(() => panel?.close());
  }

  // ── Tool end: track files and auto-open ──
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

        if (AUTO_OPEN_TOOLS.has(event.toolName) && config.autoOpen) {
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
        description: "Close the editor pane",
        async run() {
          const result = inTmux()
            ? await tmuxClosePane()
            : "Not in tmux \u2014 nothing to close";
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
