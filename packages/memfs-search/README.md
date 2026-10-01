# MemFS Search

A Letta Code mod package that adds an agent-callable `memfs_search` tool for searching the current agent's MemFS memory files.

The tool includes built-in keyword search over markdown memory files and optional QMD-backed semantic/hybrid search when `qmd` is installed and indexed.

Original source: <https://tangled.org/cameron.stream/memfs-search>

## Install

```bash
letta install npm:@letta-ai/memfs-search
```

Run `/reload` in active sessions after installing.

## Tool

- `memfs_search` searches this agent's local MemFS projection.

Actions:

- `search` (default) searches memory files.
- `status` reports memory path and QMD availability.

Search modes:

- `keyword` - built in, no dependencies.
- `semantic` - uses `qmd` structured vector search.
- `hybrid` - uses `qmd` structured lexical + vector search.

Example tool call:

```json
{
  "action": "search",
  "query": "commit footer preferences",
  "mode": "keyword",
  "limit": 5
}
```

Status check:

```json
{ "action": "status" }
```

## QMD setup

`semantic` and `hybrid` modes require `qmd` to be installed and indexed. Install `@tobilu/qmd`, create a collection named `memory` over `$MEMORY_DIR`, and embed the memory markdown files.

If QMD is unavailable, use `mode: "keyword"`.

QMD discovery uses the current process `PATH` on macOS, Linux, and Windows. Windows npm PowerShell/command shims are supported without relying on a Unix `sh` executable.

## Memory path detection

The mod checks the invocation-scoped `ctx.memfs.memoryDir` first, then `MEMORY_DIR` when present. If neither points to an existing directory, it falls back to common local Letta memory paths using `ctx.agent.id` (or `AGENT_ID`) and Node's cross-platform home-directory resolution:

- `~/.letta/lc-local-backend/memfs/<agent-id>/memory`
- `~/.letta/agents/<agent-id>/memory`

`status` reports which context/environment fields were available and lists each candidate path with its existence result. It reports field availability rather than environment values to avoid exposing unrelated configuration.

## Safety

This is trusted local code. It reads markdown memory files from the current agent's local MemFS projection and returns matching snippets to the model.

If a mod breaks startup or command handling, recover with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

See [`MOD.md`](./MOD.md) for the agent-facing behavioral contract.
