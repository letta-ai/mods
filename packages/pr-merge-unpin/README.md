# PR merge unpin

A Letta Code mod package that tracks the active conversation's GitHub pull request and removes that conversation from the Desktop pinned sidebar after the PR merges.

This is useful for PR-driven workflows where pinned conversations are a temporary work queue.

## Install

```bash
letta install npm:@letta-ai/pr-merge-unpin
```

Then reload local mods:

```text
/reload
```

## Requirements

- `gh` must be installed and authenticated for the repo.
- The active conversation cwd must be inside a git repo with a branch that `gh pr view` can resolve.
- Desktop pins must be stored in `~/.letta/pinned-conversations.json`.

## What it adds

- A `conversation_open` lifecycle handler that records the active conversation's current branch PR.
- A 5-minute background check for tracked PR merge state.
- A `/pr-merge-unpin` command that runs a check immediately and prints counts.

Example command output:

```text
PR merge unpin: checked 2, tracking 1, unpinned 1.
```

## Behavior

- The mod tracks non-default conversations only.
- It stores tracking state at `~/.letta/mods/pr-merge-unpin.state.json`.
- When a tracked PR reports `MERGED` via `gh pr view`, the mod removes that conversation id from `~/.letta/pinned-conversations.json`.
- Merged entries are retained until a later check confirms the conversation stayed unpinned, which helps with Desktop renderer cache races.

## Limitations

This mod intentionally avoids Letta Code internals and uses the durable Desktop pinned-conversations JSON file. It does not call Desktop renderer IPC APIs, so a stale renderer-local pin cache may briefly rehydrate the pin until the next check removes it again.

## Safety

Mods are trusted local code. Review the source before installing third-party mods.

If a mod breaks startup or command handling, recover with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

See [`MOD.md`](./MOD.md) for the agent-facing behavioral contract.
