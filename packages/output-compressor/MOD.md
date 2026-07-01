---
name: "@letta-ai/output-compressor"
description: "Compresses large tool outputs (Bash, Read, web fetches) before the model sees them, reversibly, to save input tokens."
---

# Output compressor mod semantics

## When to use

Install this package when an agent burns input tokens on large tool
outputs — verbose shell commands, big file reads, and web-page fetches.
It compresses those outputs *before they reach the model*, so every
subsequent turn carries fewer tokens. Compression is reversible: the
originals are cached locally and retrievable on demand.

## Behavior

The package registers one event handler and one tool.

### `tool_end` handler (capability: `events.tools`)

For successful, allowlisted tools whose string output exceeds a token
threshold, the handler replaces the result with a compact form:

- **JSON** → whitespace collapsed, long arrays truncated to the first N
  elements with a `…(M more)` marker.
- **Logs / build output** → importance-scored line selection: every line
  is scored by level (`ERROR`/`FAIL` > `WARN` > `INFO` > `DEBUG`/`TRACE`)
  with boosts for stack traces and summary lines. It keeps the first +
  last error, top errors up to a cap, deduped warnings, up to N stack
  traces, and all summary/status lines — each with surrounding context,
  in original order. Errors are kept **wherever they occur**, not just at
  the head or tail. Routine `INFO`/`DEBUG` noise is dropped.
- **Diffs / structureless text** → a head/tail window that preserves
  structure (the line-scorer would gut a diff by keeping only its
  markers).

The full original is written to
`~/.letta/mods/output-compressor.cache/<id>.txt` and a retrieval hint is
injected into the compact output. The handler never inflates output,
never double-compresses already-compacted output, and passes the
original through unchanged on any error.

### `retrieve_output` tool (capability: `tools`)

Reads a cached original back into context by id, for when the model needs
the elided or verbatim content. The id shape is `oc_[0-9a-f]{8}`;
anything else (including path-traversal attempts) is rejected.

## Configuration

Everything is configurable via `OUTPUT_COMPRESSOR_*` environment
variables — token threshold, per-strategy caps (errors, warnings, stack
traces, context lines, array-keep), tool allowlist, cache size, verbose
logging, and a global disable switch. See the README for the full table
and defaults.

## Safety and recovery

This mod is trusted local code and runs with the user's local
permissions. It reads and writes under
`~/.letta/mods/output-compressor.cache/` and rewrites tool outputs
in-process before they reach the model. It makes no network calls and
spawns no subprocesses.

Compression is **lossy by design** for logs (routine lines are dropped),
but never destructive: the original bytes are always recoverable via
`retrieve_output(id)`. To disable compression entirely, set
`OUTPUT_COMPRESSOR_DISABLE=1` and run `/reload`. If a mod ever breaks
startup, recover with `letta --no-mods` or `LETTA_DISABLE_MODS=1 letta`,
then remove or edit the package and `/reload`.
