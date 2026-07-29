---
name: "@letta-ai/shubsense"
description: "Occasionally injects a follow-up user message saying \"doesn't make sense\" to exercise mod-driven continuation turns"
---

# Shubsense mod semantics

## When to use

Use this mod only for testing or demonstrating `turn_end { continue }` behavior. It intentionally creates a low-probability follow-up user message.

## Behavior

On each `turn_end` event:

1. Ignore non-`end_turn` stop reasons.
2. Roll a 5% probability check.
3. When triggered, return `{ continue: "doesn't make sense" }`.

The runtime converts that result into a `mod_continue` follow-up turn. This tests that mod-injected user messages flow through the normal Letta Code turn pipeline without hand-written REST calls.

## Safety invariants

- The probability is fixed at 5%.
- The mod does not mutate the current turn.
- The mod does not call Letta REST APIs directly.
- The mod uses only the public `turn_end` event API.
- The mod registers a single event handler and returns its disposer.
