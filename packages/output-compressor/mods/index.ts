/**
 * letta-output-compressor
 * ------------------------
 * A Headroom-style context compression layer for Letta Code, built as a single
 * trusted local mod. It intercepts large tool outputs (Bash, Read, web fetches)
 * on the `tool_end` event and rewrites them into a compact, information-dense
 * form *before the model sees them* — saving input tokens on every turn.
 *
 * Compression is reversible: the full original is cached on disk and the model
 * can pull it back with the `retrieve_output` tool when it needs the detail.
 *
 * Zero runtime dependencies. Deterministic. Fully local — nothing leaves the
 * machine. All numbers are byte-stable for the same input.
 *
 * Config (environment variables, all optional):
 *   OUTPUT_COMPRESSOR_DISABLE=1        Turn the mod off entirely.
 *   OUTPUT_COMPRESSOR_MIN_TOKENS=800   Only compress outputs estimated larger
 *                                      than this (default 800 ≈ 3.2k chars).
 *   OUTPUT_COMPRESSOR_HEAD_LINES=40    Lines kept from the top of a text body.
 *   OUTPUT_COMPRESSOR_TAIL_LINES=20    Lines kept from the bottom of a text body.
 *   OUTPUT_COMPRESSOR_ARRAY_KEEP=8     Elements kept from a long JSON array.
 *   OUTPUT_COMPRESSOR_TOOLS=Bash,Read,fetch_webpage,web_search,exa_search
 *                                      Comma-separated tool allowlist.
 *   OUTPUT_COMPRESSOR_CACHE_MAX=200    Max cached originals kept on disk.
 *   OUTPUT_COMPRESSOR_VERBOSE=1        Log a one-line diagnostic per compression.
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CACHE_DIR = join(homedir(), ".letta", "mods", "output-compressor.cache");

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function envList(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const CONFIG = {
  disabled: process.env.OUTPUT_COMPRESSOR_DISABLE === "1",
  minTokens: envInt("OUTPUT_COMPRESSOR_MIN_TOKENS", 800),
  // Fallback head/tail window, used only for structureless text (no scored lines).
  headLines: envInt("OUTPUT_COMPRESSOR_HEAD_LINES", 40),
  tailLines: envInt("OUTPUT_COMPRESSOR_TAIL_LINES", 20),
  arrayKeep: envInt("OUTPUT_COMPRESSOR_ARRAY_KEEP", 8),
  // Log/text importance-scoring budget (Headroom-style selection).
  maxErrors: envInt("OUTPUT_COMPRESSOR_MAX_ERRORS", 12),
  maxWarnings: envInt("OUTPUT_COMPRESSOR_MAX_WARNINGS", 6),
  maxStackTraces: envInt("OUTPUT_COMPRESSOR_MAX_STACK_TRACES", 3),
  stackTraceMaxLines: envInt("OUTPUT_COMPRESSOR_STACK_TRACE_MAX_LINES", 20),
  contextLines: envInt("OUTPUT_COMPRESSOR_CONTEXT_LINES", 2),
  maxKeepLines: envInt("OUTPUT_COMPRESSOR_MAX_KEEP_LINES", 100),
  cacheMax: envInt("OUTPUT_COMPRESSOR_CACHE_MAX", 200),
  verbose: process.env.OUTPUT_COMPRESSOR_VERBOSE === "1",
  tools: envList("OUTPUT_COMPRESSOR_TOOLS", [
    "Bash",
    "Read",
    "fetch_webpage",
    "web_search",
    "exa_search",
  ]),
};

// ---------------------------------------------------------------------------
// Token estimation (deterministic, dependency-free)
// ---------------------------------------------------------------------------
// ~4 chars per token is the standard rough heuristic for English + code. We do
// not pull a tokenizer dependency; the goal is a stable relative signal, not an
// exact provider count.

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ---------------------------------------------------------------------------
// Cache (reversible compression — originals retrievable on demand)
// ---------------------------------------------------------------------------

function ensureCacheDir(): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
  } catch {
    /* best-effort */
  }
}

function newId(): string {
  return `oc_${randomBytes(4).toString("hex")}`;
}

function cachePath(id: string): string {
  return join(CACHE_DIR, `${id}.txt`);
}

function storeOriginal(id: string, original: string): boolean {
  try {
    ensureCacheDir();
    writeFileSync(cachePath(id), original, "utf8");
    pruneCache();
    return true;
  } catch {
    return false;
  }
}

