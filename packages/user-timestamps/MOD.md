---
name: "@letta-ai/user-timestamps"
description: "Adds local timestamp metadata to every user message before model turns."
---

# User timestamps mod semantics

## When to use

Use this mod when the agent should always know the exact local time of each user turn without relying on stale prior context or manual user-provided timestamps.

## Behavior

On every `turn_start`, the mod transforms each user message by:

1. Adding structured `metadata.user_timestamp` with:
   - `local`: the user's local date/time string
   - `timeZone`: the local IANA timezone when available
2. Prepending a short visible timestamp block to the user message content:

```text
<user_timestamp>
local: Wednesday, June 24, 2026 at 6:00:00 PM PDT
timezone: America/Los_Angeles
</user_timestamp>
```

The visible block is intentionally included because model providers and downstream message schemas may ignore custom metadata. The visible content keeps the behavior robust and easy to inspect.

## Safety invariants

- Only user messages are transformed.
- Approval messages are left unchanged.
- Existing `<user_timestamp>` blocks are not duplicated.
- The mod uses only public turn event APIs and does not import Letta Code internals.
- The mod registers a single `turn_start` handler and returns its disposer.

## Adaptation notes for agents

- Keep timestamp text compact. Do not add UTC, ISO, or verbose metadata unless the user explicitly asks.
- Keep the XML-like tag stable so agents and tests can detect the injected timestamp.
- If adapting for strict invisibility, remove the visible block only if the harness/provider reliably preserves `metadata.user_timestamp` into model-visible context.
