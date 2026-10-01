# Codex Quota Router

A Letta Code mod that automatically moves a conversation to another connected ChatGPT OAuth plan when its current Codex plan has exhausted its usage allowance.

## Install

```bash
letta install npm:@letta-ai/codex-quota-router
```

Run `/reload` after installation.

## Behavior

Before a Codex turn, the mod:

1. Discovers connected non-base `chatgpt_oauth` providers and caches that verified set.
2. Reads current usage for each verified plan.
3. Checks that the conversation's selected provider is verified and has reached its limit.
4. If needed, changes only the conversation-level model provider to the verified available plan with the most quota remaining.

Both sides of every route must be in the verified ChatGPT OAuth set. Base providers, non-OpenAI providers, unknown aliases, and stale manually injected names are ignored.

The model name is preserved. For example, an exhausted `chatgpt-work/gpt-5.5` conversation may move to `chatgpt-personal/gpt-5.5`.

The agent's default model is not changed. In the TUI, a persistent transcript notification reports the quota error, mod name, replacement model, and reasoning effort. Like the `Dreamed; no durable memory changes were needed.` notification, it is local UI state and is never added to the agent's messages or context.

## Commands

```text
/codex-quota-router status
/codex-quota-router refresh
/codex-quota-router on
/codex-quota-router off
/codex-quota-router plans chatgpt-work,chatgpt-personal
```

Connected plans are discovered automatically on refresh. The `plans` command can restrict failover to a specific allowlist.

## State and network access

The mod stores usage metadata and configuration in:

```text
~/.letta/mods/codex-quota-router.state.json
```

It does not store OAuth tokens. Usage and provider metadata are read through the authenticated Letta client already used by Letta Code. The state file is written with owner-only permissions when created.

Desktop listener sessions cannot make general Letta client requests from mods. They use the most recently cached usage snapshot written by a CLI or another supported surface; run `/codex-quota-router refresh` in the CLI if that cache is missing or stale. On Letta Code 0.30.8 or newer, the mod also overrides the in-flight Desktop turn so the replacement plan takes effect immediately rather than only updating persisted conversation state.

## Safety and recovery

Mods are trusted local code. Review the source before installing third-party mods.

Disable automatic switching with `/codex-quota-router off`. If a mod breaks startup or command handling, recover with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

See [`MOD.md`](./MOD.md) for agent-facing semantics and adaptation notes.
