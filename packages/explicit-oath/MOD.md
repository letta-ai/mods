---
name: "@letta-ai/explicit-oath"
description: "Explicit opt-in follow-up promises delivered through Letta schedules without passive phrase detection."
---

# Explicit Oath mod semantics

## When to use

Use this mod when an agent has deliberately committed to deliver a concrete result later and cannot finish that work in the current turn.

Good use cases include:

- checking a deployment after its expected completion time
- reporting the result of a long-running external process
- following up at a user-requested time with fresh evidence
- revisiting a time-dependent condition that cannot be checked yet

Do not use it for:

- ordinary phrases such as "let me check" when the check will happen now
- work that can be completed in the current turn
- vague offers, speculative ideas, or optional future enhancements
- periodic monitoring; use a recurring cron directly for that

## Behavioral contract

`schedule_oath` is explicit and opt-in. It must only be called after the agent has made a real future commitment or the user has directly requested a timed follow-up.

The tool requires:

- a specific promise
- a meaningful due time
- actionable delivery instructions

The scheduled turn must either deliver the promised evidence or state the real blocker plainly. It must not claim success without verification.

## Tool

`schedule_oath`

Creates a one-shot Letta cron schedule for the current agent and conversation. Optional runner and computer arguments expose the standard Letta scheduling placement choices without hard-coding an environment.

## Design

Explicit Oath intentionally does not detect promises from natural language. It has:

- no regex scanning
- no LLM classification
- no conversation polling
- no hidden message inspection
- no local oath state separate from Letta's scheduler

Letta cron is the source of truth for scheduled work. This keeps the mod small and makes delivery behavior consistent with the harness's existing cross-time mechanism.

## Safety invariants

- Resolve agent and conversation IDs from the invocation context.
- Never schedule into an unrelated conversation.
- Request tool approval because scheduling creates durable future work.
- Reject a computer target with the local runner.
- Do not silently fall back if scheduling fails; return a concise error.
- Do not infer or create an oath unless the agent invokes the tool.

## Adaptation notes

This package is deliberately narrow. Add separate commands or status UI only if they provide concrete value; use `letta cron list`, `get`, `runs`, and `delete` for schedule management rather than duplicating scheduler state in the mod.
