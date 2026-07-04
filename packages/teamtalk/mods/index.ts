// TeamTalk mod — single-file implementation.
//
// Architecture: a designated "steward" agent owns the team's OKF bundle
// in its MemFS under `team/`. Other agents on the team read directly
// from the steward's local MemFS clone (no remote API on hot path) and
// route writes through the steward via the PROPOSE protocol.
//
// Capability surface:
//   - commands: /teamtalk with subcommands (init, enable, disable,
//     status, search, sync, propose)
//   - tools: teamtalk_search, teamtalk_propose
//   - events.turns: read steward system/rules.md and prepend as transient
//     prefix on every turn
//
// Reference: plan-mode mod for multi-capability patterns.

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// ============================================================================
// Constants
// ============================================================================

const STEWARD_TAG = "teamtalk-steward";
const STATE_PATH = join(homedir(), ".letta", "mods", "teamtalk.state.json");
const RULES_RELATIVE_PATH = "system/rules.md";
const TEAM_BUNDLE_DIRNAME = "team";
const SEARCH_DEFAULT_LIMIT = 8;
const SEARCH_MAX_FILE_BYTES = 1_000_000;

// Assets directory (relative to this file). Used by /teamtalk init to seed
// the steward's MemFS with persona/schema/rules and the OKF bundle.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ASSETS_DIR = join(__dirname, "..", "assets");

// Patterns that signal likely secrets in proposed content.
const SECRET_PATTERNS: RegExp[] = [
  /AKIA[0-9A-Z]{16}/,
  /sk-[A-Za-z0-9]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}/i,
];

// ============================================================================
// Types
// ============================================================================

type TeamTalkState = {
  stewardAgentId: string | null;
  stewardAgentName: string | null;
  lastSyncAt: string | null;
  bundlePath: string | null;
};

type ConceptHit = {
  conceptId: string;
  title: string;
  description: string;
  tags: string[];
  snippet: string;
  path: string;
};

type ParsedArgs = { sub: string; rest: string };
type ParsedFlags = { positional: string; flags: Record<string, string> };

// ============================================================================
// State IO
// ============================================================================

function emptyState(): TeamTalkState {
  return {
    stewardAgentId: null,
    stewardAgentName: null,
    lastSyncAt: null,
    bundlePath: null,
  };
}

function readState(): TeamTalkState {
  try {
    if (!existsSync(STATE_PATH)) return emptyState();
    const parsed = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    return {
      stewardAgentId:
        typeof parsed?.stewardAgentId === "string" ? parsed.stewardAgentId : null,
      stewardAgentName:
        typeof parsed?.stewardAgentName === "string" ? parsed.stewardAgentName : null,
      lastSyncAt: typeof parsed?.lastSyncAt === "string" ? parsed.lastSyncAt : null,
      bundlePath: typeof parsed?.bundlePath === "string" ? parsed.bundlePath : null,
    };
  } catch {
    return emptyState();
  }
}

function writeState(state: TeamTalkState): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ============================================================================
// Steward MemFS path resolution
// ============================================================================

function candidateStewardMemoryPaths(state: TeamTalkState): string[] {
  // When the steward agent itself runs, MEMORY_DIR points to its own
  // memory — that's the steward's clone. When a user-agent runs with
  // TeamTalk installed (the common case), MEMORY_DIR points to the
  // user-agent's memory, NOT the steward's. We therefore ignore
  // MEMORY_DIR for steward lookup and only consider paths derived
  // from stewardAgentId. To find the steward's clone, only check
  // the explicit steward paths under ~/.letta/agents/<id>/memory
  // and ~/.letta/lc-local-backend/memfs/<id>/memory.
  const candidates: string[] = [];
  const home = process.env.HOME || homedir();
  if (state.stewardAgentId) {
    candidates.push(join(home, ".letta", "agents", state.stewardAgentId, "memory"));
    candidates.push(
      join(home, ".letta", "lc-local-backend", "memfs", state.stewardAgentId, "memory"),
    );
  }
  return candidates;
}

function findStewardMemoryDir(state: TeamTalkState): string | null {
  for (const p of candidateStewardMemoryPaths(state)) {
    if (existsSync(p)) return p;
  }
  return null;
}

function findStewardRulesFile(state: TeamTalkState): string | null {
  const memDir = findStewardMemoryDir(state);
  if (!memDir) return null;
  const rulesPath = join(memDir, RULES_RELATIVE_PATH);
  return existsSync(rulesPath) ? rulesPath : null;
}

function findStewardBundleDir(state: TeamTalkState): string | null {
  const memDir = findStewardMemoryDir(state);
  if (!memDir) return null;
  const bundlePath = join(memDir, TEAM_BUNDLE_DIRNAME);
  return existsSync(bundlePath) ? bundlePath : null;
}

// ============================================================================
// Rules injection (turn_start)
// ============================================================================

function readRulesSummary(state: TeamTalkState): string | null {
  const rulesPath = findStewardRulesFile(state);
  if (!rulesPath) return null;
  try {
    const content = readFileSync(rulesPath, "utf8").trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
}

function buildRulesReminder(state: TeamTalkState, agentName: string | null): string | null {
  const rules = readRulesSummary(state);
  if (!rules) return null;
  const steward = state.stewardAgentName || state.stewardAgentId || "the team steward";
  const subject = agentName ? `the ${agentName} agent` : "you";
  return `<system-reminder>
The following are the team's global rules, sourced from ${steward}'s
MemFS (system/rules.md). Apply them to non-trivial implementation work,
process decisions, and any situation where the team has documented a
convention. Use teamtalk_search for full rule content before acting.

${rules}
</system-reminder>`;
}

// ============================================================================
// OKF helpers
// ============================================================================

type Frontmatter = {
  type?: string;
  title?: string;
  description?: string;
  tags?: string[];
  timestamp?: string;
};

function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  if (!content.startsWith("---\n")) return { frontmatter: {}, body: content };
  const end = content.indexOf("\n---", 4);
  if (end < 0) return { frontmatter: {}, body: content };
  const raw = content.slice(4, end);
  const body = content.slice(end + 4).replace(/^\n/, "");
  const fm: Frontmatter = {};
  for (const line of raw.split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let value: string | string[] | undefined = line.slice(idx + 1).trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    if (key === "type") fm.type = value as string;
    else if (key === "title") fm.title = value as string;
    else if (key === "description") fm.description = value as string;
    else if (key === "tags") fm.tags = value as string[];
    else if (key === "timestamp") fm.timestamp = value as string;
  }
  return { frontmatter: fm, body };
}

function walkMarkdownFiles(rootDir: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const full = join(dir, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".md")) {
        if (stats.size > SEARCH_MAX_FILE_BYTES) continue;
        try {
          const content = readFileSync(full, "utf8");
          out.push({ path: full, content });
        } catch {
          // skip unreadable files
        }
      }
    }
  }
  walk(rootDir);
  return out;
}

