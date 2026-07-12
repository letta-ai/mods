---
name: "@vedant020000/ponytail"
description: "Lazy senior dev mode — YAGNI ladder that makes the agent write less, simpler code."
---

# Ponytail mod semantics

## When to use

Use this mod to make the agent write less code by stopping at the first rung of the YAGNI ladder that holds: skip speculative features, reuse existing code, prefer stdlib and native platform features, use installed dependencies, write one-liners, and only then write the minimum code that works.

The ruleset is injected at the start of each conversation and persists until deactivated with "stop ponytail", "normal mode", or `/ponytail off`.

## Behavioral contract

When ponytail is active, the agent should:

1. Read the task and trace the code it touches end to end before writing anything.
2. Climb the ladder: YAGNI → reuse → stdlib → native → installed dependency → one line → minimum.
3. Never simplify away input validation at trust boundaries, error handling that prevents data loss, security measures, or accessibility basics.
4. Leave a `ponytail:` comment on deliberate simplifications, naming the ceiling and upgrade path.
5. Leave one runnable self-check for non-trivial logic (assert-based demo or one small test).

## Commands

### `/ponytail [lite|full|ultra|off]`

Report or switch ponytail intensity level. No argument reports the current level.

- **lite** — Build what's asked, name the lazier alternative in one line.
- **full** — The ladder enforced. Stdlib and native first. Shortest diff, shortest explanation. Default.
- **ultra** — YAGNI extremist. Deletion before addition. Challenges requirements.
- **off** — Deactivate ponytail.

### `/ponytail-review`

Sends a prompt to review the current diff for over-engineering. Returns a delete-list with tags: delete, stdlib, native, yagni, shrink.

### `/ponytail-audit`

Sends a prompt to audit the whole repo for over-engineering, not just the diff.

### `/ponytail-debt`

Sends a prompt to harvest `ponytail:` comments into a tracked debt ledger, so deferrals don't rot.

### `/ponytail-gain`

Displays a static benchmark scoreboard showing measured impact (less code, less cost, more speed).

### `/ponytail-help`

Displays a quick reference card for all commands and levels.

## Events

### `turn_start`

On the first turn of a conversation, injects the ponytail ruleset as a system reminder (filtered to the active level). Also detects natural-language deactivation ("stop ponytail", "normal mode") and turns ponytail off.

### `conversation_open`

Resets mode to the configured default and clears the injection flag on new conversations.

## State

State (current mode + injection flag) is stored in the platform config directory:

- Linux/macOS: `~/.config/ponytail/state.json`
- Windows: `%APPDATA%\ponytail\state.json`

## Configuration

Default mode can be set via:

1. `PONYTAIL_DEFAULT_MODE` env var (`lite`/`full`/`ultra`/`off`)
2. Config file: `~/.config/ponytail/config.json` (Windows: `%APPDATA%\ponytail\config.json`) with `{ "defaultMode": "lite" }`
3. Default: `full`

Resolution: env var > config file > `full`.

## UI

Sets a status value `ponytail-mode` showing the current level (e.g. "FULL", "LITE"). Cleared when ponytail is off or the mod is disposed.

## Adaptation notes for agents

- Do not import Letta Code internals. Use the public mod API and Node built-ins only.
- The mod uses `node:fs`, `node:path`, `node:os` — no third-party dependencies.
- State is written to the user's config directory, not the mods folder.
- The ruleset is a large embedded string (`SKILL_BODY`) — it is filtered per-level by `filterSkillBodyForMode` before injection.
