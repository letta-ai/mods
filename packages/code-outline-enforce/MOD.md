---
name: "@letta-ai/code-outline-enforce"
description: "Permission overlay + outline tool that forces agents to structure large code files before reading them."
---

# Code-Outline Enforce mod semantics

## When to use

Use this mod when working with large source code files where full-file reads waste context tokens. The mod is especially valuable in codebases with files over 500 lines where an agent might otherwise read entire files to find a single function or class.

This package provides a permission overlay and two model-callable tools (`code_outline` and `code_outline_dir`). The overlay blocks `Read` on large code files unless offset/limit is specified, and auto-injects the outline into the denial message. The `code_outline` and `code_outline_dir` tools are available for explicit use.

## Behavioral contract

When a `Read` call on a code file is denied, the agent should:

1. Read the auto-injected outline from the denial reason.
2. Use `Read` with offset/limit to target specific sections identified in the outline.
3. Optionally call `code_outline` directly on files that haven't been blocked yet.

The agent should never attempt to bypass the permission overlay by reading without offset/limit on files above the threshold.

## Tools

### `code_outline`

Model-callable structural outline tool. Accepts a `file_path` parameter and returns functions, classes, methods, and other structural elements with line numbers.

Backends tried in order:
- Python `ast` for `.py` files (accurate start+end lines, plus call-site references showing up to 10 bare-name and attribute calls at the function's own scope level, excluding nested definitions)
- Universal Ctags (optional, 50+ languages, expanded kind coverage: `func` for Go, `table`/`view` for SQL, `macro` for C/C++, `selector`/`id` for CSS)
- Regex patterns (35+ languages/formats, zero dependencies)
- Fallback (line count + first 15 lines)

Supports non-code formats: Markdown headings, JSON keys, YAML keys, CSV headers, TOML sections, XML tags, .env vars, gitignore patterns, EditorConfig sections.

### `code_outline_dir`

Model-callable directory outline tool. Accepts `dir_path` (required), `depth` (default 3, max 10), and `max_files` (default 30, max 100). Returns an indented directory tree with file symbols and safety-truncation markers.

Safety bounds:
- 8,000 character output cap
- 5,000 directory visit limit
- 20,000 entry consideration limit
- 5 symbols per file (with "+N more symbols" marker)
- Excluded directories: .git, node_modules, __pycache__, .venv, venv, build, dist, coverage, .next, target, bin, obj
- Hidden files/dirs (dot prefix) and symbolic links are skipped
- Unknown/binary extensions are ignored (only CODE_EXTS extensions are outlined)
- Note: `.env`, `.gitignore`, and `.editorconfig` are supported by `code_outline` (single-file mode) but not by `code_outline_dir` (directory mode skips dot-prefixed files)
- Deterministic sort order
- Stop reason and counters reported in truncation suffix

## Permission invariants

The permission overlay:

- **Blocks** `Read`-family tools (Read, read_file, ReadFile, ReadFileGemini, ReadLSP, ReadFileCodex) on supported code and structured text files (extensions listed in CODE_EXTS, which includes code languages plus Markdown, JSON, YAML, CSV, TOML, XML, .env, .gitignore, .editorconfig) above LINE_THRESHOLD (default 500) or BYTE_THRESHOLD (default 512 KB) when:
  - No offset or limit is provided (blind full-file read)
  - A tiny unanchored limit (< MIN_UNANCHORED_LIMIT, default 50) is provided without an offset (sequential crawl from the top)
- **Allows** reads with a valid positive offset (anchored to an outline location) even with a small limit — the agent knows where it's going.
- **Allows** unanchored reads with limit >= MIN_UNANCHORED_LIMIT.
- **Allows** reads on files below both thresholds.
- **Allows** reads on memory files (`.letta/.../memory/`).
- **Resolves relative paths** against the event's `workingDirectory` or `cwd`.
- **Auto-injects** a capped outline (max 40 entries, 3000 chars) into the denial reason. Truncated outlines include a hint directing the agent to use the shown symbols for targeted reads. The overlay uses regex/fallback only (start lines, no end ranges) — it must work synchronously with zero external dependencies. The explicit `code_outline` tool additionally uses Python AST and ctags for end ranges.
- **Caches** outline results by resolved path + mtime + size for performance (max 100 entries).

## Supported languages (regex backend, zero dependencies)

Python, JavaScript, TypeScript, Go, Rust, C, C++, Java, C#, Ruby, PHP, Swift, Kotlin, Scala, Lua, HTML, CSS/SCSS, Shell, PowerShell, SQL, Dart, Vue, Svelte, Dockerfile.

Python regex patterns cover `class`, `def`, and `async def`. For accurate start+end lines, the `code_outline` tool prefers Python AST when available.

## Configuration

No persistent state. Configuration via environment variables (values clamped to minimum 1):

- `LETTA_OUTLINE_THRESHOLD` — line count threshold (default: 500)
- `LETTA_OUTLINE_BYTE_THRESHOLD` — byte size backstop for minified files (default: 524288 / 512 KB)
- `LETTA_OUTLINE_MIN_UNANCHORED_LIMIT` — minimum limit for unanchored reads without offset (default: 50)

## Outline capping

All outline output — including denial auto-injections and explicit `code_outline` results — is capped at 40 entries and 3000 characters. This prevents the very token blowback the mod is designed to solve. When either limit is hit, the outline is truncated and a hint directs the agent to use the shown symbols to choose a targeted Read range.

Fallback output (first 15 lines) is also character-capped, with individual lines truncated at 200 characters before joining.

## Adaptation notes for agents

- Do not import Letta Code internals. Use the public mod API and Node built-ins.
- The permission check is synchronous and uses `readFileSync` — keep it fast.
- The regex patterns are line-by-line. Multi-line signatures or deeply nested structures may be missed.
- For Python files, the `ast` backend gives the most accurate results (start+end lines). For all other languages, regex gives start lines only.
- The `code_outline` tool and the permission overlay share the same regex patterns — they are always in sync.
