---
name: "@letta-ai/tool-guard-inspector"
description: "Tool permission audit mod for Letta Code."
---

# Tool Guard Inspector mod semantics

## When to use

Use this mod when the user wants lightweight visibility into tool permission decisions made by a local Letta Code mod.

The mod is useful for debugging tool-use behavior, surfacing potentially risky tool calls, and reducing silent failures where a tool action appears to proceed without the user noticing whether it was allowed, asked, or denied.

## Behavioral contract

This package registers a permission policy and a slash command.

The permission policy classifies tool calls into:

- `allow` for common read-only tools and simple read-only shell commands
- `ask` for ambiguous shell commands, file mutation tools, and delegated agent/task tools
- `deny` for dangerous shell patterns such as destructive deletion, package installation, git pushes/commits/resets, and `curl | sh`

Unknown tools are allowed and logged as `unclassified tool; observe only` to avoid over-blocking unfamiliar tool surfaces.

## Commands

### `/tool-guard`

Shows recent in-memory audit entries for the current conversation.

### `/tool-guard 25`

Shows up to 25 recent entries.

### `/tool-guard all`

Shows recent entries across conversations in the current process.

### `/tool-guard clear`

Clears audit entries for the current conversation.

### `/tool-guard all clear`

Clears all in-memory audit entries.

## State

The audit log is in memory only.

It stores up to 50 recent entries and is reset when Letta Code exits or reloads the mod. This is intentional for the first version: the mod is an inspector, not a persistent compliance log.

## Permission invariants

The mod should be transparent about its scope:

- It records decisions made by this mod's own permission policy.
- It does not claim to observe every permission decision from Letta Code or from other mods.
- It avoids blocking unknown tools by default.
- It keeps shell classification conservative.

## Adaptation notes for agents

- Do not import Letta Code internals. Use public mod APIs and standard JavaScript.
- Keep the rule table small and inspectable.
- Prefer `ask` over `deny` when a command is ambiguous but not clearly dangerous.
- Keep README language accurate: this is an in-session audit view, not a persistent security log.
- Keep `package.json#letta` as the source of truth for runtime capabilities.
