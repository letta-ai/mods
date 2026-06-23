---
name: "@letta-ai/mod-plan-mode"
description: "Example plan-mode workflow mod for Letta Code."
---

# Plan mode mod semantics

## When to use

Use this mod as a reference for workflows that need to pause implementation, gather read-only context, write a plan, ask the user for approval, and only then proceed.

This is an example package. It uses sample-prefixed IDs and does not override built-in plan mode.

## Behavioral contract

When sample plan mode is active, the agent should:

1. Explore the codebase with read-only tools.
2. Avoid mutating files, configuration, git state, or external systems.
3. Write the plan to the generated plan file under `~/.letta/plans/`.
4. Present the full current plan text to the user for approval.
5. Call `sample_exit_plan_mode` only after the user approves.

## Commands

### `/sample-plan`

Starts sample plan mode for the current conversation.

The command creates a plan session, chooses a plan file path, and injects a system reminder telling the agent how to proceed.

## Tools

### `sample_enter_plan_mode`

Model-callable entrypoint for sample plan mode. Use when a non-trivial task needs explicit planning and approval before implementation.

### `sample_exit_plan_mode`

Model-callable exit point. Call only after the plan file has been written, the full current plan has been shown to the user, and the user has approved it.

## Turn reminders

While sample plan mode is active, the mod prepends a system reminder at turn start. The reminder restates the active plan file path and the rule that only read-only exploration and plan-file writes are allowed.

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
~/.letta/mods/sample-plan-mode.state.json
```

Plan files are written under:

```text
~/.letta/plans/sample-*.md
```

## Adaptation notes for agents

- Keep the command/tool IDs sample-prefixed unless the user explicitly wants to replace built-in plan mode.
- Do not import Letta Code internals. Use the public mod API and Node built-ins.
- Keep permission checks conservative. If a tool cannot be confidently classified as safe, deny it while plan mode is active.
- Keep `package.json#letta` as the source of truth for runtime capabilities. Do not duplicate capabilities in this file's frontmatter.