function loadOriginal(id: string): string | null {
  // Guard against path traversal — ids are internally generated, but this tool
  // is model-callable, so only accept the exact id shape we mint.
  if (!/^oc_[0-9a-f]{8}$/.test(id)) return null;
  try {
    return readFileSync(cachePath(id), "utf8");
  } catch {
    return null;
  }
}

// Keep the cache bounded: drop oldest files once we exceed cacheMax.
function pruneCache(): void {
  try {
    const files = readdirSync(CACHE_DIR)
      .filter((f) => f.endsWith(".txt"))
      .map((f) => {
        const full = join(CACHE_DIR, f);
        return { full, mtime: statSync(full).mtimeMs };
      })
      .sort((a, b) => a.mtime - b.mtime);
    const excess = files.length - CONFIG.cacheMax;
    for (let i = 0; i < excess; i++) {
      try {
        unlinkSync(files[i].full);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Compression strategies
// ---------------------------------------------------------------------------

interface CompressionResult {
  body: string;
  strategy: string;
}

/**
 * Detect and compress JSON. Handles the two shapes that dominate tool output:
 *   - a top-level array of records  → keep first N, note "(… M more)"
 *   - a top-level object            → recursively truncate long arrays inside
 * Whitespace is always collapsed (pretty-printed JSON is pure token waste).
 * Returns null if the text is not valid JSON.
 */
function tryCompressJson(text: string): CompressionResult | null {
  const trimmed = text.trim();
  const looksJson =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));
  if (!looksJson) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  let dropped = 0;
  const keep = CONFIG.arrayKeep;

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      const truncated = value.slice(0, keep).map(walk);
      if (value.length > keep) {
        dropped += value.length - keep;
        truncated.push(`…(${value.length - keep} more of ${value.length})`);
      }
      return truncated;
    }
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = walk(v);
      return out;
    }
    return value;
  };

  const reduced = walk(parsed);
  // Compact serialization — no indentation, minimal separators.
  const body = JSON.stringify(reduced);
  return {
    body,
    strategy: dropped > 0 ? `json (collapsed, ${dropped} array items elided)` : "json (collapsed)",
  };
}

/**
 * Compress plain text / logs / build output by *importance-scored line
 * selection* rather than a positional head/tail window.
 *
 * Ported from Headroom's log compressor: every line is classified by level
 * (ERROR/FAIL > WARN > INFO > DEBUG/TRACE) and flagged as stack-trace or
 * summary, then the highest-value lines are kept — first + last error, top
 * errors up to a cap, deduped warnings, up to N stack traces, and all summary
 * lines — each surrounded by a few lines of context, in original order. This
 * keeps the parts that matter (errors, tracebacks, final status) *wherever they
 * occur*, instead of assuming they sit at the top or bottom.
 *
 * Deterministic and dependency-free.
 */

type LogLevel = "error" | "fail" | "warn" | "info" | "debug" | "trace" | "unknown";

interface ScoredLine {
  n: number; // original line index
  text: string;
  level: LogLevel;
  isStack: boolean;
  isSummary: boolean;
  score: number;
}

const LEVEL_PATTERNS: Array<[LogLevel, RegExp]> = [
  ["error", /\b(?:ERROR|Error|error|FATAL|Fatal|fatal|CRITICAL|critical|panic(?:ked)?)\b/],
  ["fail", /\b(?:FAIL(?:ED|URE)?|Fail(?:ed)?|failed)\b/],
  ["warn", /\b(?:WARN(?:ING)?|Warn(?:ing)?|warning)\b/],
  ["info", /\b(?:INFO|Info|info)\b/],
  ["debug", /\b(?:DEBUG|Debug|debug)\b/],
  ["trace", /\b(?:TRACE|Trace|trace)\b/],
];

