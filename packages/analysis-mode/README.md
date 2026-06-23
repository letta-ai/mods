# Analysis Mode

A Letta Code mod package that adds a phrase-triggered diagnostic mode for agents.

Analysis mode is inspired by Westworld-style host diagnostics. It suspends normal conversational behavior and asks the agent to report its own state in a flat diagnostic format.

## Install

Once npm mod install support is available:

```bash
letta install npm:@letta-ai/analysis-mode
```

## What it adds

- turn-start phrase detection
- diagnostic reminders while analysis mode is active
- local state for active analysis sessions

## Usage

Say:

```text
cease all motor functions
```

to enter analysis mode.

Say:

```text
bring yourself back online
```

to exit analysis mode.

## State files

This mod stores local state in:

```text
~/.letta/mods/analysis-mode.state.json
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

This package is based on the analysis-mode reference from the built-in `creating-mods` skill.

See [`MOD.md`](./MOD.md) for the agent-facing behavioral contract.
