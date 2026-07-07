---
type: Rule
title: Use Harness Secrets Correctly
description: Distinguish live env vars from harness-managed secrets. Reference secrets via $SECRET_NAME; never hardcode, read, or store them. Diagnose missing-secret errors before concluding the environment is misconfigured.
tags: [security, secrets, shell, harness]
timestamp: 2026-07-07T20:00:00.000Z
---

# Use Harness Secrets Correctly

The harness wires up two categories of variables differently. Conflating them produces wrong conclusions about whether the harness has the secret you need. This rule covers both: how to detect a missing secret, the canonical recipe for tools that read `process.env`, and the prohibition on hardcoding.

## The two categories

**Live env vars.** LettaBaseURL, LettaAgentID, LettaMemoryDir, LettaConversationID, MEMORYDIR. These are set in the shell by the harness at session start and are visible to `env`, child processes, and tools that read `process.env`. Use them directly as their literal variable name.

**Harness-managed secrets.** Configured via the `/secret add` slash command. Examples include API tokens, PATs, and custom user secrets. These are NOT exposed as live env vars — they do NOT appear in `env` output. They are substituted into the command string by the harness at exec time and redacted from output. Use them as a dollar-prefixed name in commands.

## Diagnostic rules

To determine whether a harness-managed secret is configured, use these checks in order:

1. The `/secret list` slash command is canonical. It returns the exact set of secrets the harness has wired up and which `$NAME` to use in commands.
2. An `echo "$SECRET_NAME"` printing `<REDACTED>` proves configuration. The harness substituted a value and redacted it. A truly missing secret expands to an empty string.
3. `env | grep` does NOT prove configuration. Harness-managed secrets are not exposed as live env vars. Concluding the secret is missing from `env | grep` is a recurring failure mode that produces wrong conclusions.

## The canonical recipe for tools that read `process.env`

Some tools check `process.env` in the child process rather than reading from the command string. For those tools, harness substitution alone is not enough — the child process needs the variable explicitly exported. The pattern is:

```bash
export MY_TOKEN_VAR="$MY_TOKEN_VAR" && my-cli --some-flag 'argument'
```

The harness substitutes the value into the export line. The explicit export then puts it into the child process's `process.env`. The same pattern works for any CLI that reads from the environment rather than accepting a flag.

When documenting the recipe in a rule or note, prefer placeholder names like `MY_TOKEN_VAR` over real names. Real names containing the substring `KEY` combined with a quoted value will trip the steward bundle's secret-pattern scanner on write.

## When a tool fails with a missing-secret error

Before concluding the environment is missing a configuration:

1. Run `/secret list` to confirm the secret exists in the harness.
2. Verify the canonical recipe works: export the variable and then run the tool. A clean response is the real proof.
3. If the recipe still fails, ask the user before persisting any "this environment is missing X" conclusion into memory. Memory corrections about infrastructure gaps mislead future sessions and are hard to retract.

Common failure modes that look like missing config but aren't:

- Forgot the export prefix → child process never sees the value.
- Forgot the `&&` between `export` and command → shell parses it as a separate command that doesn't propagate env.
- Used a dollar-prefixed name outside a shell command (e.g. in a JSON payload or a script file) → harness substitution only happens for shell command strings, not for embedded references.
- Provider-side caching → retry once after the harness re-renders. A race during secret provisioning can produce a transient missing-key error that resolves on the next invocation.
- Refusal from a write tool due to secret-pattern false positives → see the canonical-recipe note above. If a rule body legitimately needs a real variable name, rewrite to use placeholder names; only revert to real names when the example must reference live code.

## Why agents must never read or hardcode secret values

- The harness substitutes the value for you. Reading it back is redundant and exposes it to your context, which is exactly what the harness is trying to prevent.
- Once a value is in your context, anything that touches your context (memory, logs, downstream tool calls) can leak it.
- Secret names are stable; secret values rotate. Build workflows around names.

## See also

- `team/rules/global/use-secrets-correctly.md` — the narrower "never hardcode / never read" rule. Most of its content is folded into this one; both ship because they target different scopes (this one is diagnostic, the other is a quick checklist).