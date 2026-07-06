# Rules

## Global

* [think-before-coding](global/think-before-coding.md) — State assumptions
  and surface tradeoffs before writing code.
* [verify-before-done](global/verify-before-done.md) — Define success
  criteria up front and verify against them before declaring work done.
* [surface-tradeoffs](global/surface-tradeoffs.md) — Explain the reasoning
  behind recommendations; do not silently choose between valid options.
* [access-steward-bundle-via-mod-tools](global/access-steward-bundle-via-mod-tools.md) — Cross-agent MemFS access is gated by the harness; reach the steward bundle through `teamtalk_search`, `teamtalk_load_rule`, `teamtalk_propose`, or Bash.

## Events

* [reply-to-pr-review-comments-individually](events/reply-to-pr-review-comments-individually.md) — Reply per-thread to each PR review comment, not in one consolidated message (trigger: `pr-review`).