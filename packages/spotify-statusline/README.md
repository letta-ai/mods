# Spotify Statusline

A Letta Code statusline mod that shows the currently playing Spotify track on macOS.

```text
🎧 Artist - Track                                      Kian-K3-Coder · Claude Sonnet 4
```

## Install

```bash
letta install npm:@letta-ai/spotify-statusline
```

Then reload local mods:

```text
/reload
```

## What it adds

- macOS Spotify now-playing statusline segment
- paused-state indicator
- panel-based primary statusline with fallback right-side agent/model display

## Behavior

- Shows `🎧 Artist - Track` while Spotify is playing.
- Wraps the playing track in a terminal hyperlink (OSC 8) pointing at `spotify:track:<id>`, so supported terminals (iTerm2, Ghostty, WezTerm, Kitty, VS Code) jump to the track on click.
- Shows `🎧 paused` while Spotify is paused.
- Shows no Spotify segment when Spotify is stopped, closed, or unavailable.
- Does not launch Spotify when checking state.

## Requirements

- macOS
- Spotify desktop app
- Letta Code `>=0.27.18` with panel-based statusline support

## Safety

Mods are trusted local code. Review the source before installing third-party mods.

If a mod breaks startup or command handling, recover with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

See [`MOD.md`](./MOD.md) for the agent-facing behavioral contract.
