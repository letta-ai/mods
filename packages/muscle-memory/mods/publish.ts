// muscle-memory · publish module (split from index.ts — behavior-preserving).
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";
import { GLOBAL_SKILLS_DIR, MM_TAG, PUBLISH_STAGED_DIR, appendMeshFeed, appendUiEvent, scanDirs, scanSkillContent, slug, writeUiState } from "./core";
import { lintSkillDraft, sotaQualityGaps } from "./gate";
import { SEARCH_STOP } from "./autopilot";


// ── PUBLISHABILITY PREFLIGHT (MM_PUBLISH v1, 2026-06-28) — the skill SUPPLY CHAIN: a graduated skill is
// agent-specific scar tissue; a *published* (shared Custom Skills) skill must be portable, private-data-
// safe, reusable by OTHER agents, and app-visible. This is the bridge "this agent learned" → "the mesh
// benefits". Pure + deterministic: privacy/portability/quality/reusability/compounding gates → 0-100 +
// a sanitized preview (swap identifiers, PRESERVE the mechanism/worked-examples) + a recommended action.
// Hermes authors skills; this manages their distribution. Read/dry-run by default — never auto-publishes.

// Actual secret VALUES — a hard block (a published skill must never carry these, sanitized or not).
export const PUBLISH_SECRET_RES: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{12,}\b/, // Anthropic keys carry hyphens (sk-ant-api03-…) — the plain sk- rule misses them (found by the Letta-baseline eval)
  /\bsk-[A-Za-z0-9]{16,}\b/, /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/, /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, /\bAIza[A-Za-z0-9_-]{20,}\b/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\b[A-Z][A-Z0-9_]*_(?:API_)?KEY\s*[:=]\s*['"][A-Za-z0-9_-]{12,}['"]/,
];

export function publishHardBlocks(body: string): string[] {
  const out: string[] = [];
  for (const re of PUBLISH_SECRET_RES) { const m = body.match(re); if (m) out.push(`secret/credential value present: ${m[0].slice(0, 14)}…`); }
  return out;
}