function keywordSearch(bundleDir: string, query: string, limit: number): ConceptHit[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return [];
  const files = walkMarkdownFiles(bundleDir);
  const scored: { hit: ConceptHit; score: number }[] = [];
  for (const file of files) {
    const { frontmatter, body } = parseFrontmatter(file.content);
    if (!frontmatter.type) continue; // OKF requires `type`
    const haystack = (
      `${frontmatter.title || ""} ` +
      `${frontmatter.description || ""} ` +
      `${(frontmatter.tags || []).join(" ")} ` +
      body
    ).toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) score += 1;
    }
    if (score === 0) continue;
    const conceptId = relative(bundleDir, file.path).replace(/\.md$/, "");
    const titleMatch = body.match(/^#\s+(.+)/m);
    const snippet = body.slice(0, 240).replace(/\s+/g, " ").trim();
    scored.push({
      hit: {
        conceptId,
        title: frontmatter.title || titleMatch?.[1]?.trim() || conceptId,
        description: frontmatter.description || "",
        tags: frontmatter.tags || [],
        snippet,
        path: file.path,
      },
      score,
    });
  }
  scored.sort((a, b) => b.score - a.score || a.hit.conceptId.localeCompare(b.hit.conceptId));
  return scored.slice(0, limit).map((s) => s.hit);
}

function countConcepts(bundleDir: string | null): number {
  if (!bundleDir) return 0;
  return walkMarkdownFiles(bundleDir).filter(({ content }) => {
    const { frontmatter } = parseFrontmatter(content);
    return Boolean(frontmatter.type);
  }).length;
}

// ============================================================================
// Steward tool provisioning
// ============================================================================

// Letta Code agents are created with `include_base_tools: false` and
// the static tool list `["web_search", "fetch_webpage"]`. Read tools
// (open_files, grep_files, semantic_search_files) and write tools are
// session-attached dynamically when a user-agent session opens.
//
// For the steward we deliberately do NOT attach file-write tools:
// in Letta Code 0.27.x this org's `letta_files_core` registry has
// only read tools, no Write/Edit equivalents. Writes on the OKF
// bundle are performed by the user-agent's TeamTalk mod (see
// teamtalk_propose), which writes directly to the steward's local
// MemFS clone and shells out to `letta memory commit` to persist.
// This keeps the steward as a read-only curator: validate, advise,
// answer questions — but never write to the corpus from the model.
//
// If a future Letta Code version adds a `Write` tool, the mod can
// re-enable the attach path here.

async function attachStewardReadTools(letta: any, agentId: string): Promise<{ attached: string[]; failed: string[] }> {
  // Attach the read tools so the steward can navigate the OKF bundle
  // when answering questions about it. Names may vary across Letta
  // Code versions; we filter by tool_type and accept whatever
  // read-side tools the server exposes.
  const attached: string[] = [];
  const failed: string[] = [];
  let items: any[] = [];
  try {
    const resp = await letta.client.tools.list({
      tool_types: ["letta_files_core"],
      limit: 100,
    });
    items = (resp as any)?.items ?? [];
  } catch (err: any) {
    return { attached: [], failed: [`list failed: ${err?.message || err}`] };
  }
  // Heuristic: only attach obvious read tools (no `write` in name).
  for (const tool of items) {
    if (!tool?.name || !tool?.id) continue;
    if (/write|edit|multi_edit/i.test(tool.name)) continue;
    try {
      await letta.client.agents.tools.attach(tool.id, { agent_id: agentId });
      attached.push(tool.name);
    } catch (err: any) {
      failed.push(`${tool.name} (attach failed: ${err?.message || err})`);
    }
  }
  if (items.length === 0) {
    failed.push("no letta_files_core tools registered on this server");
  }
  return { attached, failed };
}

// ============================================================================
// Module-level debug logger
// ============================================================================

// Append-only debug log shared across all handlers. The per-handler
// debug logs in handleInit/handleReseed are local-scoped; this one is
// for tool handlers and other top-level code that needs to log.
function dlog(line: string): void {
  try {
    const logPath = join(homedir(), ".letta", "mods", "teamtalk-debug.log");
    writeFileSync(logPath, `[teamtalk] ${line}\n`, { flag: "a" });
  } catch {}
}

// ============================================================================
// Secret detection
// ============================================================================

function containsSecret(text: string): string | null {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) return pattern.source;
  }
  return null;
}

// ============================================================================
// Status formatting
// ============================================================================

function formatDisplayPath(absolutePath: string, cwd: string): string {
  // Always prefer ~/-prefix for paths under $HOME, regardless of cwd.
  // This gives consistent display in /teamtalk status and /teamtalk debug.
  const home = process.env.HOME || homedir();
  if (home && absolutePath.startsWith(home + "/")) {
    return "~/" + absolutePath.slice(home.length + 1);
  }
  // Fall back to relative-to-cwd for paths outside $HOME.
  try {
    const rel = relative(cwd, absolutePath);
    if (rel && !rel.startsWith("..")) return rel;
  } catch {
    // fall through
  }
  return absolutePath;
}

function formatStatus(state: TeamTalkState, cwd: string): string {
  const lines: string[] = [];
  lines.push("# TeamTalk status");
  lines.push("");
  if (!state.stewardAgentId) {
    lines.push("No steward bound. Run `/teamtalk init` or `/teamtalk enable <agent-id>`.");
    return lines.join("\n");
  }
  const memDir = findStewardMemoryDir(state);
  const bundleDir = findStewardBundleDir(state);
  const rulesFile = findStewardRulesFile(state);
  lines.push(
    `- Steward agent: ${state.stewardAgentName || "(unnamed)"} (${state.stewardAgentId})`,
  );
  lines.push(`- Local MemFS dir: ${memDir ? formatDisplayPath(memDir, cwd) : "(not found on disk)"}`);
  lines.push(`- OKF bundle: ${bundleDir ? formatDisplayPath(bundleDir, cwd) : "(missing)"}`);
  lines.push(
    `- Rules file: ${rulesFile ? formatDisplayPath(rulesFile, cwd) : "(missing)"}`,
  );
  lines.push(`- Concepts in bundle: ${countConcepts(bundleDir)}`);
  lines.push(`- Last sync: ${state.lastSyncAt || "(never)"}`);
  return lines.join("\n");
}

// ============================================================================
// Argument parsing
// ============================================================================

function parseSubcommand(args: string): ParsedArgs {
  const trimmed = args.trim();
  if (!trimmed) return { sub: "help", rest: "" };
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx < 0) return { sub: trimmed.toLowerCase(), rest: "" };
  return {
    sub: trimmed.slice(0, spaceIdx).toLowerCase(),
    rest: trimmed.slice(spaceIdx + 1).trim(),
  };
}

function parseFlags(rest: string): ParsedFlags {
  // Use Node's built-in util.parseArgs to tokenize the arg string into
  // flags and positionals. We declare every flag the mod accepts as a
  // typed option; util.parseArgs handles --name George, --name=George,
  // --confirm, and repeated flags correctly without custom code.
  if (!rest.trim()) return { positional: "", flags: {} };
  // Tokenize the same way util.parseArgs does: split on whitespace,
  // respecting double-quoted strings.
  const tokens = rest.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const parsed = parseArgs({
    args: tokens,
    options: {
      name: { type: "string" },
      limit: { type: "string" },
      description: { type: "string" },
      confirm: { type: "boolean" },
      yes: { type: "boolean" },
      y: { type: "boolean" },
      force: { type: "boolean" },
      reseed: { type: "boolean" },
    },
    strict: false,
    allowPositionals: true,
  });
  const flags: Record<string, string> = {};
  for (const [key, val] of Object.entries(parsed.values)) {
    if (val === true) flags[key] = "true";
    else if (val === false) {
      // Absent boolean flag — skip.
    } else {
      flags[key] = String(val);
    }
  }
  return { positional: parsed.positionals.join(" "), flags };
}

