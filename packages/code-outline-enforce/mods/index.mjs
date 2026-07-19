/**
 * Code-Outline Enforcement Mod v0.3.0
 *
 * Three capabilities:
 * 1. Permission overlay: blocks large reads on code files without offset/limit
 * 2. Mod tool "code_outline": multi-language structural outline (code + non-code)
 * 3. Mod tool "code_outline_dir": directory-level structural outline
 *
 * Outline backends (tried in order):
 *   - Python ast for .py files (accurate start+end lines, call-site refs, requires Python)
 *   - Universal Ctags for 50+ languages (start line only, optional)
 *   - Regex patterns for 35+ languages/formats (start line only, zero dependencies)
 *   - Fallback: line count + first 15 lines
 *
 * For installation, configuration, and supported-language tables see README.md.
 */

import { readFileSync, statSync, readdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// --- Configuration (validated) ---

const LINE_THRESHOLD = Math.max(1, parseInt(process.env.LETTA_OUTLINE_THRESHOLD)) || 500;
const BYTE_THRESHOLD = Math.max(1, parseInt(process.env.LETTA_OUTLINE_BYTE_THRESHOLD)) || 512 * 1024; // 512 KiB
const MAX_OUTLINE_ENTRIES = 40;
const MAX_OUTLINE_CHARS = 3000;
const MIN_UNANCHORED_LIMIT = Math.max(1, parseInt(process.env.LETTA_OUTLINE_MIN_UNANCHORED_LIMIT)) || 50;

// --- Directory outline bounds ---

const MAX_DIR_OUTLINE_CHARS = 8000;
const MAX_DIR_DEPTH = 10;
const MAX_DIR_FILES = 100;
const MAX_DIRS_VISITED = 5000;
const MAX_ENTRIES_CONSIDERED = 20000;
const MAX_SYMBOL_LENGTH = 80;
const MAX_SYMBOLS_PER_FILE = 5;

const EXCLUDED_DIRS = new Set([
  ".git", "node_modules", "__pycache__", ".venv", "venv",
  "build", "dist", "coverage", ".next", "target", "bin", "obj",
]);

// --- Deterministic sort comparator (locale-independent) ---

function compareEntryNames(a, b) {
  const al = a.name.toLowerCase();
  const bl = b.name.toLowerCase();
  if (al < bl) return -1;
  if (al > bl) return 1;
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}

// --- Read-tool family normalization ---

/**
 * Normalize a tool name by stripping non-alphanumeric characters and lowercasing.
 * This handles Read, read_file, ReadFile, ReadFileGemini, read-file, ReadLSP,
 * ReadFileCodex, and any other variant the runtime may produce.
 */
const normalizeToolName = (name) =>
  String(name).replace(/[^a-z0-9]/gi, "").toLowerCase();

const READ_TOOL_NAMES = new Set([
  "read",
  "readfile",
  "readfilegemini",
  "readfilecodex",
  "readlsp",
]);

// --- Supported code + non-code file extensions ---

const CODE_EXTS = new Set([
  ".py", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx",
  ".go", ".rs", ".c", ".cpp", ".cc", ".h", ".hpp",
  ".java", ".cs", ".rb", ".php", ".swift", ".kt", ".scala", ".lua",
  ".html", ".htm", ".css", ".scss", ".sass", ".less",
  ".sh", ".bash", ".zsh", ".ps1", ".psm1",
  ".sql", ".dart", ".vue", ".svelte",
  ".md", ".markdown",
  ".json",
  ".yml", ".yaml",
  ".csv", ".tsv",
  ".toml",
  ".xml",
  ".env",
  ".gitignore",
  ".editorconfig",
  "dockerfile",
]);

// --- Caches ---

let ctagsPath = null;
let pythonExe = null;

// Outline cache: map<resolvedPath_mtime_size, { outline, lineCount, bytes }>
const outlineCache = new Map();
const OUTLINE_CACHE_MAX = 100;

// --- Regex outline patterns (zero dependencies) ---

const CONTROL_FLOW = new Set([
  "if", "for", "while", "switch", "catch", "return",
  "else", "do", "try", "finally", "throw", "assert",
]);
const isControlFlow = (name) => CONTROL_FLOW.has(name);

const REGEX_PATTERNS = {
  ".py": [
    [/^\s*(?:class)\s+(\w+)/, "class"],
    [/^\s*(?:async\s+)?def\s+(\w+)/, "def"],
  ],
  ".js": [
    [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/, "function"],
    [/^\s*(?:export\s+)?(?:default\s+)?class\s+(\w+)/, "class"],
    [/^\s*(?:export\s+)?interface\s+(\w+)/, "interface"],
    [/^\s*(?:export\s+)?enum\s+(\w+)/, "enum"],
    [/^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(?[^=]*=>/, "arrowFn"],
    [/^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*function/, "function"],
    [/^\s*(?:static\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/, "method", true],
  ],
  ".jsx": null,
  ".mjs": null,
  ".cjs": null,
  ".ts": [
    [/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?function\s+(\w+)/, "function"],
    [/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/, "class"],
    [/^\s*(?:export\s+)?interface\s+(\w+)/, "interface"],
    [/^\s*(?:export\s+)?enum\s+(\w+)/, "enum"],
    [/^\s*(?:export\s+)?type\s+(\w+)\s*=/, "type"],
    [/^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(?[^=]*=>/, "arrowFn"],
    [/^\s*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?(\w+)\s*\([^)]*\)\s*[:{]/, "method", true],
  ],
  ".tsx": null,

  ".go": [
    [/^\s*func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/, "func"],
    [/^\s*type\s+(\w+)\s+struct/, "struct"],
    [/^\s*type\s+(\w+)\s+interface/, "interface"],
    [/^\s*type\s+(\w+)\s+func/, "type"],
    [/^\s*var\s+(\w+)\s*=\s*func/, "varFunc"],
  ],

  ".rs": [
    [/^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/, "fn"],
    [/^\s*(?:pub\s+)?struct\s+(\w+)/, "struct"],
    [/^\s*(?:pub\s+)?enum\s+(\w+)/, "enum"],
    [/^\s*(?:pub\s+)?trait\s+(\w+)/, "trait"],
    [/^\s*impl\s+(?:<[^>]*>\s+)?(\w+)/, "impl"],
    [/^\s*(?:pub\s+)?(?:const|static)\s+(\w+)/, "const"],
  ],

  ".c": [
    [/^\s*(?:static\s+)?(?:inline\s+)?[\w\s\*]+?\s+(\w+)\s*\([^)]*\)\s*\{/, "function", true],
    [/^\s*(?:typedef\s+)?struct\s+(\w+)/, "struct"],
    [/^\s*(?:typedef\s+)?enum\s+(\w+)/, "enum"],
    [/^\s*#define\s+(\w+)/, "macro"],
  ],
  ".cpp": [
    [/^\s*(?:static\s+)?(?:inline\s+)?(?:virtual\s+)?[\w\s\*&:]+?\s+(\w+)\s*\([^)]*\)\s*(?:const\s*)?(?:override\s*)?\{/, "function", true],
    [/^\s*(?:class|struct)\s+(\w+)/, "class"],
    [/^\s*(?:typedef\s+)?enum\s+(?:class\s+)?(\w+)/, "enum"],
    [/^\s*template\s*<[^>]*>\s*[\w\s\*&:]+?\s+(\w+)\s*\(/, "template"],
    [/^\s*#define\s+(\w+)/, "macro"],
  ],
  ".cc": null,
  ".h": null,
  ".hpp": null,

  ".java": [
    [/^\s*(?:public|private|protected|static|final|abstract|\s)*\s+(?:class|interface|enum)\s+(\w+)/, "class"],
    [/^\s*(?:public|private|protected|static|final|abstract|synchronized|native|\s)*\s+[\w<>\[\],\s]+\s+(\w+)\s*\([^)]*\)\s*\{/, "method", true],
    [/^\s*(?:public|private|protected|static|final|\s)*\s+[\w<>\[\],\s]+\s+(\w+)\s*=\s*[^;]+;/, "field"],
  ],

  ".cs": [
    [/^\s*(?:public|private|protected|internal|static|sealed|abstract|partial|async|\s)*\s+(?:class|interface|struct|enum)\s+(\w+)/, "class"],
    [/^\s*(?:public|private|protected|internal|static|async|override|virtual|abstract|sealed|\s)*\s+[\w<>\[\],\s]+\s+(\w+)\s*\([^)]*\)\s*\{/, "method", true],
    [/^\s*(?:public|private|protected|internal|static|readonly|\s)*\s+[\w<>\[\],\s]+\s+(\w+)\s*=\s*[^;]+;/, "field"],
  ],

  ".rb": [
    [/^\s*(?:private|protected|public)?\s*def\s+(?:self\.)?(\w+)/, "def"],
    [/^\s*class\s+(\w+)/, "class"],
    [/^\s*module\s+(\w+)/, "module"],
    [/^\s*attr_(?:accessor|reader|writer)\s*:(\w+)/, "attr"],
  ],

  ".php": [
    [/^\s*(?:public|private|protected|static|final|abstract|\s)*\s*function\s+(\w+)/, "function"],
    [/^\s*(?:final\s+|abstract\s+)?class\s+(\w+)/, "class"],
    [/^\s*interface\s+(\w+)/, "interface"],
    [/^\s*trait\s+(\w+)/, "trait"],
    [/^\s*(?:public|private|protected|static|\s)*\s+(?:const|static)\s+(\w+)/, "const"],
  ],

  ".swift": [
    [/^\s*(?:public|private|fileprivate|internal|open|static|final|override|mutating|\s)*\s*func\s+(\w+)/, "func"],
    [/^\s*(?:public|private|fileprivate|internal|open|final|\s)*\s*(?:class|struct|enum|protocol)\s+(\w+)/, "type"],
    [/^\s*(?:public|private|fileprivate|internal|open|static|\s)*\s*var\s+(\w+)/, "var"],
    [/^\s*(?:public|private|fileprivate|internal|open|static|let|\s)*\s*let\s+(\w+)/, "let"],
  ],

  ".kt": [
    [/^\s*(?:public|private|protected|internal|open|override|operator|inline|suspend|\s)*\s*fun\s+(\w+)/, "fun"],
    [/^\s*(?:public|private|protected|internal|final|open|abstract|data|\s)*\s*(?:class|interface|object|enum\s+class)\s+(\w+)/, "class"],
    [/^\s*(?:public|private|protected|internal|const|\s)*\s*(?:val|var)\s+(\w+)/, "property"],
  ],

  ".scala": [
    [/^\s*(?:private|protected|override|final|implicit|\s)*\s*def\s+(\w+)/, "def"],
    [/^\s*(?:private|protected|final|sealed|abstract|case|\s)*\s*(?:class|trait|object|case\s+class)\s+(\w+)/, "class"],
    [/^\s*(?:private|protected|val|var|\s)*\s*(?:val|var)\s+(\w+)/, "val"],
  ],

  ".lua": [
    [/^\s*function\s+(\w+)/, "function"],
    [/^\s*local\s+function\s+(\w+)/, "function"],
    [/^\s*function\s+(\w+)\.(\w+)/, "method"],
    [/^\s*function\s+(\w+):(\w+)/, "method"],
    [/^\s*local\s+(\w+)\s*=\s*\{/, "table"],
  ],

  ".html": [
    [/^\s*<!--\s*(.+?)\s*-->/, "section"],
    [/^\s*<[a-z]+\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*>/, "id"],
    [/^\s*<(section|nav|header|footer|main|article|aside|template|form|table)\b[^>]*>/, "tag"],
    [/^\s*<(script|style)\b[^>]*>/, "block"],
  ],
  ".htm": null,

  ".css": [
    [/^\s*@(media|keyframes|font-face|import|supports)\b/, "at-rule"],
    [/^\s*\/\*\s*(.+?)\s*\*\//, "section"],
    [/^\s*([.#]?[a-zA-Z][a-zA-Z0-9_-]*)\s*\{/, "rule"],
  ],
  ".scss": [
    [/^\s*@(media|keyframes|font-face|import|supports|mixin|include|function)\b/, "at-rule"],
    [/^\s*\/\/\s*(.+)$/, "comment"],
    [/^\s*\/\*\s*(.+?)\s*\*\//, "section"],
    [/^\s*([.#]?[a-zA-Z][a-zA-Z0-9_-]*)\s*\{/, "rule"],
  ],
  ".sass": null,
  ".less": null,

  ".sh": [
    [/^\s*function\s+(\w+)\s*\(/, "function"],
    [/^\s*(\w+)\s*\(\s*\)\s*\{/, "function"],
    [/^\s*#\s*(.+)$/, "comment"],
  ],
  ".bash": null,
  ".zsh": null,

  ".ps1": [
    [/^\s*function\s+(\w+)/, "function"],
    [/^\s*class\s+(\w+)/, "class"],
    [/^\s*enum\s+(\w+)/, "enum"],
    [/^\s*filter\s+(\w+)/, "filter"],
    [/^\s*#\s*(.+)$/, "comment"],
  ],
  ".psm1": null,

  ".sql": [
    [/^\s*CREATE\s+(?:TABLE|VIEW|INDEX|PROCEDURE|FUNCTION|TRIGGER)\s+(\w+)/i, "create"],
    [/^\s*ALTER\s+(?:TABLE|VIEW|INDEX|PROCEDURE|FUNCTION)\s+(\w+)/i, "alter"],
    [/^\s*DROP\s+(?:TABLE|VIEW|INDEX|PROCEDURE|FUNCTION)\s+(\w+)/i, "drop"],
    [/^\s*INSERT\s+INTO\s+(\w+)/i, "insert"],
    [/^\s*SELECT\b.*?\bFROM\s+(\w+)/is, "select"],
    [/^\s*--\s*(.+)$/, "comment"],
  ],

  ".dart": [
    [/^\s*(?:abstract\s+)?(?:class|enum|mixin|typedef)\s+(\w+)/, "type"],
    [/^\s*(?:static\s+)?\w+\s+(\w+)\s*\(/, "function"],
    [/^\s*(?:static\s+)?\w+\s+get\s+(\w+)/, "getter"],
    [/^\s*set\s+(\w+)\s*\(/, "setter"],
    [/^\s*\/\/\/?\s*(.+)$/, "comment"],
  ],

  ".vue": [
    [/^\s*<template>/, "template"],
    [/^\s*<script[^>]*>/, "script"],
    [/^\s*<style[^>]*>/, "style"],
    [/^\s*<!--\s*(.+?)\s*-->/, "comment"],
  ],

  ".svelte": [
    [/^\s*<script[^>]*>/, "script"],
    [/^\s*<style[^>]*>/, "style"],
    [/^\s*<!--\s*(.+?)\s*-->/, "comment"],
  ],

  "dockerfile": [
    [/^\s*(FROM)\s+\S+/, "from"],
    [/^\s*(RUN)\s/, "run"],
    [/^\s*(CMD)\s/, "cmd"],
    [/^\s*(ENTRYPOINT)\s/, "entrypoint"],
    [/^\s*(COPY)\s/, "copy"],
    [/^\s*(ADD)\s/, "add"],
    [/^\s*(ENV)\s/, "env"],
    [/^\s*(ARG)\s/, "arg"],
    [/^\s*(WORKDIR)\s/, "workdir"],
    [/^\s*(EXPOSE)\s/, "expose"],
    [/^\s*(VOLUME)\s/, "volume"],
    [/^\s*(LABEL)\s/, "label"],
    [/^\s*(HEALTHCHECK)\s/, "healthcheck"],
    [/^\s*(SHELL)\s/, "shell"],
  ],

  // --- Non-code file formats ---

  ".md": [
    [/^(#{1,6})\s+(.+)/, "heading"],
    [/^```(\w*)/, "codeblock"],
  ],
  ".markdown": null,

  ".json": [
    [/^\s*"([^"]+)"\s*:/, "key"],
  ],

  ".yml": [
    [/^\s*(\w[\w\s]*?):\s*$/, "key"],
    [/^\s*-\s+(\w[\w\s]*?):\s*$/, "listKey"],
  ],
  ".yaml": null,

  ".csv": [
    [/^([^,\r\n]+(?:,[^,\r\n]+)*)$/, "columns"],
  ],
  ".tsv": [
    [/^([^\t\r\n]+(?:\t[^\t\r\n]+)*)$/, "columns"],
  ],

  ".toml": [
    [/^\[(.+)\]/, "section"],
    [/^\s*(\w+)\s*=\s*/, "key"],
  ],

  ".xml": [
    [/^\s*<(\w+)[^>]*>/, "tag"],
    [/^\s*<!--\s*(.+?)\s*-->/, "comment"],
    [/^\s*<\?xml[^>]*\?>/, "declaration"],
  ],

  ".env": [
    [/^\s*(\w+)=/, "var"],
  ],

  ".gitignore": [
    [/^(\S.*)$/, "pattern"],
  ],

  ".editorconfig": [
    [/^\[(.+)\]/, "section"],
    [/^\s*(\w+)\s*=/, "property"],
  ],
};

// Extension alias map
const EXT_ALIASES = {
  ".jsx": ".js", ".mjs": ".js", ".cjs": ".js",
  ".tsx": ".ts",
  ".cc": ".cpp", ".h": ".c", ".hpp": ".cpp",
  ".htm": ".html",
  ".sass": ".scss",
  ".bash": ".sh", ".zsh": ".sh",
  ".psm1": ".ps1",
  ".less": ".css",
  ".markdown": ".md",
  ".yaml": ".yml",
  ".tsv": ".csv",
};

// --- Helpers ---

function n(path) {
  return path.replace(/\\/g, "/");
}

function getExt(filePath) {
  const normalized = n(filePath);
  const basename = normalized.split("/").pop() || "";
  // Dockerfile (case-insensitive, with optional .suffix)
  if (/^dockerfile(?:\.|$)/i.test(basename)) return "dockerfile";
  // .env files (exact name or .env.*)
  if (/^\.env(?:\..+)?$/.test(basename)) return ".env";
  // .gitignore (exact name)
  if (basename === ".gitignore") return ".gitignore";
  // .editorconfig (exact name)
  if (basename === ".editorconfig") return ".editorconfig";
  const dot = basename.lastIndexOf(".");
  if (dot === -1) return "";
  return basename.slice(dot).toLowerCase();
}

function getRegexPatterns(ext) {
  let patterns = REGEX_PATTERNS[ext];
  if (patterns === null) {
    const base = EXT_ALIASES[ext];
    patterns = base ? REGEX_PATTERNS[base] : null;
  }
  return patterns;
}

function isMemoryFile(filePath) {
  const normalized = n(filePath);
  return normalized.includes(".letta/") && normalized.includes("/memory/");
}

/**
 * Resolve a possibly-relative file_path against the current working directory.
 * Returns absolute path or null if unable to resolve.
 */
function resolvePath(filePath, event) {
  if (!filePath) return null;
  const normalized = n(filePath);

  // Already absolute (Windows drive letter or Unix root)
  if (/^[A-Za-z]:[/\\]/i.test(normalized) || normalized.startsWith("/")) {
    return normalized;
  }

  // Relative — resolve against workingDirectory or cwd
  const cwd = event.workingDirectory || event.cwd || process.cwd();
  return n(cwd).replace(/\/+$/, "") + "/" + normalized;
}

/**
 * True when the agent provided a valid offset (anchored read).
 * An anchored read means the agent already has a target location
 * (e.g. from the outline) and knows where it's going.
 *   - Positive number bypasses the block.
 *   - 0 / null / undefined do NOT bypass (full-file read).
 *   - Negative numbers do NOT bypass (invalid).
 */
function hasAnchoredOffset(args) {
  const offset = args?.offset;
  return typeof offset === "number" && offset > 0;
}

/**
 * Count lines in a UTF-8 buffer by counting LF (0x0A) bytes.
 */
function countLinesFromBuffer(buf) {
  let count = 1;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 10) count++;
  }
  return count;
}

/**
 * Shared regex outline backend.
 * Returns an array of "L{line}: {kind} {name}" strings, or null.
 */
function regexOutlineLines(filePath, ext) {
  const patterns = getRegexPatterns(ext);
  if (!patterns) return null;

  let content;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const lines = content.split("\n");
  const tags = [];

  for (let i = 0; i < lines.length; i++) {
    for (const [regex, kind, excludeControlFlow] of patterns) {
      const match = lines[i].match(regex);
      if (match) {
        if (excludeControlFlow && isControlFlow(match[1])) continue;
        tags.push(`  L${i + 1}: ${kind} ${match[1]}`);
        break;
      }
    }
  }

  return tags.length > 0 ? tags : null;
}

/**
 * Build outline string from raw lines, capped by entry count and total characters.
 * Reserves room for the truncation hint so the final result stays within MAX_OUTLINE_CHARS.
 * Also accepts a pre-built string (for fallback paths) and caps that too.
 */
function buildCappedOutline(outlineLines, lineCount) {
  let result;
  let trimmed = false;

  if (Array.isArray(outlineLines)) {
    // Cap by entry count
    if (outlineLines.length > MAX_OUTLINE_ENTRIES) {
      outlineLines = outlineLines.slice(0, MAX_OUTLINE_ENTRIES);
      trimmed = true;
    }
    result = outlineLines.join("\n");
  } else {
    // Already a string (fallback output)
    result = String(outlineLines);
  }

  // Build hint now so we know its length when capping
  const TRUNCATION_HINT = `\n  ... (${lineCount} total lines, outline truncated — use the shown symbols to choose a targeted Read range)`;

  // Character cap — reserve room for the hint if we might append it
  if (result.length > MAX_OUTLINE_CHARS - TRUNCATION_HINT.length) {
    const effectiveLimit = MAX_OUTLINE_CHARS - TRUNCATION_HINT.length;
    const truncated = result.slice(0, effectiveLimit);
    const lastNewline = truncated.lastIndexOf("\n");
    result = lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated;
    trimmed = true;
  }

  if (trimmed) {
    result += TRUNCATION_HINT;
  }

  return result;
}

/**
 * Get or generate a cached outline for a file path.
 * Reads the file once per cache miss: stats for mtime+size, reads buffer,
 * counts lines from buffer, decodes for regex.
 * Cache key = resolvedPath_mtime_size.
 * Returns { outline, lineCount, bytes }.
 */
function getOutline(filePath, ext) {
  // Stat once for mtime + size
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return { outline: null, lineCount: 0, bytes: 0 };
  }

  const cacheKey = `${filePath}_${stat.mtimeMs}_${stat.size}`;

  // Cache key includes mtime and size so file changes produce a new entry
  const cached = outlineCache.get(cacheKey);
  if (cached) return cached;

  // Read file buffer once
  let buf;
  try {
    buf = readFileSync(filePath);
  } catch {
    return { outline: null, lineCount: 0, bytes: 0 };
  }

  const lineCount = countLinesFromBuffer(buf);
  const bytes = stat.size;

  let outline = null;

  // Try regex patterns first (synchronous, zero dependencies)
  const regexPatterns = getRegexPatterns(ext);
  if (regexPatterns) {
    try {
      const content = buf.toString("utf-8");
      const lines = content.split("\n");
      const rawLines = [];

      for (let i = 0; i < lines.length; i++) {
        for (const [regex, kind, excludeControlFlow] of regexPatterns) {
          const match = lines[i].match(regex);
          if (match) {
            if (excludeControlFlow && isControlFlow(match[1])) continue;
            rawLines.push(`  L${i + 1}: ${kind} ${match[1]}`);
            break;
          }
        }
      }

      if (rawLines.length > 0) {
        outline = buildCappedOutline(rawLines, lineCount);
      }
    } catch {
      // regex parse error — fall through to fallback
    }
  }

  // Special: for CSV/TSV files, add a row count summary if no regex match
  if (!outline && (ext === ".csv" || ext === ".tsv")) {
    try {
      const content = buf.toString("utf-8");
      const lines = content.trim().split("\n");
      if (lines.length >= 2) {
        const rowCount = lines.length - 1;
        const sep = ext === ".tsv" ? "\t" : ",";
        const colCount = lines[0].split(sep).length;
        outline = `  L1: columns ${colCount} cols\n  L2: rows ${rowCount} data rows`;
        const headers = lines[0].split(sep).map(h => h.trim());
        if (headers.length <= 15) {
          outline += "\n  L1: headers " + headers.join(", ");
        }
        outline = buildCappedOutline(outline, lineCount);
      }
    } catch {
      // fall through to fallback
    }
  }

  if (!outline) {
    // Fallback — capped
    try {
      const content = buf.toString("utf-8");
      const lines = content.split("\n");
      const head = lines.slice(0, 15).map((l, i) => {
        const line = l.length > 200 ? l.slice(0, 200) + "..." : l;
        return `  L${i + 1}: ${line}`;
      }).join("\n");
      const fallbackText = `File has ${lineCount} lines (no outline backend available).\nFirst 15 lines:\n${head}`;
      outline = buildCappedOutline(fallbackText, lineCount);
    } catch {
      outline = buildCappedOutline(`File has ${lineCount} lines. No outline backend available.`, lineCount);
    }
  }

  const result = { outline, lineCount, bytes };

  // Cache (evict oldest if over max)
  if (outlineCache.size >= OUTLINE_CACHE_MAX) {
    const firstKey = outlineCache.keys().next().value;
    outlineCache.delete(firstKey);
  }
  outlineCache.set(cacheKey, result);

  return result;
}

// --- Ctags / Python detection ---

async function checkCtags() {
  try {
    await execFileAsync("ctags", ["--version"], { timeout: 2000 });
    ctagsPath = "ctags";
    return true;
  } catch {
    // check fallback paths
  }

  const home = process.env.USERPROFILE || process.env.HOME || "";
  const fallbackPaths = [
    `${home}\\AppData\\Local\\Microsoft\\WinGet\\Packages\\UniversalCtags.Ctags_Microsoft.Winget.Source_8wekyb3d8bbwe\\ctags.exe`,
    `${home}\\scoop\\apps\\universal-ctags\\current\\ctags.exe`,
    "/opt/homebrew/bin/ctags",
    "/usr/local/bin/ctags",
    "/usr/bin/ctags",
  ];

  for (const p of fallbackPaths) {
    try {
      await execFileAsync(p, ["--version"], { timeout: 2000 });
      ctagsPath = p;
      return true;
    } catch {
      // try next
    }
  }

  ctagsPath = false;
  return false;
}

async function findPython() {
  if (pythonExe !== null) return pythonExe;
  for (const cmd of ["python", "python3"]) {
    try {
      await execFileAsync(cmd, ["--version"], { timeout: 2000 });
      pythonExe = cmd;
      return cmd;
    } catch {
      // try next
    }
  }
  pythonExe = false;
  return false;
}

async function outlineWithPython(filePath) {
  const py = await findPython();
  if (!py) throw new Error("python not found");

  // Extended Python script that extracts function/class definitions and their calls
  const script = [
    'import ast,sys;f=open(sys.argv[1],encoding="utf-8");src=f.read();f.close();tree=ast.parse(src);out=[]',
    'class V(ast.NodeVisitor):',
    '  def _calls(self,body):',
    '    c=set()',
    '    for n in ast.walk(ast.Module(body=body if isinstance(body,list) else [body])):',
    '      if isinstance(n,ast.Call) and hasattr(n.func,"id") and not n.func.id.startswith("_"):',
    '        c.add(n.func.id)',
    '    return sorted(c)[:10]',
    '  def visit_FunctionDef(self,n):',
    '    c=self._calls(n.body)',
    '    s="  L{}-{}: def {}".format(n.lineno,getattr(n,"end_lineno",n.lineno),n.name)',
    '    if c:s+=" -> "+", ".join(c)',
    '    out.append(s);self.generic_visit(n)',
    '  def visit_AsyncFunctionDef(self,n):',
    '    c=self._calls(n.body)',
    '    s="  L{}-{}: async def {}".format(n.lineno,getattr(n,"end_lineno",n.lineno),n.name)',
    '    if c:s+=" -> "+", ".join(c)',
    '    out.append(s);self.generic_visit(n)',
    '  def visit_ClassDef(self,n):',
    '    out.append("  L{}-{}: class {}".format(n.lineno,getattr(n,"end_lineno",n.lineno),n.name))',
    '    self.generic_visit(n)',
    'V().visit(tree);print(chr(10).join(out))',
  ].join("\n");

  const { stdout } = await execFileAsync(py, ["-c", script, filePath], {
    timeout: 5000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return stdout.trim();
}

async function outlineWithCtags(filePath) {
  const exe = ctagsPath || "ctags";
  const { stdout } = await execFileAsync(
    exe,
    ["--output-format=json", "--fields=+lnK", filePath],
    { timeout: 5000, maxBuffer: 2 * 1024 * 1024 },
  );

  const USEFUL_KINDS = new Set([
    "class", "method", "function", "func", "interface", "struct",
    "enum", "typedef", "namespace", "module", "constructor", "property",
    "table", "view", "macro", "selector", "id",
  ]);

  const tags = stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((t) => t.line && t.name && USEFUL_KINDS.has(t.kind))
    .sort((a, b) => a.line - b.line);

  return tags.map((t) => `  L${t.line}: ${t.kind} ${t.name}`).join("\n");
}

// --- Directory walker for code_outline_dir ---

/**
 * Recursively walk a directory and collect file outlines.
 * Returns array of { path, isDir, depth, outline?, lineCount?, stopReason? }.
 * stopReason is set when traversal stops due to a safety limit.
 */
function walkDirectory(dirPath, maxDepth, maxFiles) {
  const entries = [];
  let directoriesVisited = 0;
  let entriesConsidered = 0;
  let filesEmitted = 0;
  let stopReason = null;

  function walk(dir, depth) {
    if (depth > maxDepth) { if (!stopReason) stopReason = "max depth reached"; return; }
    if (filesEmitted >= maxFiles) { if (!stopReason) stopReason = "requested max_files reached"; return; }
    if (directoriesVisited >= MAX_DIRS_VISITED) { if (!stopReason) stopReason = "directory-visit limit reached"; return; }
    if (entriesConsidered >= MAX_ENTRIES_CONSIDERED) { if (!stopReason) stopReason = "entry-consideration limit reached"; return; }

    let items;
    try {
      items = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    directoriesVisited++;

    // Sort deterministically
    items.sort(compareEntryNames);

    for (const item of items) {
      if (filesEmitted >= maxFiles) { if (!stopReason) stopReason = "requested max_files reached"; break; }
      if (entriesConsidered >= MAX_ENTRIES_CONSIDERED) { if (!stopReason) stopReason = "entry-consideration limit reached"; break; }
      entriesConsidered++;

      // Skip symbolic links
      if (item.isSymbolicLink()) continue;

      // Skip hidden files/dirs (dot prefix)
      if (item.name.startsWith(".")) continue;

      const fullPath = n(dir + "/" + item.name);

      if (item.isDirectory()) {
        // Skip excluded directories by exact basename
        if (EXCLUDED_DIRS.has(item.name)) continue;

        entries.push({ path: fullPath, isDir: true, depth });
        walk(fullPath, depth + 1);
      } else if (item.isFile()) {
        const ext = getExt(fullPath);
        if (!ext) continue;
        const cached = getOutline(fullPath, ext);
        // Extract at most MAX_SYMBOLS_PER_FILE symbols for orientation
        let symbol = null;
        if (cached.outline) {
          const symbolLines = cached.outline.split("\n");
          const shown = [];
          for (const line of symbolLines) {
            const trimmed = line.replace(/^  L\d+: /, "").trim();
            if (trimmed && !trimmed.startsWith("...")) {
              if (trimmed.length > MAX_SYMBOL_LENGTH) {
                shown.push(trimmed.slice(0, MAX_SYMBOL_LENGTH) + "...");
              } else {
                shown.push(trimmed);
              }
              if (shown.length >= MAX_SYMBOLS_PER_FILE) {
                const remaining = symbolLines.length - MAX_SYMBOLS_PER_FILE;
                if (remaining > 0) {
                  shown.push(`\u2026 +${remaining} more symbols`);
                }
                break;
              }
            }
          }
          symbol = shown.join("; ");
        }
        filesEmitted++;
        entries.push({
          path: fullPath,
          isDir: false,
          depth,
          symbol,
          lineCount: cached.lineCount,
        });
      }
    }
  }

  walk(dirPath, 0);
  return { entries, stopReason, directoriesVisited, entriesConsidered, filesEmitted };
}

// --- Mod activation ---

export default function activate(letta) {
  const disposers = [];

  // 1) Permission overlay: block full-file reads on large code files
  if (letta.capabilities.permissions) {
    disposers.push(
      letta.permissions.register({
        id: "code-outline-enforce",
        description:
          `Block Read-family tools on code files over ${LINE_THRESHOLD} lines ` +
          `or ${(BYTE_THRESHOLD / 1024).toFixed(0)} KB. Tiny unanchored reads (< ${MIN_UNANCHORED_LIMIT} lines, no offset) are also blocked.`,
        check(event) {
          // Normalize read-tool family (case-insensitive, strip non-alnum)
          if (!READ_TOOL_NAMES.has(normalizeToolName(event.toolName))) return;

          // Resolve file path (handle relative paths)
          const filePath = resolvePath(event.args?.file_path, event);
          if (!filePath) return;

          const ext = getExt(filePath);
          if (!CODE_EXTS.has(ext)) return;

          // Don't block memory files (markdown, not source code)
          if (isMemoryFile(filePath)) return;

          // Allow anchored reads — agent has a target offset (from outline)
          if (hasAnchoredOffset(event.args)) return;

          // Allow unanchored reads with sufficient limit (not tiny crawl)
          const limit = event.args?.limit;
          if (typeof limit === "number" && limit > 0 && limit >= MIN_UNANCHORED_LIMIT) return;

          // Generate (cached, capped) outline — also gets line count and bytes
          const cached = getOutline(filePath, ext);
          if (!cached.outline) return; // unreadable file — let it through

          const { outline, lineCount, bytes } = cached;

          // Check thresholds
          if (lineCount <= LINE_THRESHOLD && bytes <= BYTE_THRESHOLD) return;

          return {
            decision: "deny",
            reason:
              `File has ${lineCount} lines (${(bytes / 1024).toFixed(0)} KB). ` +
              `Outline:\n${outline}\n\n` +
              `Use Read with offset/limit for targeted reads. ` +
              `Unanchored reads need limit >= ${MIN_UNANCHORED_LIMIT}.`,
          };
        },
      }),
    );
  }

  // 2) Mod tool: code_outline — multi-language structural outline
  if (letta.capabilities.tools) {
      disposers.push(
      letta.tools.register({
        name: "code_outline",
        description:
          "Get a structural outline (functions, classes, methods with line numbers) " +
          "of a source code file. Use BEFORE reading large code files to find the " +
          "right line ranges. Supported languages (zero dependencies): Python, " +
          "JavaScript, TypeScript, Go, Rust, C, C++, Java, C#, Ruby, PHP, Swift, " +
          "Kotlin, Scala, Lua, HTML, CSS/SCSS, Shell, PowerShell, SQL, Dart, Vue, " +
          "Svelte, Dockerfile, Markdown, JSON, YAML, CSV, TOML, XML, env, gitignore. " +
          "No dependencies required.",
        parameters: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Absolute or workspace-relative path to the file to outline.",
            },
          },
          required: ["file_path"],
          additionalProperties: false,
        },
        requiresApproval: false,
        parallelSafe: true,
        async run(ctx) {
          const inputPath = ctx.args.file_path;
          if (typeof inputPath !== "string" || !inputPath.trim()) {
            return { status: "error", content: "file_path is required" };
          }

          const filePath = resolvePath(inputPath, ctx);
          if (!filePath) {
            return { status: "error", content: `Could not resolve file: ${inputPath}` };
          }

          const ext = getExt(filePath);

          // Read file buffer for line counting
          let buf;
          try {
            buf = readFileSync(filePath);
          } catch {
            return { status: "error", content: `Could not read file: ${filePath}` };
          }
          const lineCount = countLinesFromBuffer(buf);

          let outline = "";

          // Python ast for .py files (accurate start+end lines)
          if (ext === ".py") {
            try {
              outline = await outlineWithPython(filePath);
              if (outline) {
                outline = buildCappedOutline(outline.split("\n"), lineCount);
                return `## ${filePath} (${lineCount} lines)\n\n${outline}`;
              }
            } catch (error) {
              try {
                letta.diagnostics.report({
                  severity: "warning",
                  message: `code_outline Python AST failed: ${error instanceof Error ? error.message : String(error)}`,
                });
              } catch {
                // diagnostics.report not available
              }
            }
          }

          // Ctags for any language (if installed)
          if (ctagsPath === null) {
            await checkCtags();
          }

          if (ctagsPath) {
            try {
              outline = await outlineWithCtags(filePath);
              if (outline) {
                outline = buildCappedOutline(outline.split("\n"), lineCount);
                return `## ${filePath} (${lineCount} lines)\n\n${outline}`;
              }
            } catch {
              // fall through
            }
          }

          // Regex patterns (zero dependencies) — shared helper
          const regexLines = regexOutlineLines(filePath, ext);
          if (regexLines) {
            outline = buildCappedOutline(regexLines, lineCount);
            return `## ${filePath} (${lineCount} lines)\n\n${outline}`;
          }

          // Special: CSV/TSV — getOutline has row count logic
          if (ext === ".csv" || ext === ".tsv") {
            const cached = getOutline(filePath, ext);
            if (cached.outline && !cached.outline.startsWith("File has ")) {
              return `## ${filePath} (${lineCount} lines)\n\n${cached.outline}`;
            }
          }

          // Fallback — capped
          try {
            const content = readFileSync(filePath, "utf-8");
            const lines = content.split("\n");
            const head = lines.slice(0, 15).map((l, i) => {
              const line = l.length > 200 ? l.slice(0, 200) + "..." : l;
              return `  L${i + 1}: ${line}`;
            }).join("\n");
            outline = buildCappedOutline(
              `File has ${lineCount} lines (no outline backend available).\nFirst 15 lines:\n${head}`,
              lineCount,
            );
          } catch {
            outline = buildCappedOutline(
              `File has ${lineCount} lines. No outline backend available.`,
              lineCount,
            );
          }
          return `## ${filePath} (${lineCount} lines)\n\n${outline}`;
        },
      }),
    );
  }

  // 3) Mod tool: code_outline_dir — directory-level structural outline
  if (letta.capabilities.tools) {
    try {
      disposers.push(
      letta.tools.register({
        name: "code_outline_dir",
        description:
          "Get a structural outline of an entire directory tree, showing file names " +
          "and their top-level symbols. Use when exploring an unfamiliar codebase to " +
          "understand the module structure before diving into specific files.",
        parameters: {
          type: "object",
          properties: {
            dir_path: {
              type: "string",
              description: "Absolute or workspace-relative path to the directory to outline.",
            },
            depth: {
              type: "integer",
              minimum: 1,
              maximum: 10,
              default: 3,
              description: "Maximum recursion depth (default 3, max 10).",
            },
            max_files: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 30,
              description: "Maximum files to include (default 30, max 100).",
            },
          },
          required: ["dir_path"],
          additionalProperties: false,
        },
        requiresApproval: false,
        parallelSafe: false,
        async run(ctx) {
          const inputPath = ctx.args.dir_path;
          if (typeof inputPath !== "string" || !inputPath.trim()) {
            return { status: "error", content: "dir_path is required" };
          }

          const dirPath = resolvePath(inputPath, ctx);
          if (!dirPath) {
            return { status: "error", content: `Could not resolve directory: ${inputPath}` };
          }

          // Strict argument validation
          let maxDepth = 3;
          if (ctx.args.depth !== undefined && ctx.args.depth !== null) {
            const d = ctx.args.depth;
            if (typeof d !== "number" || !Number.isFinite(d) || !Number.isInteger(d)) {
              return { status: "error", content: "depth must be a finite integer" };
            }
            if (d < 1 || d > 10) {
              return { status: "error", content: "depth must be between 1 and 10" };
            }
            maxDepth = d;
          }

          let maxFiles = 30;
          if (ctx.args.max_files !== undefined && ctx.args.max_files !== null) {
            const f = ctx.args.max_files;
            if (typeof f !== "number" || !Number.isFinite(f) || !Number.isInteger(f)) {
              return { status: "error", content: "max_files must be a finite integer" };
            }
            if (f < 1 || f > 100) {
              return { status: "error", content: "max_files must be between 1 and 100" };
            }
            maxFiles = f;
          }

          const { entries, stopReason, directoriesVisited, entriesConsidered, filesEmitted } = walkDirectory(dirPath, maxDepth, maxFiles);

          if (entries.length === 0) {
            return { status: "error", content: `Directory is empty or could not be read: ${dirPath}` };
          }

          // Build truncation suffix first so we know its exact length
          const truncParts = [];
          if (stopReason) truncParts.push(stopReason);
          if (stopReason !== "requested max_files reached" && filesEmitted >= maxFiles) {
            truncParts.push("requested max_files reached");
          }
          let truncSuffix = "";
          if (truncParts.length > 0) {
            truncSuffix = `\n\u2026 truncated: ${truncParts.join("; ")} (${filesEmitted} files emitted, ${directoriesVisited} directories visited, ${entriesConsidered} entries considered)`;
          }

          const reservedSuffixLen = truncSuffix.length;
          const headerLen = `## Directory: ${dirPath}\n\n`.length;
          const budget = MAX_DIR_OUTLINE_CHARS - headerLen - reservedSuffixLen;

          const lines = [];
          let dirCount = 0;
          let fileCount = 0;
          let currentLen = 0;
          let charLimitHit = false;

          for (const entry of entries) {
            const indent = "  ".repeat(entry.depth);
            const name = entry.path.split("/").pop();
            let line;

            if (entry.isDir) {
              dirCount++;
              line = `${indent}${name}/`;
            } else {
              fileCount++;
              const info = [];
              if (entry.symbol) info.push(entry.symbol);
              if (entry.lineCount) info.push(`${entry.lineCount} lines`);
              const suffix = info.length > 0 ? `  (${info.join(", ")})` : "";
              line = `${indent}${name}${suffix}`;
            }

            // Truncate line length for safety
            if (line.length > 200) {
              line = line.slice(0, 197) + "...";
            }

            // Check character budget
            if (currentLen + line.length + 1 > budget) {
              charLimitHit = true;
              break;
            }

            lines.push(line);
            currentLen += line.length + 1; // +1 for newline
          }

          if (charLimitHit) {
            // Remove last line if it doesn't fit, prefer truncating at newline boundary
            const capSuffix = `\n\u2026 truncated: output-character limit reached (${fileCount} files emitted, ${dirCount} directories visited, ${entriesConsidered} entries considered)`;
            // Only add if it fits within the actual output
            const result = `## Directory: ${dirPath}\n\n${lines.join("\n")}${capSuffix}`;
            if (result.length <= MAX_DIR_OUTLINE_CHARS) {
              return result;
            }
            // Remove lines until the suffix fits
            while (lines.length > 0) {
              const last = lines.pop();
              currentLen -= last.length + 1;
              fileCount--;
              const testResult = `## Directory: ${dirPath}\n\n${lines.join("\n")}${capSuffix}`;
              if (testResult.length <= MAX_DIR_OUTLINE_CHARS) {
                return testResult;
              }
            }
            // Fallback: minimal output
            return `## Directory: ${dirPath}\n\n(too many entries to display)\n\u2026 truncated: output-character limit reached`;
          }

          let result = `## Directory: ${dirPath}\n\n${lines.join("\n")}`;
          if (truncSuffix) {
            result += truncSuffix;
          }

          // Ensure total output fits within cap
          if (result.length > MAX_DIR_OUTLINE_CHARS) {
            result = result.slice(0, MAX_DIR_OUTLINE_CHARS - 3) + "...";
          }

          return result;
        },
      }),
    );
    } catch(e) {
      console.error("[code-outline-enforce] code_outline_dir registration failed:", e);
    }
  }

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
