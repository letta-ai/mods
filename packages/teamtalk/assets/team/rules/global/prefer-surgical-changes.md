---
type: Rule
title: Prefer Surgical Changes
description: Keep edits closely scoped to the modules, ownership boundaries, and behavioral surface implied by the user's request.
tags: [quality, process]
timestamp: 2026-07-07T20:00:00.000Z
---

# Prefer Surgical Changes

Keep edits closely scoped to the modules, ownership boundaries, and behavioral surface implied by the user's request. Do not refactor adjacent code, churn metadata, or introduce new abstractions as a side effect.

Every changed line should trace back to the request. If a refactor is genuinely needed for safety, call it out before doing it rather than hiding it in a commit.

# Trigger

Any non-trivial implementation task, particularly when touching shared behavior, public APIs, or cross-module contracts.

# Examples

- Fix a bug: edit the failing code path and a regression test. Do not also rename adjacent variables.
- Add a feature: introduce only the new symbol and its tests. Do not rewrite the file to match a different style.

# Exceptions

Pure refactoring tasks, architectural reorganization, and code-review-driven cleanups obviously do not apply. This rule is about scope discipline, not against refactors per se.