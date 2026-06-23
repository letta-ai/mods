# Plan Mode Mod

A sample Letta Code mod package that recreates a plan-mode style workflow using public mod APIs.

This package is an example for developers and agents. It does not replace the built-in `/plan` command. Instead, it uses sample-prefixed IDs so you can install and inspect it safely alongside the built-in flow.

## Install

Publishing/install support is still being wired up. Once npm mod install is available, this package is intended to install with:

```bash
letta install npm:@letta-ai/plan-mode
```

For local development, copy or install the package through the local mod package workflow once available.

## What it adds

- `/sample-plan` slash command
- `sample_enter_plan_mode` model-callable tool
- `sample_exit_plan_mode` model-callable tool
- a turn reminder while sample plan mode is active
- a permission overlay that blocks mutating tools except plan-file writes

## Quick start

```text
/sample-plan
```

The command tells the agent to explore read-only, write an implementation plan to a generated file under `~/.letta/plans/`, present the full plan for approval, and then call `sample_exit_plan_mode` after approval.

## State files

This mod stores small local state in:

```text
~/.letta/mods/sample-plan-mode.state.json
```

Generated plan files live in:

```text
~/.letta/plans/sample-*.md
```

## Safety

Mods are trusted local code. Review the source before installing third-party mods.

If a mod breaks startup or command handling, recover with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

## Adapting this example

This example intentionally uses `sample-*` command/tool IDs. If you want to turn it into a real replacement for built-in plan mode, rename the command and tools intentionally and document any overrides.

See [`MOD.md`](./MOD.md) for the agent-facing behavioral contract and semantics.
