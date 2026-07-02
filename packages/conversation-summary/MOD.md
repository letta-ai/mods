---
name: "@letta-ai/conversation-summary"
description: "Conversation summary/title statusline for Letta Code."
---

# Conversation summary statusline mod semantics

## When to use

Use this mod when the user wants Letta Code's idle statusline to show the current conversation summary/title.

## Behavior

- Registers an order-0 panel, replacing the built-in agent/model line while idle.
- Shows the host-provided `ctx.conversationSummary` on the left side of the statusline.
- Renders the agent name and model on the right so the row stays useful when the conversation has no summary yet.
- Does not poll, fetch conversation records, call the model, or read local conversation files.
- Clears the left segment when the current conversation summary is empty or unavailable.

## Safety invariants

- Renderer stays synchronous and side-effect-free.
- The mod only reads host-provided panel context.
- The panel is closed when the mod is disposed.
- Panel API is capability-guarded.

## Adaptation notes for agents

- This package requires Letta Code `>=0.27.21` because it depends on `ctx.conversationSummary` in panel render context.
- If adding a fallback label, preserve the distinction between “no summary yet” and a real conversation title.
- If composing with other statusline data, remember an order-0 panel owns the full idle row.
