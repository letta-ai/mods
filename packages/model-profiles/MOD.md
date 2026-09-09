---
name: "@letta-ai/model-profiles"
description: "Remember a context window limit and reasoning effort per model and apply them when switching models."
---

# Model profiles mod semantics

## When to use

Use this mod when a model switch should also restore a saved context window limit and reasoning effort for that model, instead of leaving the user to set them again after every switch.

## Behavioral contract

- A profile is keyed by model handle and holds `contextWindow` (positive integer, tokens), optional `reasoningEffort` (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`), optional `label`, and `updatedAt`.
- `switch_model_profile` and `/model-profile switch` resolve the argument as an exact handle, then a case-insensitive handle, then a case-insensitive label. Explicit `context_window` / `reasoning_effort` arguments override the saved profile.
- The switch is one call to `ctx.conversation.updateLlmConfig({ model, contextWindow, reasoningEffort, scope })`. Fields that are neither saved nor overridden are omitted, so the runtime keeps or defaults them.
- If nothing matches, the model is still switched and the result says that no saved profile was used.
- `scope: "conversation"` (default) changes only the active conversation. `scope: "agent"` changes the agent default.
- Changes apply on the next turn.

## Storage and recovery

- File: `ctx.memfs.memoryDir/mods/model-profiles.json`, falling back to `MEMORY_DIR`, then `~/.letta/mods/model-profiles.json`. An existing root-level `model-profiles.json` in the memory directory keeps being used.
- Writes are temp-file plus rename. The mod never commits or pushes.
- An unreadable or malformed file is moved to `model-profiles.json.corrupt-<timestamp>` and a warning diagnostic is reported. Malformed individual entries are skipped on read and dropped on the next write.

## Tools

- `list_model_profiles` (parallel-safe)
- `set_model_profile` (`model`, `context_window`, `reasoning_effort?`, `label?`)
- `switch_model_profile` (`model`, `scope?`, `context_window?`, `reasoning_effort?`)
- `delete_model_profile` (`model`)

Tools that write or switch are registered with `parallelSafe: false` and do not require approval. Validation failures and backend errors are returned as tool results with `status: "error"`, not thrown.

## Command

`/model-profile [list|set|switch|remove]`. Flags `--scope <conversation|agent>`, `--scope=<value>`, `--agent`, `--conversation` may appear anywhere. Remaining tokens are positional, so labels with spaces work in `set`, `switch`, and `remove`.

## Adaptation notes

- Use `ctx.memfs.memoryDir` and `ctx.conversation.updateLlmConfig`; do not derive private Letta Code paths or import internal modules.
- Keep the reasoning tier list in sync with `ModelReasoningEffort` in Letta Code.
