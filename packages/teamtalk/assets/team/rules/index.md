# Rules

## Global

* [think-before-coding](global/think-before-coding.md) — State assumptions
  and surface tradeoffs before writing code.
* [verify-before-done](global/verify-before-done.md) — Define success
  criteria up front and verify against them before declaring work done.
* [surface-tradeoffs](global/surface-tradeoffs.md) — Explain the reasoning
  behind recommendations; do not silently choose between valid options.
* [match-repo-patterns](global/match-repo-patterns.md) — Use existing
  patterns and helper APIs rather than inventing new abstractions.
* [prefer-surgical-changes](global/prefer-surgical-changes.md) — Keep
  edits closely scoped; every changed line should trace back to the request.
* [clean-up-after-pr-merge](global/clean-up-after-pr-merge.md) — Switch
  to main, pull, remove the worktree/branch, and prune remote refs.
* [manage-rule-corpus](global/manage-rule-corpus.md) — Audit the
  corpus for staleness, merge overlaps, retire dead rules.
* [use-secrets-correctly](global/use-secrets-correctly.md) — Reference
  secrets via `$SECRET_NAME`; never hardcode, read, or store them.
* [use-harness-secrets](global/use-harness-secrets.md) — Distinguish
  live env vars from harness-managed secrets; canonical recipe for
  tools that read `process.env`.
* [access-steward-bundle-via-mod-tools](global/access-steward-bundle-via-mod-tools.md) — Cross-agent MemFS access is gated by the harness; reach the steward bundle through `teamtalk_search`, `teamtalk_load_rule`, `teamtalk_propose`, or Bash (TeamTalk mod only).

## Events

* [reply-to-pr-review-comments-individually](events/reply-to-pr-review-comments-individually.md) — Reply per-thread to each PR review comment, not in one consolidated message (trigger: `pr-review`).