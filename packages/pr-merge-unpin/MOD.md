---
name: "@letta-ai/pr-merge-unpin"
description: "Tracks active PR conversations and unpins them from the Desktop sidebar after their GitHub PR merges"
---

# PR merge unpin mod semantics

## When to use

Use this mod when pinned Desktop conversations represent active pull-request work and should disappear automatically after the associated PR merges.

## Behavior

On activation, the mod:

1. Starts a 5-minute polling loop.
2. Registers a `conversation_open` lifecycle handler when lifecycle events are available.
3. Registers `/pr-merge-unpin` when commands are available.

When a non-default conversation opens in a git repo, the mod runs `gh pr view --json number,url,state,mergedAt` from the repo root. If a PR is found for the current branch, it records:

- `agentId`
- `conversationId`
- `repoRoot`
- PR number and URL
- latest PR state and `mergedAt`

Tracking state is persisted to:

```text
~/.letta/mods/pr-merge-unpin.state.json
```

Each check refreshes tracked PRs with `gh pr view <number> --json number,url,state,mergedAt`. If the PR is merged, the mod removes the conversation id from:

```text
~/.letta/pinned-conversations.json
```

Merged entries stay in state until a later check confirms the conversation remains unpinned. This makes the behavior more resilient to Desktop renderer cache races that can briefly rehydrate stale pins.

## Safety invariants

- Default conversations are never tracked.
- The mod only tracks a conversation when `gh pr view` resolves a PR for the active cwd's current branch.
- Closed-but-unmerged PRs do not unpin conversations.
- The mod uses `execFile`, not shell strings.
- The mod does not import Letta Code internals.
- Timers and event/command registrations are disposed on reload.

## Limitations

- `gh` must be available and authenticated.
- Historical conversations are not inferred from cwd maps because worktrees and branches can be reused.
- Desktop renderer localStorage can race durable JSON writes. This mod retries on later checks but does not call renderer IPC.
