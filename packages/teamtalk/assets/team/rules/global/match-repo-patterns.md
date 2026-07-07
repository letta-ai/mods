---
type: Rule
title: Match Repo Patterns Over Inventing Abstractions
description: When the codebase already has a pattern, framework, or helper API, use it rather than introducing a new style.
tags: [quality, process]
timestamp: 2026-07-07T20:00:00.000Z
---

# Match Repo Patterns Over Inventing Abstractions

When the codebase already has a pattern, framework, or helper API, use it rather than introducing a new style. Reach for existing abstractions before creating your own.

If you find yourself wanting to add a new abstraction, ask first: does the existing one actually fit? If yes, use it. If no, propose the abstraction before building it.

# Trigger

Any implementation task in an existing codebase. Especially true when the project's README, ADRs, or contributing guide call out a preferred framework.

# Examples

- The repo uses pnpm with workspaces — don't introduce npm install workflows.
- The codebase uses a custom error type — don't throw new Error("...").
- The project standardizes on a particular ORM — don't bring in raw SQL strings.