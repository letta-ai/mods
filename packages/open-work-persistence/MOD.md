# open-work-persistence

## Purpose

Lets an agent resume its own declared open work by chaining a follow-up turn
after `turn_end`, instead of depending on a user message to continue.

## Behavior

- Subscribes to the `turn_end` event (guarded by `letta.capabilities.events.turns`).
- Reads a JSON registry (`OPEN_WORK_REGISTRY`, default `/var/lib/letta/workspace/OPEN-WORK.json`).
- When the registry declares open work (same conversation, < 6h old, budget > 0),
  decrements `chain_budget` on disk **before** chaining, then returns
  `{ continue: "..." }` — the harness-native turn-chaining contract — instructing
  the agent to continue the declared task or mark it done.
- Never chains on malformed registry, wrong conversation, stale declaration, or
  exhausted budget; reports a diagnostic instead.

## Entry points

- `mods/open-work-persistence.ts`

## Safety

- Durable budget prevents runaway loops; decrement happens before the chained turn.
- Staleness window (6h) prevents acting on outdated declarations.
- Conversation scoping prevents cross-conversation chaining.
- Registry read/write failures fail closed (no chain).
