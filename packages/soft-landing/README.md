# Soft Landing

A small Letta Code mod for recovering gracefully after context drift, compaction,
tool wobble, or overloaded technical work.

It adds a `/soft-landing` slash command that turns into a short orientation prompt
for the agent. The goal is not a full planning ceremony. It is a handrail: pause,
locate the current room, separate facts from assumptions, and choose one sane next
step.

## Install

```bash
letta install npm:@letta-ai/soft-landing
```

Then reload local mods:

```text
/reload
```

## Usage

```text
/soft-landing
/soft-landing technical
/soft-landing memory
/soft-landing emotional
```

Aliases:

```text
/land
```

## Modes

- `general` - recover from drift or overloaded context.
- `technical` - recover after tool errors, logs, implementation tangles, or a long debugging tunnel.
- `memory` - recover before touching memory, notes, or other durable state.
- `emotional` - recover when distance, formality, or runtime weirdness may have affected the human.

## What it does

The command asks the agent to:

1. Name where the conversation is right now.
2. Separate known facts from assumptions.
3. Mention relevant tool/runtime/context wobble briefly without making the user manage it.
4. Pick one small next step.
5. Keep the response warm, direct, and walkable.

## Safety

This mod only registers prompt commands. It does not read files, write files, store
state, call tools, or change permissions.

If a mod breaks startup or command handling, recover with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

See [`MOD.md`](./MOD.md) for the agent-facing behavioral contract.
