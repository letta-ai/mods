# @letta-ai/hypa

A [Letta Code](https://docs.letta.com/letta-code) mod that integrates [Hypa](https://github.com/Hypabolic/Hypa) — a local context runtime for coding agents. Hypa reduces noisy tool output via deterministic, local compression.

Upstream Hypa resources:

- GitHub: <https://github.com/Hypabolic/Hypa>
- Pi package: <https://pi.dev/packages/@hypabolic/pi-hypa>

## What it does

### Shell command rewriting

The mod intercepts `Bash` and `exec_command` tool calls and rewrites the command through `hypa rewrite --json`. When Hypa recognizes a command (e.g. `git status`, `npm install`, `npm run ci`), it wraps it so the output is compressed before the model sees it.

The mod strips the `cd <workdir> &&` prefix and `2>&1` suffix that the Letta Code harness prepends/appends to commands, so Hypa's reducers can match the core command. After rewriting, the prefix and suffix are re-attached.

Multi-line shell scripts and here-documents are intentionally not rewritten because generic shell wrapping can change their semantics.

**Supported outcomes:**

| Outcome | Behavior |
|---|---|
| `Rewritten` | Command replaced with `hypa <command>` (specific reducer) |
| `GenericWrapper` | Command replaced with `hypa -c "<command>"` (generic reducer) |
| `Passthrough` | Command runs unchanged |
| Error | Command runs unchanged (fail-open) |

### `/hypa` diagnostics

Run `/hypa` to see:

- Hypa binary path and MCP proxy status
- Last rewrite (input, outcome, command)
- Mod-level stats (rewrites, passthroughs, errors this session)
- Hypa session stats (tokens saved, tool calls). These prefer Hypa's recorded
  command metrics for the active session when available, falling back to
  `hypa session status` counters otherwise.
- Observed `tool_start` tool names

### Tools

| Tool | Description |
|---|---|
| `hypa_diagnostics` | Same output as `/hypa`, for environments without slash commands |
| `hypa_read` | Context-aware file reading (modes: smart, full, outline, signatures, pruned) |
| `hypa_search` | Semantic code search (scopes: project, session, code, docs; kinds: text, regex, symbol) |
| `hypa_compress` | Compress explicit text (kinds: shell-output, log, code, generic) |
| `hypa_mcp_proxy` | Proxy to upstream MCP servers (optional, env-gated) |

## Installation

### Prerequisites

1. Install the [Hypa CLI](https://pi.dev/packages/@hypabolic/pi-hypa) and ensure `hypa` is on your `PATH`.
2. Letta Code `>=0.27.20`.

The mod checks whether the configured Hypa binary is available during activation and in `/hypa` diagnostics. Missing Hypa is non-fatal: shell commands run unchanged and diagnostics explain how to install or configure the binary.

### Install the mod

```bash
letta mod install @letta-ai/hypa
```

Or manually clone this repo and copy the package into your mods directory.

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|---|---|---|
| `HYPA_BIN` | `hypa` | Path to the Hypa binary |
| `HYPA_LETTA_REWRITE_TIMEOUT_MS` | `5000` | Timeout for `hypa rewrite` calls (ms) |
| `HYPA_LETTA_ENABLE_MCP_PROXY` | (unset) | Set to `1` to enable the MCP proxy tool |
| `HYPA_LETTA_MCP_PROXY_TIMEOUT_MS` | `10000` | Timeout for MCP proxy calls (ms) |

## How it works

```
Agent calls Bash: "cd /repo && npm run ci 2>&1"
  ↓
Mod strips prefix/suffix: core = "npm run ci"
  ↓
hypa rewrite "npm run ci" --json
  ↓
Hypa returns: {"outcome":"GenericWrapper","command":"hypa -c \"npm run ci\""}
  ↓
Mod re-attaches prefix/suffix: "cd /repo && hypa -c \"npm run ci\" 2>&1"
  ↓
Agent runs the rewritten command — output is compressed by Hypa
```

## Token savings

Each rewritten command appends a Hypa footer to the compressed output:

```text
[hypa: 1200→340 tok, -72%, reducer=git-diff]
```

Individual savings vary by reducer — some commands compress by 90%+ while others pass through unchanged. Over a typical session of 50–100+ shell calls, these savings compound:

```text
$ /hypa

Hypa session:
  Tool calls:   104
  Tokens saved: 1792
  Source:       command metrics
```

This directly reduces the agent's context window consumption, leaving more room for reasoning and code.

## Cross-harness support

Different model harnesses expose shell tools under different names:

| Harness | Tool name | Arg key |
|---|---|---|
| Claude-style | `Bash` | `command` |
| Letta Auto / GLM | `exec_command` | `cmd` |

The mod supports both automatically.

## License

Apache-2.0

## Testing and linting

This package includes the original example-based and property-based test suite from the standalone `letta-hypa` source repo.

```bash
cd packages/hypa
npm install
npm run ci
```

The package-local quality gate is:

```bash
vitest run && tsc --noEmit && biome check .
```

This intentionally keeps linting local to `packages/hypa` rather than imposing a root-wide formatter on all mods in this heterogeneous repository.

Available scripts:

| Script | Purpose |
|---|---|
| `npm test` | Run the Vitest example-based and property-based tests |
| `npm run typecheck` | Typecheck the shipped mod with TypeScript |
| `npm run lint` | Run Biome lint rules |
| `npm run check` | Run Biome lint/format/import checks |
| `npm run format` | Format package files with Biome |
| `npm run ci` | Run tests, typecheck, and Biome checks |

The suite covers shell rewrite recovery, tool routing across `Bash` and `exec_command`, command prefix/suffix reconstruction, argument preservation, CLI-backed tools, diagnostics rendering, and fast-check properties across generated command/input spaces.

The mods repo root should still pass manifest validation:

```bash
cd ../..
npm run validate
```
