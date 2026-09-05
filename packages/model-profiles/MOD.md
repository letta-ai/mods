---
name: "@letta-ai/model-profiles"
description: "Manage per-model context window limits and reasoning effort profiles in MemFS."
---

# Model profiles mod semantics

## When to use

Use this mod when you want model switches to preserve custom context window limits (such as 250K for Grok or 200K for Claude) and reasoning effort settings across turns, rather than resetting to provider defaults.

## Recommended scope

Install this as an agent-scoped mod in MemFS (`$MEMORY_DIR/mods/model-profiles.ts`). Agent scoping ensures each agent keeps its own preferred model targets, limits are tracked in the agent's memory git repository, and settings persist across machines.

## Behavioral contract

The mod stores preferred settings per model in MemFS (`$MEMORY_DIR/mods/model-profiles.json`). When switching models via `/model-profile switch` or the `switch_model_profile` tool, it updates the model, context window, and reasoning tier atomically via `ctx.conversation.updateLlmConfig({ model, contextWindow, reasoningEffort, scope })`.

- Changes apply on the next turn.
- Scope `conversation` updates only the active thread override without mutating the agent default.
- Scope `agent` updates the agent's default configuration.

## Commands

### `/model-profile` or `/model-profile list`
Lists all saved model profiles, current active model, context window, and storage location.

### `/model-profile set <model> <context-window> [reasoning-effort] [label]`
Saves or updates a model profile in MemFS.

### `/model-profile switch <model-or-label> [--scope conversation|agent]`
Atomically switches the model and preferred context window for the conversation or agent.

### `/model-profile remove <model-or-label>`
Removes a saved profile from MemFS.

## Tools

The mod registers snake_case and PascalCase aliases:

- `list_model_profiles` / `ListModelProfiles`
- `set_model_profile` / `SetModelProfile`
- `switch_model_profile` / `SwitchModelProfile`
- `delete_model_profile` / `DeleteModelProfile`
