---
name: "@letta-ai/horizon-mode"
description: "Long-horizon autonomous work mode with budget-aware continuation and clean Git checkpoints."
---

# Horizon mode semantics

## When to use

Use Horizon mode for benchmarks, optimization searches, reverse engineering, and other tasks where the agent should keep iterating for a substantial wall-clock budget instead of returning after a plausible first pass.

In `auto` mode, a working `sandbox-timer remaining` command identifies such an environment. `/horizon on` and `/horizon off` override detection for the current conversation.

## Behavioral contract

While Horizon mode is active, the agent should:

1. Establish a measurable baseline and optimize the actual objective, not a weak proxy.
2. Maintain `/tmp/horizon/PROGRESS.md` as a compact recovery ledger containing the objective baseline and best result, latest checkpoint, validation status, failed experiments, and next action.
3. Keep known-good work committed and record useful checkpoints with `submit`.
4. Continue after a checkpoint while meaningful budget and credible improvements remain.
5. Validate correctness, held-out behavior, and regressions throughout the run.
6. Keep the latest submission pointed at the best validated result before the budget expires.

Horizon mode automatically starts another model turn when the agent ends while more than the configured reserve remains. It does not continue after cancellation, interruption, errors, budget reserve, or three consecutive identical completion-only turns with no productive tool calls or checkpoint change. Submitting a checkpoint never ends the run.

## Commands

`/horizon on|off|auto|status|reset` controls conversation-scoped state. Environment variables take precedence over the command state.

## Tools

### `submit`

The tool accepts a Git commit or revision and an optional `repository` path. A supplied path must remain inside the active workspace. Without one, Horizon searches the workspace and nested directories to find the unique repository containing the commit. This supports task layouts such as `/app/generator` beneath a non-repository `/app` root.

The commit must be that repository's current `HEAD`, and its worktree must be clean, so a checkpoint identifies all submitted changes. If `HORIZON_CHECKPOINT_DIR` is configured, Horizon creates and verifies a Git bundle there before recording the checkpoint. That directory must be backed by runner-owned or mounted durable storage to survive sandbox deletion; otherwise the checkpoint remains workspace-local and Horizon says so explicitly.

Every call records the selected commit as the latest workspace checkpoint and returns control to the agent. Repeated calls, including repeated submissions of the same commit, are nonterminal. The external task budget controls when work stops.

Update `/tmp/horizon/PROGRESS.md` after submitting so later turns and post-compaction recovery can distinguish the best validated checkpoint from active experiments.

## Adaptation notes

- Keep timer detection side-effect free and bounded by a short timeout.
- Keep continuation conditional on a live budget; do not create an unbounded automatic loop in `auto` mode.
- Keep checkpoint validation read-only. The mod must never commit, reset, or modify the user's repository.
- Keep repository discovery bounded and reject paths outside the active workspace.
- Keep state scoped by conversation ID. Bundle export is opt-in and must complete verification before a checkpoint is described as externally preserved.
