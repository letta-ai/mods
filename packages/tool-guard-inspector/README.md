# Tool Guard Inspector

A Letta Code mod that adds a lightweight permission policy and an in-session audit view for tool calls.

It classifies selected tool calls as `allow`, `ask`, or `deny`, records the decisions made by this mod, and exposes a `/tool-guard` command for inspecting recent decisions.

## Install

```bash
letta install npm:@letta-ai/tool-guard-inspector
```

Then reload local mods:

```text
/reload
```

## What it adds

- a permission policy for common read, shell, mutation, and delegation tools
- an in-memory audit log of recent decisions made by this mod
- a `/tool-guard` slash command for viewing recent decisions and stats

## Quick start

After installing the mod, run normal agent tasks that use tools. Then inspect the recent permission decisions:

```text
/tool-guard
```

Show more entries:

```text
/tool-guard 25
```

Show all in-memory entries across conversations:

```text
/tool-guard all
```

Clear the current conversation's entries:

```text
/tool-guard clear
```

Clear all in-memory entries:

```text
/tool-guard all clear
```

## Example output

```text
Tool Guard Inspector

Recent permission decisions:
✓ 14:03:12  read_file  allow  read-only tool | path=README.md
✓ 14:04:21  bash       allow  read-only shell command | command=git status
⚠ 14:05:10  edit       ask    file mutation tool | path=src/index.ts
✗ 14:06:33  bash       deny   dangerous shell command pattern | command=rm -rf dist

Stats: allowed: 8 | asked: 2 | denied: 1
Scope: current conversation. Use /tool-guard all to include all in-memory entries.
```

## Policy behavior

The default policy is intentionally conservative:

- common read/search tools are allowed
- simple read-only shell commands such as `git status`, `git diff`, `ls`, `cat`, and `rg` are allowed
- chained, piped, redirected, or shell-expanded commands ask for confirmation, even when the visible command looks read-only
- file mutation tools ask for confirmation
- dangerous shell patterns such as `rm -rf`, package installs, git pushes/commits/resets, and `curl | sh` are denied
- unknown tools are allowed and logged as `unclassified tool; observe only`

This mod only records decisions made by its own permission policy. It does not claim to audit every permission decision made by Letta Code or by other mods.

## State

The audit log is in memory only and stores the latest 50 entries. It is cleared when the Letta Code process exits or reloads the mod.

## Safety

Mods are trusted local code. Review the source before installing third-party mods.

If a mod breaks startup or command handling, recover with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

Then remove or edit the mod package and run `/reload`.

See [`MOD.md`](./MOD.md) for the agent-facing behavior and adaptation notes.
