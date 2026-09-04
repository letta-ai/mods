# @letta-ai/model-profiles

Letta Code mod package for managing per-model context window limits and reasoning effort preferences in MemFS.

## Recommended: Install as an agent-scoped mod

We strongly advise installing this as an agent-scoped mod in MemFS (`$MEMORY_DIR/mods/model-profiles.ts`) rather than a global machine mod.

Benefits of agent-scoped installation:
- **Per-agent preferences**: Different agents need different model profiles and token limits. A coding agent may target a 200,000 token limit, while a lighter agent targets 64,000. Agent-scoped mods keep these configurations isolated.
- **Portability across environments**: When installed in MemFS, both the mod and its profile definitions (`$MEMORY_DIR/mods/model-profiles.json`) are committed to the agent's git repository. They travel with the agent across machines, containers, and cloud environments.
- **Isolated defaults**: Updating the agent default (`scope: "agent"`) targets only this agent rather than global system settings.

### Setup

Copy or symlink `model-profiles.ts` into your agent's memory directory:

```bash
mkdir -p "$MEMORY_DIR/mods"
cp packages/model-profiles/mods/index.ts "$MEMORY_DIR/mods/model-profiles.ts"
```

Then run `/reload` in your Letta Code session.

## Why this mod exists

In Letta, switching models typically resets the active context window to the provider default. When users want custom token limits (such as 250,000 tokens on Grok instead of 500,000) or specific reasoning tiers, this mod preserves those preferences and applies them atomically on switch.

Profiles are saved directly in MemFS (`$MEMORY_DIR/mods/model-profiles.json`).

## Slash commands

- `/model-profile list` - Show current active configuration and all saved profiles
- `/model-profile set <handle> <context-window> [reasoning] [label]` - Add or update a profile
- `/model-profile switch <handle-or-label> [--scope conversation|agent]` - Switch model and apply its profile
- `/model-profile remove <handle-or-label>` - Remove a saved profile

## Tools

- `list_model_profiles` / `ListModelProfiles` - Inspect saved profiles and active settings
- `set_model_profile` / `SetModelProfile` - Store preferred context window and reasoning tier
- `switch_model_profile` / `SwitchModelProfile` - Atomically apply model and context window updates
- `delete_model_profile` / `DeleteModelProfile` - Delete a saved profile

## Scopes

- `conversation` (default): Applies the model and context limit to the active conversation only.
- `agent`: Updates the agent default configuration.
