import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_LIMIT = 8;
const MAX_FILE_BYTES = 1_000_000;
const COLLECTION_NAME = "memory";
const QMD_TIMEOUT_MS = 60_000;

function candidateMemoryDirs(ctx) {
  const candidates = [];
  if (process.env.MEMORY_DIR) candidates.push(process.env.MEMORY_DIR);
  const agentId = ctx?.agent?.id || process.env.AGENT_ID || "";
  const home = process.env.HOME || "";
  if (home && agentId) {
    candidates.push(path.join(home, ".letta", "lc-local-backend", "memfs", agentId, "memory"));
    candidates.push(path.join(home, ".letta", "agents", agentId, "memory"));
  }
  return candidates;
}

function memoryDir(ctx) {
  for (const candidate of candidateMemoryDirs(ctx)) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return candidateMemoryDirs(ctx)[0] || "";
}

function clampLimit(value) {
  const n = Number.parseInt(String(value ?? DEFAULT_LIMIT), 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, 50);
}

function qmdEnv(extraPath = "") {
  const env = { ...process.env };
  delete env.BUN_INSTALL;
  if (extraPath) env.PATH = `${extraPath}:${env.PATH || ""}`;
  return env;
}

async function commandExists(command) {
  try {
    await execFileAsync("sh", ["-lc", `command -v ${command}`], { env: qmdEnv(), timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function qmdBinDir() {
  const { stdout } = await execFileAsync("sh", ["-lc", "command -v qmd"], { env: qmdEnv(), timeout: 5_000 });
  return path.dirname(stdout.trim());
}

async function runQmd(args, cwd) {
  // QMD can break when Bun's sqlite runtime is selected; unset BUN_INSTALL.
  // Prefer the Node binary next to qmd so native sqlite modules match the qmd install.
  const binDir = await qmdBinDir();
  const { stdout, stderr } = await execFileAsync("qmd", args, {
    cwd,
    env: qmdEnv(binDir),
    timeout: QMD_TIMEOUT_MS,
    maxBuffer: 2 * 1024 * 1024,
  });
  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
}

async function qmdFilesArgs() {
  try {
    const { stdout } = await execFileAsync("qmd", ["query", "--help"], { env: qmdEnv(await qmdBinDir()), timeout: 5_000 });
    return stdout.includes("--format") ? ["--format", "files"] : ["--files"];
  } catch {
    return ["--files"];
  }
}

async function walkMarkdown(root, out = []) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      await walkMarkdown(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function terms(query) {
  return query.toLowerCase().split(/\s+/).map((s) => s.replace(/^\W+|\W+$/g, "")).filter(Boolean);
}

function makeSnippet(text, queryTerms, phrase = "") {
  const lower = text.toLowerCase();
  let index = phrase ? lower.indexOf(phrase) : -1;
  if (index < 0) {
    for (const term of queryTerms) {
      index = lower.indexOf(term);
      if (index >= 0) break;
    }
  }
  if (index < 0) index = 0;
  const start = Math.max(0, index - 180);
  const end = Math.min(text.length, index + 420);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while (true) {
    const next = haystack.indexOf(needle, pos);
    if (next < 0) return count;
    count += 1;
    pos = next + Math.max(needle.length, 1);
  }
}

function scoreText(text, rel, query, queryTerms) {
  const lower = text.toLowerCase();
  const relLower = rel.toLowerCase();
  const phrase = query.toLowerCase().trim();
  const uniqueTerms = [...new Set(queryTerms)];
  const matchedTerms = uniqueTerms.filter((term) => lower.includes(term) || relLower.includes(term));

  let score = 0;
  // Exact phrase beats scattered term spam.
  score += countOccurrences(lower, phrase) * 100;
  score += countOccurrences(relLower, phrase) * 150;

  // Prefer files that cover more of the query.
  score += matchedTerms.length * 25;
  if (matchedTerms.length === uniqueTerms.length) score += 75;

  for (const term of uniqueTerms) {
    const bodyCount = countOccurrences(lower, term);
    const pathCount = countOccurrences(relLower, term);
    // Cap repeated body matches so long noisy files do not dominate.
    score += Math.min(bodyCount, 8) * 3;
    score += pathCount * 20;
  }

  // Prefer core memory and short focused files when scores are close.
  if (rel.startsWith("system/")) score += 20;
  if (text.length < 10_000) score += 8;
  if (text.length < 3_000) score += 8;

  return { score, matchedTerms: matchedTerms.length, phrase };
}

async function keywordSearch(root, query, limit, filesOnly, full) {
  const queryTerms = terms(query);
  if (queryTerms.length === 0) return "No query terms.";

  const files = await walkMarkdown(root);
  const hits = [];
  for (const file of files) {
    let st;
    try {
      st = await stat(file);
    } catch {
      continue;
    }
    if (st.size > MAX_FILE_BYTES) continue;
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const rel = path.relative(root, file);
    const scored = scoreText(text, rel, query, queryTerms);
    if (scored.score > 0 && scored.matchedTerms > 0) {
      hits.push({ file, rel, score: scored.score, text, phrase: scored.phrase });
    }
  }

  hits.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
  const top = hits.slice(0, limit);
  if (top.length === 0) return "No matches.";
  if (filesOnly) return top.map((h) => h.rel).join("\n");

  return top.map((h, i) => {
    const body = full ? h.text.trim().slice(0, 6000) : makeSnippet(h.text, queryTerms, h.phrase);
    return [`## ${i + 1}. ${h.rel}`, `score: ${h.score}`, "", body].join("\n");
  }).join("\n\n---\n\n");
}

async function search(args, ctx) {
  const root = memoryDir(ctx);
  if (!root || !existsSync(root)) {
    return { status: "error", content: "MEMORY_DIR is not set or does not exist; memfs_search needs the agent memory filesystem path." };
  }

  const query = String(args.query || "").trim();
  if (!query) return { status: "error", content: "query is required." };

  const mode = String(args.mode || "keyword");
  const limit = clampLimit(args.limit);
  const filesOnly = Boolean(args.files_only);
  const full = Boolean(args.full);

  if (mode === "keyword") {
    return await keywordSearch(root, query, limit, filesOnly, full);
  }

  if (!(await commandExists("qmd"))) {
    return {
      status: "error",
      content: `Semantic/hybrid search requires QMD. Falling back is not automatic for mode=${mode}. Try mode=keyword, or install QMD with: npm install -g @tobilu/qmd`,
    };
  }

  // QMD 2.5.x `vsearch` and plain `query` can trigger query-expansion or reranker
  // model downloads on first use. Use structured query syntax plus --no-rerank to
  // stay on the already-installed embedding/BM25 paths and avoid surprise 1GB+ pulls.
  const qmdQuery = mode === "semantic" ? `vec: ${query}` : `lex: ${query}
vec: ${query}`;
  const qmdArgs = ["query", qmdQuery, "-c", COLLECTION_NAME, "-n", String(limit), "--no-rerank"];
  if (filesOnly) qmdArgs.push(...(await qmdFilesArgs()));
  if (full) qmdArgs.push("--full");
  try {
    return await runQmd(qmdArgs, root);
  } catch (error) {
    return {
      status: "error",
      content: `QMD structured ${mode} search failed: ${error instanceof Error ? error.message : String(error)}
Try mode=keyword, or run the memfs-search skill setup/reindex flow.`,
    };
  }

}

async function status(ctx) {
  const root = memoryDir(ctx);
  const lines = [];
  lines.push(`MEMORY_DIR: ${root || "not set"}`);
  lines.push(`exists: ${root && existsSync(root) ? "yes" : "no"}`);
  lines.push(`qmd: ${(await commandExists("qmd")) ? "available" : "not found"}`);
  if (root && existsSync(root)) {
    const count = (await walkMarkdown(root)).length;
    lines.push(`markdown_files: ${count}`);
  }
  return lines.join("\n");
}

export default function activate(letta) {
  if (!letta.capabilities.tools) return;

  return letta.tools.register({
    name: "memfs_search",
    description: "Search this agent's MemFS memory files. Use before creating memory, when the user asks what you know about something, or when exact remembered context may be stored in memory. Supports built-in keyword search and optional QMD semantic/hybrid search when qmd is installed.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query. Required unless action=status.",
        },
        mode: {
          type: "string",
          enum: ["keyword", "semantic", "hybrid"],
          description: "Search mode. keyword is built in. semantic/hybrid use QMD structured queries with --no-rerank to avoid expansion/reranker model downloads.",
        },
        limit: {
          type: "number",
          description: "Maximum results, default 8, max 50.",
        },
        files_only: {
          type: "boolean",
          description: "Return only matching memory file paths. QMD modes auto-detect --files vs --format files.",
        },
        full: {
          type: "boolean",
          description: "Return fuller file contents/snippets instead of compact snippets.",
        },
        action: {
          type: "string",
          enum: ["search", "status"],
          description: "Use status to check MEMORY_DIR/QMD availability. Defaults to search.",
        },
      },
      additionalProperties: false,
    },
    requiresApproval: false,
    parallelSafe: true,
    async run(ctx) {
      const action = String(ctx.args.action || "search");
      if (action === "status") return await status(ctx);
      return await search(ctx.args, ctx);
    },
  });
}