function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function gitConfigValue(key: string): string {
  const envKey = key === "user.name" ? "MM_TEST_GIT_USER_NAME" : key === "user.email" ? "MM_TEST_GIT_USER_EMAIL" : "";
  if (envKey && process.env[envKey]) return process.env[envKey] || "";
  try { return execFileSync("git", ["config", "--get", key], { encoding: "utf8", timeout: 1500, stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
}

function runtimeUserIdentifiers(): string[] {
  const vals = new Set<string>();
  const add = (v?: string) => {
    const s = String(v || "").trim();
    if (s.length >= 3 && !/^(root|user|admin|runner|node|git|local)$/i.test(s)) vals.add(s);
  };

  try { add(process.env.MM_TEST_USERINFO_USERNAME || userInfo().username); } catch { /* ignore */ }
  const gitName = gitConfigValue("user.name");
  const gitEmail = gitConfigValue("user.email");
  add(gitName);
  add(gitEmail);
  if (gitEmail.includes("@")) add(gitEmail.split("@")[0]);

  return [...vals].sort((a, b) => b.length - a.length);
}

// Sanitize identifiers → placeholders. Preserves all mechanism/code/worked-examples; only swaps PRIVATE terms.
export function sanitizeForPublish(body: string): { sanitized: string; replacements: Array<{ kind: string; from: string; to: string }> } {
  const replacements: Array<{ kind: string; from: string; to: string }> = []; let s = body;
  const sub = (kind: string, re: RegExp, to: string) => { s = s.replace(re, (m) => { if (!replacements.some((r) => r.from === m)) replacements.push({ kind, from: m, to }); return to; }); };
  sub("local-path", /\/Users\/[A-Za-z0-9._-]+/g, "<local path>");
  sub("agent-memfs", /(?:~\/)?\.letta\/(?:lc-local-backend\/memfs\/)?agents?\/[A-Za-z0-9._/-]+/g, "<agent memfs>");
  sub("agent-id", /\bagent-[a-f0-9]{6,}(?:-[a-f0-9]+)+\b/g, "<agent id>");
  sub("user", /\b(?:localuser|private-user|chan2saucy|adrianchan|adrian chan)\b/gi, "<user>");
  for (const id of runtimeUserIdentifiers()) sub("user", new RegExp(`\\b${escapeRegExp(id)}\\b`, "gi"), "<user>");
  sub("project", /\b(?:ProjectX|ExampleCorp)\b/g, "<project>");
  sub("provider-env", /\b(?:ZAI|Z_AI|OPENAI|ANTHROPIC|GLM|MORPH|KIMI|MINIMAX|GEMINI|XAI)_API_KEY\b/g, "PROVIDER_API_KEY");
  return { sanitized: s, replacements };
}

// 0-100 publishability + the issues that move it. Deterministic; reuses the SOTA gate for quality.
export function publishabilityScore(skill: { name: string; description: string; body: string }): {
  score: number; hardBlocks: string[]; issues: Array<{ axis: string; penalty: number; detail: string }>; recommended: "publish" | "stage-sanitized" | "block";
} {
  const b = skill.body; const issues: Array<{ axis: string; penalty: number; detail: string }> = [];
  const hardBlocks = publishHardBlocks(b);
  const pen = (axis: string, penalty: number, detail: string) => issues.push({ axis, penalty, detail });
  // PORTABILITY — sanitizable private/local identifiers (publishable only after sanitization)
  const { replacements } = sanitizeForPublish(b);
  const kinds = new Set(replacements.map((r) => r.kind));
  for (const k of kinds) pen("portability", 8, `${k} present (sanitize before publish): e.g. ${replacements.find((r) => r.kind === k)!.from.slice(0, 28)}`);
  // QUALITY — reuse the SOTA gate + required structure
  for (const g of sotaQualityGaps(skill)) pen("quality", 10, g.split(":")[0]);
  for (const [re, label] of [[/##\s+when to use/i, "When to use"], [/##\s+procedure/i, "Procedure"], [/##\s+pitfalls|##\s+failure/i, "Pitfalls"], [/##\s+verification/i, "Verification"]] as Array<[RegExp, string]>)
    if (!re.test(b)) pen("quality", 8, `missing ## ${label}`);
  if (!skill.description || skill.description.length < 30) pen("quality", 6, "description too thin for a shared shelf");
  // REUSABILITY — one-off / no scope guard
  if (/GENERALITY/.test(sotaQualityGaps(skill).join(" "))) pen("reusability", 10, "reads as a one-off (hardcoded specifics)");
  if (/(reset --hard|force[- ]?push|rm -rf|drop (table|database)|--force)/i.test(b) && !/(when not to use|do not use|scope|only when|caution)/i.test(b)) pen("reusability", 5, "risky ops without a when-not-to-use / scope guard");
  // COMPOUNDING — update/retire criteria (does it teach the next agent to keep it healthy?)
  if (!/(update|patch|retire|prune|absorb|anti-bloat|refine this skill|earn its context)/i.test(b)) pen("compounding", 5, "no update/retire criteria (won't compound across agents)");
  let score = Math.max(0, 100 - issues.reduce((a, i) => a + i.penalty, 0));
  if (hardBlocks.length) score = Math.min(score, 15);
  const sanitizableLeft = kinds.size > 0;
  const recommended: "publish" | "stage-sanitized" | "block" = hardBlocks.length ? "block" : (score >= 80 && !sanitizableLeft) ? "publish" : "stage-sanitized";
  return { score, hardBlocks, issues, recommended };
}

// Full preflight: the score + a sanitized preview + the recommended action. The V1 product surface.
export function publishPlan(skill: { name: string; description: string; body: string; shelf?: string }): {
  skill: string; currentShelf: string; recommendedShelf: string; publishability: number; recommended: string;
  hardBlocks: string[]; issues: Array<{ axis: string; penalty: number; detail: string }>; sanitizedPreview: string; replacements: Array<{ kind: string; from: string; to: string }>;
} {
  const sc = publishabilityScore(skill); const san = sanitizeForPublish(skill.body);
  return {
    skill: skill.name, currentShelf: skill.shelf ?? "agent", recommendedShelf: sc.recommended === "block" ? "(blocked — keep agent-local)" : "Custom Skills",
    publishability: sc.score, recommended: sc.recommended, hardBlocks: sc.hardBlocks, issues: sc.issues,
    sanitizedPreview: san.sanitized, replacements: san.replacements,
  };
}

export type PublishTier = "blocked" | "agent-local" | "team-shareable" | "marketplace-candidate";

// Tiered recommendation label.
export function publishTier(plan: { publishability: number; hardBlocks: string[]; replacements: Array<{ kind: string }> }): PublishTier {
  if (plan.hardBlocks.length) return "blocked";
  const sanitizable = plan.replacements.length > 0;
  if (plan.publishability >= 85 && !sanitizable) return "marketplace-candidate";
  if (plan.publishability >= 65) return "team-shareable";
  return "agent-local";
}

// Sanitized provenance metadata to embed on publish (NO raw ids/user/paths).
export function publishMetadata(plan: { publishability: number; replacements: Array<{ kind: string }> }, tier: string): Record<string, string | number> {
  return { origin: "muscle-memory", publishability_score: plan.publishability, tier, privacy: plan.replacements.length ? "sanitized" : "as-is", published_at: new Date().toISOString().slice(0, 10) };
}

// Duplicate check: close name/description matches among existing Custom Skills → recommend update/merge, not duplicate.
export function findSimilarSkills(name: string, description: string, existing: Array<{ name: string; description: string }>): Array<{ name: string; why: string }> {
  const toks = (s: string) => new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3 && !SEARCH_STOP.has(t)));
  const nT = toks(`${name} ${description}`); const out: Array<{ name: string; why: string }> = [];
  for (const e of existing) {
    if (e.name === name) { out.push({ name: e.name, why: "exact name match — update it, don't duplicate" }); continue; }
    const eT = toks(`${e.name} ${e.description}`); let shared = 0; for (const t of nT) if (eT.has(t)) shared++;
    const overlap = shared / Math.max(1, Math.min(nT.size, eT.size));
    if (overlap >= 0.5 && shared >= 3) out.push({ name: e.name, why: `${Math.round(overlap * 100)}% topic overlap — consider merge/update` });
  }
  return out.slice(0, 3);
}

// Stage a SANITIZED publish to the review dir: writes SKILL.md (sanitized + metadata) + PUBLISH-PLAN.json. Never publishes.
export function stageSanitizedPublish(skill: { name: string; description: string; body: string; shelf?: string }): { staged: boolean; dir: string; plan: ReturnType<typeof publishPlan>; tier: PublishTier; reason?: string } {
  const plan = publishPlan(skill); const tier = publishTier(plan);
  if (plan.hardBlocks.length) return { staged: false, dir: "", plan, tier, reason: `blocked: ${plan.hardBlocks.join("; ")}` };
  const dir = join(PUBLISH_STAGED_DIR, slug(skill.name)); try { mkdirSync(dir, { recursive: true }); } catch { /* */ }
  const meta = publishMetadata(plan, tier);
  const body = /^---\n[\s\S]*?\n---/.test(plan.sanitizedPreview)
    ? plan.sanitizedPreview.replace(/^---\n([\s\S]*?)\n---/, (_m, fm) => `---\n${fm.replace(/\n+$/, "")}\n${Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---`)
    : `---\nname: ${skill.name}\ndescription: ${skill.description}\n${Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\n${plan.sanitizedPreview}`;
  writeFileSync(join(dir, "SKILL.md"), body);
  writeFileSync(join(dir, "PUBLISH-PLAN.json"), JSON.stringify({ skill: skill.name, tier, publishability: plan.publishability, recommended: plan.recommended, issues: plan.issues, replacements: plan.replacements, metadata: meta, staged_at: Date.now() }, null, 2));
  return { staged: true, dir, plan, tier };
}

// Approve: publish the STAGED sanitized copy to the global Custom Skills shelf. Re-preflights the staged
// copy (hard-block if it now carries secrets — guards tampering). Emits caller-side skill_published. No remote push.
export function approveStagedPublish(name: string, globalDir: string): { published: boolean; path?: string; reason?: string } {
  const staged = join(PUBLISH_STAGED_DIR, slug(name), "SKILL.md");
  if (!existsSync(staged)) return { published: false, reason: "no staged copy — run `publish stage <skill>` first" };
  const body = readFileSync(staged, "utf8");
  const hb = publishHardBlocks(body); if (hb.length) return { published: false, reason: `hard block on staged copy: ${hb.join("; ")}` };
  const sec = scanSkillContent(body); if (!sec.ok) return { published: false, reason: `security: ${sec.issues.join("; ")}` };
  const dst = join(globalDir, slug(name)); try { mkdirSync(dst, { recursive: true }); } catch { /* */ }
  writeFileSync(join(dst, "SKILL.md"), body);
  return { published: true, path: join(dst, "SKILL.md") };
}

// Visibility receipt: prove the published file exists; hint /reload for the app/skill index.
export function publishVisibilityReceipt(name: string, globalDir: string): { exists: boolean; path: string; reloadHint: string } {
  const p = join(globalDir, slug(name), "SKILL.md");
  return { exists: existsSync(p), path: p, reloadHint: "run /reload (or restart the agent) so the skill index surfaces the new Custom Skill" };
}

// LIVE-INDEX confirmation (best-effort): actually query `letta skills list` to prove the agent SEES the
// published skill, not just that the file is on disk. Graceful: any failure (no agent context, locked
// memfs, index lag) falls back to the honest "on disk — /reload to surface" — never claims false visibility.
export function liveSkillVisible(name: string, agentId?: string): { checked: boolean; visible: boolean; note: string } {
  const onDisk = "on disk on the Custom Skills shelf — run /reload to load it into the live skill index";
  if (!agentId) return { checked: false, visible: false, note: onDisk };
  try {
    const out = execFileSync("letta", ["skills", "list", "--agent", agentId], { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "ignore"] });
    const visible = out.split(/\r?\n/).some((l) => l.includes(name));
    return { checked: true, visible, note: visible ? "✓ confirmed live: the agent's skill index now lists it" : `${onDisk} (not in the live index yet)` };
  } catch { return { checked: false, visible: false, note: `${onDisk} (live index query unavailable)` }; }
}


export function catalogPrivacyScan(content: string): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const body = content.replace(/^---[\s\S]*?\n---\s*\n?/, "");
  const sec = scanSkillContent(content); if (!sec.ok) issues.push(...sec.issues.map((i) => `security: ${i}`));
  if (/\/Users\/[A-Za-z0-9._-]+\//.test(content) || /\/home\/[A-Za-z0-9._-]+\//.test(content)) issues.push("private absolute user path");
  if (/lc-local-backend/.test(content) || /~\/\.letta\/agents\//.test(content) || /~\/\.agents\/agents\//.test(content)) issues.push("local harness path");
  if (/\b(?:private-store\.myshopify\.com|examplecorp|example-host|agent-71b0883e|localuser|private-user)\b/i.test(content)) issues.push("private org/user/agent identifier");
  if (/references\/evidence|receipt json|final-gate-result\.json/i.test(body) && /\/Users\//.test(content)) issues.push("private evidence reference");
  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}


export function publishSkillToCatalog(name: string, ctx?: any): string {
  const nm = slug(name);
  if (!nm) throw new Error("name required");
  const d = scanDirs(ctx).find((x) => existsSync(join(x, nm, "SKILL.md")));
  if (!d) throw new Error(`no active skill '${nm}'`);
  const src = join(d, nm, "SKILL.md");
  if (!existsSync(src)) throw new Error(`no SKILL.md for '${nm}'`);
  const content = readFileSync(src, "utf8");
  const desc = (content.match(/^description:\s*(.+)$/im)?.[1] || "").trim();
  const body = content.replace(/^---[\s\S]*?\n---\s*\n?/, "");
  const lint = lintSkillDraft({ name: nm, description: desc, body });
  if (!lint.ok) throw new Error(`linter blocked: ${lint.issues.join("; ")}`);
  const priv = catalogPrivacyScan(content);
  if (!priv.ok) throw new Error(`privacy blocked: ${priv.issues.join("; ")}`);
  const dstDir = join(GLOBAL_SKILLS_DIR, nm);
  mkdirSync(dstDir, { recursive: true });
  const published = content.includes(MM_TAG) ? content : content + `\n<!-- ${MM_TAG}: published ${new Date().toISOString().slice(0, 10)}; catalog=global -->\n`;
  writeFileSync(join(dstDir, "SKILL.md"), published);
  appendUiEvent({ phase: "skill_published", summary: `published '${nm}' to custom skill catalog`, skill: nm, action: "publish", route: "global-catalog" });
  appendMeshFeed({ type: "skill_published", skill: nm, route: "PUBLISH", signals: 0 });
  writeUiState({ phase: "done", last: `published '${nm}' to catalog`, route: "PUBLISH · catalog" });
  return join(dstDir, "SKILL.md");
}
