# @letta-ai/model-profiles

Letta Code mod that remembers a preferred context window limit, max output tokens, and reasoning effort for each model, and applies them in the same update when you switch to that model.

## Why

Context window, max output tokens, and reasoning settings are per-model. When you switch models, the new model starts from its own defaults, not from whatever you had tuned on the previous one. If you want Grok capped at 250,000 tokens, or a specific model always on `xhigh` reasoning, you have to set that again after every switch.

That matters most for models whose catalog entry carries placeholder limits. A `byok`/proxy model is registered with a uniform default — commonly 128,000 context and 16,384 max output — regardless of what the provider actually supports, and a model switch resets the conversation to those values.

This mod stores those preferences as a profile per model handle and applies model, context window, max output tokens, and reasoning effort together.

## Enforcement (not just on switch)

Profiles are applied in three situations, so a switch made anywhere is corrected:

1. When you use `/model-profile switch` or the `switch_model_profile` tool.
2. On `conversation_open`, where lifecycle events are available.
3. On **every turn start**, which is what makes it work in listener/Desktop sessions.

The third is the important one. A model changed through the UI picker never goes through this mod, so the conversation silently reverts to catalog placeholders. On each turn the mod reads the active conversation and rewrites only the fields that differ from the saved profile, including reasoning effort. When everything already matches, it reads once and writes nothing, which is the common case. Every request has a five-second timeout: a stalled API produces a warning and does not hold up the turn.

Two details explain the shape of this code:

- `updateLlmConfig` carries model, context window, and reasoning effort but cannot express an output-token limit. That limit is written separately, re-reading the live conversation first. For `model_settings.max_output_tokens`, the existing settings are preserved because the API replaces that object wholesale. For records using top-level `max_tokens` (including Kimi-shaped configurations), only that field is sent so provider settings are not replaced.
- `letta.getClient()` is the primary transport. Listener-hosted mods cannot use it, however, and their conversation handle has no record-read API. Reads and writes therefore fall back to authenticated REST using `LETTA_BASE_URL` and `LETTA_API_KEY`, which the listener process carries in its environment. The key is sent only to the configured Letta origin. If neither transport is available, the mod reports a warning instead of failing silently.

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
/model-profile set <model> <context-window> [reasoning] [--max-output <tokens>] [label...]
/model-profile switch <model-or-label...> [--scope conversation|agent] [--max-output <tokens>]
/model-profile remove <model-or-label...>
```

- `reasoning` is one of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.
- `--max-output` sets the preferred max output tokens, and is optional everywhere.
- Labels can contain spaces and are matched case-insensitively.
- `--scope` accepts `--scope agent`, `--scope=agent`, or the shorthand `--agent`. It may appear anywhere in the command.

Example:

```
/model-profile set xai/grok-4-6 250000 xhigh Grok 4.6
/model-profile set lc_opencode_go/deepseek-v4.1-flash 1000000 --max-output 384000
/model-profile switch Grok 4.6
/model-profile switch anthropic/claude-opus-4-8 --scope agent
```

If no profile matches, the model is still switched and the output says that provider defaults were used for anything not saved.

## Tools

The agent can call the same operations:

- `list_model_profiles` — saved profiles plus the current model, context window, and reasoning effort
- `set_model_profile` — `model`, `context_window`, optional `max_output_tokens`, optional `reasoning_effort`, optional `label`
- `switch_model_profile` — `model` (handle or label), optional `scope`, optional `context_window`, `max_output_tokens` and `reasoning_effort` overrides that win over the saved profile
- `delete_model_profile` — `model` (handle or label)

`list_model_profiles` is parallel-safe. The three tools that write or switch are not, so the runtime serialises them.

## Scope

- `conversation` (default): changes the active conversation only. The agent default is untouched.
- `agent`: changes the agent's default configuration.

Changes take effect on the next turn.

## Test

```bash
npm test
```

The suite covers profile storage, command parsing, and — against a fake conversation API — enforcement on turn start, re-enforcement after a model switch made outside the mod, reasoning restoration, preservation of unrelated `model_settings` for both output-limit representations, request timeouts, the listener case where `letta.client` throws, and distinct max-output write/already-applied/failure reporting.
