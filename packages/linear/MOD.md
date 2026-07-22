---
name: linear
description: "Batched Linear issue tools with dry-run previews, rich reads, and stale-state guards."
---

# Linear mod

Use this mod for direct Linear reads and writes. Keep triage policy, ownership rules, and automation in skills; the mod provides bounded primitives.

## Behavior

- Batch related reads with `identifiers`; summary reads allow 50 and full reads allow 5.
- Read issues before writes.
- Use `dry_run: true` to preview any create, update, comment, or relation operation without mutations.
- Use `expected` on updates/comments when acting on previously read state. Guards support `updated_at`, state, assignee/unassigned, project/no-project, and priority.
- Treat guards as best-effort stale-state protection, not atomic compare-and-swap.
- Batch writes are sequential, stop after cancellation, and return per-item failures.
- `blocked-by` is normalized to the inverse `blocks` relation. `related` is symmetric.

## Authentication and team selection

The mod invokes the authenticated `@schpet/linear-cli` and never reads its API token. The child environment is allowlisted and excludes secret-bearing variables.

One-team workspaces are detected automatically. In multi-team workspaces, set `LINEAR_TEAM_KEY` before starting Letta Code. The team key is configuration, not a credential, and is not forwarded to the CLI child process.
