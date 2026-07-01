# Git Status

#git-status

A Letta Code statusline mod that shows your current git state in the idle status row: branch, clean/dirty, changed-file counts, and how far you are ahead/behind upstream.

Letta Code's default statusline has no git awareness — this fills that gap.

## Install

#install

```
letta install npm:@letta-ai/git-status
```

Then reload local mods:

```
/reload
```

## What it shows

#what-it-shows

A git segment on the left of the idle statusline, for example:

```
 main ↑2 +1 ~3 -1     Letta · claude-sonnet
```

- ` main` — current branch (short SHA when in detached HEAD; long names are truncated with `…`)
- `↑2 ↓1` — commits ahead / behind the upstream branch (only shown when there's an upstream and a delta)
- `+N` — untracked / newly added files
- `~N` — modified files (staged or unstaged)
- `-N` — deleted files

When the working tree is clean it shows a check:

```
 main ✓
```

The segment is **green when clean** and **yellow when dirty**, so you can read tree state at a glance. The right side always shows the agent name and model.

## Behavior

#behavior

- Polls `git status --porcelain=v2 --branch` every 4 seconds, outside the render path.
- Reads from the agent's current workspace directory.
- Clears the segment when not inside a git work tree.
- A single git call provides branch, upstream, ahead/behind, and per-file status.

## Safety

#safety

Mods are trusted local code. Review the source before installing third-party mods.

This mod only runs read-only `git` commands; it never writes to your repository.

If a mod breaks startup or command handling, recover with:

```
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

See [MOD.md](./MOD.md) for the agent-facing behavioral contract.