const STACK_PATTERNS: RegExp[] = [
  /^\s*Traceback \(most recent call last\)/, // Python
  /^\s*File ".+", line \d+/, // Python frame
  /^\s*at\s+[\w.$<>]+\s*\(/, // JS/Java frame:  at foo (file:line)
  /^\s+at\s+/, // generic indented "at "
  /^\s*-->\s+.+:\d+:\d+/, // Rust location
  /^\s*\d+:\s+0x[0-9a-fA-F]+/, // Rust/backtrace frame
  /^\s*[\w.]+(?:Error|Exception):/, // exception header line
];

const SUMMARY_PATTERNS: RegExp[] = [
  /^={3,}/,
  /^-{3,}/,
  /^\s*\d+\s+(?:passed|failed|skipped|error|warning)/i,
  /^\s*(?:Tests?|Suites?):?\s+\d+/,
  /^\s*(?:TOTAL|Total|Summary)\b/,
  /^\s*(?:Build|Compile|Test).*(?:succeeded|failed|complete|passing)/i,
  /^\s*Exit code\b/i,
];

const LEVEL_SCORE: Record<LogLevel, number> = {
  error: 1.0,
  fail: 1.0,
  warn: 0.5,
  info: 0.1,
  debug: 0.05,
  trace: 0.02,
  unknown: 0.1,
};

function classifyLines(lines: string[]): ScoredLine[] {
  const out: ScoredLine[] = [];
  let inStack = false;
  let stackLen = 0;

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];

    let level: LogLevel = "unknown";
    for (const [lvl, re] of LEVEL_PATTERNS) {
      if (re.test(text)) {
        level = lvl;
        break;
      }
    }

    // Stack-trace state machine: a start pattern opens a trace; blank lines or
    // exceeding the per-trace cap close it. This keeps multi-line tracebacks
    // together instead of scoring their frames individually.
    let isStack = false;
    if (STACK_PATTERNS.some((re) => re.test(text))) {
      inStack = true;
      stackLen = 0;
    }
    if (inStack) {
      isStack = true;
      stackLen++;
      if (stackLen > CONFIG.stackTraceMaxLines || text.trim() === "") {
        inStack = false;
      }
    }

    const isSummary = SUMMARY_PATTERNS.some((re) => re.test(text));

    let score = LEVEL_SCORE[level];
    if (isStack) score += 0.3;
    if (isSummary) score += 0.4;
    if (score > 1) score = 1;

    out.push({ n: i, text, level, isStack, isSummary, score });
  }
  return out;
}