function buildHelp(): string {
  return [
    "# TeamTalk commands",
    "",
    "- `/teamtalk init [--name <name>] [--confirm|--reseed]` — create a steward agent in your org (with confirmation) and seed its MemFS. Pass `--reseed` to re-seed the OKF bundle for an already-bound steward without recreating the agent.",
    "- `/teamtalk enable [agent-id]` — bind to an existing steward agent. Without ID, lists candidates tagged `teamtalk-steward`.",
    "- `/teamtalk disable` — clear the local binding.",
    "- `/teamtalk status` — show binding, steward ID, local MemFS path, OKF bundle root, concept count.",
    "- `/teamtalk search <query> [--limit N]` — search the steward's OKF bundle.",
    "- `/teamtalk propose` — open the proposal flow (use `teamtalk_propose` from the model for a structured write).",
    "- `/teamtalk debug` — self-check: list agents in the active org, list tagged agents, retrieve the bound steward, check local filesystem state. Use to diagnose org scoping and missing-agent issues.",
    "",
    "Tools available to the model:",
    "",
    "- `teamtalk_search(query, limit?)` — same as `/teamtalk search`.",
    "- `teamtalk_propose(type, title, proposed_path, body, tags?)` — send a PROPOSE_NEW_CONCEPT message to the steward.",
    "",
    "Note: the mod reads directly from the steward's local MemFS clone on every",
    "call. State (bundle path, last check) refreshes implicitly on each read.",
    "There is no manual sync command.",
  ].join("\n");
}

// ============================================================================
// Search output
// ============================================================================

function buildSearchOutput(query: string, hits: ConceptHit[], bundleDir: string): string {
  if (hits.length === 0) {
    return `No matches for "${query}" in ${relative(homedir(), bundleDir)}.`;
  }
  const lines: string[] = [];
  lines.push(`# teamtalk search: ${query}`);
  lines.push("");
  for (const hit of hits) {
    lines.push(`## ${hit.title}`);
    lines.push(`**Path:** \`${hit.conceptId}\``);
    if (hit.description) lines.push(`**Description:** ${hit.description}`);
    if (hit.tags.length) lines.push(`**Tags:** ${hit.tags.join(", ")}`);
    lines.push("");
    lines.push(hit.snippet);
    lines.push("");
  }
  return lines.join("\n");
}

// ============================================================================
// Command handlers
// ============================================================================

async function handleEnable(letta: any, rest: string): Promise<string> {
  const state = readState();
  const { positional, flags } = parseFlags(rest);
  if (state.stewardAgentId && !positional && !flags.force) {
    return `Already bound to ${state.stewardAgentName || state.stewardAgentId}.\nRun \`/teamtalk disable\` first to rebind, or pass --force.`;
  }
  if (!positional) {
    try {
      const response = await letta.client.agents.list({ tags: [STEWARD_TAG, "git-memory-enabled"], limit: 20 });
      const candidates: any[] = Array.isArray(response)
        ? response
        : response?.items || response?.data || [];
      if (!candidates.length) {
        return [
          `No agents tagged \`${STEWARD_TAG}\` found in your org.`,
          `Run \`/teamtalk init\` to create one, or pass an agent-id: \`/teamtalk enable <agent-id>\`.`,
        ].join("\n");
      }
      const lines = candidates.map((a: any) => `- ${a.name || "(unnamed)"} (${a.id})`);
      return [`# Candidates tagged \`${STEWARD_TAG}\`:`, "", ...lines].join("\n");
    } catch (err: any) {
      return `Failed to list agents: ${err?.message || String(err)}`;
    }
  }
  const agentId = positional.trim();
  try {
    const agent = await letta.client.agents.retrieve(agentId);
    writeState({
      stewardAgentId: agent.id,
      stewardAgentName: agent.name || null,
      lastSyncAt: state.lastSyncAt,
      bundlePath: state.bundlePath,
    });
    return `Bound to steward: ${agent.name || "(unnamed)"} (${agent.id}).`;
  } catch (err: any) {
    return `Failed to bind to ${agentId}: ${err?.message || String(err)}`;
  }
}

function handleDisable(): string {
  writeState(emptyState());
  return "TeamTalk binding cleared.";
}

function handleStatus(cwd: string): string {
  return formatStatus(readState(), cwd);
}

// ============================================================================
// Rules rendering (turn_start injection source)
// ============================================================================

function renderRulesFile(bundleDir: string, rulesRelDir: string = "rules/global"): string {
  // Walk <bundleDir>/<rulesRelDir>/*.md, parse frontmatter + body, render
  // a compact summary suitable for projection into the steward's system
  // prompt. One section per rule.
  const rulesDir = join(bundleDir, rulesRelDir);
  if (!existsSync(rulesDir)) return "";
  const files = walkMarkdownFiles(rulesDir);
  const entries: { relPath: string; title: string; description: string; tags: string[] }[] = [];
  for (const f of files) {
    const { frontmatter, body } = parseFrontmatter(f.content);
    if (frontmatter.type !== "Rule") continue;
    const relPath = relative(bundleDir, f.path).replace(/\.md$/, "");
    const heading = body.match(/^#\s+(.+)/m);
    entries.push({
      relPath,
      title: frontmatter.title || heading?.[1]?.trim() || relPath,
      description: frontmatter.description || "",
      tags: frontmatter.tags || [],
    });
  }
  if (entries.length === 0) return "";
  entries.sort((a, b) => a.relPath.localeCompare(b.relPath));
  // Wrap with OKF-compliant YAML frontmatter so the steward's
  // pre-commit hook (which validates frontmatter on every .md in
  // memory) accepts the rendered summary file. Allowed keys per the
  // hook: description, read_only, limit. We need a non-empty
  // description.
  const lines: string[] = [
    "---",
    "description: The team's always-on global rules, linking to full OKF concepts.",
    "---",
    "",
    "# Global Rules",
    "",
    "These are the team's always-on rules. Each entry links to the full concept in the OKF bundle.",
    "",
  ];
  for (const e of entries) {
    lines.push(`## ${e.title}`);
    lines.push(`**Path:** \`${e.relPath}\``);
    if (e.description) lines.push(`**Description:** ${e.description}`);
    if (e.tags.length) lines.push(`**Tags:** ${e.tags.join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

function writeRulesFile(memDir: string, rulesContent: string): { written: boolean; path: string; ruleCount: number } {
  if (!rulesContent) return { written: false, path: "", ruleCount: 0 };
  const rulesPath = join(memDir, "system", "rules.md");
  try {
    mkdirSync(join(memDir, "system"), { recursive: true });
    writeFileSync(rulesPath, rulesContent);
    // Count rules in the rendered output.
    const ruleCount = (rulesContent.match(/^## /gm) || []).length;
    return { written: true, path: rulesPath, ruleCount };
  } catch (err: any) {
    return { written: false, path: "", ruleCount: 0 };
  }
}

async function handleSearch(rest: string): Promise<string> {
  const state = readState();
  if (!state.stewardAgentId) {
    return "No steward bound. Run `/teamtalk init` or `/teamtalk enable <agent-id>` first.";
  }
  const bundleDir = findStewardBundleDir(state);
  if (!bundleDir) {
    const memDir = findStewardMemoryDir(state);
    return memDir
      ? `Steward MemFS found at ${memDir} but no \`team/\` bundle directory exists yet.\nRun \`/teamtalk sync\` or check the steward's init.`
      : `Steward local MemFS not found on disk. Ensure the steward agent has been cloned locally.`;
  }
  const { positional, flags } = parseFlags(rest);
  const query = positional.trim();
  if (!query) return "Usage: `/teamtalk search <query>`";
  const limit = Math.max(
    1,
    Math.min(50, Number.parseInt(flags.limit || `${SEARCH_DEFAULT_LIMIT}`, 10) || SEARCH_DEFAULT_LIMIT),
  );
  const hits = keywordSearch(bundleDir, query, limit);
  return buildSearchOutput(query, hits, bundleDir);
}

async function handlePropose(letta: any, rest: string, ctx: any): Promise<string> {
  const state = readState();
  if (!state.stewardAgentId) {
    return "No steward bound. Run `/teamtalk init` or `/teamtalk enable <agent-id>` first.";
  }
  const { positional } = parseFlags(rest);
  if (!positional) {
    return [
      "Usage: `/teamtalk propose <type>:<title>:<path>:<body>` or call `teamtalk_propose` from the model.",
      "",
      "Recommended: ask the model to call `teamtalk_propose` with structured args.",
    ].join("\n");
  }
  const secretHit = containsSecret(positional);
  if (secretHit) {
    return `Refused: proposal body matches secret pattern (${secretHit}). Remove sensitive content and try again.`;
  }
  const message = [
    "PROPOSE_NEW_CONCEPT",
    `type: <unknown; please interpret>`,
    `title: <unknown; please interpret>`,
    `proposed_path: <unknown; please interpret>`,
    "body: |",
    positional.split("\n").map((l) => `  ${l}`).join("\n"),
    `source_agent: ${ctx?.agent?.id || "unknown"}`,
  ].join("\n");
  try {
    const response = await letta.client.agents.messages.create(state.stewardAgentId, {
      messages: [{ role: "user", content: message }],
    });
    const messages: any[] = response?.messages || [];
    const last = messages.filter((m) => m.message_type === "assistant_message").pop();
    return last?.content || "Proposal sent to steward (no assistant message in response).";
  } catch (err: any) {
    return `Failed to send proposal: ${err?.message || String(err)}`;
  }
}

// ============================================================================
// Init: create steward + seed MemFS
// ============================================================================

function readAsset(relativePath: string): string | null {
  const full = join(ASSETS_DIR, relativePath);
  if (!existsSync(full)) return null;
  try {
    return readFileSync(full, "utf8");
  } catch {
    return null;
  }
}

function listAssetFiles(subdir: string): string[] {
  const root = join(ASSETS_DIR, subdir);
  if (!existsSync(root)) return [];
  const out: string[] = [];
  function walk(dir: string, prefix: string): void {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        walk(full, `${prefix}${entry}/`);
      } else {
        out.push(`${prefix}${entry}`);
      }
    }
  }
  walk(root, "");
  return out;
}

