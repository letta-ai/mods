# Goal Mode

A Letta Code mod package that adds a goal workflow using public mod APIs.

Goal mode keeps a user-provided objective active across turns. The agent receives reminders to continue toward the goal until it is completed, blocked, paused, or cleared.

## Install

```bash
letta install npm:@letta-ai/goal-mode
```

## What it adds

- `/goal` slash command for creating, inspecting, pausing, resuming, completing, and clearing goals
- `get_goal` / `GetGoal` model-callable tools
- `create_goal` / `CreateGoal` model-callable tools
- `update_goal` / `UpdateGoal` model-callable tools
- turn reminders while an active goal is being pursued

## Usage

```text
/goal improve benchmark coverage
/goal --token-budget 50000 improve benchmark coverage
/goal status
/goal pause
/goal resume
/goal complete
/goal clear
```

## State files

This mod stores local state in:

```text
~/.letta/mods/goal-mode.state.json
```

## Safety

Mods are trusted local code. Review the source before installing third-party mods.

If a mod breaks startup or command handling, recover with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

## Notes

This package is implemented as a standalone mod package, so it stores state locally instead of importing Letta Code internals.

See [`MOD.md`](./MOD.md) for the agent-facing behavioral contract.
