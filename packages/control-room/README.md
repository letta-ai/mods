# Control Room: Goal, Progress, and Trust at a Glance

Control Room is a Letta Code mod that keeps long-running agent work honest by separating **human intent**, **agent progress claims**, and **harness-observed reality** in one small cockpit.

It is not a project manager. It is a trust surface for agentic work.

```text
CR [goal] Build demo | [mode] edit | [next] Verify cockpit | [approval] ask | [verified] stale | [risk] medium | workspace
```

## Why we made Control Room

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

| Source | What it owns | What uses it |
| --- | --- | --- |
| Human | Intent, approval, and acceptance | `/cr goal`, `/cr verified`, `/cr safe`, `/cr lock`, approved goal proposals |
| Agent | Progress narration and provisional claims | `control_room_update`, checkpoints, next step, mode, claimed verification |
| Harness | Observed runtime facts | tool events, file-change signals, verification-looking commands, turn reminders, stale/checking state |

The important rule: **agent claims are not human verification**.

An agent can claim verification, but Control Room records it as `claimed`. A human `/cr verified` is the stronger signal. If a tool later changes state, Control Room marks verification `stale`.

This is the useful part: Control Room shows all three streams together without collapsing them into one fake certainty. The agent can keep the cockpit current, the harness can notice runtime evidence, and the human still owns the goal and final acceptance.

## Tiny golden path

There are a lot of commands because Control Room is meant to be useful for power users. You do not need all of them for the demo.

Start here:

```text
/cr goal Add export support to the app
/cr next Run the export flow and verify the saved file
/cr safe
/cr
```

That gives you:

1. a human-owned goal,
2. a visible next step,
3. approval required before agent progress updates,
4. a compact cockpit view.

Then let the agent update progress with `control_room_update` as work moves forward. If the agent needs to change the goal, it should use `control_room_propose_goal`, which asks for approval.

## User-facing cockpit

The panel line is designed for the Letta Code terminal UI:

```text
CR [goal] <human goal> | [mode] <mode> | [next] <next step> | [approval] <auto|ask|locked> | [verified] <state> | [risk] <level> | <workspace>
```

Field meanings:

| Field | Meaning |
| --- | --- |
| `goal` | The human-owned objective for this workspace |
| `mode` | The agent's current posture: explore, plan, edit, verify, stuck, or handoff |
| `next` | The next concrete step |
| `approval` | Whether agent progress updates are auto, ask, or locked |
| `verified` | Whether work is unknown, checking, claimed, verified, or stale |
| `risk` | A lightweight drift heuristic based on cockpit completeness and recent signals: missing goal/next, stale or unknown verification, stuck/handoff mode, and meaningful changes after verification raise risk. |
| `workspace` | The current workspace key |


## Commands

The golden path above is the recommended first demo. The full command surface is below.

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
/cr checkpoint [note]       record a checkpoint without claiming verification
/cr lock                    deny agent progress updates
/cr safe                    require approval for agent progress updates
/cr unlock                  allow agent progress updates
/cr expand|collapse         toggle expanded panel
/cr reset                   reset this workspace state
```

## Verification terms

The verification commands are close together on purpose, but they mean different things:

| Term | Owner | Meaning |
| --- | --- | --- |
| `/cr verify <what>` | Human | "This still needs to be checked." |
| `/cr needs <what>` | Human | Alias for `/cr verify <what>`. |
| `/cr claim [note]` | Agent/provisional | "The agent says this was checked." Useful, but not final. |
| `/cr verified [note]` | Human | "The user accepts this as verified." Strongest signal. |
| `/cr checkpoint [note]` | Workflow note | Breadcrumb about where the session is; not proof. |
| `stale` | Harness-derived | Something changed after checking, claimed, or verified; re-check before trusting. |

Short version:

```text
verify / needs  = please check this
claim           = agent says it checked this
verified        = human accepts this as checked
checkpoint      = breadcrumb, not proof
stale           = proof got old after a change
```

## Reminder loop

When Control Room is on, the mod can use the `turn_end` event as a lightweight self-check loop. After an assistant turn, it may inject a continuation reminder when cockpit state likely needs attention:

- goal or next step is missing
- mode is `stuck` or `handoff`
- verification is `unknown`, `checking`, or `stale`
- a meaningful change or verification signal happened after the last reminder

Reminder text:

```text
Control Room checkpoint: state may need an update. If needed, call `control_room_update` or `control_room_propose_goal`; otherwise continue normally.
```

The important implementation detail: the reminder stores a pending flag so its own follow-up turn does **not** recursively remind forever.

```text
assistant turn ends
-> Control Room may inject one reminder
-> agent updates state or continues normally
-> reminder follow-up does not cause another reminder
```

`/cr off` pauses that reminder loop and renders the cockpit as paused:

```text
CR [off] paused | /cr on to resume | workspace
```

`/cr on` resumes it.

## Agent tools

Control Room exposes three agent-callable tools.

### `control_room_status`

Read-only, auto-approved.

Returns the current goal, mode, next step, verification state, lock state, drift heuristic, recent tool signal, changed file count when git is available, and the state path.

### `control_room_update`

Auto-approved by default, but governed by the Control Room lock permission.

The agent can update:

- mode
- next step
- checkpoint
- verification claim
- evidence string

The agent **cannot** use this tool to set the human-owned goal.

If the agent attempts to set `verificationState=verified`, Control Room downgrades that to `claimed`.

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

`control_room_status` stays read-only. `control_room_propose_goal` always asks through the native approval path.

In ask mode, the permission handler distinguishes approval and execution phases:

```text
approval phase  -> ask
execution phase -> allow after approval
```

This keeps the user in the loop without causing an approved tool call to be blocked a second time during execution.

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
- `/cr claim` records provisional/agent-grade verification.
- agent `control_room_update(... verificationState=verified ...)` is downgraded to `claimed`.
- edit/write/shell-like tool activity after verification marks verification `stale`.
- test/check/lint-like commands mark verification `checking` until the result is interpreted.

## Harness signals

On Letta Code 0.27.11-safe APIs, Control Room observes:

```text
conversation_open
conversation_close
turn_start
tool_start
```

When running on newer APIs, it opportunistically uses:

```text
tool_end
turn_end
compact_start
compact_end
llm_start
llm_end
```

All newer events are guarded, so the mod loads on older runtimes without failing.

## Persistent state

State lives at:

```text
~/.letta/mods/control-room.state.json
```

State is keyed by workspace/cwd so separate projects can keep separate Control Room context.

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

## Example Demo

A good demo should show the trust mechanism, not just the pretty line. This example uses a generic app feature so the flow is easy to map onto real work.

### 1. Set the human goal

```text
/cr goal Add CSV export to the reports page
/cr mode edit
/cr next Implement the export button and verify the downloaded file
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
  "next": "Run the export flow and inspect the downloaded CSV",
  "checkpoint": "Export implementation is ready for verification"
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

When Control Room detects stale/checking/missing state at the end of a turn, it reminds the agent to update or continue normally. The pending flag prevents reminder recursion.

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

Made with care, thoughtful collaboration ... and coffee.
- Memo and Anna <3
