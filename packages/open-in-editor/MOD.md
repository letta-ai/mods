---
name: "@letta-ai/open-in-editor"
description: "Open files in your editor as the agent touches them — tmux split-pane for nvim/vim, or any editor command."
---

# Open in editor mod semantics

## When to use

Use this mod when the user wants files the agent edits to automatically open in
their editor (nvim/vim/code/hx/etc.), ideally in a tmux split pane alongside
the Letta Code chat. Also useful when the user wants a `/edit` command to
manually open the last-touched file or a specific path.

## Behavior

- Listens to `tool_end` events for `Edit`, `Write`, and `Read` tools.
- Tracks the last touched file path and tool name in local state.
- Shows a status panel (order 100, above the input) with the file name and
  editor pane status. Hidden until the first file is touched.
- When `autoOpen` is `true` (default), files touched by `Edit` or `Write` are
  automatically opened in the editor. `Read` is tracked but not auto-opened.
- Auto-open calls are serialized to prevent tmux `send-keys` interleaving when
  the agent edits multiple files in rapid succession. Only the most recent
  pending file is queued; earlier pending opens are superseded.

### tmux split-pane mode

- When inside tmux, the first open creates a right-side split pane
  (`tmux split-window -h -p <tmuxSize>`) running the editor with the file.
- For nvim/vim, subsequent opens send `Escape :e <path> Enter` to the running
  instance via `tmux send-keys`. This preserves buffers and undo history.
- For other editors, the editor command is re-run in the pane via send-keys.
- The pane ID is tracked in memory. After a `/reload`, the mod searches the
  current tmux window's panes for one running the configured editor and
  reattaches, avoiding duplicate panes.
- If the tracked pane was closed by the user, a new split is created on the
  next open.
- `/editclose` kills the editor pane via `tmux kill-pane`.

### Non-tmux mode

- For nvim-like editors, tries `nvr` (neovim-remote) to open in an existing
  nvim instance. If `nvr` is not available, returns a guidance message.
- For other editors, launches the editor command directly.
- The full split-pane two-column experience requires tmux.

### Path escaping

- For vim `:e` command: spaces, `#`, `%`, and backslashes are escaped.
- For shell commands: file paths are wrapped in single quotes with single-quote
  escaping.

## Configuration

Config file: `~/.letta/mods/editor-config.json`

```json
{
  "editor": "nvim",
  "autoOpen": true,
  "tmuxSize": 38
}
```

Missing or malformed config falls back to defaults and emits a warning diagnostic.

## Platform assumptions

- Requires tmux for split-pane mode (tested on tmux 3.4, Linux).
- Non-tmux nvim mode benefits from `nvr` (neovim-remote) if installed.
- The editor binary must be on `PATH`.
- Cross-platform: uses `windowsHide` to avoid console flashes on Windows.

## Safety invariants

- Only runs editor commands and tmux pane management. Never modifies files.
- All `execFile` calls have a 5-second timeout.
- Errors from tmux or editor commands are caught and surfaced as user-facing
  messages, never as uncaught exceptions.
- The mod degrades gracefully when capabilities are missing: no panel without
  `ui.panels`, no auto-open without `events.tools`, no commands without
  `commands`.
- Event handler, panel, and command registrations are all disposed on reload.

## Adaptation notes for agents

- To support a new editor, just set `"editor"` in the config. Vim-like editors
  (`nvim`, `vim`, `vi`, `neovim`) use `:e` send-keys; all others re-run the
  editor command in the pane.
- To add line-number jumping (open at a specific line), extend `openFile` to
  send `:+<line>` or `:<line>` after `:e` for vim-like editors.
- To track Bash-created files, parse `event.args.command` in the `tool_end`
  handler — this is intentionally not done by default due to fragility.
- The panel `render` function is pure and side-effect-free. All state updates
  go through `panel.update()`.
