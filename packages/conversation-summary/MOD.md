---
name: "@letta-ai/conversation-summary"
description: "Conversation summary/title statusline for Letta Code."
---

# Conversation summary statusline mod semantics

## When to use

Use this mod when the user wants Letta Code's idle statusline to show the current conversation summary/title.

## Behavior

- Registers an order-0 panel, replacing the built-in agent/model line while idle.
- Shows the current conversation summary on the left side of the statusline.
- Renders the agent name and model on the right so the row stays useful when the conversation has no summary yet.
- Fetches on `conversation_open`; it does not poll.
- Uses `letta.client.conversations.retrieve(conversationId)` for API-backed conversations.
- Supports local agents by reading local backend conversation metadata from `~/.letta/lc-local-backend/conversations/<base64url-key>/conversation.json`.
- Honors `LETTA_LOCAL_BACKEND_DIR` when resolving local backend storage.
- Clears the left segment when the current conversation summary is empty or unavailable.

## Safety invariants

- Renderer stays synchronous and side-effect-free.
- API/file reads happen only during activation and lifecycle events, never during render.
- Local file access is read-only and limited to local backend conversation metadata.
- The panel is closed when the mod is disposed.
- Panel and lifecycle APIs are capability-guarded.

## Adaptation notes for agents

- Keep this mod one-fetch-per-open; do not add polling unless the user explicitly wants live title refresh.
- If adding a fallback label, preserve the distinction between “no summary yet” and a real conversation title.
- If composing with other statusline data, remember an order-0 panel owns the full idle row.
