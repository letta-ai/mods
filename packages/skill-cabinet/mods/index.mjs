import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MOD_ID = "skill-cabinet";
const STATE_VERSION = 1;
const MAX_SKILL_BYTES = 1_000_000;
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 30;
const LOCAL_AGENT_EXCLUDED_BUNDLED_SKILLS = new Set(["image-generation"]);

const CATEGORY_LABELS = {
  care: "Care & presence",
  voice: "Voice & audio",
  social: "Social & reaching",
  memory: "Memory & self-governance",
  media: "Media & creation",
  world: "Live world & reference",
  engineering: "Engineering & orchestration",
  games: "Games & playtesting",
  uncategorized: "Uncategorized",
};

const stateLocks = new Map();

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || process.cwd();
}

function nowIso() {
  return new Date().toISOString();
}

function safeSegment(value, fallback = "unknown") {
  const clean = String(value || fallback).trim().replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180);
  return clean || fallback;
}

function agentId(ctx) {
  return ctx?.agent?.id || ctx?.agent?.agentId || ctx?.agent?.agent_id || process.env.AGENT_ID || null;
}

function requireAgentId(ctx) {
  const id = agentId(ctx);
  if (!id) throw new Error("Skill Cabinet unavailable: missing scoped agent id.");
  return id;
}

function isLocalAgentId(value) {
  return /^local[-_:]/i.test(String(value || ""));
}

function dataRoot() {
  return process.env.SKILL_CABINET_DATA_DIR || path.join(homeDir(), ".letta", "mods", "data", MOD_ID);
}

function scopeDir(ctx) {
  return path.join(dataRoot(), safeSegment(requireAgentId(ctx), "agent"));
}

function statePath(ctx) {
  return path.join(scopeDir(ctx), "state.json");
}

function catalogJsonPath(ctx) {
  return path.join(scopeDir(ctx), "catalog.json");
}

function catalogMarkdownPath(ctx) {
  return path.join(scopeDir(ctx), "catalog.md");
}

function displayPath(value) {
  const normalized = String(value || "");
  const home = homeDir();
  if (home && normalized === home) return "~";
  if (home && normalized.startsWith(`${home}${path.sep}`)) return `~${normalized.slice(home.length)}`;
  return normalized;
}

function candidateMemoryDirs(ctx) {
  const id = agentId(ctx);
  if (!id) return [];
  const home = homeDir();
  const candidates = [
    path.join(home, ".letta", "lc-local-backend", "memfs", id, "memory"),
    path.join(home, ".letta", "agents", id, "memory"),
  ];
  for (const configured of [process.env.LETTA_MEMORY_DIR, process.env.MEMORY_DIR]) {
    if (configured && (configured.includes(id) || candidates.every((candidate) => !existsSync(candidate)))) {
      candidates.push(configured);
    }
  }
  return [...new Set(candidates.filter(Boolean))];
}

function agentSkillsDir(ctx) {
  const candidates = candidateMemoryDirs(ctx).map((candidate) => path.join(candidate, "skills"));
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0] || "";
}

function bundledSkillsDir() {
  const home = homeDir();
  const executablePrefix = path.resolve(path.dirname(process.execPath), "..");
  const candidates = [
    process.env.LETTA_BUNDLED_SKILLS_DIR,
    path.join(home, ".local", "lib", "node_modules", "@letta-ai", "letta-code", "skills"),
    path.join(home, ".npm-global", "lib", "node_modules", "@letta-ai", "letta-code", "skills"),
    process.env.APPDATA && path.join(process.env.APPDATA, "npm", "node_modules", "@letta-ai", "letta-code", "skills"),
    path.join(executablePrefix, "lib", "node_modules", "@letta-ai", "letta-code", "skills"),
    "/usr/local/lib/node_modules/@letta-ai/letta-code/skills",
    "/usr/lib/node_modules/@letta-ai/letta-code/skills",
    "/Applications/Letta.app/Contents/Resources/app.asar.unpacked/node_modules/@letta-ai/letta-code/skills",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0] || "";
}

