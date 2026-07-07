---
type: Rule
title: Use Secrets Correctly in Shell Commands
description: Reference secrets via $SECRET_NAME substitution. Never hardcode, read, or store secret values.
tags: [security, secrets, shell]
timestamp: 2026-07-07T20:00:00.000Z
---

# Use Secrets Correctly in Shell Commands

Secrets (API keys, tokens, credentials) must always be referenced via `$SECRET_NAME` syntax in shell commands. The harness substitutes the real value at execution time and scrubs it from all output — the agent never sees the actual value. Never hardcode, read, or store secret values.

## How to reference secrets

- **Use `$SECRET_NAME` syntax** in any shell command. Example: `curl -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/...`
- **Never hardcode** a secret value in a command, even if you think you know it.
- **Never try to read** secrets from files (`cat ~/.letta/...`, `printenv`, etc.) or discover them through any means. The harness provides them automatically via `$SECRET_NAME` substitution.
- **Never write** secret values to memory files, code, git-tracked content, or shell history. Only secret *names* may be recorded in memory.

## What agents must never do

- Hardcode secret values in commands, scripts, or code.
- Read secret values from files or environment variables directly.
- Write secret values to memory, code, or any git-tracked content.
- Attempt to discover, extract, or log secret values.
- Work around a missing secret by trying alternative authentication methods without user guidance.

## See also

- `team/rules/global/use-harness-secrets.md` — companion rule covering how harness-managed secrets differ from live env vars, the diagnostic rules for "is the secret configured?", and the canonical recipe for tools that read `process.env`.
- `team/rules/global/manage-rule-corpus.md` — when proposing a new rule, you may encounter secrets (real variable names, secret patterns). That rule explains the steward bundle's secret-pattern scanner and how to use placeholder names in example snippets.