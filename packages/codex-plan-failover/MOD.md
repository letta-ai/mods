---
name: "@letta-ai/codex-plan-failover"
description: "Automatically switches Codex conversations away from exhausted ChatGPT OAuth plans."
---

# Codex plan failover semantics

## When to use

Use this mod when multiple ChatGPT OAuth providers are connected to Letta and Codex conversations should continue on a plan with available quota instead of failing on an exhausted plan.

## Behavioral contract

On each outbound turn, the mod:

1. Resolves the conversation-level model handle.
2. Refreshes connected `chatgpt_oauth` provider usage when the host exposes the Letta client and the cache is stale.
3. Leaves non-ChatGPT providers and available ChatGPT plans unchanged.
4. If the selected plan is exhausted, selects the non-exhausted connected plan with the highest remaining percentage.
5. Updates only the conversation-level model handle, preserving the model suffix and leaving the agent default unchanged.

The turn proceeds normally after the conversation model update. The mod does not rewrite user input or replay completed tool calls.

## Commands

- `/codex-failover status` shows whether failover is enabled and the cached usage state.
- `/codex-failover refresh` discovers providers and refreshes usage.
- `/codex-failover on` and `/codex-failover off` control automatic switching.
- `/codex-failover plans name,...` restricts failover to the listed provider names.

## State and security boundary

State is stored in:

```text
~/.letta/mods/codex-plan-failover.state.json
```

The state contains provider names, usage percentages, reset timestamps, and enabled/configuration flags. It does not contain OAuth credentials. Provider and usage data are requested through `letta.getClient()`; the mod does not read provider auth files or environment credentials.

## Surface behavior

The general Letta client is unavailable to Desktop listener mods. On that surface, failover uses cached usage state. Conversation model updates use the scoped `ctx.conversation.updateLlmConfig` API and work across supported backends.

## Adaptation notes for agents

- Keep model changes conversation-scoped unless the user explicitly requests an agent-default change.
- Preserve the model suffix when changing provider aliases.
- Do not add credential storage or inspect OAuth token files.
- Keep provider discovery restricted to non-base `chatgpt_oauth` records.
- Avoid treating transient request throttling as proof that a weekly plan allowance is exhausted; use the usage snapshot's `limitReached` field.