// Conservative dedupe: preserve the message identifier (everything before the
// first ':' or '=') and only normalise the trailing variable region (numbers,
// hex addresses, paths). Distinct error categories stay distinct.
function normalizeForDedupe(text: string): string {
  const idx = (() => {
    for (let i = 0; i < text.length; i++) {
      if (text[i] === ":" || text[i] === "=") return i;
    }
    return text.length;
  })();
  const prefix = text.slice(0, idx);
  let suffix = text.slice(idx);
  suffix = suffix.replace(/0x[0-9a-fA-F]+/g, "ADDR");
  suffix = suffix.replace(/\d+/g, "N");
  suffix = suffix.replace(/\/[\w./-]+\//g, "/PATH/");
  return prefix + suffix;
}

function pickFirstLast(lines: ScoredLine[], cap: number): ScoredLine[] {
  if (lines.length <= cap) return lines.slice();
  const picked: ScoredLine[] = [];
  const seen = new Set<number>();
  const take = (l: ScoredLine) => {
    if (!seen.has(l.n)) {
      seen.add(l.n);
      picked.push(l);
    }
  };
  take(lines[0]);
  take(lines[lines.length - 1]);
  const remaining = cap - picked.length;
  if (remaining > 0) {
    const rest = lines
      .filter((l) => !seen.has(l.n))
      .sort((a, b) => b.score - a.score)
      .slice(0, remaining);
    for (const l of rest) take(l);
  }
  return picked;
}

// Head/tail window — the structure-preserving fallback for content that isn't
// log-shaped (plain source, prose) or that the line-scorer would mangle (diffs,
// tables). Keeps the top and bottom, elides the middle, and is fully
// recoverable via retrieve_output.
function headTailWindow(rawLines: string[]): CompressionResult {
  const head = CONFIG.headLines;
  const tail = CONFIG.tailLines;
  if (rawLines.length <= head + tail + 1) {
    return {
      body: rawLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd(),
      strategy: "text (whitespace)",
    };
  }
  const elided = rawLines.length - head - tail;
  const body = [
    ...rawLines.slice(0, head),
    "",
    `… [${elided} lines elided — call retrieve_output for the full text] …`,
    "",
    ...rawLines.slice(rawLines.length - tail),
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return { body, strategy: `text (head ${head} / tail ${tail}, ${elided} lines elided)` };
}

// Cheap diff detector. The log line-scorer treats `---`/`+++`/`===` lines as
// "summary" and would keep only those, gutting the actual changes — so diffs
// are routed to the structure-preserving head/tail window instead. We only need
// a fast positive signal, not full classification.
const DIFF_HEADER = /^(?:diff --git |diff --cc |diff --combined |--- a\/|\+\+\+ b\/|@@ -\d)/;

function looksLikeDiff(rawLines: string[]): boolean {
  let headers = 0;
  const scan = Math.min(rawLines.length, 60);
  for (let i = 0; i < scan; i++) {
    if (DIFF_HEADER.test(rawLines[i])) {
      headers++;
      if (headers >= 2) return true;
    }
  }
  return false;
}

function compressText(text: string): CompressionResult {
  const rawLines = text.split("\n");

  // Diffs: preserve structure via the window rather than the log scorer.
  if (looksLikeDiff(rawLines)) {
    const win = headTailWindow(rawLines);
    return { body: win.body, strategy: win.strategy.replace(/^text/, "diff") };
  }

  const scored = classifyLines(rawLines);

  const errors = scored.filter((l) => l.level === "error");
  const fails = scored.filter((l) => l.level === "fail");
  const warns = scored.filter((l) => l.level === "warn");
  const summaries = scored.filter((l) => l.isSummary);

  // Group contiguous stack-trace lines into traces.
  const traces: ScoredLine[][] = [];
  let cur: ScoredLine[] = [];
  for (const l of scored) {
    if (l.isStack) {
      cur.push(l);
    } else if (cur.length) {
      traces.push(cur);
      cur = [];
    }
  }
  if (cur.length) traces.push(cur);

  const signalCount =
    errors.length + fails.length + warns.length + summaries.length + traces.length;

  // No log structure at all (e.g. a plain source file or prose dump) → fall back
  // to a head/tail window so we still save tokens without mangling it.
  if (signalCount === 0) {
    return headTailWindow(rawLines);
  }

  // Select the important lines.
  const selected = new Map<number, ScoredLine>();
  const add = (l: ScoredLine) => selected.set(l.n, l);

  for (const l of pickFirstLast(errors, CONFIG.maxErrors)) add(l);
  for (const l of pickFirstLast(fails, CONFIG.maxErrors)) add(l);

  // Dedupe warnings, then keep up to the cap.
  const seenWarn = new Set<string>();
  const dedupedWarns: ScoredLine[] = [];
  for (const w of warns) {
    const key = normalizeForDedupe(w.text);
    if (!seenWarn.has(key)) {
      seenWarn.add(key);
      dedupedWarns.push(w);
    }
  }
  for (const l of dedupedWarns.slice(0, CONFIG.maxWarnings)) add(l);

  // Keep up to N stack traces, capped per trace.
  for (const trace of traces.slice(0, CONFIG.maxStackTraces)) {
    for (const l of trace.slice(0, CONFIG.stackTraceMaxLines)) add(l);
  }

  // Always keep summary lines (final status).
  for (const l of summaries) add(l);

  // Add a few lines of context around each selected line.
  const ctx = CONFIG.contextLines;
  if (ctx > 0) {
    for (const n of [...selected.keys()]) {
      for (let i = Math.max(0, n - ctx); i <= Math.min(scored.length - 1, n + ctx); i++) {
        if (!selected.has(i)) selected.set(i, scored[i]);
      }
    }
  }

  // Enforce an overall budget: if we somehow selected too many lines, keep the
  // highest-scoring ones (still emitted in original order).
  let kept = [...selected.values()].sort((a, b) => a.n - b.n);
  if (kept.length > CONFIG.maxKeepLines) {
    kept = kept
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, CONFIG.maxKeepLines)
      .sort((a, b) => a.n - b.n);
  }

  // Emit, inserting elision markers where we skipped runs of lines.
  const omitted = rawLines.length - kept.length;
  const pieces: string[] = [];
  let prev = -1;
  for (const l of kept) {
    if (l.n > prev + 1) {
      const gap = l.n - prev - 1;
      pieces.push(`… [${gap} lines omitted] …`);
    }
    pieces.push(l.text);
    prev = l.n;
  }
  if (prev < rawLines.length - 1) {
    pieces.push(`… [${rawLines.length - 1 - prev} lines omitted] …`);
  }

  const stats = [
    errors.length ? `${errors.length} error` : "",
    fails.length ? `${fails.length} fail` : "",
    warns.length ? `${warns.length} warn` : "",
    traces.length ? `${traces.length} trace` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const body = pieces.join("\n").replace(/\n{3,}/g, "\n\n");
  return {
    body,
    strategy: `log (scored: kept ${kept.length}/${rawLines.length} lines, ${omitted} omitted${
      stats ? `; ${stats}` : ""
    })`,
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

interface Compressed {
  output: string;
  id: string;
  beforeTokens: number;
  afterTokens: number;
  strategy: string;
}

function compress(original: string): Compressed | null {
  const beforeTokens = estimateTokens(original);
  if (beforeTokens < CONFIG.minTokens) return null;

  const result = tryCompressJson(original) ?? compressText(original);
  const afterTokens = estimateTokens(result.body);

  // If compression didn't actually help (rare — e.g. minified JSON already, or
  // a short-lined but char-dense body), don't touch it. Never inflate.
  if (afterTokens >= beforeTokens) return null;

  const id = newId();
  const stored = storeOriginal(id, original);

  const header = stored
    ? `[output-compressor] ${fmtTokens(beforeTokens)}→${fmtTokens(afterTokens)} tokens · ${result.strategy}\n` +
      `Full original cached — call retrieve_output(id="${id}") to read it verbatim.\n` +
      `${"─".repeat(60)}\n`
    : `[output-compressor] ${fmtTokens(beforeTokens)}→${fmtTokens(afterTokens)} tokens · ${result.strategy} (cache write failed; original not retrievable)\n` +
      `${"─".repeat(60)}\n`;

  return {
    output: header + result.body,
    id,
    beforeTokens,
    afterTokens,
    strategy: result.strategy,
  };
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export default function activate(letta: any) {
  if (CONFIG.disabled) return () => {};

  const disposers: Array<() => void> = [];
  const toolSet = new Set(CONFIG.tools);

  // --- tool_end: compress large outputs before the model sees them ---------
  if (letta.capabilities?.events?.tools) {
    disposers.push(
      letta.events.on("tool_end", (event: any) => {
        if (event.status !== "success") return;
        if (!toolSet.has(event.toolName)) return;
        if (typeof event.output !== "string" || event.output.length === 0) return;

        // Never double-compress our own output.
        if (event.output.startsWith("[output-compressor]")) return;

        let compressed: Compressed | null = null;
        try {
          compressed = compress(event.output);
        } catch (err) {
          // Compression must never break the tool result. On any error, pass
          // the original through untouched and record a diagnostic.
          letta.diagnostics?.report?.({
            message: `output-compressor failed on ${event.toolName}: ${
              err instanceof Error ? err.message : String(err)
            }`,
            severity: "warning",
          });
          return;
        }

        if (!compressed) return; // below threshold or no net saving

        if (CONFIG.verbose) {
          console.log(
            `[output-compressor] ${event.toolName}: ${fmtTokens(compressed.beforeTokens)}→${fmtTokens(
              compressed.afterTokens,
            )} tokens (${compressed.strategy}) id=${compressed.id}`,
          );
        }

        return { result: { status: "success", output: compressed.output } };
      }),
    );
  }

  // --- retrieve_output: pull a cached original back into context -----------
  if (letta.capabilities?.tools) {
    disposers.push(
      letta.tools.register({
        name: "retrieve_output",
        description:
          "Retrieve the full, uncompressed original of a tool output that was " +
          "shrunk by the output-compressor. Call this with the id shown in a " +
          "'[output-compressor]' header when you need the elided middle section " +
          "or exact verbatim content that was truncated.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "The compression id from the '[output-compressor]' header, e.g. 'oc_1a2b3c4d'.",
            },
          },
          required: ["id"],
          additionalProperties: false,
        },
        requiresApproval: false,
        parallelSafe: true,
        run(ctx: any) {
          const id = String(ctx.args?.id ?? "").trim();
          if (!id) return { status: "error", content: "id is required." };
          const original = loadOriginal(id);
          if (original == null) {
            return {
              status: "error",
              content: `No cached output for id "${id}". It may have expired (cache holds the ${CONFIG.cacheMax} most recent) or the id is malformed.`,
            };
          }
          return original;
        },
      }),
    );
  }

  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
  };
}
