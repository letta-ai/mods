---
name: jev-auto
description: Approve low-impact tool calls with Jev and ask about risky ones.
---

# Jev Auto

`mods/auto.mjs` registers `/auto on|off|status` and the `jev-auto` permission
overlay. Both commands and permissions capabilities are required.
Conversation-close cleanup requires lifecycle events.

State is activation-local, scoped by agent and conversation. Keys and tool
arguments are never persisted to disk. Disposal aborts reviews, clears state,
and removes registrations. There are no startup network calls or host permission
setting changes. The mod stays inactive until enabled by the user.

Approval uses OpenRouter's Decisions API. Execution consumes the exact-call
review without another provider call, preserving the host's human-approval
handoff. Returning `alwaysAsk`, not `ask`, prevents ordinary PermissionRequest
auto-allow hooks from bypassing a caution result.

This is trusted local code. Read README.md for privacy and limitations before
enabling it. Never put credentials in this package.
