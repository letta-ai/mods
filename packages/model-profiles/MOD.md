---
name: "@letta-ai/model-profiles"
description: "Remember a context window limit, max output tokens, and reasoning effort per model and enforce them on switch and on every turn."
---

# Model profiles mod semantics

## When to use

Use this mod when a model should always run with a saved context window limit, max output tokens, and reasoning effort, instead of leaving the user to set them again after every switch. It matters most for models whose catalog entry carries placeholder limits, where a switch silently reverts the conversation.

## Behavioral contract

- A profile is keyed by model handle and holds `contextWindow` (positive integer, tokens), optional `maxOutputTokens` (positive integer, tokens), optional `reasoningEffort` (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`), optional `label`, and `updatedAt`.
- `switch_model_profile` and `/model-profile switch` resolve the argument as an exact handle, then a case-insensitive handle, then a case-insensitive label. Explicit `context_window` / `max_output_tokens` / `reasoning_effort` arguments override the saved profile.
- A switch calls `ctx.conversation.updateLlmConfig({ model, contextWindow, reasoningEffort, scope })`, then writes the output limit separately through the conversation API. `updateLlmConfig` cannot express that field, so it is not available on that single call. Fields that are neither saved nor overridden are omitted, so the runtime keeps or defaults them.
- `scope: "conversation"` (default) changes only the active conversation. `scope: "agent"` changes the agent default, and skips the separate max-output write, which is conversation-scoped.
- Changes apply on the next turn.

## Enforcement on conversation start and every turn

- On `conversation_open` (where lifecycle events exist) and on every `turn_start`, the mod reads the active conversation and applies the profile for its model when the live values differ.
- Only the diverging fields are written. Context and reasoning are applied with `ctx.conversation.updateLlmConfig({ contextWindow?, reasoningEffort?, scope: "conversation" })`; omitting `model` preserves the current model and lets the harness build the provider-specific reasoning shape. Output limits use the server's representation: merge `max_output_tokens` into existing `model_settings` when that is the live shape, but send top-level `max_tokens` alone when the conversation stores the limit there. This avoids replacing provider settings on Kimi-like records.
- A model with no saved profile is left untouched. A conversation whose values already match is read once and not written, which is the common case. Reasoning is compared across the harness-supported shapes: `reasoning.reasoning_effort`, flat `reasoning_effort`, and `effort`.
- There is deliberately no per-conversation "already applied" latch: `ctx.model.id` resolves from the agent record in listener mode, not from the conversation, so a later UI model change is only observable from the conversation record itself.

## Transport

- `letta.getClient()` is the primary transport, with `letta.client` kept for compatibility with older hosts. The client is captured at activation because event contexts do not carry one.
- In listener-hosted sessions both mod-client paths are unavailable. Reads and writes therefore fall back to authenticated REST at `${LETTA_BASE_URL}/v1/conversations/{id}` using `LETTA_API_KEY`, both of which the listener process carries. The credential is sent only to that configured Letta origin.
- This REST path is a deliberately constrained compatibility fallback: the mod conversation handle can write model/reasoning/context settings, but exposes no conversation record read for `model_settings`. Listener enforcement and the separate max-output write need that read. A supported scoped read or `maxOutputTokens` on `updateLlmConfig` would remove the need for it.
- Every conversation read/write is bounded to 5 seconds. A stalled request is aborted and reported as a warning, so profile enforcement cannot indefinitely block a turn.
- With no SDK and no REST credentials the mod reports a warning diagnostic rather than failing silently.

## Storage and recovery

- File: `ctx.memfs.memoryDir/mods/model-profiles.json`, falling back to `MEMORY_DIR`, then `~/.letta/mods/model-profiles.json`. An existing root-level `model-profiles.json` in the memory directory keeps being used.
- Writes are temp-file plus rename. The mod never commits or pushes.
- An unreadable or malformed file is moved to `model-profiles.json.corrupt-<timestamp>` and a warning diagnostic is reported. Malformed individual entries are skipped on read and dropped on the next write.

## Tools

- `list_model_profiles` (parallel-safe)
- `set_model_profile` (`model`, `context_window`, `max_output_tokens?`, `reasoning_effort?`, `label?`)
- `switch_model_profile` (`model`, `scope?`, `context_window?`, `max_output_tokens?`, `reasoning_effort?`)
- `delete_model_profile` (`model`)

Tools that write or switch are registered with `parallelSafe: false` and do not require approval. Validation failures and backend errors are returned as tool results with `status: "error"`, not thrown.

## Command

`/model-profile [list|set|switch|remove]`. Flags `--scope <conversation|agent>`, `--scope=<value>`, `--agent`, `--conversation`, and `--max-output <tokens>` may appear anywhere. Remaining tokens are positional, so labels with spaces work in `set`, `switch`, and `remove`.

## Adaptation notes

- Use `ctx.memfs.memoryDir` and `ctx.conversation.updateLlmConfig`; do not derive private Letta Code paths or import internal modules.
- Keep the reasoning tier list in sync with `ModelReasoningEffort` in Letta Code.
- Guard the event registrations on `letta.capabilities.events.lifecycle` and `.turns` separately; hosts expose different subsets.
