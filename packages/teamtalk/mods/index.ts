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

// ============================================================================
// Constants
// ============================================================================

const STEWARD_TAG = "teamtalk-steward";
const STATE_PATH = join(homedir(), ".letta", "mods", "teamtalk.state.json");
const RULES_RELATIVE_PATH = "system/rules.md";
const TEAM_BUNDLE_DIRNAME = "team";
const DEFAULT_STEWARD_MODEL = "anthropic/claude-sonnet-4-5-20250929";
const DEFAULT_EMBEDDING = "openai/text-embedding-3-small";
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
  const candidates: string[] = [];
  if (process.env.MEMORY_DIR) candidates.push(process.env.MEMORY_DIR);
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
  lines.push(`- Local MemFS dir: ${memDir || "(not found on disk)"}`);
  lines.push(`- OKF bundle: ${bundleDir || "(missing)"}`);
  lines.push(
    `- Rules file: ${rulesFile ? relative(cwd, rulesFile) || rulesFile : "(missing)"}`,
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
  const tokens = rest.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (const token of tokens) {
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq > 0) {
        flags[token.slice(2, eq)] = token.slice(eq + 1).replace(/^"|"$/g, "");
      } else {
        flags[token.slice(2)] = "true";
      }
    } else {
      positional.push(token.replace(/^"|"$/g, ""));
    }
  }
  return { positional: positional.join(" "), flags };
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
      const response = await letta.client.agents.list({ tags: [STEWARD_TAG], limit: 20 });
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
  if (state.stewardAgentId && !rest.includes("--force")) {
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
      return `Steward MemFS dir not found on disk: ${memDir}\nWait for the clone to land, then re-run.`;
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
    writeState({ ...state, bundlePath: bundleDir, lastSyncAt: new Date().toISOString() });
    return [
      "# TeamTalk reseed",
      "",
      `- MemFS dir: ${memDir}`,
      `- OKF bundle: ${bundleDir}`,
      `- Seeded ${seededFiles} files.`,
    ].join("\n");
  }
  if (!confirmed) {
    const summary = [
      "# TeamTalk init (preview — not yet run)",
      "",
      "This will:",
      "  1. Create a new agent named `" + name + "` in your Letta org.",
      "  2. Tag it with `teamtalk-steward`.",
      "  3. Seed its MemFS with persona, schema, and starter rules memory blocks.",
      "  4. Bind this install to the new agent.",
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
    const dlog = (line: string) => {
      debugLog.push(line);
      try {
        const logPath = join(homedir(), ".letta", "mods", "teamtalk-debug.log");
        writeFileSync(logPath, `[teamtalk-init] ${line}\n`, { flag: "a" });
      } catch {}
    };
    dlog(`init start: name=${name}`);

    const agent = await letta.client.agents.create({
      name,
      model: DEFAULT_STEWARD_MODEL,
      embedding: DEFAULT_EMBEDDING,
      memory_blocks: [
        { label: "persona", value: persona },
        { label: "schema", value: schema },
        { label: "rules", value: rules },
      ],
      tags: [STEWARD_TAG],
    });

    dlog(`create response keys: ${Object.keys(agent || {}).sort().join(",")}`);
    dlog(`create response: ${JSON.stringify({
      id: agent?.id,
      name: agent?.name,
      tags: agent?.tags,
    })}`);

    // Verify the create actually produced a usable agent. If the response
    // shape is unexpected (e.g. an error envelope with an id field) or
    // retrieve fails, refuse to bind.
    const candidateId = agent?.id;
    if (!candidateId || typeof candidateId !== "string" || !candidateId.startsWith("agent-")) {
      const msg = `Agent create returned no usable id. Response: ${JSON.stringify(agent)}`;
      dlog(`FAIL: ${msg}`);
      return [
        "# TeamTalk init FAILED",
        "",
        msg,
        "",
        "Debug log: ~/.letta/mods/teamtalk-debug.log",
      ].join("\n");
    }

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

    // Trust the requested name; create response shape varies.
    const displayName = name;

    // Wait for MemFS clone to land locally, then seed the OKF bundle.
    const home = process.env.HOME || homedir();
    const memDir = join(home, ".letta", "agents", candidateId, "memory");
    const bundleDir = join(memDir, TEAM_BUNDLE_DIRNAME);
    let seededFiles = 0;
    let memDirFound = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (existsSync(memDir)) {
        memDirFound = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    dlog(`memDir found after poll: ${memDirFound}`);
    if (memDirFound) {
      const assetFiles = listAssetFiles("team");
      for (const rel of assetFiles) {
        const src = join(ASSETS_DIR, "team", rel);
        const dst = join(bundleDir, rel);
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(src, dst);
        seededFiles += 1;
      }
    }

    writeState({
      stewardAgentId: candidateId,
      stewardAgentName: displayName,
      lastSyncAt: new Date().toISOString(),
      bundlePath: existsSync(bundleDir) ? bundleDir : null,
    });

    const seedNote = memDirFound
      ? seededFiles > 0
        ? `Seeded ${seededFiles} bundle files.`
        : "Bundle directory exists but no files were seeded (check assets)."
      : "MemFS clone did not land within 30s. Run `/teamtalk init --reseed` once the clone is available.";

    return [
      "# TeamTalk steward created",
      "",
      `- Agent: ${displayName} (${candidateId})`,
      `- Tagged: ${STEWARD_TAG}`,
      `- Verified: retrieve succeeded`,
      `- MemFS dir: ${memDir}`,
      `- OKF bundle: ${existsSync(bundleDir) ? bundleDir : "(not yet present locally)"}`,
      `- ${seedNote}`,
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
  lines.push(`Local state file: ${STATE_PATH}`);
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
  lines.push(`HOME: ${process.env.HOME || homedir()}`);
  for (const p of candidateStewardMemoryPaths(state)) {
    lines.push(`  ${existsSync(p) ? "EXISTS" : "missing"}: ${p}`);
  }
  if (state.stewardAgentId) {
    const home = process.env.HOME || homedir();
    const memDir = join(home, ".letta", "agents", state.stewardAgentId, "memory");
    const bundleDir = join(memDir, TEAM_BUNDLE_DIRNAME);
    lines.push(`  ${existsSync(memDir) ? "EXISTS" : "missing"}: ${memDir}`);
    lines.push(`  ${existsSync(bundleDir) ? "EXISTS" : "missing"}: ${bundleDir}`);
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
          "Propose a new concept (Rule, Playbook, Decision, Person, Reference) for the team's " +
          "shared knowledge base. The proposal is sent to the steward agent, which validates " +
          "OKF conformance and commits to its own MemFS. The steward may reject proposals that " +
          "violate policy (secrets, duplicates, schema violations); treat a rejection as a " +
          "revision request.",
        parameters: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["Rule", "Playbook", "Decision", "Person", "Reference"],
              description: "OKF concept type",
            },
            title: { type: "string", description: "Display title for the concept" },
            proposed_path: {
              type: "string",
              description: "Path under team/, e.g. team/rules/global/think-before-coding.md",
            },
            body: { type: "string", description: "Markdown body of the concept" },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Optional tags for the concept frontmatter",
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

          const message = [
            "PROPOSE_NEW_CONCEPT",
            `type: ${type}`,
            `title: ${title}`,
            `proposed_path: ${proposedPath}`,
            "body: |",
            body.split("\n").map((l) => `  ${l}`).join("\n"),
            `tags: [${tags.join(", ")}]`,
            `source_agent: ${ctx?.agent?.id || "unknown"}`,
          ].join("\n");

          try {
            const response = await letta.client.agents.messages.create(state.stewardAgentId, {
              messages: [{ role: "user", content: message }],
            });
            const messages: any[] = response?.messages || [];
            const assistant = messages.filter((m) => m.message_type === "assistant_message").pop();
            return assistant?.content || "Proposal sent to steward (no assistant message in response).";
          } catch (err: any) {
            return { status: "error", content: `Failed to send proposal: ${err?.message || String(err)}` };
          }
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