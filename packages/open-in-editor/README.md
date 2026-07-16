# Open in Editor

#open-in-editor

A Letta Code mod that opens files in your editor as the agent touches them. When the agent edits or writes a file, it can auto-open in a tmux split pane (nvim/vim) or launch any editor command you configure — giving you a live two-column layout: chat on the left, editor on the right.

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
| `editor` | `"nvim"` | Editor binary name. Any editor on your `PATH` works (`nvim`, `vim`, `code`, `hx`, `emacsclient`, etc.) |
| `autoOpen` | `true` | Automatically open files when the agent edits or writes them. Set to `false` for manual `/edit` only. |
| `tmuxSize` | `38` | Width percentage for the tmux editor pane (e.g. `38` = 38% of the window) |

If the config file is missing, the mod runs with defaults.

## How it works

#how-it-works

**File tracking.** The mod listens to `tool_end` events for `Edit`, `Write`, and `Read` tools. It tracks the last touched file and shows it in a status panel above the input bar.

**Auto-open.** When `autoOpen` is `true` (default), files edited via `Edit` or `Write` are automatically opened in the editor. Files only read via `Read` are tracked but not auto-opened (to avoid noise).

**tmux split-pane.** When running inside tmux, the mod creates a right-side split pane with your editor. For nvim/vim, subsequent files are opened via `:e <path>` sent to the running instance — no new process, buffers and undo history are preserved. For other editors, the editor command is re-run in the pane.

**Pane recovery.** After a `/reload`, the mod searches the current tmux window for a pane running your editor and reattaches to it. No duplicate panes.

**Non-tmux.** Outside tmux, the mod tries `nvr` (neovim-remote) for nvim-like editors, or launches the editor command directly. For the full split-pane experience, run Letta Code inside tmux.

## Commands

#commands

| Command | Description |
| --- | --- |
| `/edit [path]` | Open a file in your editor. With no argument, opens the last file the agent touched. |
| `/editclose` | Close the editor pane (tmux only). |

## Panel

#panel

A status line above the input shows the last touched file and editor pane state:

```
 edit src/main.ts (Edit)                    open %5
```

When no editor pane is open:

```
 edit src/main.ts (Edit)                    /edit
```

The panel is hidden until the agent touches a file.

## Editor support

#editor-support

| Editor | tmux split | Non-tmux | Notes |
| --- | --- | --- | --- |
| `nvim` / `vim` | `:e` send-keys (preserves session) | `nvr` if installed | Best experience |
| `code` | re-run `code <file>` in pane | `code <file>` | Opens in same window |
| `hx` | re-run `hx <file>` in pane | `hx <file>` | New instance each time |
| `emacsclient` | re-run in pane | direct | Opens in existing frame |

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
