# CruiseCode

[English](https://github.com/letta-ai/mods/tree/main/packages/cruise-code) | [한국어](https://github.com/letta-ai/mods/blob/main/packages/cruise-code/README.ko.md)

CruiseCode is an evidence-first coding workflow mod for Letta Code.

It turns implementation tasks and UX handoffs into verifiable contracts, evidence, verdicts, and reports.

```text
No evidence → no verified
```

## What it adds

| Command | Purpose | Best used when |
| --- | --- | --- |
| `/code-cruise "task"` | Creates a run and Evidence Contract | You are starting a coding task that should be traceable |
| `/code-cruise --verify-only` | Verifies the current git diff with available checks | You already changed code and want evidence/reporting |
| `/code-cruise --resume` | Shows the active run | You want to continue or inspect the current run |
| `/code-cruise --handoff <file>` | Creates a run from `implementation-handoff.json` | You are continuing from a UX/product handoff |
| `/code-plan [task]` | Creates or updates the Evidence Contract | The task criteria or checks need to be clarified |
| `/code-check` | Collects git/check evidence | You want proof before claiming progress |
| `/code-status` | Shows run state, evidence, blockers, and next action | You need a readable dashboard |
| `/code-report` | Generates `report.md` | You need a handoff or verification summary |

## Core idea

CruiseCode separates workflow state from verification judgment.

```text
phase   = where the run is in the workflow
verdict = what the evidence says about trust/completion
```

A run can be complete enough to report but still not be verified. That distinction is the point.

## Storage

CruiseCode writes project-local state under the current working directory:

```text
.letta/cruise-code/
  config.json
  active.json
  runs/
    <run-id>/
      run.json
      plan.json
      ledger.jsonl
      evidence/
        index.json
        git-status.txt
        git-diff-stat.txt
        git-diff.patch
        typecheck.txt
        test.txt
        lint.txt
        build.txt
      report.md
      lesson-candidates.json
```

This repository does **not** include local run state or evidence artifacts.

## Installation

Install the published package from Letta Code:

```bash
letta install npm:@letta-ai/cruise-code
```

Then reload active Letta Code sessions:

```text
/reload
```

Verify commands are available:

```text
/code-cruise help
```

For local development from this repository:

```bash
git clone https://github.com/letta-ai/mods.git
letta install ./mods/packages/cruise-code
```

Use CruiseCode from a project directory, not from your home directory:

```text
/code-cruise "Fix login redirect after expired session"
```

## Development

The public package is intentionally small:

```text
MOD.md
README.md
README.ko.md
mods/index.ts
package.json
```

For a quick source/package check:

```bash
tmp=$(mktemp -d)
cp mods/index.ts "$tmp/mod.mjs"
node --check "$tmp/mod.mjs"
rm -rf "$tmp"
npm pack --dry-run
```

## CruiseUX handoff

CruiseCode is designed to pair with CruiseUX.

```text
CruiseUX   → UX framing, research, interview, ideation, spec, review
CruiseCode → implementation, evidence, checks, verdict, report
```

The intended handoff file is:

```text
implementation-handoff.json
```

CruiseCode preserves original UX acceptance criteria such as `ux-ac-001` as `ux_ref`, so reports can connect UX intent to implementation evidence.

## muscle-memory integration

CruiseCode can cooperate with [`muscle-memory`](https://github.com/letta-ai/mods/tree/main/packages/muscle-memory) without taking over skill management.

```text
CruiseUX      → writes UX intent and implementation handoff
CruiseCode    → writes evidence, verdict, report, and reusable lesson candidates
muscle-memory → distills/deduplicates/sanitizes/publishes skills when a lesson is actually reusable
```

`/code-report` writes `lesson-candidates.json` next to `report.md` and adds a `Reusable Lesson Candidates` section to the report. These are **not skills**. They are reviewable hints for `muscle-memory` or a human reviewer. CruiseCode does not write to the skill shelf, publish Custom Skills, or decide whether a lesson deserves graduation.

Recommended conservative `muscle-memory` defaults while dogfooding CruiseCode:

```bash
MM_REFLECT=staged
MM_CAPTURE=off
MM_PUBLISH=off
```

## Safety

Mods are trusted local code. Review the source before installing third-party mods.

This mod performs local filesystem writes under the active project’s `.letta/cruise-code/` directory and runs local git/check commands only when invoked by the user. It has no startup side effects and does not run background timers by itself.

Do not commit private CruiseCode run state, evidence files, `.env` files, credentials, local diagnostics, or private project logs.

If a mod breaks startup or command handling, recover with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

Then remove or edit the mod package and run `/reload`.

See MOD.md for the agent-facing behavioral contract.