function activeRoots(ctx) {
  const cwd = ctx?.cwd || process.cwd();
  return [
    { id: "bundled", source: "bundled", label: "Bundled Letta Code", root: bundledSkillsDir(), priority: 10 },
    { id: "global", source: "global", label: "Global user", root: path.join(homeDir(), ".letta", "skills"), priority: 20 },
    { id: "agent", source: "agent", label: "Agent-owned", root: agentSkillsDir(ctx), priority: 30 },
    { id: "project-legacy", source: "project", label: "Project (.skills)", root: path.join(cwd, ".skills"), priority: 40 },
    { id: "project", source: "project", label: "Project (.agents/skills)", root: path.join(cwd, ".agents", "skills"), priority: 50 },
  ];
}

function emptyState(ctx) {
  const timestamp = nowIso();
  return {
    version: STATE_VERSION,
    agent_id: agentId(ctx),
    tracking_since: timestamp,
    updated_at: timestamp,
    last_audit_at: null,
    usage: {},
  };
}

async function loadState(ctx) {
  const file = statePath(ctx);
  if (!existsSync(file)) return emptyState(ctx);
  try {
    const raw = JSON.parse(await readFile(file, "utf8"));
    return {
      ...emptyState(ctx),
      ...raw,
      usage: raw?.usage && typeof raw.usage === "object" ? raw.usage : {},
    };
  } catch {
    return emptyState(ctx);
  }
}

async function atomicWrite(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, file);
}

async function saveState(ctx, state) {
  const file = statePath(ctx);
  state.version = STATE_VERSION;
  state.agent_id = requireAgentId(ctx);
  state.updated_at = nowIso();
  await atomicWrite(file, `${JSON.stringify(state, null, 2)}\n`);
  return file;
}

async function withStateLock(ctx, operation) {
  const key = safeSegment(requireAgentId(ctx), "agent");
  const previous = stateLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  stateLocks.set(key, current);
  try {
    return await current;
  } finally {
    if (stateLocks.get(key) === current) stateLocks.delete(key);
  }
}

function stripQuotes(value) {
  const text = String(value ?? "").trim();
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    if (text.startsWith('"')) {
      try { return JSON.parse(text); } catch { /* Fall through to slicing. */ }
    }
    return text.slice(1, -1).replaceAll("''", "'");
  }
  return text;
}

function parseBoolean(value, fallback = false) {
  const normalized = stripQuotes(value).toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return fallback;
}

function parseStringList(value) {
  const text = String(value ?? "").trim();
  if (!text) return [];
  if (text.startsWith("[") && text.endsWith("]")) {
    return text.slice(1, -1).split(",").map(stripQuotes).map((item) => item.trim()).filter(Boolean);
  }
  return stripQuotes(text).split(/\s+/).filter(Boolean);
}

function parseFrontmatter(content) {
  const match = String(content).match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) return { values: {}, raw: {}, body: content, present: false };
  const values = {};
  const raw = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/);
    if (!field) continue;
    raw[field[1]] = field[2];
    values[field[1]] = stripQuotes(field[2]);
  }
  return { values, raw, body: content.slice(match[0].length), present: true };
}

