---
name: "@letta-ai/cruise-code"
description: "Evidence-first coding workflow commands for turning implementation tasks and UX handoffs into contracts, evidence, verdicts, and reports."
---

# CruiseCode Mod

CruiseCode registers `/code-*` slash commands for evidence-first coding work in Letta Code.

It is designed to make implementation work easier to trust. A run starts from a task or handoff, creates an Evidence Contract, collects git/check evidence, calculates a conservative verdict, and writes a report.

CruiseCode is intentionally not a full autonomous coding harness. It does not create worktrees, commit code, open pull requests, run multi-agent teams, or auto-loop through fixes in this MVP.

## Commands

- `/code-cruise "task"` — create a CruiseCode run and Evidence Contract.
- `/code-cruise --verify-only` — verify the current git diff with available checks.
- `/code-cruise --resume` — show the active run.
- `/code-cruise --handoff <file>` — create a run from `implementation-handoff.json`.
- `/code-plan [task]` — create or update the active Evidence Contract.
- `/code-check` — collect git evidence and run configured checks.
- `/code-status` — show current run status.
- `/code-report` — generate `report.md`.

Each command supports `help`, `-h`, or `--help` where applicable.

## Core rule

```text
No evidence → no verified
```

CruiseCode should not mark work as `verified` just because code changed or an agent says the task is complete.

## State model

CruiseCode separates workflow state from trust judgment:

```text
phase   = where the run is in the workflow
verdict = what the evidence says about trust/completion
```

This allows a run to be closed but still not verified.

## Project-local state

State is written under the current working directory:

```text
.letta/cruise-code/
```

This includes run metadata, the Evidence Contract, append-only ledger events, latest evidence snapshots, and `report.md`.

`/code-report` also writes `lesson-candidates.json`. This file is a boundary artifact for `muscle-memory`: CruiseCode may suggest reusable lesson candidates from the evidence chain, but it does not create, update, sanitize, graduate, or publish skills.

## Evidence Contract

`plan.json` is the Evidence Contract. It records:

- goal
- non-goals
- constraints
- acceptance criteria
- implementation/check steps
- detected checks
- manual check placeholders when needed

## Evidence collection

CruiseCode can collect:

- `git status --short`
- `git diff --stat`
- `git diff`
- typecheck output
- test output
- lint output
- build output

Evidence files are latest snapshots. The ledger records event summaries.

## CruiseUX handoff

CruiseCode is designed to pair with CruiseUX. The intended handoff file is:

```text
implementation-handoff.json
```

When a handoff includes UX acceptance criteria such as `ux-ac-001`, CruiseCode preserves that original reference as `ux_ref` in the implementation plan.

## muscle-memory boundary

Use CruiseCode for the current coding run's proof. Use `muscle-memory` for durable skill lifecycle work across runs.

```text
CruiseCode    → report.md + lesson-candidates.json
muscle-memory → distill / dedup / quality gate / sanitize / publish
```

CruiseCode should not add `/code-skill`, `/code-learn`, or automatic skill writes unless the product boundary is deliberately redesigned later.

## Safety

Mods are trusted local code. Review the source before installing third-party mods.

This mod performs local filesystem writes under the active project’s `.letta/cruise-code/` directory and runs local git/check commands when invoked by the user. It has no startup side effects and does not run background timers by itself.

If a mod breaks startup or command handling, recover with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

Then remove or edit the mod package and run `/reload`.
