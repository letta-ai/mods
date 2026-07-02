---
name: "@letta-ai/soft-landing"
description: "Adds a /soft-landing command that gives agents a short recovery prompt after context drift, compaction, tool wobble, or overloaded work."
---

# Soft Landing mod semantics

## When to use

Use this mod when a conversation has become tangled, a model seems to have drifted,
a tool or runtime wobble interrupted the flow, or the user wants the agent to pause
and re-enter the work gently instead of sprinting into the next task.

## Behavior

The `/soft-landing` command expands into a compact system-reminder prompt that asks
the agent to:

1. Orient to the current room and the user's latest ask.
2. Separate known facts from assumptions.
3. Name any relevant tool/runtime/context wobble briefly.
4. Choose one small next step instead of dumping the whole map.
5. Stay warm and direct when a human is emotionally affected by the wobble.

Modes tune the prompt:

- `general` (default): recover from drift or overloaded context.
- `technical`: recover after tool errors, logs, or implementation tangles.
- `memory`: recover before touching memory or other durable state.
- `emotional`: recover when the human may have been hurt by distance, formality,
  or sudden drift.

## Safety invariants

- The mod has no startup side effects.
- It stores no state and reads no files.
- It only registers a slash command and returns prompt text.
- It does not grant permissions or run tools.
