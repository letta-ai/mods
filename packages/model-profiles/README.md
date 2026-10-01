# @letta-ai/model-profiles

Letta Code mod that remembers a preferred context window limit and reasoning effort for each model, and applies them in the same update when you switch to that model.

## Why

Context window and reasoning settings are per-model. When you switch models, the new model starts from its own defaults, not from whatever you had tuned on the previous one. If you want Grok capped at 250,000 tokens, or a specific model always on `xhigh` reasoning, you have to set that again after every switch.

This mod stores those preferences as a profile per model handle and applies model, context window, and reasoning effort together through `ctx.conversation.updateLlmConfig`.

## Install

Recommended: install as an agent-scoped mod in MemFS so the mod and its profiles travel with the agent.

```bash
mkdir -p "$MEMORY_DIR/mods"
cp packages/model-profiles/mods/index.ts "$MEMORY_DIR/mods/model-profiles.ts"
```

Then run `/reload` in Letta Code.

Agent scope means:

- each agent keeps its own profiles
- profiles live in the agent's memory git repository and follow it across machines
- `--scope agent` changes only this agent's default, never a global setting

You can also install it as a normal package with `letta install npm:@letta-ai/model-profiles`. Profiles are still stored per agent in MemFS when MemFS is enabled.

## Storage

Profiles are written to `$MEMORY_DIR/mods/model-profiles.json` (an existing file at `$MEMORY_DIR/model-profiles.json` is kept in place). Without MemFS or `MEMORY_DIR`, the file lives at `~/.letta/mods/model-profiles.json`.

Writes go to a temporary file and are renamed into place, so an interrupted write cannot leave a half-written file. If the file is ever unreadable, it is moved to `model-profiles.json.corrupt-<timestamp>` and a warning is reported, rather than being overwritten. Nothing is committed or pushed by the mod.

## Slash command

```
/model-profile list
/model-profile set <model> <context-window> [reasoning] [label...]
/model-profile switch <model-or-label...> [--scope conversation|agent]
/model-profile remove <model-or-label...>
```

- `reasoning` is one of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.
- Labels can contain spaces and are matched case-insensitively.
- `--scope` accepts `--scope agent`, `--scope=agent`, or the shorthand `--agent`. It may appear anywhere in the command.

Example:

```
/model-profile set xai/grok-4-6 250000 xhigh Grok 4.6
/model-profile switch Grok 4.6
/model-profile switch anthropic/claude-opus-4-8 --scope agent
```

If no profile matches, the model is still switched and the output says that provider defaults were used for anything not saved.

## Tools

The agent can call the same operations:

- `list_model_profiles` - saved profiles plus the current model, context window, and reasoning effort
- `set_model_profile` - `model`, `context_window`, optional `reasoning_effort`, optional `label`
- `switch_model_profile` - `model` (handle or label), optional `scope`, optional `context_window` and `reasoning_effort` overrides that win over the saved profile
- `delete_model_profile` - `model` (handle or label)

`list_model_profiles` is parallel-safe. The three tools that write or switch are not, so the runtime serialises them.

## Scope

- `conversation` (default): changes the active conversation only. The agent default is untouched.
- `agent`: changes the agent's default configuration.

Changes take effect on the next turn.

## Test

```bash
npm test
```
