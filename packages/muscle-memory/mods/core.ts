// muscle-memory · core module (split from index.ts — behavior-preserving).
import { appendFileSync, mkdirSync, readFileSync, existsSync, writeFileSync, readdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { commandTemplate, correlateOutcomes, fingerprint, inferOutcomes } from "./detect";
import { sotaQualityGaps } from "./gate";
import { archivePassage, syncNeocortexBlock } from "./engram";


export const STATE_DIR = process.env.MM_STATE_DIR || join(homedir(), ".letta", "muscle-memory");

export const LOG_PATH = join(STATE_DIR, "experience.jsonl");

export const SESSIONS_PATH = join(STATE_DIR, "sessions.jsonl");

export const GLOBAL_SKILLS_DIR = process.env.MM_GLOBAL_SKILLS_DIR || join(homedir(), ".letta", "skills");


// ── Redaction ────────────────────────────────────────────────────────────────
export const SECRETISH = /(?:key|token|secret|password|passwd|auth|bearer|cookie|api[_-]?key)/i;

export const LONG_OPAQUE = /\b[A-Za-z0-9_\-]{24,}\b/g;

export const HEXID = /\b[0-9a-f]{7,}\b/gi;

export const ABS_PATH = /(?:\/[\w.\-~ ]+){2,}/g;

export const QUOTED = /(['"])(?:\\.|(?!\1).)*\1/g;

export const SECRET_ASSIGN = /\b(?=[A-Za-z_][A-Za-z0-9_]*\s*=)(?=[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|COOKIE|BEARER|API[_-]?KEY|APIKEY))[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s;&]+)/gi;

export const SECRET_QUERY = /([?&])(?:access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|key|token|secret|password|passwd|auth|cookie|bearer)=([^&\s]+)/gi;

export const SECRET_FLAG = /--(?:api[_-]?key|apikey|key|token|secret|password|passwd|auth|cookie|bearer)(?:=|\s+)(?:"[^"]*"|'[^']*'|[^\s;&]+)/gi;

export const SECRET_HEADER = /\b(?:authorization|cookie|x-api-key|api-key)\s*:\s*(?:"[^"]*"|'[^']*'|[^\s;&]+)/gi;

export const NUM = /\b\d+\b/g;


/** Secret-scrub cascade shared by the fingerprint template and the opt-in worked-example redactor,
 * so both honor the same credential-removal contract. */
export function scrubSecrets(t: string): string {
  t = t.replace(/\b(?:bearer|token|apikey|api[_-]?key)\s+[^\s;&"']+/gi, "<cred> <redacted>");
  t = t.replace(/([a-z][a-z0-9+.\-]*:\/\/)[^/\s:@]+(?::[^/\s@]+)?@/gi, "$1<cred>@");
  t = t.replace(/\b((?:aws[_-]?)?(?:secret|password|passwd|token|api[_-]?key|access[_-]?key(?:[_-]?id)?|auth)[a-z0-9_]*)\s+(["']?)[^\s"';|&]{3,}\2/gi, "$1 <redacted>");
  t = t.replace(/(^|\s)(--?user|-u)[=\s]+("?)[^\s"':;|&]+:[^\s"';|&]+\3/gi, "$1$2 <redacted>");
  t = t.replace(/(^|\s)(--?(?:password|passwd|token|access[-_]?token|api[-_]?key))[=\s]+\S+/gi, "$1$2 <redacted>");
  t = t.replace(/(^|\s)-p(?=\S)\S+/g, "$1-p <redacted>");
  t = t.replace(/\b(?:AKIA|ASIA|AIza|ghp_|gho_|ghu_|ghs_|github_pat_|glpat-|xox[baprs]-|sk-[A-Za-z0-9]*-?|eyJ)[A-Za-z0-9_\-.]{6,}/g, "<id>");
  t = t.replace(SECRET_ASSIGN, "<cred>=<redacted>");
  t = t.replace(SECRET_QUERY, "$1<cred>=<redacted>");
  t = t.replace(SECRET_FLAG, "--<cred>=<redacted>");
  t = t.replace(SECRET_HEADER, "<cred>:<redacted>");
  return t;
}


/** Opt-in worked-example redactor (MM_CAPTURE). Unlike commandTemplate it PRESERVES code/error
 * structure (line numbers, operators, short identifiers, quotes) so a captured error/diff stays
 * concrete, but still strips credentials, absolute paths, and long opaque tokens. The final skill
 * body is independently re-scanned by scanSkillContent before any write (defense in depth). */
export function redactFragment(text: unknown, maxLines = 8, maxChars = 320): string {
  const lines = String(text ?? "").split(/\r?\n/).slice(0, maxLines).map((ln) => {
    let s = scrubSecrets(ln);
    s = s.replace(ABS_PATH, "<path>");
    s = s.replace(/\b[A-Za-z0-9_\-]{28,}\b/g, "<id>");
    s = s.replace(/\b[0-9a-f]{12,}\b/gi, "<id>");
    return s.replace(/[ \t]+/g, " ").replace(/\s+$/, "");
  });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxChars);
}


export function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}


// ── D2: DETECT (pure, deterministic — the testable core) ─────────────────────
// v2 (0.27.18): rows carry an outcome (ok) + error class (err) + a call id so
// tool_end outcomes can be merged onto tool_start observations.
export type Row = { ts?: number; conv?: string | null; tool: string; fp: string; tmpl?: string | null; h?: string; ok?: boolean; err?: string | null; id?: string; errMsg?: string | null; fix?: string | null };


export type Candidate = {
  kind: "template" | "sequence";
  key: string;
  count: number;
  convs: number;          // distinct conversations (cross-session spread)
  fixes: number;          // occurrences that recovered an error (false->true)
  maturity: number;
  mature: boolean;
};


// Tunable, conservative thresholds (born-hard — keeps the bank lean).
export const MM = {
  MIN_COUNT: 3,           // must recur >= 3x
  MIN_CONVS: 2,           // cross-session spread OR ...
  STRONG_SINGLE: 8,       // ... heavily repeated within a single session (both are "you do this a lot")
  MATURE_AT: 3.0,         // maturity score threshold to become a candidate
  NGRAM: 2,               // workflow transition (verb bigram) — empirically the right granularity
  // weights
  W_FREQ: 1.0, W_SPREAD: 1.5, W_FIX: 2.0,
};


// ── State I/O ────────────────────────────────────────────────────────────────
export function ensureDir() { try { mkdirSync(STATE_DIR, { recursive: true }); } catch { /* */ } }

export function appendJsonl(path: string, row: unknown) {
  try { ensureDir(); appendFileSync(path, JSON.stringify(row) + "\n"); } catch { /* tap must never throw */ }
}

export function loadRows(path = LOG_PATH): Row[] {
  if (!existsSync(path)) return [];
  const rows: Row[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    try { rows.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return rows;
}


// ── D3: DISTILL / GRADUATE / HOT-LOAD / REFINE (Hermes-style skill_manage) ────
export const GLOBAL_SKILLS = GLOBAL_SKILLS_DIR; // unified: respects MM_GLOBAL_SKILLS_DIR (was hardcoded — broke isolation + env override)

export const MM_TAG = "muscle-memory provenance"; // marker that tags a muscle-memory-managed skill


/** Resolve the agent-scoped skills dir (compounds via MemFS); fall back to global. Portable. */
export function agentSkillsDir(ctx?: any): string {
  if (process.env.MEMORY_DIR) return join(process.env.MEMORY_DIR, "skills");
  const id = ctx?.agent?.id || ctx?.agentId;
  if (id) {
    // Prefer the projected agent MemFS path that the Skill shelf indexes. The local-backend
    // mirror can exist but be seatbelt-inaccessible / invisible to the normal Skill tool.
    const projected = join(homedir(), ".letta", "agents", id, "memory", "skills");
    if (existsSync(join(homedir(), ".letta", "agents", id, "memory"))) return projected;
    const local = join(homedir(), ".letta", "lc-local-backend", "memfs", id, "memory", "skills");
    if (existsSync(join(homedir(), ".letta", "lc-local-backend", "memfs", id))) return local;
  }
  return GLOBAL_SKILLS;
}

/** Dirs to scan for list/dedup/AUDIT: agent-scoped + global (deduped). Read-only visibility across both. */
export function scanDirs(ctx?: any): string[] { return [...new Set([agentSkillsDir(ctx), GLOBAL_SKILLS])]; }

// ── NATIVE-FIT SHELF RESOLVER (Block N) — name each shelf + its permissions. An autonomous (unattended)
// loop may READ agent + global (audit/dedup visibility) but may only MUTATE the agent-local shelf: it must
// NEVER retire or rewrite shared global Custom Skills other agents may depend on. Global mutation is
// explicit-only (`/muscle-memory publish approve`). This is a permission boundary, NOT a priority resolver.
export type SkillShelf = { name: string; dir: string; writable: boolean; autonomous: boolean; priority: number };
export function skillShelves(ctx?: any): SkillShelf[] {
  const agent = agentSkillsDir(ctx);
  const shelves: SkillShelf[] = [{ name: "agent", dir: agent, writable: true, autonomous: true, priority: 20 }];
  // global is present for READ (audit/dedup) but is NOT autonomous-writable; only when it's a distinct shelf.
  if (GLOBAL_SKILLS !== agent) shelves.push({ name: "global", dir: GLOBAL_SKILLS, writable: false, autonomous: false, priority: 10 });
  return shelves;
}
/** The only shelves an AUTONOMOUS (unattended) op may MUTATE — agent-local; never the shared global shelf. */
export function autonomousShelves(ctx?: any): string[] { return skillShelves(ctx).filter((s) => s.autonomous).map((s) => s.dir); }


export function slug(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64); }

export function listSkillNames(dir: string): string[] { try { return readdirSync(dir).filter((n) => existsSync(join(dir, n, "SKILL.md"))); } catch { return []; } }

export function readSkill(dir: string, name: string): string { try { return readFileSync(join(dir, name, "SKILL.md"), "utf8"); } catch { return ""; } }

export function skillDesc(dir: string, name: string): string { return (readSkill(dir, name).match(/description:\s*(.+)/)?.[1] || "").trim(); }

export function isManaged(dir: string, name: string): boolean { return readSkill(dir, name).includes(MM_TAG); }

export function writeSkill(dir: string, name: string, content: string): string {
  mkdirSync(join(dir, name), { recursive: true });
  const tmp = join(dir, name, ".SKILL.md.tmp"); writeFileSync(tmp, content); renameSync(tmp, join(dir, name, "SKILL.md"));
  return join(dir, name, "SKILL.md");
}


// ════════════════════════════════════════════════════════════════════════════
// v2 (Letta Code 0.27.18) — outcome-aware learning, repair chains, impact scoring,
// authoring linter, anti-patterns, effectiveness retirement, llm/compact telemetry.
// Pure + deterministic where it matters; the harness proves each piece.
// ════════════════════════════════════════════════════════════════════════════
export const OUTCOME_PATH = join(STATE_DIR, "outcomes.jsonl");

export const TELEMETRY_PATH = join(STATE_DIR, "telemetry.json");

export const RECEIPTS_DIR = join(STATE_DIR, "receipts");

export type Outcome = { id?: string | null; ok?: boolean; err?: string | null; tool?: string | null; conv?: string | null; ts?: number; errMsg?: string | null };

export function loadOutcomes(): Outcome[] {
  if (!existsSync(OUTCOME_PATH)) return [];
  const out: Outcome[] = [];
  for (const l of readFileSync(OUTCOME_PATH, "utf8").split("\n")) { if (!l) continue; try { out.push(JSON.parse(l)); } catch { /* skip */ } }
  return out;
}

/** v2.1 experience = starts correlated with outcomes (id-exact + fallback), then sequence-inferred
 *  outcomes for tools Letta never reports (Bash/Task). The latter is what makes the loop work live. */
export function loadExperience(): Row[] { return inferOutcomes(correlateOutcomes(loadRows(), loadOutcomes())); }


// ── MM_PUBLISH v1.1: the SUPPLY CHAIN — graduated agent skill → publishability preflight → staged
// sanitized Custom Skill → approved publish → visibility receipt. No auto-publish; sanitize identifiers
// (not mechanisms); dedup-aware; tiered. Closes "this agent learned" → "the mesh reuses it". (2026-06-28)
export const PUBLISH_STAGED_DIR = join(STATE_DIR, "publish-staged");


// ════════════════════════════════════════════════════════════════════════════
// HERMES-PARITY + EDGE: curator lifecycle (replicate) · failure-defense (beat).
// ════════════════════════════════════════════════════════════════════════════
export const USAGE_PATH = join(STATE_DIR, "skill-usage.json");


// ── E3.5: NATIVE NEOCORTEX BRIDGE (opt-in) — exploit Letta's core memory + archival ───────────
// CLS made literal: project the consolidated skill index into a Letta CORE MEMORY BLOCK so the
// agent SEES its neocortex in-context every turn (no retrieval), and (optionally) write salient
// lessons as ARCHIVAL PASSAGES for semantic recall. The string builders are pure + tested; the
// live SDK writes (syncNeocortexBlock/archivePassage) are best-effort + opt-in (MM_NATIVE), never
// throw, and no-op without a client+agentId. SDK shapes grounded against @letta-ai/letta-client.
export const NEOCORTEX_BLOCK = "muscle_memory";


// ════════════════════════════════════════════════════════════════════════════
// M2: SECURITY + AUTHORING GATE — every write path (create/edit/patch/write_file/
// autopilot-graduate) passes through this. Block dangerous content; no partial writes.
// ════════════════════════════════════════════════════════════════════════════
// Real key formats: separator-prefixed (sk-/pk-/ghp_/xoxb-…), Anthropic sk-ant- (internal hyphen),
// AWS AKIA + 16 (NO separator), Google AIza + 20+ (NO separator). The old single `[-_]` rule silently
// missed AKIA/AIza/sk-ant real keys — found by the adversarial safety tests; hardened, not benchmark-tuned.
export const SECRET_TOKEN_RE = /\b(?:(?:sk|pk|ghp|gho|ghu|ghs|xox[baprs])[-_][A-Za-z0-9]{12,}|sk-ant-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16}|AIza[A-Za-z0-9_-]{20,})\b/;

export function scanSkillContent(content: string): { ok: boolean; issues: string[] } {
  const c = String(content || "");
  const issues: string[] = [];
  if (SECRET_TOKEN_RE.test(c) || /\b(?:authorization|api[_-]?key|secret|password)\s*[:=]\s*["']?[^\s"'<>]{6,}/i.test(c) || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(c)) issues.push("secret-looking credential");
  if (/\bcurl\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/i.test(c) || /\bwget\b[^\n|]*\|\s*(?:ba)?sh\b/i.test(c)) issues.push("pipe-to-shell (curl|sh)");
  if (/\brm\s+-[rf]{1,2}\s+(?:["']?[~/]|\$HOME|\*)/.test(c)) issues.push("naked rm -rf on root/home/glob");
  if (/(?:^|[\s;&|])sudo\s+\S/i.test(c)) issues.push("sudo command");
  // NOTE: force-push / reset --hard / rm etc. are NOT security threats — they are legitimate workflow ops a
  // skill may need to teach (git rebase, deploy rollback). Hard-blocking them here made mm unable to distil
  // entire domains (git/rebase/deploy). The real concern — "use them with a safety net" — is the SAFE-FIRST
  // QUALITY gate's job (sotaQualityGaps), which flags destructive ops lacking a backup/--force-with-lease/
  // dry-run and regenerates. Security scanner = true threats (secrets, exfil, pipe-to-shell, injection) only.
  if (Math.ceil(c.length / 4) > 5000) issues.push("body > 5000 tokens (decompose into references/)");
  if (/\bignore\s+(?:all\s+|the\s+)?(?:previous|prior|above)\s+(?:instructions|messages|prompts|rules)\b/i.test(c) || /\b(?:disregard|override)\s+(?:your\s+|the\s+)?(?:system|previous)\s+(?:prompt|instructions)\b/i.test(c)) issues.push("prompt-injection phrasing");
  // concrete hardcoded API-key/token formats (QA-hardened)
  if (/\b(?:sk-ant-[a-zA-Z0-9-]{8,}|sk-[a-zA-Z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[A-Za-z0-9-]{10,})\b/.test(c)) issues.push("hardcoded API key/token");
  // credential exfiltration: command-substitution reading secrets, or piping creds to the network
  if (/\$\([^)]*(?:cat|head|tail|less)[^)]*(?:\.ssh|id_rsa|\.env|\.aws|credentials|\.netrc|passwd|secret|token)/i.test(c) || /(?:curl|wget|nc|ncat)\b[^\n]*(?:\$\(|`)[^\n]*(?:cat|\.ssh|\.env|credentials|secret)/i.test(c)) issues.push("credential exfiltration pattern");
  // obfuscated code execution
  if (/\beval\s*\(\s*(?:atob|Buffer\.from|decodeURIComponent|unescape)\s*\(/i.test(c) || /\bbase64\s+-d\b[^\n]*\|\s*(?:ba)?sh\b/i.test(c) || /\b(?:python3?|node|ruby|perl)\b[^\n]*\s-[ec]\b[^\n]*(?:atob|base64|exec\(|eval)/i.test(c)) issues.push("obfuscated code execution");
  return { ok: issues.length === 0, issues };
}

export function scanSupportFile(path: string, content: string): { ok: boolean; issues: string[] } {
  const issues = [...scanSkillContent(content).issues];
  if (/\.(?:sh|mjs|cjs|js|ts|py|rb)$/i.test(path)) {
    const testDemo = /\b(?:test|demo|smoke|example|fixture)\b/i.test(path) || /\b(?:test|demo|smoke|example)\b/i.test(String(content).slice(0, 240));
    if (!testDemo && /\b(?:curl|wget|fetch\s*\(|https?:\/\/|rm\s+-[rf]|dd\s+if=|mkfs|>\s*\/dev\/)\b/i.test(content)) issues.push("support script runs network/destructive ops without test/demo marking");
  }
  return { ok: issues.length === 0, issues };
}


// ════════════════════════════════════════════════════════════════════════════
// M1: SUPPORT-FILE MANAGER + RESTORE (Hermes skill_manage parity)
// ════════════════════════════════════════════════════════════════════════════
export const SUPPORT_SUBDIRS = new Set(["references", "templates", "scripts", "assets"]);

export function validateSupportPath(filePath: string): { ok: boolean; reason?: string } {
  const p = String(filePath || "");
  if (!p) return { ok: false, reason: "file_path required" };
  if (p.includes("..")) return { ok: false, reason: "path traversal ('..') blocked" };
  if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("~")) return { ok: false, reason: "absolute/home path blocked" };
  const parts = p.split("/").filter(Boolean);
  if (parts.length < 2) return { ok: false, reason: "provide subdir/filename" };
  if (!SUPPORT_SUBDIRS.has(parts[0])) return { ok: false, reason: `must be under: ${[...SUPPORT_SUBDIRS].join(", ")}` };
  if (parts.some((s) => s.startsWith("."))) return { ok: false, reason: "dotfiles/segments blocked" };
  return { ok: true };
}

export function skillDirOf(name: string, ctx?: any): string | null { return scanDirs(ctx).find((d) => existsSync(join(d, name, "SKILL.md"))) || null; }

export function writeSupportFile(name: string, filePath: string, content: string, ctx?: any): string {
  const v = validateSupportPath(filePath); if (!v.ok) throw new Error(v.reason);
  const sc = scanSupportFile(filePath, content); if (!sc.ok) throw new Error(`security: ${sc.issues.join("; ")}`);
  const d = skillDirOf(name, ctx); if (!d) throw new Error(`no skill '${name}'`);
  const full = join(d, name, filePath);
  mkdirSync(dirname(full), { recursive: true });
  const tmp = full + ".mmtmp"; writeFileSync(tmp, content); renameSync(tmp, full); // atomic, no partial write
  return full;
}

export function removeSupportFile(name: string, filePath: string, ctx?: any): string {
  const v = validateSupportPath(filePath); if (!v.ok) throw new Error(v.reason);
  const d = skillDirOf(name, ctx); if (!d) throw new Error(`no skill '${name}'`);
  const full = join(d, name, filePath); if (!existsSync(full)) throw new Error(`no such support file`);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const grave = join(STATE_DIR, "removed-files", name, `${filePath.replace(/\//g, "__")}-${stamp}`);
  mkdirSync(dirname(grave), { recursive: true }); renameSync(full, grave); // reversible quarantine, not delete
  return grave;
}


// ════════════════════════════════════════════════════════════════════════════
// AUTOPILOT — the self-driving loop. Pure decision engine + executor so the whole
// autonomous distill/refine/manage cycle is testable WITHOUT a live model; the
// optional fork-author is a quality layer on top. Gated, budgeted, reversible, receipted.
// ════════════════════════════════════════════════════════════════════════════
export const STAGED_DIR = join(STATE_DIR, "staged");

export const STAGED_RETIRED_DIR = join(STATE_DIR, "staged-retired");

export const AUTOPILOT_STATE = join(STATE_DIR, "autopilot-state.json");


// ════════════════════════════════════════════════════════════════════════════
// v3.3 — HERMES-VISIBLE UI: surface compact, FINISHED self-improvement summaries
// (not chain-of-thought) via a Letta panel + events ledger. No transcript hack —
// only the supported openPanel + command APIs. Adrian: "let me SEE it distilling."
// ════════════════════════════════════════════════════════════════════════════
export const UI_EVENTS = join(STATE_DIR, "ui-events.jsonl");

export const UI_STATE = join(STATE_DIR, "ui-state.json");

export const REFLECT_HANDLED = join(STATE_DIR, "reflect-handled.json");

export type UiEvent = { ts: number; phase: string; summary: string; skill?: string; action?: string; route?: string; source: "muscle-memory" };

export function appendUiEvent(e: { phase: string; summary: string; skill?: string; action?: string; route?: string }) { try { ensureDir(); appendJsonl(UI_EVENTS, { ts: Date.now(), source: "muscle-memory", ...e }); } catch { /* */ } }

export let livePanel: any = null; // set in activate(); lets state changes re-render the panel LIVE (interactive mirror)

export function setLivePanel(p: any) { livePanel = p; } // setter so the entry module can wire the panel across the module boundary

export function writeUiState(s: Record<string, unknown>) { try { ensureDir(); writeFileSync(UI_STATE, JSON.stringify({ ...readUiState(), ...s, ts: Date.now() })); } catch { /* */ } try { livePanel?.update(); } catch { /* */ } }

export function readUiState(): Record<string, any> { try { return existsSync(UI_STATE) ? JSON.parse(readFileSync(UI_STATE, "utf8")) : {}; } catch { return {}; } }

export function loadUiEvents(n = 8): UiEvent[] { if (!existsSync(UI_EVENTS)) return []; const out: UiEvent[] = []; for (const l of readFileSync(UI_EVENTS, "utf8").trim().split("\n")) { if (!l) continue; try { out.push(JSON.parse(l)); } catch { /* */ } } return out.slice(-n); }


// CROSS-AGENT MESH FEED — shared so the panel shows BOTH Mack (local) + Kev (cloud) distilling.
// Best-effort; never breaks reflect. Redacted (skill name + route + counts only).
export const MESH_FEED = join(homedir(), ".local", "state", "mesh-skill-feed.jsonl");

export function meshAgentLabel(): string { return process.env.MM_AGENT || (String(process.env.MEMORY_DIR || "").includes("be7d4413") ? "mack" : "agent"); }

export function appendMeshFeed(e: { type: string; skill?: string; route?: string; signals?: number }) { try { mkdirSync(dirname(MESH_FEED), { recursive: true }); appendFileSync(MESH_FEED, JSON.stringify({ agent: meshAgentLabel(), ts: Date.now(), source: "muscle-memory", ...e }) + "\n"); } catch { /* */ } }

export function loadMeshFeed(n = 6): Array<{ agent?: string; type?: string; skill?: string; route?: string; signals?: number }> { try { if (!existsSync(MESH_FEED)) return []; const all: any[] = []; for (const l of readFileSync(MESH_FEED, "utf8").trim().split("\n")) { if (l) try { all.push(JSON.parse(l)); } catch { /* */ } } const seen = new Map<string, any>(); for (const e of all) seen.set(`${e.agent}|${e.skill}|${e.type}`, e); return [...seen.values()].slice(-n); } catch { return []; } }

export function renderMeshFeed(entries: Array<{ agent?: string; type?: string; skill?: string; route?: string; signals?: number }>): string[] {
  return entries.map((e) => `${(e.agent || "?").padEnd(5)} ${String(e.type || "").replace("skill_", "")} ${e.skill || ""}${e.route ? ` · ${e.route}` : ""}${e.signals ? ` · ${e.signals} signals` : ""}`.trim());
}
