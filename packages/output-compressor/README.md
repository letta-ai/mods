# @letta-ai/output-compressor

**A Headroom-style context compression layer for [Letta Code](https://docs.letta.com/letta-code), shipped as a single trusted local mod.**

It intercepts large tool outputs — `Bash` stdout, big `Read` results, web fetches — **before they reach the model**, and rewrites them into a compact, information-dense form. You keep the signal (structure, errors, final state); you drop the token-bloat (repeated log lines, pretty-printed JSON whitespace, giant arrays).

Compression is **reversible**: the full original is cached on disk, and the model can pull it back verbatim with a `retrieve_output` tool whenever it needs the detail.

- **Zero runtime dependencies** — no ML model, no tree-sitter, no vector DB, no proxy process.
- **Deterministic** — same input, same output, byte-stable.
- **Fully local** — nothing leaves the machine. Runs inside the harness on the `tool_end` event.
- **Safe** — never inflates output, never double-compresses, passes originals through on any error.

---

## Why

Every turn, your agent re-reads its context. Tool outputs are the worst offenders: a `docker ps` JSON dump, a 300-line build log, a `gh api` response, a big file read. Most of those tokens are noise — the model needs the *shape* and the *outcome*, not 240 near-identical log lines.

This mod trims that noise at the exact seam Headroom's proxy uses, except there's no proxy: Letta Code fires a `tool_end` event after a tool runs but *before the model sees the result*, and a mod can replace that result. So the compression happens in-process, locally, with no packets leaving your machine.

Inspired by [Headroom](https://github.com/headroomlabs-ai/headroom) — this is the deterministic, zero-dep, Letta-native take on the idea.

---

## Measured savings

From the package's behavioral tests (`node --experimental-strip-types` against representative inputs):

| Input                                        | Before   | After    | Reduction |
|----------------------------------------------|---------:|---------:|----------:|
| Pretty-printed JSON array (60 records)       | 3.7k tok |  315 tok | **91.5%** |
| Build log, errors buried mid-file (400 lines)| 5.3k tok |  394 tok | **91.3%** |
| Small output (below threshold)               |     —    |    —     | untouched |
| Already-minified JSON                         |     —    |    —     | untouched |

Token counts are a deterministic `chars / 4` estimate (no tokenizer dependency). The point is the *relative* reduction, which tracks real provider counts closely for code and logs.

> Honesty note: Headroom's headline "60–95%" leans partly on a trained model and AST parsing. This mod is deliberately **zero-dep and deterministic**, so it wins big on the outputs that actually bloat coding sessions (structured JSON, logs, long dumps) and leaves prose roughly as-is. It's a smaller, auditable tool that does one thing well.

---

## How it works

```
  Bash / Read / fetch runs
        │  raw output (e.g. 6k tokens)
        ▼
  ┌─────────────────────────────────────────┐
  │  output-compressor  (tool_end handler)   │
  │  ─────────────────────────────────────   │
  │  1. estimate tokens; skip if < threshold │
  │  2. route by content:                    │
  │       JSON  → collapse ws + trim arrays   │
  │       logs  → score lines, keep errors    │
  │       diff  → structure-preserving window │
  │  3. skip if it didn't actually shrink     │
  │  4. cache original → mint id              │
  │  5. inject compact body + retrieval hint  │
  └─────────────────────────────────────────┘
        │  compact output (~1k tokens) + id
        ▼
  Model sees the compact version.
  Needs the full thing? → retrieve_output(id)
```

- **JSON strategy** — parses the output; recursively collapses whitespace and truncates long arrays to the first N elements with a `…(M more)` marker. Pretty-printed JSON is pure token waste; this is where you get 90%+.
- **Log strategy (importance-scored)** — for build output, test runs, and logs, every line is scored by level (`ERROR`/`FAIL` = 1.0, `WARN` = 0.5, `INFO` = 0.1, `DEBUG`/`TRACE` lower) with boosts for stack-traces (+0.3) and summary lines (+0.4). It keeps the first + last error, the top errors up to a cap, deduped warnings, up to N stack traces, and all summary/status lines — each with a few lines of context, in original order. **Errors are kept wherever they occur**, not just at the top or bottom. This is ported from [Headroom's](https://github.com/headroomlabs-ai/headroom) log compressor. Ends with a `… [N lines omitted] …` marker.
- **Diff / structureless text** — git diffs and plain source/prose (no log structure) fall back to a head/tail window (`HEAD_LINES` + `TAIL_LINES`) that preserves structure instead of the line-scorer, which would gut a diff.
- **Reversibility** — the original is written to `~/.letta/mods/output-compressor.cache/<id>.txt`. The injected header tells the model the id; `retrieve_output(id)` reads it back byte-for-byte. The cache is bounded (oldest evicted past `CACHE_MAX`).

Each compressed result carries a header like:

```
[output-compressor] 5.3k→394 tokens · log (scored: kept 30/400 lines, 370 omitted; 2 error, 1 fail, 1 warn, 1 trace)
Full original cached — call retrieve_output(id="oc_1a2b3c4d") to read it verbatim.
────────────────────────────────────────────────────────────
...compact body...
```

---

## Install

```bash
letta install npm:@letta-ai/output-compressor
```

Then run `/reload` in any active session.

You can also install from a local checkout of this repository:

```bash
git clone https://github.com/letta-ai/mods.git
cd mods/packages/output-compressor
letta install .
```

**Verify it loaded:**

```bash
letta mods list
# → Installed packages
#     enabled  npm:@letta-ai/output-compressor@0.1.0
```

**Uninstall:**

```bash
letta mods remove @letta-ai/output-compressor
```

Requires Letta Code with mod support and a Node runtime that strips TS types (Node ≥ 22.6 / ≥ 24 — the harness handles this).

---

## Configuration

All optional, via environment variables (set in your shell rc, e.g. `~/.zshrc`):

| Variable                          | Default                                        | Meaning |
|-----------------------------------|------------------------------------------------|---------|
| `OUTPUT_COMPRESSOR_DISABLE`       | `0`                                            | Set `1` to turn the mod off entirely. |
| `OUTPUT_COMPRESSOR_MIN_TOKENS`    | `800`                                          | Only compress outputs estimated larger than this (≈ 3.2k chars). |
| `OUTPUT_COMPRESSOR_ARRAY_KEEP`    | `8`                                            | Elements kept from a long JSON array. |
| `OUTPUT_COMPRESSOR_MAX_ERRORS`    | `12`                                           | Max error/fail lines kept per log (first + last always kept). |
| `OUTPUT_COMPRESSOR_MAX_WARNINGS`  | `6`                                            | Max (deduped) warning lines kept per log. |
| `OUTPUT_COMPRESSOR_MAX_STACK_TRACES` | `3`                                         | Max stack traces kept per log. |
| `OUTPUT_COMPRESSOR_STACK_TRACE_MAX_LINES` | `20`                                   | Max lines kept per stack trace. |
| `OUTPUT_COMPRESSOR_CONTEXT_LINES` | `2`                                            | Lines of context kept around each selected log line. |
| `OUTPUT_COMPRESSOR_MAX_KEEP_LINES`| `100`                                          | Overall cap on lines kept from a scored log. |
| `OUTPUT_COMPRESSOR_HEAD_LINES`    | `40`                                           | Fallback: lines kept from the top of structureless text / diffs. |
| `OUTPUT_COMPRESSOR_TAIL_LINES`    | `20`                                           | Fallback: lines kept from the bottom of structureless text / diffs. |
| `OUTPUT_COMPRESSOR_TOOLS`         | `Bash,Read,fetch_webpage,web_search,exa_search`| Comma-separated allowlist of tools to compress. |
| `OUTPUT_COMPRESSOR_CACHE_MAX`     | `200`                                          | Max cached originals kept on disk (oldest evicted). |
| `OUTPUT_COMPRESSOR_VERBOSE`       | `0`                                            | Set `1` to log a one-line diagnostic per compression. |

Change a value, then `/reload`.

---

## Design guarantees

- **Never inflates.** If the "compressed" form isn't smaller, the original passes through unchanged.
- **Never double-compresses.** Output that already carries the `[output-compressor]` header is left alone.
- **Never breaks a tool.** Any error inside compression is caught; the original result is returned and a warning is recorded to mod diagnostics.
- **Only successful, allowlisted, string outputs** are touched. Errored tools, non-allowlisted tools, and multimodal/image results pass through.
- **Path-traversal safe.** `retrieve_output` only accepts the exact `oc_[0-9a-f]{8}` id shape it mints.

---

## Limitations

- Token counts are estimates (`chars/4`), not exact provider tokenization.
- Log compression is lossy by design — it keeps errors, warnings, stack traces, and summaries, but drops routine INFO/DEBUG noise. If the model needs a dropped line, it calls `retrieve_output`. (It's told how.)
- No AST-aware code compression (that would need tree-sitter). Source files read via `Read` have no log structure, so they get the head/tail window — which preserves the top and bottom well but elides the middle. If you want code-structure-preserving compression, tune `HEAD_LINES` up or exclude `Read` from the allowlist.
- Diff detection is a fast heuristic (looks for `diff --git`/`---`/`+++`/`@@` headers). Diffs are routed to the head/tail window rather than the log scorer; the *middle* of a very large diff is elided (retrievable).
- Cache is per-machine under `~/.letta/mods/` and bounded; very old originals are evicted.

---

## Development

The whole mod is one file: [`mods/index.ts`](mods/index.ts). No build step — the harness strips types at load.

Run the logic in isolation:

```bash
node --experimental-strip-types -e '
import("./mods/index.ts").then(m => {
  const registered = { events: [], tools: [] };
  m.default({
    capabilities: { events: { tools: true }, tools: true },
    events: { on: (n) => (registered.events.push(n), () => {}) },
    tools: { register: (s) => (registered.tools.push(s.name), () => {}) },
  });
  console.log(registered);
});'
```

---

## License

Apache-2.0. Part of the [letta-ai/mods](https://github.com/letta-ai/mods) repository.
