# Shubsense

A Letta Code mod that occasionally follows up with:

```text
doesn't make sense
```

This is a joke/debug mod for testing mod-driven follow-up turns. Install it only if you want the agent to sometimes challenge itself after a normal turn.

## Install

```bash
letta install npm:@letta-ai/shubsense
```

Then reload local mods:

```text
/reload
```

## Behavior

- Runs on `turn_end`.
- Only reacts to normal `end_turn` completions.
- Has a 5% chance to return `{ continue: "doesn't make sense" }`.
- The follow-up is sent as a user message through Letta Code's `mod_continue` path, so it exercises the same turn pipeline as a normal user follow-up.

## Safety

This mod intentionally injects low-probability nonsense into the conversation. Keep it opt-in and disable/remove it if it becomes disruptive.

Recover with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

See [`MOD.md`](./MOD.md) for the agent-facing behavioral contract.
