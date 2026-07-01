---
name: "@letta-ai/plan-mode"
description: "Plan-mode workflow mod for Letta Code."
---

# Plan mode mod semantics

## When to use

Use this mod for workflows that need to pause implementation, gather read-only context, write a plan, ask the user for approval, and only then proceed.

This package provides a real plan-mode surface. It overrides `/plan` and exposes `enter_plan_mode` / `exit_plan_mode` as model-callable tools.

## Behavioral contract

When plan mode is active, the agent should:

1. Explore the codebase with read-only tools.
2. Avoid mutating files, configuration, git state, or external systems.
3. Write the plan to the generated plan file under `~/.letta/plans/`.
4. Present the full current plan text to the user for approval.
5. Call `exit_plan_mode` only after the user approves.

## Commands

### `/plan`

Starts plan mode for the current conversation.

The command creates a plan session, chooses a plan file path, and injects a system reminder telling the agent how to proceed.

## Tools

### `enter_plan_mode`

Model-callable entrypoint for plan mode. Use when a non-trivial task needs explicit planning and approval before implementation.

### `exit_plan_mode`

Model-callable exit point. Call only after the plan file has been written, the full current plan has been shown to the user, and the user has approved it.

## Turn reminders

While plan mode is active, the mod prepends a system reminder at turn start. The reminder restates the active plan file path and the rule that only read-only exploration and plan-file writes are allowed.

## Permission invariants

While active, the permission overlay allows:

- read-only tools
- planning coordination tools such as `AskUserQuestion` and `UpdatePlan`
- writes or patches only to markdown files under `~/.letta/plans/`
- recall-style subagents only

It denies general coding agents, arbitrary shell mutation, package installs, commits, and edits outside the plans directory.

## State

State is stored in:

```text
~/.letta/mods/plan-mode.state.json
```

Plan files are written under:

```text
~/.letta/plans/plan-*.md
```

## Adaptation notes for agents

- Do not import Letta Code internals. Use the public mod API and Node built-ins.
- Keep permission checks conservative. If a tool cannot be confidently classified as safe, deny it while plan mode is active.
- Keep `package.json#letta` as the source of truth for runtime capabilities. Do not duplicate capabilities in this file's frontmatter.
