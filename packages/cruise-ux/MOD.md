---
name: "@letta-ai/cruise-ux"
description: "UX discovery workflow commands for framing, research, interviews, ideation, specs, review, and implementation handoff."
---

# CruiseUX Mod

This mod registers `/ux-*` slash commands that prompt an agent through a UX/UI discovery-to-decision workflow.

It is intentionally command-only. It does not run autonomous background work, write files by itself, or enforce permissions. Instead, each command injects a structured prompt that tells the current agent how to reason, when to ask questions, and where to preserve artifacts when a concrete project path is known.

## Commands

- `/ux-frame <topic>` — create a decision frame before research or ideation.
- `/ux-research <topic>` — produce a source-backed UX research brief and preserve project research under `docs/search/` when appropriate.
- `/ux-interview <topic>` — run an Adaptive UX Interview with Discovery Interview, Decision Trace, or User Research Protocol mode.
- `/ux-ideate <topic>` — generate three distinct UX concepts with hypotheses, validation targets, failure signals, flows, tradeoffs, and ASCII wireframes.
- `/ux-spec <topic>` — synthesize an English UX specification with prototype scope and usability-test plan.
- `/ux-review <topic-or-path>` — review a UX artifact or current context for decision-readiness.
- `/ux-cruise [auto|loop] <topic>` — run the full pipeline: frame → research → adaptive interview → validation frame → ideation → spec/test plan → review.

Each command supports command-specific help with `help`, `-h`, or `--help`.

## Cruise semantics

`/ux-cruise` is the flagship command. It moves through the full decision-to-evidence pipeline:

```text
Decision Frame
→ Research
→ Adaptive UX Interview
→ Problem + Hypothesis + Validation Frame
→ Ideation
→ UX Spec + Prototype/Test Plan
→ UX Review
```

Modes:

- default — per-stage confirmation gates.
- `auto` — skip stage gates and run straight through; the interview stage may still pause for needed user answers.
- `loop` — keep gates and add a bounded Review → revise/rollback → re-review loop, max 3 iterations.

`auto` and `loop` are mutually exclusive. The mod should return an error/help output rather than a prompt for invalid combinations like:

```text
/ux-cruise auto loop <topic>
/ux-cruise loop auto <topic>
```

## Loop semantics

In `/ux-cruise loop`, the Review verdict controls the next move:

- `Ready` — stop the loop and produce a final decision-ready summary.
- `Needs Revision` — revise the specific weak stage, then re-run review.
- `Not Ready` — treat as a stronger upstream rollback, not a small polish pass.

For `Not Ready`, classify the root cause and recommend the earliest stage that must be repaired:

- decision/user/context unclear → Stage 0: Decision Frame
- evidence weak or missing → Stage 1: Research
- user/problem/workflow unclear → Stage 2: Adaptive UX Interview
- hypotheses or success/failure signals weak → Stage 3: Problem + Hypothesis + Validation Frame
- concept direction wrong or too narrow → Stage 4: Ideation
- artifact quality/scope/edge cases/test plan insufficient → Stage 5: UX Spec + Prototype/Test Plan

After 3 iterations, stop looping and produce a force-decision recommendation with current evidence, remaining risks, and the smallest next test.

## Behavioral contract

The generated prompts should keep UX work tied to a product decision:

1. Frame the user, context, job-to-be-done, and decision needed.
2. Separate evidence, assumptions, risks, and open questions.
3. Make hypotheses and validation criteria explicit before ideation.
4. Keep concepts meaningfully different, not restyled duplicates.
5. Use ASCII wireframes for early UX structure.
6. Define the smallest useful prototype before expanding scope.
7. Include usability-test missions, behavioral data, qualitative prompts, edge cases, and decision thresholds.
8. Review artifacts with a Ready / Needs Revision / Not Ready verdict before coding or testing.
9. Use plain-language interview questions and keep method jargon internal unless the user asks.
10. Stop asking when the remaining unknown is better resolved through a prototype, usability test, or research task.

## Interview semantics

`/ux-interview` is adaptive. It should route to one of three modes:

- **Discovery Interview** — for new or thinly defined ideas that need a clearer UX/product brief.
- **Decision Trace** — for existing project context where the agent must decide what to specify, prototype, test, defer, or compare next.
- **User Research Protocol** — for preparing non-leading questions, tasks, and data-capture plans for real participants.

Decision Trace is a practical workflow in this package, not a claimed industry-standard method. It combines task analysis, cognitive walkthrough-style step reasoning, assumption mapping, hypothesis-driven design, and lightweight decision logging to separate what should be specified now, asked next, deferred, or tested later.

## File preservation semantics

When research or specs belong to a concrete project:

- save research and source-backed findings under `docs/search/`
- save UX specs, plans, and test plans under `docs/plans/`
- ask the user for the save path if the active project is unclear
- do not write files if the user explicitly asks for chat-only output

## Language semantics

The prompts instruct the agent to use the conversation language for interaction. Shared artifacts such as specs, plans, handoffs, and README-style docs should be written in English unless the user requests otherwise.

## Review semantics

`/ux-review` is a check command. It should not rubber-stamp weak artifacts. It should identify the smallest fixes needed before coding or testing and should call out weak evidence for regulated, safety-critical, security, or business-critical claims.

## Influences

The Discovery Interview mode is inspired by gajae-code's deep-interview workflow, adapted for UX/UI discovery and prototype planning. This package does not copy gajae-code source code; it implements separate Letta Code mod prompts and command behavior.

## Safety

This mod registers commands only. It has no startup side effects, no timers, no filesystem writes, and no network calls. The current agent may still choose to use its normal tools in response to the generated prompt.

If the mod breaks command handling, start Letta Code with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

Then remove or edit the mod and run `/reload`.
