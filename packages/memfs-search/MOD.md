---
name: "@letta-ai/memfs-search"
description: "Agent-callable MemFS memory search with built-in keyword search and optional QMD semantic/hybrid search."
---

# MemFS search mod semantics

## When to use

Use `memfs_search` before creating new memory, when the user asks what the agent already knows about something, or when exact remembered context may be stored in markdown memory files.

## Tool

This package registers one tool:

- `memfs_search` - searches this agent's MemFS memory files.

## Actions

- `search` (default) - search memory files.
- `status` - inspect memory path and QMD availability.

## Search modes

- `keyword` - built-in markdown keyword search, no dependencies.
- `semantic` - QMD vector search, requires `qmd` setup.
- `hybrid` - QMD lexical + vector structured search, requires `qmd` setup.

If semantic or hybrid search fails because QMD is unavailable, retry with `mode: "keyword"`.

## Important behavior

- The tool reads local markdown memory files from the current agent's MemFS projection.
- The tool first checks `MEMORY_DIR`, then common Letta local memory paths for `ctx.agent.id`.
- Keyword search skips large files over 1 MB and searches `.md` files only.
- QMD modes use collection name `memory` and `--no-rerank` to avoid surprise reranker/model downloads.
- The tool is read-only and marked `parallelSafe: true`.

## Adaptation notes for agents

- Use `action: "status"` when memory path or QMD availability is unclear.
- Prefer `files_only: true` when you only need paths.
- Use `full: true` sparingly because it can return larger memory excerpts.
- Do not use this tool as a substitute for updating durable memory when a new stable preference or project fact should be recorded.
