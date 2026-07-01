# Jukebox

A Letta Code terminal jukebox that plays Jamendo Creative Commons music while you work.

Jukebox registers `/jb` and `/jukebox`, searches Jamendo by keyword, plays matching tracks locally on macOS, and renders a compact now-playing card with an animated audio-reactive equalizer.

## Requirements

- Letta Code `>=0.27.20`
- macOS
- `/usr/bin/afplay`
- `/usr/bin/afconvert`
- A free Jamendo Client ID

This first version is macOS-only because it uses `afplay` for playback and `afconvert` to generate an amplitude envelope for the terminal equalizer.

## Install

```bash
letta install npm:@letta-ai/jukebox
```

Then reload local mods:

```text
/reload
```

## Quick start

Get a free Jamendo Client ID from:

```text
https://developer.jamendo.com/
```

Save it locally:

```text
/jb setkey YOUR_JAMENDO_CLIENT_ID
```

Play music with any keyword:

```text
/jb meditation
/jb focus
/jb rainy day
/jb jazz piano
```

You can also open the setup guide from inside Letta Code:

```text
/jb setup
```

## What it adds

- `/jb` and `/jukebox` slash commands
- Jamendo Creative Commons music search and playback
- free-form keyword search
- built-in mood aliases such as `focus`, `chill`, `deadline`, `victory`, `tired`, `invoice`, `scope-creep`, and `panic`
- playback controls for next, stop, and loop mode
- a compact now-playing panel with an audio-reactive equalizer
- statusline integration that preserves normal agent/model information
- automatic LRU cache cleanup
- cache inspection and manual cache clearing commands

## Commands

### Setup

| Command | Description |
|---|---|
| `/jb setup` | Show setup instructions for getting a Jamendo Client ID. |
| `/jb setkey <client_id>` | Save the Jamendo Client ID locally. |
| `/jb source` | Show source, config, cache, and current track information. |

### Playback

| Command | Description |
|---|---|
| `/jb <keyword>` | Search Jamendo using the keyword and play a random matching track. |
| `/jb <mood>` | Play using a built-in mood keyword such as `focus`, `chill`, `deadline`, `victory`, `tired`, `invoice`, `scope-creep`, or `panic`. |
| `/jb next` | Skip to another track. |
| `/jb stop` | Stop playback and close the player UI. |
| `/jb now` | Reopen the now-playing panel if music is playing. |
| `/jb loop` | Toggle loop mode. |
| `/jb loop on` | Repeat the current track when it ends. |
| `/jb loop off` | Automatically move to another Jamendo track when the current track ends. |
| `/jb list` | List moods and commands. |

### UI

| Command | Description |
|---|---|
| `/jb pin` | Keep the now-playing panel visible. |
| `/jb unpin` | Let the now-playing panel close automatically. |

### Cache

| Command | Description |
|---|---|
| `/jb cache` | Show cache size, file count, and cleanup settings. Also runs automatic cleanup. |
| `/jb cache clear` | Clear cached tracks while keeping the currently playing file. |

## Cache behavior

Jukebox caches downloaded Jamendo tracks locally under:

```text
~/.letta/mods/jukebox-cache/
```

The cache is automatically pruned using an LRU policy:

- default max cache size: `200 MB`
- default max audio files: `50`
- the currently playing track is never deleted while active
- temporary envelope WAV files are removed automatically
- old generated WAV files are removed automatically

This prevents the cache from growing indefinitely while keeping recently used tracks available.

## Local state

Jukebox stores local configuration at:

```text
~/.letta/mods/jukebox-config.json
```

This file stores the user's Jamendo Client ID and cache preferences. It is not included in this package and should not be committed.

Cached audio files are stored only in the local cache directory and are not included in this package.

## Privacy

Jukebox sends the user's search keywords to the Jamendo API.

The mod does not include any Jamendo Client ID. Users configure their own Client ID locally with:

```text
/jb setkey YOUR_JAMENDO_CLIENT_ID
```

## Safety

Mods are trusted local code. Review the source before installing third-party mods.

Jukebox uses local macOS commands for playback and analysis:

- `/usr/bin/afplay`
- `/usr/bin/afconvert`

It also stops `afplay` processes associated with its own Jukebox cache when stopping or skipping playback.

If a mod breaks startup or command handling, recover with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

Then remove or edit the mod package and run `/reload`.

See [`MOD.md`](./MOD.md) for the agent-facing behavioral contract.
