# Code-Outline Enforcement Mod

**The Problem**
Agents waste context by reading entire large source files when they only need a few functions. A 5,000-line file burns ~15k tokens in a single Read call. System prompt reminders like "use code-outline first" don't work — the agent ignores them.

**The Solution**
Structural enforcement, not advisory. Three parts:

**1. Permission Overlay (the gate)**
Blocks Read-family tools (Read, read_file, ReadFile, ReadFileGemini, ReadLSP, ReadFileCodex) on supported code and structured text files over 500 lines (configurable) or 512 KB in two cases:

- **No offset/limit at all** — agent would read the entire file blind
- **Tiny unanchored limit (< 50 lines, no offset)** — agent would crawl from the top in small slices

With a valid offset (anchored to an outline location), even a small limit is allowed — the agent knows where it's going. Larger unanchored limits (>= 50) are also allowed for direct access to known sections.

When a read is blocked, a **capped outline** (max 40 entries, 3000 chars) is auto-injected into the denial message — the agent gets the structure immediately without needing to call `code_outline` separately. Relative paths are resolved against the event's working directory.

Uses `letta.permissions.register`, not `tool_start`. Runs before the approval UI so the user never sees a confusing prompt for a denied tool.

**2. Mod Tool: `code_outline` (the outline)**
Gives the agent a structural outline (functions, classes, methods with line numbers) so it knows where to target its reads. Four backends tried in order:

- **Python ast** — accurate start+end lines for `.py` files, plus **call-site references** showing what functions each function calls (requires Python, usually already installed)
- **Ctags** (optional) — 50+ languages, best accuracy. Expanded kind coverage: `func` (Go), `table`/`view` (SQL), `macro` (C/C++), `selector`/`id` (CSS)
- **Regex patterns** — zero-dependency, covers 35+ languages/formats
- **Fallback** — line count + first 15 lines

Supports non-code formats: Markdown headings, JSON keys, YAML keys (inline and block styles), CSV/TSV headers and row counts (simple delimiter heuristic, does not handle quoted commas), XML tags, .env variable names (values never exposed), gitignore patterns, EditorConfig sections.

**No dependencies required.** Works out of the box. Python and ctags are optional enhancements.

**3. Mod Tool: `code_outline_dir` (directory outline)**
Gives the agent a structural overview of an entire directory tree, showing file names and their top-level symbols. Parameters:

- `dir_path` (required) — absolute or workspace-relative path
- `depth` (optional, default 3, max 10) — maximum recursion depth
- `max_files` (optional, default 30, max 100) — maximum files to include

Safety bounds:
- 8,000 character output cap
- 5,000 directory visit limit
- 20,000 entry consideration limit
- 5 symbols per file (with "+N more symbols" marker)
- Symbol names truncated at 80 characters
- Excluded directories: .git, node_modules, __pycache__, .venv, venv, build, dist, coverage, .next, target, bin, obj
- Hidden files/dirs (dot prefix) and symbolic links are skipped
- Unknown/binary extensions are ignored (only supported extensions are outlined)
- Note: `.env`, `.gitignore`, and `.editorconfig` are supported by `code_outline` (single-file mode) but not by `code_outline_dir` (directory mode skips dot-prefixed files)
- Deterministic sort order (case-insensitive, case-stable tiebreaker)
- Stop reason and counters reported in truncation suffix

The permission overlay enforces on all supported extensions (code and structured text files). The overlay uses **regex/fallback only** (start lines, no end ranges) for its auto-injected denial outlines — it must work synchronously with zero external dependencies. The explicit `code_outline` tool uses all four backends including AST and ctags.

## Supported Languages (zero dependencies)

