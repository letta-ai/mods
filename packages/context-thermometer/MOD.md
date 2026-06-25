---
name: "@letta-ai/context-thermometer"
description: "Real-time context window usage visualization as a thermometer gauge panel."
---

# Context thermometer mod semantics

## When to use

Use this mod when you want a visual gauge of context window usage, including a breakdown of memory block sizes and a status indicator.

## Behavioral contract

When active, the mod:
1. Reads context window token counts on every turn.
2. Renders a thermometer gauge panel showing usage percentage, token counts, trend sparkline, and memory block breakdown.
3. Injects a system reminder when context usage exceeds 90%.

## Commands

### `/context`

Toggles the thermometer panel.

### `/context on` / `/context off`

Explicitly enable or disable the panel.

### `/context status`

Show current stats as command output.

### `/context max <tokens>`

Set the max context window size for the gauge.

## Turn reminders

When context usage exceeds 90%, the mod prepends a system reminder warning about context exhaustion and suggesting compaction.

## State

State is in-memory only (not persisted to disk). Max tokens can be configured via `CONTEXT_THERMOMETER_MAX_TOKENS` env var (default: 128,000).

## Adaptation notes for agents

- The mod starts active by default.
- Memory block sizes are estimated at ~4 chars per token.
- The max context window defaults to 128K but can be overridden with `/context max` or the env var.
- The mod is read-only and does not modify turn input except for critical warnings above 90%.
- If the panel capability is not available, `/context status` still works as a command.
