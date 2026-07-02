# Control Room v2: Panel Cockpit + Trust Guard

Control Room is a Letta Code mod that keeps long-running agent work honest by separating **human intent**, **agent progress claims**, and **harness-observed reality** in one small cockpit.

It is not a project manager. It is a trust surface for agentic work.

```text
CR [goal] Build demo | [mode] edit | [next] Verify cockpit | [approval] ask | [verified] stale | [risk] medium | workspace
```

## Why this matters

Long-running coding sessions drift. The user sets a goal, the agent explores, tools run, files change, tests pass or fail, context compacts, and eventually nobody has a crisp answer to:

- What are we actually trying to do?
- Who set that goal?
- What is the next step?
- Has the result been verified, claimed, or merely hoped for?
- Did something change after verification?
- Can the agent silently mutate its own progress state?

Control Room makes those questions visible.

## Core idea

Control Room tracks three kinds of truth separately:

| Source | Meaning | Example |
| --- | --- | --- |
| Human | Intent and acceptance | `/cr goal Ship the contest demo` |
| Agent | Progress narration and claims | `control_room_update(mode=edit, next=Run smoke test)` |
| Harness | Observed runtime facts | tool calls, file changes, verification commands, compaction, LLM events |

The important rule: **agent claims are not human verification**.

An agent can claim verification, but Control Room records it as `claimed`. A human `/cr verified` is the stronger signal. If a tool later changes state, Control Room marks verification `stale`.

## User-facing cockpit

The panel line is designed for the Letta Code terminal UI:

```text
CR [goal] <human goal> | [mode] <mode> | [next] <next step> | [approval] <auto|ask|locked> | [verified] <state> | [risk] <level> | <workspace>
```

Color is used when supported:

```text
static labels use distinct soft/pastel ANSI colors
[verified] label uses pastel coral
[verified] value uses semantic colors: green verified, sunshine yellow checking/claimed/unknown, red stale
[approval] value stays plain/default text: auto, ask, or locked
[risk] value uses semantic colors: green low, sunshine yellow medium, red high
workspace is dim
```

The mod intentionally avoids fragile glyphs after testing showed some symbols render as tofu boxes in Desktop terminal fonts.

## Commands

```text
/cr                         show compact status
/cr detail                  show provenance and harness facts
/cr on|off                  enable/disable cockpit reminders
/cr goal <text>             set the human-owned goal
/cr goal clear              clear the goal
/cr mode <mode>             explore | plan | edit | verify | stuck | handoff
/cr next <step>             set the next step
/cr next clear              clear the next step
/cr verified [note]         human confirms current state is verified
/cr verify <what>           mark what still needs verification
/cr needs <what>            same as /cr verify
/cr claim [note]            provisional/agent-grade verification claim
/cr checkpoint [note]       record a checkpoint
/cr lock                    deny agent progress updates
/cr safe                    require approval for agent progress updates
/cr unlock                  allow agent progress updates
/cr expand|collapse         toggle expanded panel
/cr glyphs                  terminal glyph/color compatibility test
/cr reset                   reset this workspace state
```

## Reminder loop

When Control Room is on, the mod can use the `turn_end` event as a lightweight self-check loop. It injects a continuation only when state may need attention:

- goal or next step is missing
- mode is `stuck` or `handoff`
- verification is `unknown`, `checking`, or `stale`
- a meaningful change or verification signal happened after the last reminder

Reminder text:

```text
Control Room checkpoint: state may need an update. If needed, call `control_room_update` or `control_room_propose_goal`; otherwise continue normally.
```

`/cr off` pauses that reminder loop and renders the cockpit as paused:

```text
CR [off] paused | /cr on to resume | workspace
```

The reminder stores a pending flag so its own follow-up turn does not recursively remind forever.

## Agent tools

Control Room exposes three agent-callable tools.

### `control_room_status`

Read-only and auto-approved.

