---
name: "@letta-ai/open-in-editor"
description: "Open files in your editor as the agent touches them — fullscreen handoff (no deps) or tmux split-pane."
---

# Open in editor mod semantics

## When to use

Use this mod when the user wants files the agent touches to be openable in
their editor (nvim/vim/code/hx/etc.) from within Letta Code, without
requiring tmux or any external dependency.

## Behavior

- Listens to `tool_end` events for `Edit`, `Write`, and `Read` tools.
- Tracks the last touched file path and tool name in local state.
- Shows a status panel (order 100, above the input) with the file name and
  editor state. Hidden until the first file is touched.
- Two modes are auto-selected based on whether `$TMUX` is set:

### Fullscreen mode (outside tmux)

- `/edit` performs a fullscreen editor handoff:
  1. Saves terminal state (raw mode flag)
  2. Disables raw mode on stdin
  3. Exits the alt screen buffer (`ESC[?1049l`) and clears the screen
  4. Calls `execFileSync(editor, [file], { stdio: "inherit" })` — this
     blocks the Node.js event loop, giving the editor exclusive terminal
     access. No Ink renders, timers, or I/O fire while the editor runs.
  5. When the editor exits, re-enters the alt screen (`ESC[?1049h`),
     restores raw mode, and sends `SIGWINCH` to force Ink to re-render.
- This is the same pattern `git commit` uses for `$EDITOR`.
- **Auto-open is disabled** in fullscreen mode. Blocking the event loop
  during agent tool execution would interrupt the response stream. Files
  are tracked in the panel; the user runs `/edit` manually.
- Works with any editor that functions as `$EDITOR`.

### tmux split-pane mode (inside tmux)

- The first `/edit` creates a right-side split pane
  (`tmux split-window -h -p <tmuxSize>`) running the editor with the file.
- For nvim/vim, subsequent opens send `Escape :e <path> Enter` to the
  running instance via `tmux send-keys`. This preserves buffers and undo
  history.
- For other editors, the editor command is re-run in the pane via send-keys.
- When `autoOpen` is `true` (default), files touched by `Edit` or `Write`
  are automatically opened in the editor pane. `Read` is tracked but not
  auto-opened.
- Auto-open calls are serialized to prevent tmux `send-keys` interleaving.
  Only the most recent pending file is queued; earlier pending opens are
  superseded.
- The pane ID is tracked in memory. After a `/reload`, the mod searches
  the current tmux window's panes for one running the configured editor
  and reattaches, avoiding duplicate panes.
- `/editclose` kills the editor pane via `tmux kill-pane`.

### Path escaping

- For vim `:e` command: spaces, `#`, `%`, and backslashes are escaped.
- For shell commands: file paths are wrapped in single quotes with
  single-quote escaping.

## Configuration

Config file: `~/.letta/mods/editor-config.json`

```json
{
  "editor": "nvim",
  "autoOpen": true,
  "tmuxSize": 38
}
```

- `editor` defaults to `$VISUAL`, then `$EDITOR`, then `"nvim"`.
- Missing or malformed config falls back to defaults and emits a warning
  diagnostic.

## Platform assumptions

- Fullscreen mode: requires a TTY with alt screen buffer support. Works
  on any terminal that supports `ESC[?1049h/l` (virtually all modern
  terminals).
- tmux mode: requires tmux on `PATH`.
- The editor binary must be on `PATH`.
- Uses `windowsHide` for tmux commands to avoid console flashes on Windows.

## Safety invariants

- Only runs editor commands and tmux pane management. Never modifies files.
- `execFileSync` is used for fullscreen mode — it blocks the event loop,
  which is intentional: it prevents Ink from writing to the terminal
  while the editor has control.
- All `execFile` calls (tmux) have a 5-second timeout.
- Errors from tmux or editor commands are caught and surfaced as
  user-facing messages, never as uncaught exceptions.
- The mod degrades gracefully when capabilities are missing: no panel
  without `ui.panels`, no auto-open without `events.tools`, no commands
  without `commands`.
- Event handler, panel, and command registrations are all disposed on
  reload.

## Adaptation notes for agents

- To support a new editor, just set `"editor"` in the config. Any editor
  that works as `$EDITOR` will work in fullscreen mode. Vim-like editors
  (`nvim`, `vim`, `vi`, `neovim`) additionally get `:e` send-keys in tmux
  mode; all others re-run the editor command in the pane.
- To add line-number jumping (open at a specific line), extend
  `openEditorFullscreen` to pass `+<line>` as an argument (nvim/vim) or
  extend `escapeVimPath` to append `:+<line>` after `:e`.
- To track Bash-created files, parse `event.args.command` in the
  `tool_end` handler — this is intentionally not done by default due to
  fragility.
- The panel `render` function is pure and side-effect-free. All state
  updates go through `panel.update()`.
- The `SIGWINCH` signal is used to force Ink to re-render after the
  editor exits. If this proves unreliable on a specific terminal, an
  alternative is to write a resize event directly to stdout.
