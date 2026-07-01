---
name: "@letta-ai/pets"
description: "Adds small terminal pets that animate based on Letta Code turn and tool activity"
---

# Pets mod semantics

## When to use

Use this mod when you want a small ambient terminal pet in Letta Code.

## Behavior

The `/pets` command creates and manages a panel-based pet. Supported pets are:

- cat
- dog
- bunny
- blob

The pet uses Letta Code events to change animation state:

- `turn_start` switches to a thinking animation.
- `tool_start` switches based on tool type:
  - shell tools use a terminal animation
  - read/search tools use a reading animation
  - edit/write/patch tools use a writing animation
  - user prompt tools use a waiting animation
  - other tools use a general working animation

The animation returns to idle after activity stops.

## Safety invariants

- The mod only writes to its own UI panel.
- The mod does not modify turn input or tool arguments.
- The mod uses only public command, event, and current render-based panel APIs.
- All timers, event handlers, and panels are cleaned up on unload.