async function handleInit(letta: any, rest: string): Promise<string> {
  const state = readState();
  if (state.stewardAgentId && !rest.includes("--force") && !rest.includes("--reseed")) {
    return `Already bound to ${state.stewardAgentName || state.stewardAgentId}.\nRun \`/teamtalk disable\` first to rebind, or pass --force.`;
  }

  const { flags } = parseFlags(rest);
  const name = flags.name || "teamtalk-steward";
  const confirmed = flags.confirm === "true" || flags.yes === "true" || flags.y === "true";

  // --reseed: re-seed the OKF bundle for an already-bound steward without
  // recreating the agent. Useful when the MemFS clone landed late or was
  // wiped.
  if (flags.reseed === "true" || flags.reseed === "yes") {
    if (!state.stewardAgentId) {
      return "No steward bound. Run `/teamtalk init --confirm` first.";
    }
    const home = process.env.HOME || homedir();
    const memDir = join(home, ".letta", "agents", state.stewardAgentId, "memory");
    const bundleDir = join(memDir, TEAM_BUNDLE_DIRNAME);
    if (!existsSync(memDir)) {
      // Try to pull the local clone via the CLI before giving up.
      try {
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execFileAsync = promisify(execFile);
        await execFileAsync(
          "letta",
          ["memory", "pull", "--agent", state.stewardAgentId],
          { timeout: 25_000 },
        );
      } catch (err: any) {
        return `Steward MemFS dir not found on disk: ${memDir}\nletta memory pull failed: ${err?.message || err}\nRun \`letta memory pull --agent ${state.stewardAgentId}\` manually, then re-run.`;
      }
      if (!existsSync(memDir)) {
        return `letta memory pull succeeded but MemFS dir still missing: ${memDir}\nInvestigate manually.`;
      }
    }
    let seededFiles = 0;
    const assetFiles = listAssetFiles("team");
    for (const rel of assetFiles) {
      const src = join(ASSETS_DIR, "team", rel);
      const dst = join(bundleDir, rel);
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      seededFiles += 1;
    }
    // Render rules.md so turn_start has something to read.
    let rulesNote = "";
    const rulesContent = renderRulesFile(bundleDir);
    if (rulesContent) {
      const result = writeRulesFile(memDir, rulesContent);
      if (result.written) {
        rulesNote = `Wrote ${result.ruleCount} rules to ${result.path}`;
      }
    }
    // Refresh the persona block in case it drifted. Schema and rules
    // live in the OKF bundle, not as memory blocks.
    let personaNote = "";
    const personaAsset = readAsset("steward-persona.md");
    if (personaAsset) {
      try {
        await letta.client.agents.blocks.update("persona", {
          agent_id: state.stewardAgentId,
          value: personaAsset,
        });
        personaNote = "Refreshed persona memory block.";
      } catch (err: any) {
        personaNote = `Failed to refresh persona: ${err?.message || err}`;
      }
    }

    // Reattach steward read tools in case they got removed (e.g. a
    // chat session drifted the agent's tool set). Idempotent — attach
    // is a no-op when the tool is already present.
    let toolsNote = "";
    try {
      const toolResult = await attachStewardReadTools(letta, state.stewardAgentId);
      if (toolResult.attached.length > 0) {
        toolsNote = `Attached ${toolResult.attached.length} read tools (${toolResult.attached.join(", ")}).`;
      }
      if (toolResult.failed.length > 0) {
        toolsNote += (toolsNote ? " " : "") +
          `Failed: ${toolResult.failed.join("; ")}.`;
      }
    } catch (err: any) {
      toolsNote = `Tool attach failed: ${err?.message || err}`;
    }

    writeState({ ...state, bundlePath: bundleDir, lastSyncAt: new Date().toISOString() });
    return [
      "# TeamTalk reseed",
      "",
      `- MemFS dir: ${memDir}`,
      `- OKF bundle: ${bundleDir}`,
      `- Seeded ${seededFiles} files.`,
      rulesNote ? `- ${rulesNote}` : "",
      personaNote ? `- ${personaNote}` : "",
      toolsNote ? `- ${toolsNote}` : "",
    ].join("\n");
  }
  if (!confirmed) {
    const summary = [
      "# TeamTalk init (preview — not yet run)",
      "",
      "This will:",
      "  1. Create a new agent named `" + name + "` in your Letta org.",
      "  2. Tag it with `teamtalk-steward`.",
      "  3. Seed its MemFS with the steward persona and OKF bundle.",
      "  4. Attach the steward read toolset (open_files, grep_files, etc.)",
      "     so it can navigate the bundle when answering questions.",
      "  5. Bind this install to the new agent.",
      "",
      "Re-run with `--confirm` to proceed:",
      "  /teamtalk init --name " + name + " --confirm",
    ].join("\n");
    return summary;
  }

  // Verify assets are present.
  const persona = readAsset("steward-persona.md");
  const schema = readAsset("steward-schema.md");
  const rules = readAsset("steward-rules.md");
  if (!persona || !schema || !rules) {
    return `Missing steward bootstrap assets under ${ASSETS_DIR}.\nReinstall the mod package.`;
  }

  try {
    const debugLog: string[] = [];
    // Local dlog mirrors to the per-init debug array (rendered in
    // the user-facing message) and forwards to the module-level
    // dlog for the persistent file log.
    const dlog = (line: string) => {
      debugLog.push(line);
      // Forward to module-level dlog (defined above) for the file log.
      try {
        const logPath = join(homedir(), ".letta", "mods", "teamtalk-debug.log");
        writeFileSync(logPath, `[teamtalk-init] ${line}\n`, { flag: "a" });
      } catch {}
    };
    dlog(`init start: name=${name}`);

    // Use the letta CLI to create the agent. The CLI sets up MemFS,
    // pre-populates persona.md, and applies the right tags automatically.
    // The SDK path (letta.client.agents.create) does NOT do this — it
    // creates a half-baked agent with no local clone.
    const { execFile: execFileCb } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFileCb);
    const tagsArg = `${STEWARD_TAG},git-memory-enabled`;
    const modelHandle = process.env.TEAMTALK_STEWARD_MODEL || "letta/auto";
    let cliStdout = "";
    let cliStderr = "";
    try {
      const result = await execFileAsync(
        "letta",
        [
          "agents", "create",
          "--name", name,
          "--tags", tagsArg,
          "--model", modelHandle,
          "--pinned",
          "--description", "TeamTalk organizational memory steward",
        ],
        { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
      );
      cliStdout = result.stdout;
      cliStderr = result.stderr;
      dlog(`letta agents create OK, ${cliStdout.length} bytes stdout`);
    } catch (err: any) {
      cliStderr = err?.stderr || err?.message || String(err);
      cliStdout = err?.stdout || "";
      dlog(`letta agents create FAILED: ${cliStderr.slice(0, 500)}`);
      return [
        "# TeamTalk init FAILED",
        "",
        `\`letta agents create\` failed: ${cliStderr.slice(0, 500)}`,
        "",
        "The mod requires the letta CLI to be on PATH. Verify with `which letta`.",
        "Debug log: ~/.letta/mods/teamtalk-debug.log",
      ].join("\n");
    }

    // Parse the agent id from the JSON output.
    let candidateId: string | null = null;
    try {
      const parsed = JSON.parse(cliStdout);
      candidateId = parsed?.id || null;
    } catch {
      const m = cliStdout.match(/"id":\s*"(agent-[0-9a-f-]+)"/);
      if (m) candidateId = m[1];
    }
    if (!candidateId || !candidateId.startsWith("agent-")) {
      dlog(`could not parse agent id from CLI output`);
      return [
        "# TeamTalk init FAILED",
        "",
        `Could not parse agent id from \`letta agents create\` output.`,
        `stdout (first 500 chars): ${cliStdout.slice(0, 500)}`,
        "",
        "Debug log: ~/.letta/mods/teamtalk-debug.log",
      ].join("\n");
    }
    dlog(`parsed agent id: ${candidateId}`);

    // Verify via the SDK that we can actually see this agent in the
    // session's org. If retrieve fails, the agent is in a different org
    // than we're bound to.
    let verified = false;
    let verifyError: string | null = null;
    try {
      const retrieved = await letta.client.agents.retrieve(candidateId);
      dlog(`retrieve OK: id=${retrieved?.id} name=${JSON.stringify(retrieved?.name)}`);
      verified = true;
    } catch (err: any) {
      verifyError = err?.message || String(err);
      dlog(`retrieve FAIL: ${verifyError}`);
    }
    if (!verified) {
      return [
        "# TeamTalk init FAILED",
        "",
        `Created agent ${candidateId} but cannot retrieve it: ${verifyError}`,
        "The agent may have been created in a different org than this session is bound to.",
        "Run `/teamtalk debug` to inspect the org context.",
        "",
        "Debug log: ~/.letta/mods/teamtalk-debug.log",
      ].join("\n");
    }

    const displayName = name;

    // The CLI's `agents create` does NOT materialize the local MemFS
    // clone. That only happens when a user-agent session opens with the
    // agent. Run `letta --agent <id>` in the background using spawn;
    // it reads no stdin (stdio: "ignore"), and the harness exits
    // promptly on a no-TTY invocation. Wait for the clone to appear,
    // then seed the OKF bundle.
    const home = process.env.HOME || homedir();
    const memDir = join(home, ".letta", "agents", candidateId, "memory");
    const bundleDir = join(memDir, TEAM_BUNDLE_DIRNAME);
    try {
      const { spawn: spawnCb } = await import("node:child_process");
      const child = spawnCb(
        "letta",
        ["--agent", candidateId],
        { stdio: "ignore", detached: true },
      );
      child.unref();
      dlog(`spawned letta --agent ${candidateId} pid=${child.pid ?? "?"}`);
    } catch (err: any) {
      dlog(`background letta --agent failed to spawn: ${err?.message || err}`);
    }
    let memDirFound = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      if (existsSync(memDir)) {
        memDirFound = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    dlog(`memDir present after init: ${memDirFound}`);
    let seededFiles = 0;
    if (memDirFound) {
      const assetFiles = listAssetFiles("team");
      for (const rel of assetFiles) {
        const src = join(ASSETS_DIR, "team", rel);
        const dst = join(bundleDir, rel);
        try {
          mkdirSync(dirname(dst), { recursive: true });
          copyFileSync(src, dst);
          seededFiles += 1;
        } catch (err: any) {
          dlog(`seed error for ${rel}: ${err?.message || err}`);
        }
      }
    }
    dlog(`memDir present at init: ${memDirFound}, seeded: ${seededFiles}`);

    // Render rules.md from OKF bundle so turn_start has something to read.
    let rulesNote = "";
    let rulesContent = "";
    if (memDirFound) {
      rulesContent = renderRulesFile(bundleDir);
      if (rulesContent) {
        const result = writeRulesFile(memDir, rulesContent);
        if (result.written) {
          rulesNote = `Wrote ${result.ruleCount} rules to ${result.path}`;
          dlog(`rules file written: ${result.path} (${result.ruleCount} rules)`);
        }
      }
    }

    // Push the steward persona block to the agent's memory via the
    // SDK. `letta agents create --pinned` pre-populates persona and
    // human blocks with the Letta Code default persona; we overwrite
    // persona with our steward-specific content so George responds as
    // an organizational memory steward rather than a generic coding
    // assistant. The schema and rules live in the OKF bundle under
    // `team/` and `system/rules.md`; we don't duplicate them as
    // memory blocks (the steward reads them from disk on demand).
    let personaNote = "";
    const personaAsset = readAsset("steward-persona.md");
    if (personaAsset) {
      try {
        await letta.client.agents.blocks.update("persona", {
          agent_id: candidateId,
          value: personaAsset,
        });
        personaNote = "Updated persona memory block.";
        dlog(`updated steward persona block`);
      } catch (err: any) {
        personaNote = `Failed to update persona block: ${err?.message || err}`;
        dlog(`persona update failed: ${err?.message || err}`);
      }
    } else {
      personaNote = "Steward persona not updated (asset missing).";
    }

    // Attach the steward read tools (any letta_files_core tool except
    // write/edit by name match) so the steward can navigate the OKF
    // bundle when answering questions. We do NOT attach write tools
    // because Letta Code 0.27.x doesn't expose Write in this org's
    // letta_files_core registry — writes happen via the mod's
    // teamtalk_propose tool.
    let toolsNote = "";
    try {
      const toolResult = await attachStewardReadTools(letta, candidateId);
      if (toolResult.attached.length > 0) {
        toolsNote = `Attached ${toolResult.attached.length} read tools (${toolResult.attached.join(", ")}).`;
      }
      if (toolResult.failed.length > 0) {
        toolsNote += (toolsNote ? " " : "") +
          `Failed: ${toolResult.failed.join("; ")}.`;
      }
      dlog(`steward read tools: ${toolResult.attached.join(",")} attached; ${toolResult.failed.join(";")} failed`);
    } catch (err: any) {
      toolsNote = `Tool attach failed: ${err?.message || err}`;
      dlog(`tool attach failed: ${err?.message || err}`);
    }

    const seedNote = memDirFound
      ? seededFiles > 0
        ? `Seeded ${seededFiles} bundle files.`
        : "Bundle directory present but no files seeded; run `/teamtalk init --reseed` to retry."
      : `MemFS clone not yet local. Run \`/teamtalk init --reseed\` once \`${memDir}\` exists.`;

    // Persist binding state before returning. Even if memDirFound is
    // false (clone not yet materialized), we still want the binding
    // written so the user can run `/teamtalk init --reseed` without
    // first re-binding via enable.
    writeState({
      stewardAgentId: candidateId,
      stewardAgentName: displayName,
      lastSyncAt: new Date().toISOString(),
      bundlePath: memDirFound && existsSync(bundleDir) ? bundleDir : null,
    });
    dlog(`init binding written: steward=${candidateId} bundlePath=${memDirFound ? bundleDir : "(not yet)"}`);

    return [
      "# TeamTalk steward created",
      "",
      `- Agent: ${displayName} (${candidateId})`,
      `- Tagged: ${STEWARD_TAG}`,
      `- Verified: retrieve succeeded`,
      `- MemFS dir: ${memDir} (${memDirFound ? "present" : "not yet present"})`,
      `- ${seedNote}`,
      rulesNote ? `- ${rulesNote}` : "",
      personaNote ? `- ${personaNote}` : "",
      toolsNote ? `- ${toolsNote}` : "",
      "",
      "Debug:",
      ...debugLog.map((l) => `  ${l}`),
      "",
      "Next: run `/teamtalk status` to verify, or `/teamtalk search` to exercise the read path.",
    ].join("\n");
  } catch (err: any) {
    const msg = err?.message || String(err);
    try {
      const logPath = join(homedir(), ".letta", "mods", "teamtalk-debug.log");
      writeFileSync(logPath, `[teamtalk-init] EXCEPTION: ${msg}\n${err?.stack || ""}\n`, { flag: "a" });
    } catch {}
    return `Failed to create steward: ${msg}\nDebug log: ~/.letta/mods/teamtalk-debug.log`;
  }
}

// ============================================================================
// Debug self-check
// ============================================================================

async function handleDebug(letta: any): Promise<string> {
  const lines: string[] = [];
  lines.push("# TeamTalk debug");
  lines.push("");
  const state = readState();
  lines.push(`Local state file: ${formatDisplayPath(STATE_PATH, "/")}`);
  lines.push(`State: ${JSON.stringify(state, null, 2)}`);
  lines.push("");

  // 1. Try to list agents to verify API connectivity.
  lines.push("## API check");
  try {
    const response = await letta.client.agents.list({ limit: 3 });
    const items: any[] = Array.isArray(response) ? response : response?.items || response?.data || [];
    lines.push(`list({ limit: 3 }) returned ${items.length} agent(s):`);
    for (const a of items.slice(0, 3)) {
      lines.push(`  - id=${a.id} name=${JSON.stringify(a.name)} tags=${JSON.stringify(a.tags)}`);
    }
  } catch (err: any) {
    lines.push(`list FAILED: ${err?.message || String(err)}`);
  }
  lines.push("");

  // 2. Try to list agents with the teamtalk-steward tag.
  lines.push("## Tagged agents");
  try {
    const response = await letta.client.agents.list({ tags: [STEWARD_TAG], limit: 10 });
    const items: any[] = Array.isArray(response) ? response : response?.items || response?.data || [];
    lines.push(`list({ tags: [${STEWARD_TAG}] }) returned ${items.length} agent(s):`);
    for (const a of items) {
      lines.push(`  - id=${a.id} name=${JSON.stringify(a.name)}`);
    }
  } catch (err: any) {
    lines.push(`list by tag FAILED: ${err?.message || String(err)}`);
  }
  lines.push("");

  // 3. Try to retrieve the bound steward, if any.
  if (state.stewardAgentId) {
    lines.push(`## Bound steward: ${state.stewardAgentId}`);
    try {
      const agent = await letta.client.agents.retrieve(state.stewardAgentId);
      lines.push(`retrieve OK: id=${agent.id} name=${JSON.stringify(agent.name)}`);
    } catch (err: any) {
      lines.push(`retrieve FAILED: ${err?.message || String(err)}`);
      lines.push(`This means the bound agent id is not accessible from this session's org.`);
    }
  } else {
    lines.push("## No steward bound");
  }
  lines.push("");

  // 4. Local filesystem checks.
  lines.push("## Local filesystem");
  const home = process.env.HOME || homedir();
  lines.push(`HOME: ~`);
  for (const p of candidateStewardMemoryPaths(state)) {
    lines.push(`  ${existsSync(p) ? "EXISTS" : "missing"}: ${formatDisplayPath(p, "/")}`);
  }
  if (state.stewardAgentId) {
    const memDir = join(home, ".letta", "agents", state.stewardAgentId, "memory");
    const bundleDir = join(memDir, TEAM_BUNDLE_DIRNAME);
    lines.push(`  ${existsSync(memDir) ? "EXISTS" : "missing"}: ${formatDisplayPath(memDir, "/")}`);
    lines.push(`  ${existsSync(bundleDir) ? "EXISTS" : "missing"}: ${formatDisplayPath(bundleDir, "/")}`);
  }
  return lines.join("\n");
}

// ============================================================================
// activate
// ============================================================================

export default function activate(letta: any) {
  const disposers: Array<() => void> = [];

  // -- /teamtalk command --
  if (letta.capabilities.commands) {
    disposers.push(
      letta.commands.register({
        id: "teamtalk",
        description: "TeamTalk — shared team knowledge base (init, enable, status, search, propose)",
        async run(ctx: any) {
          const { sub, rest } = parseSubcommand(String(ctx.args || ""));
          // Diagnostic logging — write to stderr and a local file so we can
          // see what happened even if the TUI doesn't render output.
          const logLine = `[teamtalk] sub=${sub} rest=${JSON.stringify(rest)}\n`;
          try { process.stderr.write(logLine); } catch {}
          try {
            const logPath = join(homedir(), ".letta", "mods", "teamtalk-debug.log");
            mkdirSync(dirname(logPath), { recursive: true });
            writeFileSync(logPath, logLine, { flag: "a" });
          } catch {}
          try {
            let result: string;
            switch (sub) {
              case "init":
                result = await handleInit(letta, rest);
                break;
              case "enable":
                result = await handleEnable(letta, rest);
                break;
              case "disable":
                result = handleDisable();
                break;
              case "status":
                result = handleStatus(ctx.cwd);
                break;
              case "search":
                result = await handleSearch(rest);
                break;
              case "propose":
                result = await handlePropose(letta, rest, ctx);
                break;
              case "debug":
                result = await handleDebug(letta);
                break;
              case "help":
              default:
                result = buildHelp();
                break;
            }
            try {
              const okLine = `[teamtalk] result (${result.length} chars): ${result.slice(0, 200)}\n`;
              process.stderr.write(okLine);
              const logPath = join(homedir(), ".letta", "mods", "teamtalk-debug.log");
              writeFileSync(logPath, okLine, { flag: "a" });
            } catch {}
            return { type: "output", output: result };
          } catch (err: any) {
            const errMsg = `Error: ${err?.message || String(err)}\n${err?.stack || ""}`;
            try {
              const errLine = `[teamtalk] error: ${errMsg.slice(0, 500)}\n`;
              process.stderr.write(errLine);
              const logPath = join(homedir(), ".letta", "mods", "teamtalk-debug.log");
              writeFileSync(logPath, errLine, { flag: "a" });
            } catch {}
            return { type: "output", output: `Error: ${err?.message || String(err)}` };
          }
        },
      }),
    );
  }

  // -- teamtalk_search tool --
  if (letta.capabilities.tools) {
    disposers.push(
      letta.tools.register({
        name: "teamtalk_search",
        description:
          "Search the team's shared knowledge corpus (OKF bundle in the steward agent's MemFS) " +
          "for rules, playbooks, decisions, or conventions. Use before non-trivial implementation " +
          "work, when the user asks about team process, or when a relevant rule may exist.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            limit: { type: "number", description: "Max results (default 8)" },
          },
          required: ["query"],
          additionalProperties: false,
        },
        requiresApproval: false,
        parallelSafe: true,
        async run(ctx: any) {
          const query = String(ctx.args?.query || "").trim();
          const limit = Math.max(
            1,
            Math.min(50, Number.parseInt(String(ctx.args?.limit || SEARCH_DEFAULT_LIMIT), 10) || SEARCH_DEFAULT_LIMIT),
          );
          if (!query) {
            return { status: "error", content: "query is required" };
          }
          const state = readState();
          if (!state.stewardAgentId) {
            return { status: "error", content: "No steward bound. Run /teamtalk init or /teamtalk enable." };
          }
          const bundleDir = findStewardBundleDir(state) || state.bundlePath;
          if (!bundleDir || !existsSync(bundleDir)) {
            return { status: "error", content: "Steward OKF bundle not found on disk." };
          }
          // Refresh cached bundle path if it was missing.
          if (bundleDir !== state.bundlePath) {
            writeState({ ...state, bundlePath: bundleDir, lastSyncAt: new Date().toISOString() });
          }
          const hits = keywordSearch(bundleDir, query, limit);
          return buildSearchOutput(query, hits, bundleDir);
        },
      }),
    );

    // -- teamtalk_propose tool --
    disposers.push(
      letta.tools.register({
        name: "teamtalk_propose",
        description:
          "Propose adding a new concept to the team's shared knowledge base. " +
          "USE THIS WHEN the user wants to: add a new team rule, document a " +
          "playbook or runbook, record an architectural decision (ADR), create " +
          "a person page, or otherwise add structured content to the team's " +
          "OKF bundle. The proposal is sent to the steward agent, which " +
          "validates OKF conformance and policy (no secrets, no duplicates, " +
          "paths under team/) and commits to its own MemFS. The steward may " +
          "reject — treat a rejection as a revision request and adjust the " +
          "proposal. Do NOT use this for ephemeral notes, project state, or " +
          "anything that belongs on a per-user agent.",
        parameters: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["Rule", "Playbook", "Decision", "Person", "Reference"],
              description: "OKF concept type. " +
                "Rule: an always-on or event-triggered team convention. " +
                "Playbook: a runbook or procedure for handling a recurring task. " +
                "Decision: an architectural decision record (ADR). " +
                "Person: a team member page. " +
                "Reference: a pointer to an external asset or index.",
            },
            title: {
              type: "string",
              description: "Human-readable title. The steward converts this to a slug in the proposed_path if not supplied.",
            },
            proposed_path: {
              type: "string",
              description: "Target path under team/. Must start with 'team/' and end with '.md'. " +
                "Examples: 'team/rules/global/no-unused-imports.md', 'team/playbooks/incident-triage.md', " +
                "'team/decisions/2026-07-04-use-postgres.md', 'team/people/jane-doe.md'. " +
                "Conventional structure: team/<type-plural>/<slug>.md.",
            },
            body: {
              type: "string",
              description: "Markdown body. Use structural markdown — headings, lists, code blocks — not freeform prose. " +
                "OKF v0.1 conventional sections when applicable: '# Trigger' for rules, '# Steps' for playbooks, '# Schema' for resource references.",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Optional short tags for cross-cutting categorization (e.g. ['quality', 'typescript']).",
            },
          },
          required: ["type", "title", "proposed_path", "body"],
          additionalProperties: false,
        },
        requiresApproval: true,
        parallelSafe: false,
        async run(ctx: any) {
          const state = readState();
          if (!state.stewardAgentId) {
            return { status: "error", content: "No steward bound. Run /teamtalk init or /teamtalk enable." };
          }
          const type = String(ctx.args?.type || "");
          const title = String(ctx.args?.title || "");
          const proposedPath = String(ctx.args?.proposed_path || "");
          const body = String(ctx.args?.body || "");
          const tags = Array.isArray(ctx.args?.tags) ? ctx.args.tags.map(String) : [];

          if (!type || !title || !proposedPath || !body) {
            return { status: "error", content: "type, title, proposed_path, and body are required" };
          }
          if (!proposedPath.startsWith("team/") || !proposedPath.endsWith(".md")) {
            return {
              status: "error",
              content: "proposed_path must start with `team/` and end with `.md`",
            };
          }
          const secretHit = containsSecret(`${title}\n${body}`);
          if (secretHit) {
            return {
              status: "error",
              content: `Refused: proposal matches secret pattern (${secretHit}). Remove sensitive content.`,
            };
          }

          // Resolve the steward local MemFS clone path. State
          // usually has bundlePath populated; if not, derive it from
          // stewardAgentId.
          let memDir = state.bundlePath ? dirname(state.bundlePath) : null;
          if (!memDir && state.stewardAgentId) {
            memDir = join(homedir(), ".letta", "agents", state.stewardAgentId, "memory");
          }
          if (!memDir || !existsSync(memDir)) {
            return {
              status: "error",
              content: `Steward local MemFS clone not found at ${memDir || "(unknown)"}. Run /teamtalk init --reseed to set up.`,
            };
          }
          const bundleDir = join(memDir, "team");
          if (!existsSync(bundleDir)) {
            return {
              status: "error",
              content: `OKF bundle directory not found at ${bundleDir}. Run /teamtalk init --reseed.`,
            };
          }
          const targetFile = join(memDir, proposedPath);
          // Path traversal guard: the resolved file must be inside
          // the bundle directory.
          if (!targetFile.startsWith(bundleDir + "/") && targetFile !== bundleDir) {
            return {
              status: "error",
              content: `Refused: proposed_path resolves outside the team/ bundle (${targetFile}).`,
            };
          }
          // Duplicate guard: existing concept files in the bundle
          // block writes unless the user re-issues the same proposal.
          if (existsSync(targetFile)) {
            return {
              status: "error",
              content: `Refused: ${proposedPath} already exists in the bundle. Use PROPOSE_EDIT instead.`,
            };
          }

          // Build the OKF-compliant concept file: YAML frontmatter
          // with required `type`, optional title/description/tags/
          // timestamp, followed by the markdown body.
          const frontmatterLines = [
            "---",
            `type: ${type}`,
            `title: ${title}`,
            `description: ${""}`, // no description provided by caller; OKF allows absent
            `tags: [${tags.join(", ")}]`,
            `timestamp: ${new Date().toISOString()}`,
            "---",
          ];
          const fileContent = frontmatterLines.join("\n") + "\n\n" + body.trimEnd() + "\n";

          try {
            mkdirSync(dirname(targetFile), { recursive: true });
            writeFileSync(targetFile, fileContent, "utf8");
          } catch (err: any) {
            return { status: "error", content: `Failed to write file: ${err?.message || String(err)}` };
          }

          // Append to team/log.md.
          const logFile = join(bundleDir, "log.md");
          try {
            const dateStr = new Date().toISOString().slice(0, 10);
            const logEntry = `\n## ${dateStr}\n* **Creation**: Added [${title}](/${proposedPath}) (proposed via teamtalk_propose).\n`;
            if (existsSync(logFile)) {
              const existing = readFileSync(logFile, "utf8");
              writeFileSync(logFile, existing + logEntry, "utf8");
            } else {
              writeFileSync(logFile, `# Directory Update Log\n${logEntry}`, "utf8");
            }
          } catch (err: any) {
            // Non-fatal: log append failure shouldn't block the commit.
            dlog(`log append failed: ${err?.message || err}`);
          }

          // If this is a global rule, re-render system/rules.md so
          // the new rule shows up in turn_start injection.
          let rulesNote = "";
          if (proposedPath.startsWith("team/rules/global/") && proposedPath.endsWith(".md")) {
            try {
              const rulesContent = renderRulesFile(bundleDir);
              if (rulesContent) {
                const result = writeRulesFile(memDir, rulesContent);
                if (result.written) {
                  rulesNote = ` Updated rules.md (${result.ruleCount} rules).`;
                }
              }
            } catch (err: any) {
              dlog(`rules re-render failed: ${err?.message || err}`);
            }
          }

          // Commit the change via plain git in the steward's local MemFS
          // clone. The `letta memory` CLI has no commit subcommand
          // (`letta memory --help` confirms: "Memory is git-backed.
          // Use git commands for commit/push."), so we shell out to
          // `git add <files> && git commit`. We use `git -C memDir`
          // to scope to the steward's repo without changing our cwd.
          //
          // Stage ONLY the files this proposal touched — never
          // `git add .`. Any unrelated dirty files (e.g. earlier
          // uncommitted writes from another tool, secrets left in
          // memory, partially-applied updates) would otherwise be
          // swept into our commit and published. If `git status`
          // reports other dirty files, refuse and ask the user to
          // resolve them first.
          let commitNote = "";
          try {
            const { execFile } = await import("node:child_process");
            const { promisify } = await import("node:util");
            const execFileP = promisify(execFile);
            const commitEnv = {
              ...process.env,
              GIT_AUTHOR_NAME: "teamtalk-mod",
              GIT_AUTHOR_EMAIL: "teamtalk@letta.local",
              GIT_COMMITTER_NAME: "teamtalk-mod",
              GIT_COMMITTER_EMAIL: "teamtalk@letta.local",
            };

            // Build the list of paths to stage. Always include the
            // proposed concept file and the log update. Include
            // system/rules.md only when the proposal wrote it.
            const touchedPaths = [proposedPath, "team/log.md"];
            if (rulesNote) touchedPaths.push("system/rules.md");

            // Inspect full repo status to detect unrelated dirty
            // files. If any exist, refuse the commit and surface
            // them to the caller.
            const statusOut = (await execFileP("git", ["-C", memDir, "status", "--porcelain"], {
              timeout: 10000,
            })).stdout;
            const dirtyPaths: string[] = [];
            for (const line of statusOut.split("\n")) {
              if (!line.trim()) continue;
              // porcelain format: XY <space> <path> (or "XY <space> <old> -> <new>" for renames)
              const m = line.match(/^..\s+(.+?)(?:\s+->\s+.+)?$/);
              if (!m) continue;
              let p = m[1];
              if (p.startsWith('"') && p.endsWith('"')) p = JSON.parse(p);
              dirtyPaths.push(p);
            }
            // Files we expect to be dirty from this proposal:
            const expectedSet = new Set(touchedPaths);
            const unexpected = dirtyPaths.filter((p) => !expectedSet.has(p));
            if (unexpected.length > 0) {
              const errMsg = `Refused to commit: ${unexpected.length} unrelated dirty file(s) in steward MemFS (${unexpected.slice(0, 5).join(", ")}${unexpected.length > 5 ? ", ..." : ""}). Resolve them via git status in ${memDir} before retrying.`;
              dlog(`unexpected dirty paths: ${unexpected.join(", ")}`);
              return { status: "error", content: errMsg };
            }

            // Stage exactly the touched paths.
            const commitMsg = `teamtalk_propose: add ${proposedPath} (${type})`;
            for (const p of touchedPaths) {
              try {
                await execFileP("git", ["-C", memDir, "add", "--", p], { timeout: 10000 });
              } catch (err: any) {
                const msg = err?.stderr || err?.message || String(err);
                // "did not match any files" is benign if a sibling
                // rule wasn't touched (e.g. log append was a no-op).
                if (!/did not match/i.test(msg)) throw err;
              }
            }
            // Commit. If there's nothing staged, that's a no-op.
            try {
              await execFileP(
                "git",
                ["-C", memDir, "commit", "-m", commitMsg, "--author=teamtalk-mod <teamtalk@letta.local>"],
                { timeout: 15000, env: commitEnv },
              );
              commitNote = " Committed to steward MemFS.";
              dlog(`git commit OK: ${commitMsg}`);
            } catch (err: any) {
              const msg = err?.stderr || err?.message || String(err);
              if (/nothing to commit/i.test(msg)) {
                commitNote = " (already committed).";
                dlog(`commit no-op: ${msg.slice(0, 200)}`);
              } else {
                throw err;
              }
            }
          } catch (err: any) {
            // Surface real commit failures (not 'nothing to commit')
            // as errors. Files are written on disk; the caller can
            // resolve manually with git status / git commit.
            const msg = err?.stderr || err?.message || String(err);
            dlog(`commit failed: ${msg.slice(0, 400)}`);
            return {
              status: "error",
              content: `Wrote ${proposedPath} to disk but git commit failed: ${msg.slice(0, 200)}. Resolve manually in ${memDir} and rerun.`,
            };
          }

          // Update local state lastSyncAt so /teamtalk status is fresh.
          writeState({ ...state, bundlePath: bundleDir, lastSyncAt: new Date().toISOString() });

          return {
            content: `Wrote ${proposedPath} (type: ${type}).${rulesNote}${commitNote}`,
          };
        },
      }),
    );
  }

  // -- turn_start: inject global rules as transient prefix --
  if (letta.capabilities.events?.turns) {
    disposers.push(
      letta.events.on("turn_start", (event: any) => {
        const state = readState();
        if (!state.stewardAgentId) return;
        const reminder = buildRulesReminder(state, event?.agentName || null);
        if (!reminder) return;
        const input = Array.isArray(event.input) ? event.input : [];
        // Prepend the system reminder as a user-role turn_start injection.
        // The harness treats prepended items as already-on-the-conversation context.
        return {
          input: [{ role: "user", content: reminder }, ...input],
        };
      }),
    );
  }

  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose();
      } catch {
        // ignore disposal errors
      }
    }
  };
}