Returns the current goal, mode, next step, verification state, approval state, drift heuristic, recent tool signal, changed file count when git is available, and state path.

### `control_room_update`

Agent progress update tool, governed by the Control Room approval mode.

The agent can update:

- mode
- next step
- checkpoint
- verification claim
- evidence string

The agent **cannot** use this tool to set the human-owned goal. If it tries to set `verificationState=verified`, Control Room downgrades that to `claimed`.

### `control_room_propose_goal`

Always asks for approval.

This is the native HITL path for goal changes proposed by the agent. If approved, the goal is recorded as human-owned with provenance:

```text
source: human
via: approved-agent-proposal
```

## Trust guard

Control Room registers a permission overlay for `control_room_update`.

```text
/cr unlock  -> approval auto: agent Control Room updates allowed
/cr safe    -> approval ask: agent Control Room updates require approval
/cr lock    -> approval locked: agent Control Room updates denied
```

In ask mode, the permission handler distinguishes approval and execution phases:

```text
approval phase  -> ask
execution phase -> allow after approval
```

This keeps the user in the loop without causing an approved tool call to be blocked a second time during execution.

`control_room_status` stays read-only. `control_room_propose_goal` always asks through the native approval path.

## Verification semantics

Verification states:

```text
unknown   no useful verification signal yet
checking  a verification command/test was observed
claimed   agent says it verified something
verified  human marked the state verified
stale     something changed after checking/claimed/verified
```

Rules:

- `/cr verified` records human verification.
- `/cr verify <what>` and `/cr needs <what>` record what still needs checking.
- agent `control_room_update(... verificationState=verified ...)` is downgraded to `claimed`.
- edit/write/shell-like tool activity after verification marks verification `stale`.
- test/check/lint-like commands mark verification `checking` until the result is interpreted.

## Harness signals

Control Room observes supported Letta Code mod events when available:

```text
conversation_open
conversation_close
turn_start
turn_end
tool_start
tool_end
compact_start
compact_end
llm_start
llm_end
```

Event handlers are capability-guarded, so unavailable surfaces are skipped instead of failing mod load.

## Persistent state

State lives at:

```text
~/.letta/mods/control-room.state.json
```

State is keyed by workspace/cwd so separate projects keep separate Control Room context.

The mod migrates older v1-shaped state into the v2 structure on load.

## Installation

After this package is published in the Letta mods catalog:

```bash
letta install npm:@letta-ai/control-room
```

Then reload mods in Letta Code:

```text
/reload
```

For local development, copy or symlink `mods/index.ts` into `~/.letta/mods/control-room.ts`, then run `/reload`.

## Demo script

A good demo should show the trust mechanism, not just the pretty line.

### 1. Set the human goal

```text
/cr goal Build Control Room v2 contest demo
/cr mode edit
/cr next Verify the cockpit, tools, lock, and approval flow
```

### 2. Show the cockpit and provenance

```text
/cr
/cr detail
```

### 3. Let the agent narrate progress

Agent calls:

```text
control_room_update({
  "mode": "verify",
  "next": "Run live smoke checks",
  "checkpoint": "Ready to test runtime behavior"
})
```

### 4. Show Trust Guard

```text
/cr safe
```

Agent calls `control_room_update`; the user gets an approval prompt. After approval, execution proceeds.

```text
/cr lock
```

Agent calls `control_room_update`; the tool is denied.

```text
/cr unlock
```

Agent progress updates are allowed again.

### 5. Show the reminder loop

```text
/cr on
```

When Control Room detects stale/checking/missing state at the end of a turn, it reminds the agent to update or continue normally.

```text
/cr off
```

The reminder loop pauses.

## Safety notes

- Control Room stores local workflow state only under `~/.letta/mods/control-room.state.json`.
- It does not modify project files.
- It does not call an LLM.
- It does not import Letta Code internals.
- Its permission overlay applies to its own agent update tool, not arbitrary project tools.
- Human-owned goal and human verification remain separate from agent claims.
