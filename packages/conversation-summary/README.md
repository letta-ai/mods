# Conversation Summary

A Letta Code statusline mod that shows the current conversation summary in the idle status row.

```text
Implement provider retry UI                         Amelia · Claude Sonnet 4
```

## Install

```bash
letta install npm:@letta-ai/conversation-summary
```

Then reload local mods:

```text
/reload
```

## What it adds

- Current conversation summary/title on the left side of the idle statusline
- Fallback right-side agent/model display
- Support for both API-backed and local agents

## Behavior

- Fetches the conversation summary when a conversation opens.
- Does not poll or call the model.
- Uses the Letta API client for API-backed conversations.
- Reads local agent conversation metadata from `~/.letta/lc-local-backend/conversations/.../conversation.json`, respecting `LETTA_LOCAL_BACKEND_DIR`.
- Renders no left segment when the current conversation has no summary yet.

## Requirements

- Letta Code `>=0.27.20` with panel-based statusline support and lifecycle events

## Safety

Mods are trusted local code. Review the source before installing third-party mods.

This mod reads conversation metadata and does not mutate files or conversations.

If a mod breaks startup or command handling, recover with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

See [`MOD.md`](./MOD.md) for the agent-facing behavioral contract.
