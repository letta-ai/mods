---
name: "@letta-ai/secrets-scrubber"
description: "Redacts detected credentials from string tool results before they enter Letta Code conversation history."
---

# Secrets scrubber mod semantics

## When to use

Install this package when agents may encounter API keys, access tokens, or credential-bearing connection strings in shell output, files, HTTP responses, logs, or other tool results.

## Behavior

The package registers one `tool_end` handler using the `events.tools` capability.

For every string tool result, the handler runs the local `@sanity-labs/secret-scan` detector plus narrow contextual rules for generic credential assignments and common authorization headers. It replaces matches with labeled redaction markers, preserves the original tool status, and passes clean results through without a replacement.

The handler also recognizes Letta Code's exact overflow and background-output breadcrumb lines. It rewrites a referenced file only when all of these checks pass:

- the path is absolute;
- the parent resolves to a known Letta Code output directory;
- the filename matches a harness-generated overflow or background-task shape;
- the target opens without following symlinks and is a regular file;
- the same file identity is still present immediately before atomic replacement.

Known background task files are recorded at launch. Inline reads are always scanned, but the file itself is rewritten only after TaskOutput reports `completed` or `failed`; this avoids racing an active writer and losing appended output.

## Failure behavior

Scanning fails closed. If text scanning throws, or a recognized harness output file cannot be safely scanned or replaced, the original tool result is withheld and an error is recorded through mod diagnostics. The mod never reads a breadcrumb path outside its narrow allowlist.

## Boundaries

This mod protects string tool results at the final `tool_end` boundary. It does not inspect user messages, assistant text, tool arguments, live streaming chunks, pre-existing history, multimodal results, or arbitrary local files.

Detection is rule-based and cannot guarantee discovery of every secret. A secret without a recognizable structure may be missed, and a matching non-secret fixture may be redacted.

`tool_end` replacements use first-handler-wins semantics. The scrubber must be loaded before any other mod that replaces tool results; a result returned by an earlier handler shadows later replacements.

The mod makes no network calls and spawns no subprocesses. If it prevents startup, use `letta --no-mods` or `LETTA_DISABLE_MODS=1 letta`, remove the package, and reload.
