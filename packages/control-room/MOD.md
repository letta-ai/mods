---
name: "@letta-ai/control-room"
description: "Panel cockpit and trust guard for goal, progress, verification, and approval state."
---

# Control Room mod semantics

## When to use

Use Control Room when an agent is doing multi-turn coding or operational work and the user wants a small visible cockpit for:

- the current human-owned goal
- the current operating mode
- the next step
- verification status
- approval mode for agent progress updates
- lightweight drift risk
- harness-observed runtime facts

Control Room is especially useful when a session has tools, tests, edits, compaction, or handoff risk.

## Behavioral contract

When Control Room is active, the agent should:

1. Treat the cockpit as operational state, not durable memory.
2. Preserve the distinction between human intent, agent claims, and harness facts.
3. Use `control_room_status` before relying on Control Room state if it is not visible in context.
4. Use `control_room_update` when the agent changes mode, next step, checkpoint, or verification claim.
5. Use `control_room_propose_goal` instead of silently changing the human-owned goal.
6. Never represent an agent verification claim as human verification.
7. Treat `verified` as human-confirmed only. Agents should use `claimed`.
8. If Control Room reminds at turn end, either update state or continue normally if no update is needed.

## Commands

Primary command:

```text
/cr
```

Alias:

```text
/control-room
```

Important subcommands:

```text
/cr goal <text>|clear       set or clear the human-owned goal
/cr mode <mode>             explore|plan|edit|verify|stuck|handoff
/cr next <step>|clear       set or clear the next step
/cr verified [note]         human confirms current state is verified
/cr verify <what>           mark what still needs verification
/cr needs <what>            same as /cr verify
/cr claim [note]            record an agent-grade verification claim
/cr checkpoint [note]       record a checkpoint
/cr lock                    deny agent progress updates
/cr safe                    ask before agent progress updates
/cr unlock                  allow agent progress updates
/cr on|off                  enable or pause turn-end reminders
/cr detail                  show provenance and harness facts
```

## Tools

### `control_room_status`

Read-only status inspection. Safe to call without approval.

### `control_room_update`

Agent progress update. Use this to update mode, next step, checkpoint, and verification claim/evidence.

This tool intentionally cannot set the human-owned goal. It also downgrades `verificationState=verified` to `claimed` because agent claims are not human verification.

### `control_room_propose_goal`

Goal proposal tool. Always asks for approval. If approved, the goal is stored as human-owned with `via: approved-agent-proposal` provenance.

## Permission invariants

Control Room has three approval modes:

```text
auto    agent progress updates allowed
ask     agent progress updates require approval
locked  agent progress updates denied
```

Implementation invariant for ask mode:

- approval phase returns `ask`
- execution phase returns `allow` after the user has approved

This prevents a double-check failure where a tool asks correctly and then blocks during execution.

## Verification invariants

Verification states:

```text
unknown
checking
claimed
verified
stale
```

- `verified` is reserved for human confirmation via `/cr verified`.
- Agent claims use `claimed`.
- Verification commands observed by the harness set `checking`.
- Meaningful changes after checking/claimed/verified set `stale`.

## Reminder semantics

When enabled with `/cr on`, Control Room may inject a `turn_end` continuation reminder. It should not fire every turn. It fires only when state may need attention, such as missing goal/next, stale/checking/unknown verification, stuck/handoff mode, or meaningful change/verification activity since the last reminder.

The reminder has a pending flag so its own follow-up turn does not recursively remind forever.

## State

State is stored locally at:

```text
~/.letta/mods/control-room.state.json
```

State is keyed by workspace path.

## Adaptation notes for agents

- Do not import Letta Code internals. Use public mod APIs and Node built-ins.
- Keep the cockpit compact; it is meant to be glanceable.
- Keep labels boring and readable rather than glyph-heavy.
- Prefer explicit provenance over clever inference.
- Keep Trust Guard scoped to Control Room state, not arbitrary project permissions, unless the user explicitly asks for a broader policy.
- If the user wants less noise, tune `shouldRemind` before changing the core commands/tools.
