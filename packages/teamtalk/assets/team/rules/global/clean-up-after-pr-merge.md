---
type: Rule
title: Clean Up Worktree or Branch After PR Merge
description: After a pull request is merged, clean up the local work environment before starting new work.
tags: [git, workflow, cleanup]
timestamp: 2026-07-07T20:00:00.000Z
---

# Clean Up Worktree or Branch After PR Merge

After a pull request is merged, clean up the local work environment before starting new work. Stale branches and worktrees accumulate, and the next session may accidentally branch from a tip that's already been merged (or worse, base its work on a tip that's about to be force-pushed away).

# Trigger

Immediately after any pull request is merged, before starting the next piece of work.

# Procedure

1. **Identify the merged PR's branch.** If you don't have the branch name, find it via `gh pr view <pr-number> --json headRefName` or `git log --merges -1`.

2. **Switch to main and pull.**
   ```bash
   git checkout main
   git pull --rebase
   ```

3. **Remove the worktree (if any) AND the local branch.**
   - If the PR used a worktree: `git worktree remove <path>` (the Letta Code `EnterWorktree` tool creates worktrees under `.letta/worktrees/`), then `git branch -d <branch>` to delete the now-orphaned branch ref. Worktrees and branches are independent: removing the worktree directory does not delete the branch, and vice versa.
   - If the PR used a plain branch: `git branch -d <branch>` (lowercase `-d` so it only deletes if fully merged).
   - **Never use `-D`** unless you're certain the branch is unrecoverable — `-D` force-deletes even unmerged branches.

4. **Prune remote-tracking refs** so stale `origin/<branch>` entries don't accumulate:
   ```bash
   git remote prune origin
   ```

5. **If the merge changed assets your tooling re-reads** (mod code, persona, schema, seed files), resync by re-running the relevant setup command in the next session. The exact command depends on the tooling; check the project's README for the resync entry point.

# Examples

- **Right (worktree flow):**
  ```
  $ git checkout main
  $ git pull --rebase
  $ git worktree remove .letta/worktrees/feat-x
  $ git branch -d feat/cool-thing
  $ git remote prune origin
  ```
- **Right (plain branch flow):**
  ```
  $ git checkout main
  $ git pull --rebase
  $ git branch -d feat/cool-thing
  $ git remote prune origin
  ```
- **Wrong:** Leave the branch around for "just in case I need it later." Branches accumulate, branch lists become unsearchable, and a future `git checkout <branch>` against a force-pushed tip is a recipe for lost work.
- **Wrong:** `git branch -D <branch>` "to save time." Use `-d`; let git protect you from deleting unmerged work.

# Related

- Worktrunk (`wt`) — an opinionated wrapper around `git worktree` that some teams prefer over the raw commands. Use if your project standardizes on it; otherwise the plain git flow above works.
- Your team's chosen code review process.