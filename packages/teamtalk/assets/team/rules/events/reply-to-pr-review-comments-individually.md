---
type: Rule
title: Reply Individually to PR Review Comments
trigger: pr-review
trigger-description: |
  You are addressing pull-request review feedback on a branch that
  just received review comments. Detect via one or more of: a
  `pull/<n>` URL in context; `gh pr review`, `gh api .../reviews`,
  `/teamtalk debug` followed by inline review discussion;
  `gemini-code-assist[bot]` or `github-copilot[bot]` comments in
  the thread; an explicit user request to "address the review" or
  "reply to comments." Load this rule when the conversation is in
  PR-review workflow rather than when merely reading a diff.
ttl: 12
cacheable: true
tags: [communication, github, code-review]
timestamp: 2026-07-05T18:00:00.000Z
---

# Reply Individually to PR Review Comments

When addressing PR review feedback (human or bot reviewers like Gemini or Copilot), reply to each review comment in its own thread, not as one consolidated PR comment.

# Why

A consolidated reply makes reviewers (and any future reader) thread-hunt to figure out which issue each fix addresses. Per-thread replies keep the conversation anchored to the file:line the reviewer flagged, preserve the diff context, and let reviewers resolve or unresolve threads individually. Each reply should name the commit that addressed the comment so the reviewer can verify the fix in one click.

# Trigger

Any time you reply to PR review comments — by you, by a delegated agent, or by any auto-review process. Applies equally to human reviewers and to bot reviewers (`gemini-code-assist[bot]`, `github-copilot[bot]`).

# Examples

- **Right**: 9 separate replies on the 9 Gemini review comments, each threaded to its source comment via the GitHub API endpoint `repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies`. Each reply names the fixing commit hash.
- **Right**: A single PR-level summary comment after all individual replies, with a one-line pointer to the full list of fixes (the summary is a complement, not a substitute).
- **Wrong**: One PR-level "I addressed all 9 Gemini comments in commits X, Y, Z" comment with no per-thread replies. The reviewer must scan the whole diff to figure out which fix corresponds to which flag.

# Common Mistakes

- Posting only a consolidated PR comment and skipping per-thread replies — defeats the review tool's threading.
- Using the wrong API endpoint (`pulls/comments/{id}/replies` instead of `pulls/{pr}/comments/{id}/replies`) — silently fails or posts to the wrong location.
- Forgetting the commit hash in the reply — reviewers then have to read the diff to find which commit fixed what.
- Delaying replies across many commits when one summary commit would do — wastes reviewer time.

# Related

- `address-github-comments` skill — the operational procedure, including the `gh` CLI commands and the correct endpoint path.
- `Prefer Surgical Changes` — per-thread replies follow the same principle at the workflow level.
