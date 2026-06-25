# Plan Mode

A Letta Code mod package that adds a plan-mode workflow using public mod APIs.

Plan mode pauses implementation, lets the agent gather read-only context, writes an implementation plan to `~/.letta/plans/`, and asks the user to approve before coding starts.

## Install

```bash
letta install npm:@letta-ai/plan-mode
```

Then reload local mods:

```text
/reload
```

## What it adds

- `/plan` slash command
- `enter_plan_mode` model-callable tool
- `exit_plan_mode` model-callable tool
- a turn reminder while plan mode is active
- a permission overlay that blocks mutating tools except plan-file writes

## Quick start

```text
/plan
```

The command tells the agent to explore read-only, write an implementation plan to a generated file under `~/.letta/plans/`, present the full plan for approval, and then call `exit_plan_mode` after approval.

## State files

This mod stores small local state in:

```text
~/.letta/mods/plan-mode.state.json
```

Generated plan files live in:

```text
~/.letta/plans/plan-*.md
```

## Safety

Mods are trusted local code. Review the source before installing third-party mods.

If a mod breaks startup or command handling, recover with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

Then remove or edit the mod package and run `/reload`.

See [`MOD.md`](./MOD.md) for the agent-facing behavioral contract and semantics.
