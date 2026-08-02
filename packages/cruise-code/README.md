# CruiseCode

[English](https://github.com/letta-ai/mods/tree/main/packages/cruise-code) | [한국어](https://github.com/letta-ai/mods/blob/main/packages/cruise-code/README.ko.md)

CruiseCode is an evidence-first coding workflow mod for Letta Code.

It turns implementation tasks and UX handoffs into executed code changes with a verifiable contract, live progress, evidence, verdict, and report.

```text
No evidence → no verified
```

## What it adds

| Command | Purpose | Best used when |
| --- | --- | --- |
| `/code-cruise "task"` | Starts the coding agent, tracks progress, verifies the result, and writes a report | You want CruiseCode to implement a task end to end |
| `/code-cruise --prototype "task"`<br>`/code-cruise --mode prototype "task"` | Builds a bounded prototype from a direct task and writes a portable review packet | You need technical prototype evidence without a UX handoff |
| `/code-cruise --prototype --handoff <file>` | Builds a prototype from a read-only implementation handoff | You already have UX criteria to trace into implementation evidence |
| `/code-cruise --verify-only` | Verifies the current git diff with available checks | You already changed code and want evidence/reporting |
| `/code-cruise --resume` | Shows the active run | You want to continue or inspect the current run |
| `/code-cruise --handoff <file>` | Creates a run from `implementation-handoff.json` | You are continuing from a UX/product handoff |
| `/code-plan [task]` | Creates or updates the Evidence Contract | The task criteria or checks need to be clarified |
| `/code-check` | Collects git/check evidence | You want proof before claiming progress |
| `/code-status` | Shows run state, evidence, blockers, and next action | You need a readable dashboard |
| `/code-report` | Generates `report.md` | You need a handoff or verification summary |
| `/code-panel hide\|show\|status` | Controls the progress panel | You want to hide, restore, or inspect panel behavior |

## Core idea

CruiseCode separates workflow state from verification judgment.

```text
phase   = where the run is in the workflow
verdict = what the evidence says about trust/completion
```

A run can be complete enough to report but still not be verified. That distinction is the point.

## Automatic execution

`/code-cruise "task"` now starts a real agent turn instead of stopping after plan creation.

```text
task prompt
→ Evidence Contract
→ inspect project
→ edit files
→ run relevant checks
→ collect git/check evidence
→ calculate verdict
→ generate report.md
→ show final summary
```

The progress panel is event-driven. Its current activity and step count update from the actual tools used by the coding agent. The run is bound to the conversation and agent that started it, so tool events from another conversation cannot advance or finalize it.

The panel automatically closes 10 seconds after a run reaches `Closed`, `Blocked`, or `Cancelled`. Use `/code-panel hide` to keep it hidden for the current project and `/code-panel show` to restore it.

Automatic finalization runs once when the implementation turn ends. It collects staged and unstaged git changes, records untracked filenames without copying their contents, runs detected checks, generates the report, and injects one final-summary turn. CruiseCode does not commit or push unless the user explicitly asks the coding agent to do so.

## Prototype evidence mode

Prototype mode keeps CruiseCode focused on implementation evidence rather than becoming another prompt-to-app generator.

```text
/code-cruise --prototype "Build a project dashboard prototype"
/code-cruise --mode prototype "Build a project dashboard prototype"  # alias
/code-cruise --prototype --handoff implementation-handoff.json
```

- **Direct task:** CruiseCode records `ux_intent_status: unverified`, implements the requested prototype, and reports technical evidence only. It does not claim that UX was validated.
- **Handoff:** CruiseCode treats valid external or CruiseUX `implementation-handoff.json` input as read-only. It preserves inherited criterion references, records coverage, and returns a review packet.
- **Boundary:** CruiseCode does not create UX criteria, invent user scenarios, or make a UX/product decision. A human or separate UX workflow interprets the resulting evidence.

Prototype mode writes a `prototype-contract.json`, then finishes with portable `prototype-review-packet.md` and `prototype-review-packet.json` artifacts beside the normal report. `--verify-only` is intentionally a standard-run command and cannot be combined with `--prototype`.

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
      prototype-contract.json       # prototype runs only
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
      prototype-review-packet.md    # prototype runs only
      prototype-review-packet.json  # prototype runs only
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

Then run `/reload`.

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
tests/cruise-code.test.mjs
```

For a quick source/package check:

```bash
npm test
tmp=$(mktemp -d)
cp mods/index.ts "$tmp/mod.mjs"
node --check "$tmp/mod.mjs"
rm -rf "$tmp"
npm pack --dry-run
```

## CruiseUX and external handoffs

CruiseUX is a useful upstream producer, not a runtime dependency. CruiseCode can also consume any valid external `implementation-handoff.json`.

```text
CruiseUX   → UX framing, research, interview, ideation, spec, review
CruiseCode → implementation, evidence, checks, verdict, report
```

The intended handoff file is:

```text
implementation-handoff.json
```

For prototype handoffs, CruiseCode preserves original UX acceptance criteria such as `ux-ac-001` as read-only `ux_ref` values, so review packets can connect UX intent to implementation evidence without claiming a UX verdict.

## muscle-memory integration

CruiseCode can cooperate with `muscle-memory` without taking over skill management.

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

This mod performs local filesystem writes under the active project’s `.letta/cruise-code/` directory. After the user invokes `/code-cruise`, it observes that run's tool/turn events and runs local git/check commands during automatic finalization. It has no startup side effects and does not run background timers by itself.

Do not commit private CruiseCode run state, evidence files, `.env` files, credentials, local diagnostics, or private project logs.

If a mod breaks startup or command handling, recover with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

Then remove or edit the mod package and run `/reload`.

See MOD.md for the agent-facing behavioral contract.
