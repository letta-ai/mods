# Codex plan failover

A Letta Code mod that automatically moves a conversation to another connected ChatGPT OAuth plan when its current Codex plan has exhausted its usage allowance.

## Install

```bash
letta install npm:@letta-ai/codex-plan-failover
```

Run `/reload` after installation.

## Behavior

Before a Codex turn, the mod:

1. Discovers connected `chatgpt_oauth` providers.
2. Reads current usage for each plan.
3. Checks whether the conversation's selected plan has reached its limit.
4. If needed, changes only the conversation-level model provider to the available plan with the most quota remaining.

The model name is preserved. For example, an exhausted `chatgpt-work/gpt-5.5` conversation may move to `chatgpt-personal/gpt-5.5`.

The agent's default model is not changed. In the TUI, a persistent transcript notification reports the quota error, mod name, replacement model, and reasoning effort. Like the `Dreamed; no durable memory changes were needed.` notification, it is local UI state and is never added to the agent's messages or context.

## Commands

```text
/codex-failover status
/codex-failover refresh
/codex-failover on
/codex-failover off
/codex-failover plans chatgpt-work,chatgpt-personal
```

Connected plans are discovered automatically on refresh. The `plans` command can restrict failover to a specific allowlist.

## State and network access

The mod stores usage metadata and configuration in:

```text
~/.letta/mods/codex-plan-failover.state.json
```

It does not store OAuth tokens. Usage and provider metadata are read through the authenticated Letta client already used by Letta Code. The state file is written with owner-only permissions when created.

Desktop listener sessions cannot make general Letta client requests from mods. They use the most recently cached usage snapshot written by a CLI or another supported surface; run `/codex-failover refresh` in the CLI if that cache is missing or stale. On Letta Code 0.30.8 or newer, the mod also overrides the in-flight Desktop turn so the replacement plan takes effect immediately rather than only updating persisted conversation state.

## Safety and recovery

Mods are trusted local code. Review the source before installing third-party mods.

Disable automatic switching with `/codex-failover off`. If a mod breaks startup or command handling, recover with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

See [`MOD.md`](./MOD.md) for agent-facing semantics and adaptation notes.
