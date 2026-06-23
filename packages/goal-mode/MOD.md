---
name: "@letta-ai/mod-goal-mode"
description: "Goal mode workflow mod for Letta Code."
---

# Goal mode mod semantics

## When to use

Use this mod when a user wants an objective to stay active across turns until the agent completes it, becomes blocked, pauses, or clears the goal.

## Behavioral contract

When a goal is active, the agent should:

1. Keep the goal objective in mind when choosing next steps.
2. Avoid repeating work that is already done.
3. Audit the current state before declaring the goal complete.
4. Mark the goal complete only when every requirement is satisfied.
5. Mark the goal blocked only when a repeated blocking condition prevents progress.
6. Respect paused or blocked goals until the user resumes them.

## Commands

### `/goal <objective>`

Starts a goal for the current conversation.

### `/goal --token-budget N <objective>`

Starts a goal with a soft token budget.

### `/goal status`

Shows the current goal and recorded usage.

### `/goal pause`, `/goal resume`, `/goal complete`, `/goal clear`

Manage the active goal state.

## Tools

The mod registers snake_case and PascalCase aliases so different toolsets can call whichever form they prefer:

- `get_goal` / `GetGoal`
- `create_goal` / `CreateGoal`
- `update_goal` / `UpdateGoal`

`update_goal` only accepts `complete` or `blocked` status values. User-controlled states like pause, resume, and clear should go through `/goal`.

## Turn reminders

While a goal is active, the mod prepends a reminder that includes the goal objective, status, budget, and completion-audit rules. The reminder tells the agent to use `<goal_status>complete</goal_status>` only after the goal is actually achieved.

## State

State is stored in:

```text
~/.letta/mods/goal-mode.state.json
```

## Adaptation notes for agents

- Keep state scoped by conversation ID.
- Keep tool descriptions strict: agents should not infer goals from normal tasks.
- Do not import Letta Code internals from package mods.
- If adapting this into a stricter workflow, prefer adding narrow permissions or status UI instead of broad side effects.
