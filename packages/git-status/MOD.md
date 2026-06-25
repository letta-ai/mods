---
name: "@letta-ai/git-status"
description: "Git branch, dirty/clean, file counts, and ahead/behind for the Letta Code statusline."
---

# Git status statusline mod semantics

## When to use

Use this mod when the user wants Letta Code's idle statusline to show git state:
current branch, clean/dirty, changed-file counts, and ahead/behind vs upstream.
Letta Code's default statusline shows no git information, so this is additive, not
a replacement for existing git UI.

## Behavior

- Polls `git` outside the render path on a fixed interval (default 4 seconds).
- Runs a single read-only command per poll: `git status --porcelain=v2 --branch
  --untracked-files=all`, plus a `rev-parse --is-inside-work-tree` guard.
- Reads from `letta.workspace.cwd` (falls back to `process.cwd()`).
- Branch: from `# branch.head`; shows a short SHA (from `# branch.oid`) when detached.
- Ahead/behind: from `# branch.ab +A -B`; rendered as `↑A ↓B`, only when an upstream
  exists and there is a non-zero delta.
- File counts from porcelain v2 entries: `?` untracked → added; staged `A` → added;
  `D` in the XY field → deleted; everything else changed → modified. Rendered as
  `+added ~modified -deleted`.
- Clean tree renders a check (`✓`).
- Segment color: green when clean, yellow when dirty.
- Clears the segment entirely when not inside a git work tree.
- Renders agent name and model on the right so the row stays useful with no repo.

## Platform assumptions

Cross-platform. Requires `git` (with porcelain v2 support, git >= 2.11) on `PATH`.
Uses `windowsHide` so no console window flashes on Windows.

## Safety invariants

- Renderer stays synchronous; all shelling happens in the poll interval.
- Only read-only git commands are run; the mod never mutates the repository.
- Git invocations use a short timeout and swallow errors, degrading to a cleared segment.
- Timers and status values are cleaned up when the mod is disposed.
- Optional UI APIs are capability-guarded (`ui.customStatuslineRenderer`, `ui.statusValues`).

## Adaptation notes for agents

- Keep polling lightweight; raise `REFRESH_MS` if a large repo makes `git status` slow.
- To add line-level churn, layer in `git diff --numstat` / `--cached --numstat` and a
  sparkline; this mod intentionally stays at the file + branch level.
- The custom statusline owns the full idle row — if composing with other statusline data,
  merge it into this renderer rather than registering a second renderer.
- Porcelain v2 is required for the branch/ahead-behind headers; do not downgrade to v1
  without re-deriving branch and upstream separately.
