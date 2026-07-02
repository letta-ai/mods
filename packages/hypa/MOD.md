---
name: "@letta-ai/hypa"
description: "Integrates Hypa local context compression — rewrites shell commands, provides tools for compressed file reading, semantic search, and text compression"
---

# Hypa mod semantics

## When to use

Use this mod when the user wants to reduce context window pressure from noisy tool output. Hypa is a local context runtime that intercepts shell commands and rewrites them through deterministic reducers, compressing output before the model sees it.

Upstream Hypa: <https://github.com/Hypabolic/Hypa>

## Behavior

The mod performs three roles:

### 1. Shell command rewriting (tool_start interception)

On every `tool_start` event for `Bash` or `exec_command` tools, the mod:

1. Extracts the core command by stripping the `cd <workdir> &&` prefix and `2>&1` suffix that the harness prepends/appends.
2. Sends the core command to `hypa rewrite --json`.
3. If Hypa returns `Rewritten` or `GenericWrapper`, replaces the command with the Hypa-wrapped version, re-attaching the prefix and suffix.
4. If Hypa returns `Passthrough` or an error, leaves the command unchanged (fail-open).

Different model harnesses expose shell tools under different names and arg keys:
- `Bash` with `{ command: string }` (Claude-style harness)
- `exec_command` with `{ cmd: string }` (Letta Auto / GLM harness)

Both are supported.

Multi-line shell scripts and here-documents are intentionally not rewritten because generic shell wrapping can change their semantics.

### 2. `/hypa` diagnostics command

Shows:
- Hypa binary path and MCP proxy status
- Last rewrite (input, outcome, command, error)
- Mod-level stats (rewrites, passthroughs, errors this session)
- Hypa session stats (tokens saved, tool calls). These prefer Hypa's recorded command metrics for the active session when available, falling back to `hypa session status` counters otherwise.
- Observed `tool_start` tool names

### 3. CLI-backed tools

- `hypa_diagnostics` — Same output as `/hypa`, available as a tool for environments where slash commands are unavailable.
- `hypa_read` — Context-aware file reading with modes: smart, full, outline, signatures, pruned.
- `hypa_search` — Semantic code search with scopes: project, session, code, docs and kinds: text, regex, symbol.
- `hypa_compress` — Compress explicit text with kinds: shell-output, log, code, generic.
- `hypa_mcp_proxy` (optional, env-gated) — Proxy to upstream MCP servers configured in Hypa.

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|---|---|---|
| `HYPA_BIN` | `hypa` | Path to the Hypa binary |
| `HYPA_LETTA_REWRITE_TIMEOUT_MS` | `5000` | Timeout for `hypa rewrite` calls |
| `HYPA_LETTA_ENABLE_MCP_PROXY` | (unset) | Set to `1` to enable the MCP proxy tool |
| `HYPA_LETTA_MCP_PROXY_TIMEOUT_MS` | `10000` | Timeout for MCP proxy calls |

## Requirements

- Hypa CLI installed and on `PATH` (or via `HYPA_BIN`)
- Letta Code `>=0.27.20`

The mod checks for the configured Hypa binary during activation and in diagnostics. If Hypa is missing, it reports an actionable warning when diagnostics are available and otherwise fails open.

## Safety invariants

- All Hypa calls are local — no data leaves the machine.
- Errors from `hypa rewrite` fail open: the original command runs unchanged.
- Commands already starting with `hypa` are never double-wrapped.
- Multi-line commands and here-documents are never wrapped.
- The mod only intercepts `Bash` and `exec_command` tool calls; all other tools are untouched.
- `hypa rewrite` may exit non-zero for `Passthrough` outcomes while still emitting valid JSON on stdout; the mod recovers these correctly.

## Recovery

If the mod breaks startup or command handling, run:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

Then remove or edit the package and run `/reload`.
