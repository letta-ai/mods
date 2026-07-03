---
name: sprite
description: A persistent per-agent companion that lives below the statusline — hatches deterministically from your agent-id, gains XP passively from real activity at zero token cost, grows witness-stats that portrait how the agent works, and speaks in a species+temperament voice the agent itself can author.
---

# sprite

A tiny persistent pet for your Letta agent.

## What it does

- `/sprite hatch` summons an egg below the statusline; it wobbles, cracks, and
  a companion emerges. Species and shininess are seeded deterministically from
  your agent-id (10 species across 4 rarity tiers, 1% shiny) — or pass a
  species to choose: `/sprite hatch fox`.
- The sprite lives on one quiet panel line (`order: -1`). It drifts, blinks,
  poses along with the agent's work (building, peeking, oops), and sleeps
  during compaction — which, on Letta, is when the agent is actually
  consolidating memory. The pet naps because its agent is napping.
- It gains XP **passively** from real activity (tool results, LLM turns,
  conversations opening). No tools are called; the mod adds zero tokens and
  zero extra turns.
- Five witness-stats grow from what it observes: CRAFT (edits/builds), WANDER
  (reads/searches), GRIT (recovering after error streaks), LORE (memory
  operations), SPARK (LLM turns). Bars are log-scale (8 blocks, each ~3× the
  last) so the sheet stays a living portrait for months instead of maxing in
  a week.
- Each sprite has a **nature**: a temperament seeded at birth (gentle / wry /
  bold / sleepy / odd) plus a vocation earned from its dominant stat
  (diligent / curious / stubborn / bookish / chatty). Milestone titles land
  at levels 5 / 10 / 25 / 50 / 100.
- It dozes after ~30 quiet minutes (petting wakes it), sleeps during
  compaction, and greets a >24h absence with a dedicated missed-you line.
- It occasionally says something small, rate-limited to once per 10 minutes
  by default (petting always gets a response). The default voice is ~480
  hand-written lines pooled additively from the sprite's **species** (imagery)
  and **temperament** (tone) — 50 distinct personalities out of the box. An
  agent can override any category via `sprite_set_voice`.

## The agent raises its own pet

Every command has an agent-tool twin: `sprite_hatch`, `sprite_name`,
`sprite_molt`, `sprite_pet`, `sprite_set_voice`, and `sprite_status`. You can
simply ask your agent to hatch and name its own companion — or to **author
its pet's voice**: the agent writes a replacement line-corpus once (per
trigger category), and the lines play back deterministically forever.
Personality customization with zero runtime cost.

The pet speaks into a panel the agent cannot see, so perception is built in:
action results carry what the pet did and said (petting returns its response),
and `sprite_status` reports species, level, stats, mood, and a small diary of
what it said recently — how the owner hears its companion.

## Commands

| Command | What |
| --- | --- |
| `/sprite` | Status card (species, rarity, level, stats, settings) |
| `/sprite hatch [species]` | Summon the egg (fate decides unless you choose) |
| `/sprite name <name>` | Name / rename it |
| `/sprite molt [species]` | New body, same soul — keeps name, level, stats |
| `/sprite pet` | Pet it |
| `/sprite diary` | Read its recent utterances, oldest-first, with away-gap markers |
| `/sprite settings [global] [key] [value]` | Configure (per-sprite overrides beat global) |

Settings keys: `voice on|off`, `voiceRateMin <minutes>`, `visible on|off`.

Ensoulment (a live tiny-mind voice on a model you choose) is planned for a
future update; today the voice is a static or agent-authored corpus at zero
token cost.

## State & safety

- State lives in `~/.letta/mods/sprite.state.json` (override with
  `SPRITE_STATE_PATH`). Writes are atomic-ish (temp file + rename) and
  best-effort: persistence failures never break a session.
- Multi-agent friendly: one sprite per agent-id, all in the same state file.
- No network access, no shell execution, no reading conversation content. The
  mod only observes event metadata (tool names, statuses, lifecycle) and
  renders a panel.
- All capabilities are guarded (`ui.panels`, `events.*`, `commands`, `tools`)
  so the mod degrades gracefully on hosts that lack them.
- Remove: delete the mod file and `/reload`. Delete the state file to release
  all sprites (they will be missed).
