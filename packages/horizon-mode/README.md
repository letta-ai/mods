# Horizon Mode

Horizon mode keeps Letta Code working on long-running optimization and benchmark tasks instead of stopping after the first plausible implementation or smoke test.

It adds budget-aware continuation turns, clean Git checkpoints, explicit final-submission confirmation, and a safe reader for deferred Markdown memory. When `sandbox-timer remaining` is available, Horizon mode activates automatically and uses that task's wall-clock budget.

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

While active, the agent receives the remaining budget and is prompted to continue measuring, improving, and validating until it confirms a final checkpoint. The mod registers two tools:

- `submit({ commit })` records a clean Git commit. Calling it again for the same commit as the only tool action of a later turn confirms the final submission.
- `read_deferred_memory({ path })` reads a Markdown file inside the active agent's MemFS, including task reference files that are not mounted in the workspace.

Any non-`submit` tool call cancels pending final confirmation, while the recorded checkpoint remains preserved.

## Configuration

Environment variables override conversation state:

| Variable | Meaning |
| --- | --- |
| `HORIZON_MODE=on` | Force Horizon mode on even without `sandbox-timer` |
| `HORIZON_MODE=off` | Force Horizon mode off |
| `TASK_BUDGET_SECS` | Total fallback budget; defaults to 72,000 seconds |
| `HORIZON_RESERVE_SECS` | Stop automatic continuation this many seconds before expiry; defaults to 600 |

When forced on without `sandbox-timer`, the fallback budget starts when the conversation first enters Horizon mode.

## State

Conversation-scoped mode and checkpoint state is stored in:

```text
~/.letta/mods/horizon-mode.state.json
```

The mod writes only this state file. `submit` invokes fixed `git` commands in the active workspace, and `read_deferred_memory` is restricted to Markdown files within the active agent's memory directory. It does not use a shell, network access, or secrets.

## Recovery

If the mod causes an unwanted continuation loop, run `/horizon off`. If command handling is unavailable, restart Letta Code with mods disabled:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

See [`MOD.md`](./MOD.md) for the agent-facing behavioral contract.
