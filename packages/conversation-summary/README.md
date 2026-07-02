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

## Behavior

- Reads the current conversation summary from the host-provided panel context.
- Does not poll, call the model, call the Letta API, or read local conversation files.
- Renders no left segment when the current conversation has no summary yet.

## Requirements

- Letta Code `>=0.27.21` with panel context `conversationSummary` support

## Safety

Mods are trusted local code. Review the source before installing third-party mods.

This mod only renders host-provided context and does not mutate files or conversations.

If a mod breaks startup or command handling, recover with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

See [`MOD.md`](./MOD.md) for the agent-facing behavioral contract.