function fallbackDescription(body) {
  const clean = String(body || "")
    .replace(/^#+\s+.*$/gm, "")
    .split(/\r?\n\s*\r?\n/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .find(Boolean);
  return clean || "No description available";
}

function titleFromId(id) {
  return String(id || "")
    .split("/").at(-1)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function categorySlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[&/]+/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeCategory(value) {
  const normalized = categorySlug(value);
  const aliases = {
    "care-presence": "care",
    health: "care",
    audio: "voice",
    "voice-audio": "voice",
    "social-reaching": "social",
    publishing: "social",
    "memory-self-governance": "memory",
    image: "media",
    creation: "media",
    "live-world-reference": "world",
    reference: "world",
    dev: "engineering",
    developer: "engineering",
    orchestration: "engineering",
    game: "games",
    playtesting: "games",
  };
  return aliases[normalized] || normalized;
}

function categoryLabel(category) {
  return CATEGORY_LABELS[category] || titleFromId(category);
}

function inferCategory(skill) {
  const declared = normalizeCategory(skill.declaredCategory);
  if (declared) return declared;
  const haystack = `${skill.id} ${skill.name} ${skill.description} ${(skill.tags || []).join(" ")}`.toLowerCase();
  if (/voice|audio|speech|transcrib|text.to.speech|\btts\b/.test(haystack)) return "voice";
  if (/memory|journal|reflect|compact|obsidian|continuity/.test(haystack)) return "memory";
  if (/image|music|video|poem|haiku|\bgif\b|media|creative/.test(haystack)) return "media";
  if (/game|playtest|steam|achievement/.test(haystack)) return "games";
  if (/weather|bird|planet|earthquake|encyclopedia|reference|research|spotify/.test(haystack)) return "world";
  if (/care|sleep|body|health|lamp|mood|wellbeing/.test(haystack)) return "care";
  if (/social|post|message|reach|publish|community|vent/.test(haystack)) return "social";
  if (/\bmod\b|code|command|browser|schedule|prompt|develop|\bgit\b|test|automation|orchestrat/.test(haystack)) return "engineering";
  return "uncategorized";
}

function digest(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function walkSkillFiles(root, current = root, output = [], seen = new Set()) {
  if (!root || !existsSync(current)) return output;
  let resolved;
  try { resolved = await realpath(current); } catch { return output; }
  if (seen.has(resolved)) return output;
  seen.add(resolved);
  let entries;
  try { entries = await readdir(current, { withFileTypes: true }); } catch { return output; }
  for (const entry of entries) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const full = path.join(current, entry.name);
    let entryStat;
    try { entryStat = entry.isSymbolicLink() ? await stat(full) : null; } catch { continue; }
    const isDirectory = entry.isDirectory() || entryStat?.isDirectory();
    const isFile = entry.isFile() || entryStat?.isFile();
    if (isDirectory) {
      await walkSkillFiles(root, full, output, seen);
    } else if (isFile && entry.name.toUpperCase() === "SKILL.MD") {
      output.push(full);
    }
  }
  return output;
}

async function parseSkillFile(file, rootSpec, ctx) {
  const fileStat = await stat(file);
  if (fileStat.size > MAX_SKILL_BYTES) throw new Error(`SKILL.md exceeds ${MAX_SKILL_BYTES} bytes`);
  const content = await readFile(file, "utf8");
  const parsed = parseFrontmatter(content);
  const relativeDir = path.relative(rootSpec.root, path.dirname(file)).split(path.sep).join("/");
  const id = String(parsed.values.id || relativeDir || "root").trim();
  const rawName = parsed.raw.name ?? parsed.raw.title ?? "";
  const name = String(parsed.values.name || parsed.values.title || titleFromId(id)).trim();
  const description = String(parsed.values.description || fallbackDescription(parsed.body)).replace(/\s+/g, " ").trim();
  const disableModelInvocation = parseBoolean(parsed.raw["disable-model-invocation"], false);
  const userInvocable = parseBoolean(parsed.raw["user-invocable"], true);
  const localExcluded = rootSpec.source === "bundled" && isLocalAgentId(agentId(ctx)) && LOCAL_AGENT_EXCLUDED_BUNDLED_SKILLS.has(id);
  const anomalies = [];
  if (!parsed.present) anomalies.push("missing frontmatter");
  if (!parsed.values.name) anomalies.push("missing name");
  if (!parsed.values.description) anomalies.push("missing description");
  if (rawName && /^(["']).*\1$/.test(rawName)) anomalies.push("quoted name may render literally in some registry views");
  if (!id) anomalies.push("empty id");
  const skill = {
    id,
    name,
    description,
    whenToUse: String(parsed.values.when_to_use || "").trim() || null,
    tags: parseStringList(parsed.raw.tags),
    declaredCategory: String(parsed.values.category || "").trim() || null,
    category: "uncategorized",
    source: rootSpec.source,
    sourceRoot: rootSpec.id,
    sourceLabel: rootSpec.label,
    path: file,
    relativePath: path.relative(rootSpec.root, file).split(path.sep).join("/"),
    priority: rootSpec.priority,
    modelInvocable: !disableModelInvocation && !localExcluded,
    userInvocable,
    localExcluded,
    hash: digest(content),
    modifiedAt: fileStat.mtime.toISOString(),
    anomalies,
  };
  skill.category = inferCategory(skill);
  return skill;
}

async function scanRoot(rootSpec, ctx) {
  const skills = [];
  const errors = [];
  if (!rootSpec.root || !existsSync(rootSpec.root)) return { ...rootSpec, skills, errors, present: false };
  const files = await walkSkillFiles(rootSpec.root);
  for (const file of files.sort()) {
    try {
      skills.push(await parseSkillFile(file, rootSpec, ctx));
    } catch (error) {
      errors.push({ path: file, message: error?.message || String(error) });
    }
  }
  return { ...rootSpec, skills, errors, present: true };
}

function byId(a, b) {
  return a.id.localeCompare(b.id) || a.source.localeCompare(b.source);
}

export async function scanCatalog(ctx = {}) {
  const rootResults = [];
  for (const root of activeRoots(ctx)) rootResults.push(await scanRoot(root, ctx));

  const selected = new Map();
  const duplicates = [];
  for (const result of rootResults.sort((a, b) => a.priority - b.priority)) {
    for (const skill of result.skills) {
      const previous = selected.get(skill.id);
      if (previous) {
        duplicates.push({
          id: skill.id,
          selected_source: skill.sourceRoot,
          selected_path: skill.path,
          shadowed_source: previous.sourceRoot,
          shadowed_path: previous.path,
          identical: previous.hash === skill.hash,
        });
      }
      selected.set(skill.id, skill);
    }
  }

  const skills = [...selected.values()].sort(byId);
  const countsBySource = {};
  const countsByCategory = {};
  for (const skill of skills) {
    countsBySource[skill.source] = (countsBySource[skill.source] || 0) + 1;
    countsByCategory[skill.category] = (countsByCategory[skill.category] || 0) + 1;
  }
  const anomalies = skills.flatMap((skill) => skill.anomalies.map((message) => ({ id: skill.id, message, path: skill.path })));
  const scanErrors = rootResults.flatMap((root) => root.errors.map((error) => ({ root: root.id, ...error })));

  return {
    generatedAt: nowIso(),
    agentId: agentId(ctx),
    cwd: ctx?.cwd || process.cwd(),
    skills,
    installedCount: skills.length,
    visibleCount: skills.filter((skill) => skill.modelInvocable).length,
    hiddenCount: skills.filter((skill) => !skill.modelInvocable).length,
    countsBySource,
    countsByCategory,
    duplicates,
    anomalies,
    scanErrors,
    uncategorized: skills.filter((skill) => skill.category === "uncategorized").map((skill) => skill.id),
    roots: rootResults.map((root) => ({
      id: root.id,
      source: root.source,
      label: root.label,
      path: root.root,
      present: root.present,
      discovered: root.skills.length,
      errors: root.errors.length,
    })),
  };
}

function formatDate(value) {
  if (!value) return "never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function compactDescription(value, max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trim()}…`;
}

function sourceDisplay(source) {
  const labels = { bundled: "bundled", global: "global", agent: "agent-owned", project: "project" };
  return labels[source] || source;
}

function sortedEntries(record) {
  return Object.entries(record || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function categorySummary(catalog) {
  const entries = sortedEntries(catalog.countsByCategory);
  return entries.length
    ? entries.map(([category, count]) => `${categoryLabel(category)} ${count}`).join(" · ")
    : "No skills found";
}

function auditIssueLines(catalog) {
  const lines = [];
  lines.push(`${catalog.duplicates.length} shadowed duplicate id${catalog.duplicates.length === 1 ? "" : "s"}`);
  lines.push(`${catalog.anomalies.length} metadata anomal${catalog.anomalies.length === 1 ? "y" : "ies"}`);
  lines.push(`${catalog.uncategorized.length} uncategorized`);
  lines.push(`${catalog.scanErrors.length} scan error${catalog.scanErrors.length === 1 ? "" : "s"}`);
  return lines.join(" · ");
}

function manifestCatalog(catalog) {
  return {
    generated_at: catalog.generatedAt,
    agent_id: catalog.agentId,
    cwd: catalog.cwd,
    counts: {
      installed: catalog.installedCount,
      model_visible: catalog.visibleCount,
      hidden: catalog.hiddenCount,
      by_source: catalog.countsBySource,
      by_category: catalog.countsByCategory,
    },
    roots: catalog.roots,
    skills: catalog.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      source: skill.source,
      source_root: skill.sourceRoot,
      path: skill.path,
      model_visible: skill.modelInvocable,
      user_invocable: skill.userInvocable,
      modified_at: skill.modifiedAt,
      anomalies: skill.anomalies,
    })),
    audit: {
      duplicates: catalog.duplicates,
      anomalies: catalog.anomalies,
      uncategorized: catalog.uncategorized,
      scan_errors: catalog.scanErrors,
    },
  };
}

function renderIndex(catalog, state) {
  const lines = [
    "# Skill Cabinet",
    "",
    `Generated ${catalog.generatedAt} for agent \`${catalog.agentId}\`.`,
    "",
    `**${catalog.visibleCount} model-visible / ${catalog.installedCount} installed.**`,
    "",
    categorySummary(catalog),
    "",
    "## Skills",
    "",
  ];
  for (const skill of catalog.skills) {
    const usage = state.usage?.[skill.id];
    const visibility = skill.modelInvocable ? "model-visible" : "hidden from model invocation";
    lines.push(`### ${skill.name}`);
    lines.push("");
    lines.push(`- ID: \`${skill.id}\``);
    lines.push(`- Category: ${categoryLabel(skill.category)}`);
    lines.push(`- Source: ${sourceDisplay(skill.source)} (${skill.sourceRoot})`);
    lines.push(`- Visibility: ${visibility}`);
    lines.push(`- Last observed use: ${formatDate(usage?.last_used_at)}`);
    lines.push(`- Path: \`${displayPath(skill.path)}\``);
    lines.push("");
    lines.push(skill.description);
    lines.push("");
  }
  lines.push("## Audit", "", auditIssueLines(catalog), "");
  lines.push("## Provenance", "");
  lines.push("- This is a point-in-time filesystem scan, not the Skill resolver itself.");
  lines.push("- “Last observed” means this mod saw a completed `Skill` tool call while its observer was loaded.");
  lines.push("- “Never observed” does not prove a skill was never used before tracking began.");
  lines.push("");
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

export async function auditCatalog(ctx = {}) {
  const catalog = await scanCatalog(ctx);
  return await withStateLock(ctx, async () => {
    const state = await loadState(ctx);
    state.last_audit_at = catalog.generatedAt;
    const stateFile = await saveState(ctx, state);
    const jsonFile = catalogJsonPath(ctx);
    const markdownFile = catalogMarkdownPath(ctx);
    await atomicWrite(jsonFile, `${JSON.stringify(manifestCatalog(catalog), null, 2)}\n`);
    await atomicWrite(markdownFile, renderIndex(catalog, state));
    return { catalog, state, stateFile, jsonFile, markdownFile };
  });
}

function clampLimit(value, fallback = DEFAULT_LIMIT) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, MAX_LIMIT);
}

function searchScore(skill, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return 1;
  const terms = q.split(/\s+/).filter(Boolean);
  const id = skill.id.toLowerCase();
  const name = skill.name.toLowerCase();
  const category = `${skill.category} ${categoryLabel(skill.category)}`.toLowerCase();
  const description = `${skill.description} ${skill.whenToUse || ""} ${(skill.tags || []).join(" ")}`.toLowerCase();
  const all = `${id} ${name} ${category} ${description}`;
  if (!terms.every((term) => all.includes(term))) return 0;
  let score = 0;
  if (id === q) score += 1000;
  if (id.startsWith(q)) score += 500;
  if (id.includes(q)) score += 300;
  if (name.includes(q)) score += 180;
  if (category.includes(q)) score += 120;
  for (const term of terms) {
    if (id.includes(term)) score += 80;
    if (name.includes(term)) score += 50;
    if (description.includes(term)) score += 15;
  }
  return score || 1;
}

function searchSkills(catalog, query, options = {}) {
  const limit = clampLimit(options.limit);
  return catalog.skills
    .filter((skill) => options.includeHidden || skill.modelInvocable)
    .filter((skill) => !options.category || skill.category === options.category)
    .filter((skill) => !options.source || skill.source === options.source)
    .map((skill) => ({ skill, score: searchScore(skill, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || byId(a.skill, b.skill))
    .slice(0, limit)
    .map((item) => item.skill);
}

function renderSkills(skills, state, { heading = "Skills" } = {}) {
  if (!skills.length) return `${heading}\n\nNo matching skills found.`;
  const lines = [heading, ""];
  for (const skill of skills) {
    const usage = state.usage?.[skill.id];
    const used = usage?.last_used_at ? ` · used ${formatDate(usage.last_used_at)}` : "";
    lines.push(`- ${skill.id} [${categoryLabel(skill.category)}; ${sourceDisplay(skill.source)}${used}]`);
    lines.push(`  ${compactDescription(skill.description, 220)}`);
  }
  return lines.join("\n");
}

function renderSummary(catalog, state, commandId) {
  const sourceLine = sortedEntries(catalog.countsBySource)
    .map(([source, count]) => `${count} ${sourceDisplay(source)}`)
    .join(" · ") || "No sources discovered";
  return [
    `Skill Cabinet — ${catalog.visibleCount} model-visible / ${catalog.installedCount} installed`,
    "",
    sourceLine,
    `Last durable audit: ${formatDate(state.last_audit_at)}`,
    `Usage observed since: ${formatDate(state.tracking_since)}`,
    "",
    categorySummary(catalog),
    "",
    `Search: /${commandId} bird  ·  Category: /${commandId} category voice`,
    `Dust check: /${commandId} forgotten  ·  Regenerate snapshots: /${commandId} audit`,
  ].join("\n");
}

function forgottenSkills(catalog, state, limit = 20, includeHidden = false) {
  return catalog.skills
    .filter((skill) => includeHidden || skill.modelInvocable)
    .sort((a, b) => {
      const aTime = state.usage?.[a.id]?.last_used_at || "";
      const bTime = state.usage?.[b.id]?.last_used_at || "";
      if (!aTime && bTime) return -1;
      if (aTime && !bTime) return 1;
      return aTime.localeCompare(bTime) || byId(a, b);
    })
    .slice(0, clampLimit(limit, 20));
}

function renderForgotten(catalog, state, limit) {
  const skills = forgottenSkills(catalog, state, limit);
  const neverCount = catalog.skills.filter((skill) => skill.modelInvocable && !state.usage?.[skill.id]?.last_used_at).length;
  return [
    `Dust check — ${neverCount} skill${neverCount === 1 ? "" : "s"} not yet observed since ${formatDate(state.tracking_since)}`,
    "This is an observation window, not a claim about the time before tracking.",
    "",
    renderSkills(skills, state, { heading: "Oldest or never-observed" }),
  ].join("\n");
}

function renderAudit(result) {
  const { catalog, stateFile, jsonFile, markdownFile } = result;
  return [
    `Skill Cabinet audited — ${catalog.visibleCount} model-visible / ${catalog.installedCount} installed`,
    "",
    auditIssueLines(catalog),
    "",
    `Markdown snapshot: ${displayPath(markdownFile)}`,
    `JSON snapshot: ${displayPath(jsonFile)}`,
    `Usage state: ${displayPath(stateFile)}`,
    "",
    "The live scan and local snapshots now agree with the current filesystem. Project skills may change when the working directory changes.",
  ].join("\n");
}

function sourceAlias(value) {
  const requested = String(value || "").toLowerCase();
  const aliases = {
    custom: "agent",
    owned: "agent",
    "agent-owned": "agent",
    builtin: "bundled",
    "built-in": "bundled",
    local: "project",
  };
  return aliases[requested] || requested;
}

function commandId() {
  const requested = String(process.env.SKILL_CABINET_COMMAND || "skills").trim().replace(/^\/+/, "");
  return /^[a-z][a-z0-9-]{0,63}$/.test(requested) ? requested : "skills";
}

function helpText(id) {
  return [
    `/${id} — show cabinet counts and categories`,
    `/${id} <query> — search ids, names, descriptions, tags, and categories`,
    `/${id} category <name> — list one category`,
    `/${id} source <agent|project|global|bundled> — filter by source`,
    `/${id} forgotten [limit] — least/never observed since tracking began`,
    `/${id} audit — rescan and regenerate local Markdown + JSON snapshots`,
    `/${id} paths — show source and state paths`,
    `/${id} help — show this help`,
  ].join("\n");
}

async function runCommand(ctx) {
  const id = commandId();
  const args = String(ctx.args || "").trim();
  const [firstRaw, ...rest] = args.split(/\s+/).filter(Boolean);
  const first = String(firstRaw || "").toLowerCase();
  if (["help", "-h", "--help"].includes(first)) return helpText(id);
  if (["audit", "refresh", "verify"].includes(first)) return renderAudit(await auditCatalog(ctx));

  const catalog = await scanCatalog(ctx);
  const state = await loadState(ctx);
  if (!first) return renderSummary(catalog, state, id);
  if (["categories", "category-list"].includes(first)) return `Skill categories\n\n${categorySummary(catalog)}`;
  if (["forgotten", "dust", "dusty", "neglected"].includes(first)) return renderForgotten(catalog, state, rest[0]);
  if (["paths", "path", "where", "roots"].includes(first)) {
    const lines = catalog.roots.map((root) => `- ${root.label}: ${displayPath(root.path)} (${root.discovered}; ${root.present ? "present" : "missing"})`);
    lines.push(`- Markdown snapshot: ${displayPath(catalogMarkdownPath(ctx))}`);
    lines.push(`- JSON snapshot: ${displayPath(catalogJsonPath(ctx))}`);
    lines.push(`- Usage state: ${displayPath(statePath(ctx))}`);
    return `Skill Cabinet paths\n\n${lines.join("\n")}`;
  }
  if (["category", "cat"].includes(first)) {
    const requested = normalizeCategory(rest.join(" "));
    const skills = searchSkills(catalog, "", { category: requested, limit: MAX_LIMIT });
    return renderSkills(skills, state, { heading: `Category: ${categoryLabel(requested)}` });
  }
  if (first === "source") {
    const source = sourceAlias(rest[0]);
    return renderSkills(searchSkills(catalog, "", { source, limit: MAX_LIMIT }), state, { heading: `Source: ${sourceDisplay(source)}` });
  }
  return renderSkills(searchSkills(catalog, args, { limit: 20 }), state, { heading: `Skill search: ${args}` });
}

function toolSchema() {
  return {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["summary", "search", "category", "source", "forgotten"],
        description: "Read-only cabinet operation.",
      },
      query: { type: "string", description: "Search phrase, category name, or source name depending on action." },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
      include_hidden: { type: "boolean", description: "Include installed skills disabled for model invocation." },
    },
    required: ["action"],
    additionalProperties: false,
  };
}

async function runTool(ctx) {
  const catalog = await scanCatalog(ctx);
  const state = await loadState(ctx);
  const action = String(ctx.args?.action || "summary").toLowerCase();
  const query = String(ctx.args?.query || "").trim();
  const limit = clampLimit(ctx.args?.limit);
  const includeHidden = ctx.args?.include_hidden === true;
  if (action === "summary") {
    return {
      generated_at: catalog.generatedAt,
      model_visible: catalog.visibleCount,
      installed: catalog.installedCount,
      hidden: catalog.hiddenCount,
      by_source: catalog.countsBySource,
      by_category: catalog.countsByCategory,
      duplicate_ids: catalog.duplicates.length,
      metadata_anomalies: catalog.anomalies.length,
      scan_errors: catalog.scanErrors.length,
      last_audit_at: state.last_audit_at,
      usage_tracking_since: state.tracking_since,
    };
  }
  if (action === "forgotten") {
    return {
      tracking_since: state.tracking_since,
      caveat: "Never observed means not seen by this mod since tracking began, not never used historically.",
      skills: forgottenSkills(catalog, state, limit, includeHidden).map((skill) => ({
        id: skill.id,
        category: skill.category,
        source: skill.source,
        model_visible: skill.modelInvocable,
        last_used_at: state.usage?.[skill.id]?.last_used_at || null,
      })),
    };
  }
  const options = { limit, includeHidden };
  if (action === "category") options.category = normalizeCategory(query);
  if (action === "source") options.source = sourceAlias(query);
  const skills = searchSkills(catalog, action === "search" ? query : "", options);
  return {
    query: action === "search" ? query : null,
    count: skills.length,
    skills: skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      source: skill.source,
      model_visible: skill.modelInvocable,
      last_used_at: state.usage?.[skill.id]?.last_used_at || null,
    })),
  };
}

async function observeSkillUse(ctx, skillId, status) {
  const id = String(skillId || "").trim();
  if (!id) return;
  await withStateLock(ctx, async () => {
    const state = await loadState(ctx);
    const previous = state.usage[id] || {};
    const timestamp = nowIso();
    state.usage[id] = {
      first_used_at: previous.first_used_at || timestamp,
      last_used_at: timestamp,
      completed_uses: Number(previous.completed_uses || 0) + 1,
      successful_uses: Number(previous.successful_uses || 0) + (status === "success" ? 1 : 0),
      failed_uses: Number(previous.failed_uses || 0) + (status === "error" ? 1 : 0),
      last_status: status || "unknown",
    };
    await saveState(ctx, state);
  });
}

function isSkillToolName(value) {
  const normalized = String(value || "").toLowerCase().replace(/^functions[._:-]/, "");
  return normalized === "skill";
}

export default function activate(letta) {
  const disposers = [];
  const id = commandId();

  if (letta.capabilities.commands) {
    disposers.push(letta.commands.register({
      id,
      description: "Search and audit the current agent's live Skill Cabinet.",
      args: "[query|category <name>|source <name>|forgotten|audit|paths|help]",
      async run(ctx) {
        try {
          return { type: "output", output: await runCommand(ctx) };
        } catch (error) {
          return { type: "output", output: `Skill Cabinet error: ${error?.message || String(error)}` };
        }
      },
    }));
  }

  if (letta.capabilities.tools) {
    disposers.push(letta.tools.register({
      name: "skill_catalog",
      description: "Search or inspect the current agent's live skill inventory. Use when looking for an existing capability, checking categories or sources, or finding skills not observed since usage tracking began.",
      parameters: toolSchema(),
      requiresApproval: false,
      parallelSafe: true,
      async run(ctx) {
        return await runTool(ctx);
      },
    }));
  }

  if (letta.capabilities.events?.tools) {
    disposers.push(letta.events.on("tool_end", async (event, ctx) => {
      if (!isSkillToolName(event.toolName)) return;
      const skill = event.args?.skill;
      if (typeof skill !== "string" || !skill.trim()) return;
      try {
        await observeSkillUse(ctx, skill, event.status);
      } catch (error) {
        console.warn(`[${MOD_ID}] failed to record skill usage: ${error?.message || String(error)}`);
      }
    }));
  }

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
