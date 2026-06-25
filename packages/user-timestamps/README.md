# User Timestamps

A Letta Code mod package that adds local timestamp metadata to every user message.

This helps agents answer time-sensitive questions and reason about current time without relying on stale conversation context.

## Install

```bash
letta install npm:@letta-ai/user-timestamps
```

Then reload local mods:

```text
/reload
```

## What it adds

- A `turn_start` transform for user messages
- Structured `metadata.user_timestamp` containing local time and timezone
- A compact visible `<user_timestamp>` block prepended to each user message so the model definitely sees the current time

Example injected block:

```text
<user_timestamp>
local: Wednesday, June 24, 2026 at 6:00:00 PM PDT
timezone: America/Los_Angeles
</user_timestamp>
```

## Behavior

- User messages get timestamped before they are sent to the model.
- Approval messages are not changed.
- Existing timestamp blocks are not duplicated.
- The timestamp is generated locally using the machine running Letta Code.

## Safety

Mods are trusted local code. Review the source before installing third-party mods.

If a mod breaks startup or command handling, recover with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

See [`MOD.md`](./MOD.md) for the agent-facing behavioral contract.
