# Open in Editor

#open-in-editor

A Letta Code mod that opens files in your editor as the agent touches them — no external dependencies required. Two modes are auto-selected based on your environment:

- **Outside tmux (default):** Fullscreen editor handoff. `/edit` exits the TUI, launches your editor with full terminal control, and restores the TUI when you quit — same pattern `git commit` uses for `$EDITOR`. Zero dependencies.
- **Inside tmux:** Split-pane with `:e` send-keys. Creates a right-side editor pane and keeps it in sync as files change. Supports auto-open.

## Install

#install

```
letta install npm:@letta-ai/open-in-editor
```

Then reload local mods:

```
/reload
```

## Configuration

#configuration

Create `~/.letta/mods/editor-config.json`:

```json
{
  "editor": "nvim",
  "autoOpen": true,
  "tmuxSize": 38
}
```

| Key | Default | Description |
| --- | --- | --- |
| `editor` | `$VISUAL`, `$EDITOR`, or `"nvim"` | Editor binary name. Any editor on your `PATH` works (`nvim`, `vim`, `code`, `hx`, `emacsclient`, etc.) |
| `autoOpen` | `true` | Auto-open files when the agent edits them. **tmux only** — in fullscreen mode, files are tracked but you open them manually with `/edit`. |
| `tmuxSize` | `38` | Width percentage for the tmux editor pane (e.g. `38` = 38% of the window) |

If the config file is missing, the mod runs with defaults.

## How it works

#how-it-works

**File tracking.** The mod listens to `tool_end` events for `Edit`, `Write`, and `Read` tools. It tracks the last touched file and shows it in a status panel above the input bar.

### Fullscreen mode (outside tmux)

When you run `/edit`, the mod:

1. Saves the terminal state (raw mode, alt screen buffer)
2. Exits the alt screen buffer and clears the screen
3. Blocks the event loop and launches your editor with inherited stdio — the editor has full, exclusive terminal access
4. When you quit the editor, re-enters the alt screen, restores raw mode, and sends `SIGWINCH` to force the TUI to re-render

This is the same mechanism `git commit` uses to open `$EDITOR`. No tmux, no extra processes, no scrolling behavior changes.

**Auto-open is disabled** in fullscreen mode because blocking the event loop would interrupt the agent's response. Files are tracked in the panel — use `/edit` when you want to view or edit them.

### tmux split-pane mode (inside tmux)

The mod creates a right-side split pane with your editor. For nvim/vim, subsequent files are opened via `:e <path>` sent to the running instance — no new process, buffers and undo history are preserved. For other editors, the editor command is re-run in the pane.

Auto-open works in tmux: files edited by the agent are automatically opened in the editor pane. After a `/reload`, the mod searches for an existing editor pane and reattaches to it.

## Commands

#commands

| Command | Description |
| --- | --- |
| `/edit [path]` | Open a file in your editor. With no argument, opens the last file the agent touched. |
| `/editclose` | Close the editor pane (tmux only). In fullscreen mode, just `:q` your editor. |

## Panel

#panel

A status line above the input shows the last touched file and editor state:

Fullscreen mode:
```
 edit src/main.ts (Edit)                    /edit to open
```

tmux with pane open:
```
 edit src/main.ts (Edit)                    open %5
```

The panel is hidden until the agent touches a file.

## Editor support

#editor-support

| Editor | Fullscreen (no tmux) | tmux split | Notes |
| --- | --- | --- | --- |
| `nvim` / `vim` | Fullscreen handoff | `:e` send-keys (preserves session) | Best experience |
| `code` | Fullscreen handoff | re-run `code <file>` in pane | Opens in same window |
| `hx` | Fullscreen handoff | re-run `hx <file>` in pane | New instance each time |
| `emacsclient` | Fullscreen handoff | re-run in pane | Opens in existing frame |

Any editor that works with `$EDITOR` will work in fullscreen mode.

## Safety

#safety

Mods are trusted local code. Review the source before installing third-party packages.

This mod only runs editor commands and tmux pane management. It does not modify files or repositories.

If a mod breaks startup or command handling, recover with:

```
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

See [MOD.md](./MOD.md) for the agent-facing behavioral contract.