| Language | Extensions | What it outlines |
|---|---|---|
| Python | `.py` | classes, functions (start+end lines via ast) |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` | functions, classes, interfaces, arrow functions, methods |
| TypeScript | `.ts`, `.tsx` | functions, classes, interfaces, enums, type aliases, methods |
| Go | `.go` | functions, structs, interfaces, type aliases |
| Rust | `.rs` | functions, structs, enums, traits, impl blocks, consts |
| C | `.c`, `.h` | functions, structs, enums, macros |
| C++ | `.cpp`, `.cc`, `.hpp` | functions, classes, enums, templates, macros |
| Java | `.java` | classes, interfaces, enums, methods, fields |
| C# | `.cs` | classes, interfaces, structs, enums, methods, fields |
| Ruby | `.rb` | methods, classes, modules, attributes |
| PHP | `.php` | functions, classes, interfaces, traits, consts |
| Swift | `.swift` | functions, classes, structs, enums, protocols, vars |
| Kotlin | `.kt` | functions, classes, interfaces, objects, properties |
| Scala | `.scala` | functions, classes, traits, objects, vals |
| Lua | `.lua` | functions, methods, tables |
| **HTML** | `.html`, `.htm` | structural tags (section, nav, etc.), elements with IDs, comments, script/style blocks |
| **CSS** | `.css`, `.less` | at-rules (@media, @keyframes), rulesets, comment sections |
| **SCSS/Sass** | `.scss`, `.sass` | at-rules (@mixin, @include), rulesets, comment sections |
| **Shell** | `.sh`, `.bash`, `.zsh` | functions, comment sections |
| **PowerShell** | `.ps1`, `.psm1` | functions, classes, enums, filters, comment sections |
| **SQL** | `.sql` | CREATE/ALTER/DROP statements, INSERT INTO, SELECT...FROM, comment sections |
| **Dart** | `.dart` | classes, enums, mixins, typedefs, functions, getters, setters, comment sections |
| **Vue** | `.vue` | template/script/style blocks, comment sections |
| **Svelte** | `.svelte` | script/style blocks, comment sections |
| **Dockerfile** | `Dockerfile`, `Dockerfile.*` | FROM, RUN, CMD, ENTRYPOINT, COPY, ADD, ENV, ARG, WORKDIR, EXPOSE, etc. |

### Optional enhancements

| Tool | What it adds | Install |
|---|---|---|
| Python | Accurate start+end lines for `.py` files (vs. just start lines) | Usually pre-installed |
| Universal Ctags | 50+ language coverage with better accuracy | `winget install UniversalCtags.Ctags` / `brew install universal-ctags` / `apt install universal-ctags` |

## How It Works

```
Agent: [Read on camera_panel.py — 5,958 lines]
Mod: DENIED. "File has 5958 lines. Outline:
  L137: class VolumeControl
  L245: class MainVideoView
  L2826: class CameraPanel
  ... (90+ methods)

Use Read with offset/limit for targeted reads (offset for anchored reads, or limit >= 50 without offset)."
Agent: [Read with offset=2838, limit=260]
Mod: ALLOWED
```

The outline is auto-injected into the denial. The agent reads exactly the 260 lines it needs. (The example shows regex/fallback output with start-only lines; the explicit `code_outline` tool additionally produces end ranges via Python AST or ctags.)

## Installation

### Standalone mod file
1. Copy `mods/index.mjs` to `~/.letta/mods/code-outline-enforce.mjs`
2. Run `/reload`

### As a package (via letta-ai/mods repo)
```
letta install npm:@letta-ai/code-outline-enforce
/reload
```

### Recovery

If the mod blocks a read you need to perform, provide a positive `offset` for an anchored read, or an unanchored `limit` at or above the configured minimum (default 50). If the mod prevents Letta from loading entirely, start with `letta --no-mods` or set `LETTA_DISABLE_MODS=1` in your environment.

### Configuration
- `LETTA_OUTLINE_THRESHOLD` — line count threshold (default: 500)
- `LETTA_OUTLINE_BYTE_THRESHOLD` — byte size backstop for minified files (default: 524288 / 512 KB)
- `LETTA_OUTLINE_MIN_UNANCHORED_LIMIT` — minimum limit for unanchored reads without offset (default: 50). Prevents the "crawl 15 lines at a time" pattern.
