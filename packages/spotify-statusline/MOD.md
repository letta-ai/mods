---
name: "@letta-ai/spotify-statusline"
description: "macOS Spotify now-playing statusline for Letta Code."
---

# Spotify statusline mod semantics

## When to use

Use this mod when the user wants Letta Code's idle statusline to show the current Spotify track on macOS.

## Behavior

- Polls Spotify with `osascript` outside the render path.
- Does not launch Spotify if the app is closed.
- Shows `🎧 Artist - Track` while music is playing.
- Wraps the playing track in an OSC 8 hyperlink to the native `spotify:track:<id>` URI so supported terminals can click to jump to the track.
- Shows `🎧 paused` when Spotify is paused.
- Clears the Spotify segment when Spotify is stopped, closed, or unavailable.
- Renders the agent name and model on the right so the statusline remains useful when no track is active.

## Platform assumptions

This mod is macOS-specific because it uses AppleScript via `osascript` to query Spotify.

## Safety invariants

- Renderer stays synchronous.
- Shelling happens only in the setup interval, never during render.
- Timers and status values are cleaned up when the mod is disposed.
- Optional UI APIs are capability-guarded.

## Adaptation notes for agents

- Preserve the `application "Spotify" is running` guard; without it, AppleScript can launch Spotify just to query state.
- Keep polling lightweight. The default refresh interval is 5 seconds.
- If composing with other statusline data, remember the custom statusline owns the full idle row.
