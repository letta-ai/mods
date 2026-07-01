---
name: "@letta-ai/jukebox"
description: "Adds a Jamendo-powered terminal jukebox with slash commands, a now-playing panel, and automatic cache cleanup"
---

# Jukebox mod semantics

## When to use

Use this mod when the user wants terminal music playback inside Letta Code while an agent works.

Jukebox is intended as a small ambient CLI companion: it searches Jamendo Creative Commons tracks, plays them locally, and renders a now-playing panel with an audio-reactive equalizer.

## Behavior

The mod registers two equivalent slash commands:

- `/jb`
- `/jukebox`

It requires a Jamendo Client ID configured by the user. Without a key, playback commands return setup guidance instead of falling back to generated audio.

Playback is Jamendo-only. The package does not include generated music, cached tracks, or bundled audio assets.

## Commands

### Setup and info

- `/jb setup` shows setup instructions.
- `/jb setkey <client_id>` saves the Jamendo Client ID locally.
- `/jb source` shows source, config, cache, and current track metadata.
- `/jb list` lists moods and commands.

### Playback

- `/jb <keyword>` searches Jamendo and plays a random matching track.
- `/jb <mood>` uses a built-in mood alias for visual theme and search tags.
- `/jb next` skips to another track.
- `/jb stop` stops playback.
- `/jb now` reopens the now-playing panel.
- `/jb loop` toggles loop mode.
- `/jb loop on` repeats the current track.
- `/jb loop off` auto-advances to another Jamendo track when the current track ends.

### UI

- `/jb pin` keeps the now-playing panel visible.
- `/jb unpin` allows the panel to close automatically.

### Cache

- `/jb cache` reports cache status and runs automatic cleanup.
- `/jb cache clear` clears cached files while preserving the currently playing track.

## State

Jukebox stores local config at:

```text
~/.letta/mods/jukebox-config.json
```

This config may contain the user's Jamendo Client ID and cache preferences. It must not be committed or included in packages.

Jukebox caches downloaded tracks at:

```text
~/.letta/mods/jukebox-cache/
```

Cached MP3/WAV files must not be committed or included in packages.

## Cache policy

Automatic cache cleanup is enabled by default.

- Default limit: `200 MB`
- Default max audio files: `50`
- Policy: LRU by file mtime
- Current playing file is protected
- Temporary envelope WAV files are deleted
- Old generated WAV files are deleted

## Requirements

- macOS
- `/usr/bin/afplay`
- `/usr/bin/afconvert`
- Letta Code `>=0.27.20`
- Jamendo Client ID

## Safety invariants

- Do not hardcode Jamendo Client IDs.
- Do not include `jukebox-config.json` in a package or PR.
- Do not include `jukebox-cache/` or audio files in a package or PR.
- Do not expose local absolute paths in documentation examples; use `~/.letta/...`.
- The mod should only stop `afplay` processes associated with its own Jukebox cache.
- The render functions must stay synchronous and side-effect-free.
- Timers, panels, commands, and playback processes are cleaned up on unload.

## Recovery

If the mod breaks startup or command handling, run:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

Then remove or edit the package and run `/reload`.
