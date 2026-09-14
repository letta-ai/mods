# Horizon Mode

Horizon mode keeps Letta Code working on long-running optimization and benchmark tasks instead of stopping after the first plausible implementation or smoke test.

It adds budget-aware continuation turns and nonterminal clean Git checkpoints. When `sandbox-timer remaining` is available, Horizon mode activates automatically and uses that task's wall-clock budget.

## Install

```bash
letta install npm:@letta-ai/horizon-mode
```

Run `/reload` after installation.

## Usage

Horizon mode defaults to `auto`:

- It activates automatically when `sandbox-timer remaining` returns a numeric budget.
- It stays inactive during ordinary sessions without that timer.

Control it explicitly with:

```text
/horizon on
/horizon off
/horizon auto
/horizon status
/horizon reset
```

While active, the agent receives the remaining budget and is prompted to continue measuring, improving, and validating until the external budget reaches its reserve. The mod registers one tool:

- `submit({ commit, repository? })` records a clean Git `HEAD` as the latest checkpoint without ending the run. `repository` may point to a nested repository such as `/app/generator`; otherwise Horizon searches the workspace and its first two directory levels for the repository containing the commit.

When `HORIZON_CHECKPOINT_DIR` is configured, `submit` creates and verifies a Git bundle in that directory before recording the checkpoint. The directory must be runner-owned or mounted durable storage if checkpoints need to survive sandbox deletion. Without it, Horizon explicitly reports that the record is workspace-only.

The agent also maintains `/tmp/horizon/PROGRESS.md` as a compact recovery ledger. It records the real objective baseline and best result, latest checkpoint, validation status, failed experiments, and next action, and is refreshed around meaningful milestones and long-running commands.

## Configuration

Environment variables override conversation state:

| Variable | Meaning |
| --- | --- |
| `HORIZON_MODE=on` | Force Horizon mode on even without `sandbox-timer` |
| `HORIZON_MODE=off` | Force Horizon mode off |
| `TASK_BUDGET_SECS` | Total fallback budget; defaults to 72,000 seconds |
| `HORIZON_RESERVE_SECS` | Stop automatic continuation this many seconds before expiry; defaults to 600 |
| `HORIZON_CHECKPOINT_DIR` | Optional runner-owned or mounted directory for verified Git checkpoint bundles |

When forced on without `sandbox-timer`, the fallback budget starts when the conversation first enters Horizon mode.

## State

Conversation-scoped mode and checkpoint state is stored in:

```text
~/.letta/mods/horizon-mode.state.json
```

`submit` invokes fixed `git` commands in the active workspace. It rejects repository paths outside that workspace, commits other than the selected repository's `HEAD`, and dirty worktrees. When checkpoint export is configured, it also writes verified Git bundles to `HORIZON_CHECKPOINT_DIR`. The mod does not use a shell, network access, or secrets.

## Stagnation protection

Horizon pauses automatic continuation after three identical completion responses in consecutive turns when the actor used no non-submission tools and produced no new checkpoint. One premature completion is still continued; repeated no-op completion turns do not consume the remaining model budget. Any later user turn or productive tool use clears the pause.

## Recovery

If the mod causes an unwanted continuation loop, run `/horizon off`. If command handling is unavailable, restart Letta Code with mods disabled:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

See [`MOD.md`](./MOD.md) for the agent-facing behavioral contract.
