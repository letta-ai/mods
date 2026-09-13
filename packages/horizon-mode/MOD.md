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
2. Keep known-good work committed and record useful checkpoints with `submit`.
3. Continue after a checkpoint while meaningful budget and credible improvements remain.
4. Validate correctness, held-out behavior, and regressions before final confirmation.
5. Confirm a final submission only when the selected clean commit is the best validated result.

Horizon mode automatically starts another model turn when the agent ends without a confirmed final submission and more than the configured reserve remains. It does not continue after cancellation, interruption, errors, final confirmation, or budget reserve.

## Commands

`/horizon on|off|auto|status|reset` controls conversation-scoped state. Environment variables take precedence over the command state.

## Tools

### `submit`

The tool accepts a Git commit or revision. It rejects unknown commits and dirty worktrees because a checkpoint should identify all submitted changes.

The first call records a checkpoint. The same commit confirms the final submission only when called in a later turn with no earlier tool action in that turn. Any other tool call cancels pending confirmation without deleting the recorded checkpoint.

## Adaptation notes

- Keep timer detection side-effect free and bounded by a short timeout.
- Keep continuation conditional on a live budget; do not create an unbounded automatic loop in `auto` mode.
- Keep checkpoint validation read-only. The mod must never commit, reset, or modify the user's repository.
- Keep state scoped by conversation ID and preserve checkpoints independently from pending final confirmation.
