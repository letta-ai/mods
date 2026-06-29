// muscle-memory · lifecycle module (split from index.ts — behavior-preserving).
import { mkdirSync, readFileSync, existsSync, writeFileSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { Row, USAGE_PATH, appendMeshFeed, appendUiEvent, autonomousShelves, ensureDir, isManaged, listSkillNames, loadRows, readSkill, scanDirs, skillDesc, slug, writeUiState } from "./core";
import { buildCrossConversationEvidence, detectRepairChains, isDurableLesson, stepSig } from "./detect";
import { pickUpdateTarget, searchSkills } from "./autopilot";


export function managedSkillUsage(name: string, rows: Row[] = loadRows()): number {
  const n = slug(name);
  return rows.filter((r) => (r.tmpl || r.fp || "").toLowerCase().includes(`skill ${n}`)).length;
}

export function curateManagedSkills(ctx?: any) {
  const rows = loadRows();
  const dirs = scanDirs(ctx);
  const out: Array<{ name: string; dir: string; uses: number; verdict: "keep" | "review" | "retire_candidate"; reason: string }> = [];
  for (const d of dirs) {
    for (const n of listSkillNames(d)) {
      if (!isManaged(d, n)) continue;
      const uses = managedSkillUsage(n, rows);
      let verdict: "keep" | "review" | "retire_candidate" = "keep";
      let reason = "managed skill has observed use or is newly created";
      if (uses === 0) { verdict = "review"; reason = "no observed Skill-tool usage yet; keep if newly created, retire if stale"; }
      out.push({ name: n, dir: d, uses, verdict, reason });
    }
  }
  return out.sort((a, b) => a.uses - b.uses || a.name.localeCompare(b.name));
}

export function retireManagedSkill(name: string, reason: string, ctx?: any, absorbedInto?: string, restrictDirs?: string[]): string {
  // restrictDirs (Block N): autonomous callers pass autonomousShelves(ctx) so a retire can NEVER reach the
  // shared global shelf even if a global skill matches the name. Default (explicit ops) sees agent+global.
  const dirs = restrictDirs ?? scanDirs(ctx);
  const d = dirs.find((x) => existsSync(join(x, name, "SKILL.md")));
  if (!d) throw new Error(`no skill '${name}'`);
  if (!isManaged(d, name)) throw new Error(`refusing to retire unmanaged skill '${name}'`);
  if (isPinned(name)) throw new Error(`'${name}' is pinned — unpin first (pin protects from retire, not from patch)`);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const retiredRoot = join(d, "_retired");
  mkdirSync(retiredRoot, { recursive: true });
  const target = join(retiredRoot, `${name}-${stamp}`);
  const forward = absorbedInto ? `absorbed_into: ${absorbedInto}\n` : "";
  writeFileSync(join(d, name, "RETIRE-REASON.txt"), `${new Date().toISOString()}\n${reason || "retired by muscle-memory curate"}\n${forward}`);
  renameSync(join(d, name), target);
  // record the lifecycle event in the usage sidecar (reversible quarantine, Hermes "never delete")
  const u = loadUsage(); u[name] = { ...(u[name] || {}), state: "archived", absorbedInto: absorbedInto || undefined }; saveUsage(u);
  return target;
}


export function runAutonomousPrune(ctx?: any, opts: { maxRetire?: number } = {}): { retired: string[]; retiredPaths: string[]; flagged: string[]; kept: string[] } {
  const maxRetire = Math.max(0, opts.maxRetire ?? 1);
  const usage = loadUsage();
  const now = Date.now();
  const retired: string[] = [];
  const retiredPaths: string[] = [];
  const flagged: string[] = [];
  const kept: string[] = [];

  // Block N BOUNDARY: autonomous prune iterates ONLY agent-local shelves — it must never retire a shared
  // global Custom Skill another agent may depend on. Global stays audit-visible (scanDirs) but mutation-safe.
  for (const d of autonomousShelves(ctx)) {
    for (const n of listSkillNames(d)) {
      if (!isManaged(d, n)) { kept.push(n); continue; }
      const u = usage[n] || {};
      if (u.pinned) { kept.push(n); continue; }
      const uses = u.uses || 0;
      if (uses > 0 || u.lastActivity) { kept.push(n); continue; }
      const created = u.created || now;
      const ageDays = Math.floor((now - created) / 86400000);
      if (ageDays > 30 && retired.length < maxRetire) {
        const reason = `auto-prune: 0 uses in ${ageDays}d — not earning context (reversible quarantine)`;
        const target = retireManagedSkill(n, reason, ctx, undefined, [d]); // restrict to THIS agent shelf — never global
        retired.push(n);
        retiredPaths.push(target);
        appendUiEvent({ phase: "skill_retired", summary: `retired '${n}' (0 uses, ${ageDays}d) — reversible`, skill: n, action: "retire", route: "auto-prune" });
        appendMeshFeed({ type: "skill_retired", skill: n, route: "AUTO-PRUNE", signals: 0 });
      } else if (ageDays > 14) {
        flagged.push(n);
        appendUiEvent({ phase: "skill_review", summary: `review '${n}' (0 uses, ${ageDays}d)`, skill: n, action: "review", route: "auto-prune" });
      } else {
        kept.push(n);
      }
    }
  }
  if (retired.length) writeUiState({ phase: "done", last: `retired '${retired[0]}' — reversible`, route: "AUTO-PRUNE · live" });
  return { retired, retiredPaths, flagged, kept };
}


// — my-add #4 / D: EFFECTIVENESS-DRIVEN RETIREMENT + telemetry aggregation —
export type LlmSpan = { tokensIn?: number; tokensOut?: number; ms?: number; stop?: string };

export function aggregateTelemetry(spans: LlmSpan[]): { calls: number; tokensIn: number; tokensOut: number; ms: number } {
  // aggregate ONLY — never store raw prompts/messages.
  return spans.reduce((a, s) => ({ calls: a.calls + 1, tokensIn: a.tokensIn + (s.tokensIn || 0), tokensOut: a.tokensOut + (s.tokensOut || 0), ms: a.ms + (s.ms || 0) }), { calls: 0, tokensIn: 0, tokensOut: 0, ms: 0 });
}


// — E. REGISTRY CATALOG (Hermes-like mini package registry) —
export function buildRegistry(dirs: string[]): { generated: string; count: number; skills: Array<{ name: string; description: string; dir: string; provenance: string; state: string; pinned: boolean; uses: number; absorbedInto?: string }> } {
  const usage = loadUsage();
  const skills: Array<{ name: string; description: string; dir: string; provenance: string; state: string; pinned: boolean; uses: number; absorbedInto?: string }> = [];
  for (const d of dirs) for (const n of listSkillNames(d)) {
    if (!isManaged(d, n)) continue;
    const prov = (readSkill(d, n).match(/<!--\s*muscle-memory provenance:([^>]*)-->/)?.[1] || "").trim();
    const u = usage[n] || {};
    skills.push({ name: n, description: skillDesc(d, n), dir: d, provenance: prov, state: u.state || "active", pinned: !!u.pinned, uses: u.uses || 0, absorbedInto: u.absorbedInto });
  }
  return { generated: new Date().toISOString(), count: skills.length, skills: skills.sort((a, b) => a.name.localeCompare(b.name)) };
}

/** Curator pass: pure, fake-clock-testable lifecycle walk (active→stale→archived→reactivate, pin-frozen). */
export function curatorPass(managed: Array<{ name: string; lastActivityDaysAgo: number; state?: SkillState; pinned?: boolean }>): { transitions: Array<{ name: string; from: SkillState; to: SkillState }> } {
  const transitions: Array<{ name: string; from: SkillState; to: SkillState }> = [];
  for (const m of managed) {
    const r = lifecycleTransition({ state: m.state, lastActivityDaysAgo: m.lastActivityDaysAgo, pinned: m.pinned });
    if (r.changed) transitions.push({ name: m.name, from: m.state || "active", to: r.state });
  }
  return { transitions };
}


// — my-add #5. SPEC-DRIFT: a managed skill whose referenced verbs no longer occur in experience —
export function skillVerbs(body: string): string[] {
  const out = new Set<string>();
  const pat = body.match(/##\s*Observed pattern\s*```text\s*([\s\S]*?)```/i);
  if (pat) for (const seg of pat[1].split(/\s*→\s*|\n/)) { const t = seg.trim().toLowerCase(); if (/^[a-z][a-z0-9 ._-]{1,23}$/.test(t) && !["text", "bash"].includes(t)) out.add(t); }
  return [...out];
}

export function specDrift(body: string, rows: Row[]): { drift: boolean; missing: string[]; verbs: string[] } {
  const verbs = skillVerbs(body);
  if (!verbs.length) return { drift: false, missing: [], verbs };
  const seen = new Set(rows.map((r) => stepSig(r).toLowerCase()));
  const seenArr = [...seen];
  const missing = verbs.filter((v) => !seenArr.some((s) => s === v || s.includes(v) || v.includes(s)));
  return { drift: missing.length === verbs.length, missing, verbs };
}

export type SkillState = "active" | "stale" | "archived";

export const CURATOR = { STALE_DAYS: 30, ARCHIVE_DAYS: 90, IDLE_HOURS: 2 };

export type UsageRec = { uses?: number; lastActivity?: number; created?: number; state?: SkillState; pinned?: boolean; absorbedInto?: string };


/** Pure, reversible lifecycle transition (Hermes curator core). Pinned = frozen. */
export function lifecycleTransition(input: { state?: SkillState; lastActivityDaysAgo: number; pinned?: boolean }): { state: SkillState; changed: boolean } {
  const state: SkillState = input.state || "active";
  if (input.pinned) return { state, changed: false };
  const d = input.lastActivityDaysAgo;
  if (d >= CURATOR.ARCHIVE_DAYS && state !== "archived") return { state: "archived", changed: true };
  if (d >= CURATOR.STALE_DAYS && state === "active") return { state: "stale", changed: true };
  if (d < CURATOR.STALE_DAYS && state === "stale") return { state: "active", changed: true }; // reactivate on use
  return { state, changed: false };
}

export function loadUsage(): Record<string, UsageRec> { try { return existsSync(USAGE_PATH) ? JSON.parse(readFileSync(USAGE_PATH, "utf8")) : {}; } catch { return {}; } }

export function saveUsage(u: Record<string, UsageRec>) { try { ensureDir(); writeFileSync(USAGE_PATH, JSON.stringify(u, null, 2)); } catch { /* */ } }

export function bumpUsage(name: string) { const u = loadUsage(); const r = u[name] || { created: Date.now(), state: "active" as SkillState }; r.uses = (r.uses || 0) + 1; r.lastActivity = Date.now(); if (r.state === "stale" || r.state === "archived") r.state = "active"; u[name] = r; saveUsage(u); }

export function setPinned(name: string, pinned: boolean) { const u = loadUsage(); u[name] = { ...(u[name] || { created: Date.now() }), pinned }; saveUsage(u); }

export function isPinned(name: string): boolean { return !!loadUsage()[name]?.pinned; }

/** Restore a retired skill from _retired/<name>-<stamp> back into the skills dir. */
export function restoreManagedSkill(name: string, ctx?: any): string {
  const dirs = scanDirs(ctx);
  for (const d of dirs) {
    const retiredRoot = join(d, "_retired"); if (!existsSync(retiredRoot)) continue;
    const matches = readdirSync(retiredRoot).filter((n) => n === name || n.startsWith(`${name}-`)).sort().reverse();
    if (matches.length) {
      if (existsSync(join(d, name, "SKILL.md"))) throw new Error(`'${name}' already active`);
      renameSync(join(retiredRoot, matches[0]), join(d, name));
      const u = loadUsage(); u[name] = { ...(u[name] || {}), state: "active", lastActivity: Date.now() }; saveUsage(u);
      return join(d, name);
    }
  }
  throw new Error(`no retired skill '${name}' to restore`);
}


// 3. SKILL COVERAGE MAP — defensive assignments: every task class has a defender; dupes get a zone.
export type CoverageRow = { domain: string; status: "covered" | "uncovered" | "over-covered" | "noise"; skill?: string; signals: number };

export function coverageMap(rows: Row[], dirs: string[]): CoverageRow[] {
  const ev = buildCrossConversationEvidence(rows);
  const out: CoverageRow[] = [];
  for (const r of detectRepairChains(rows).filter((x) => isDurableLesson(x.errClass))) {
    const hits = searchSkills(dirs, `${r.trigger} ${r.fixStep} ${r.errClass}`, 4);
    const tgt = pickUpdateTarget(hits, 18);
    const overCovered = hits.filter((h) => h.matched >= 2).length >= 2;
    out.push({ domain: r.trigger, status: tgt ? (overCovered ? "over-covered" : "covered") : "uncovered", skill: tgt?.name, signals: r.count });
  }
  for (const rej of ev.rejected) out.push({ domain: rej.item, status: "noise", signals: 0 });
  return out;
}


// 4. CHURN-AWARE LIFECYCLE — git/usage churn as a stability signal (basketball: rotation status).
export type ChurnVerdict = "stable-veteran" | "needs-verification" | "g-league" | "blocked" | "active";

export function churnSignal(i: { patches: number; ageDays: number; uses: number; reverted?: boolean }): { verdict: ChurnVerdict; reason: string } {
  if (i.reverted) return { verdict: "blocked", reason: "reverted — blocked from auto-regeneration unless new evidence overrides the old rejection" };
  if (i.patches >= 5 && i.ageDays <= 2) return { verdict: "needs-verification", reason: `patched ${i.patches}× in ${i.ageDays}d — unstable; verify before trusting` };
  if (i.uses === 0 && i.ageDays > 7) return { verdict: "g-league", reason: `created but never invoked in ${i.ageDays}d — bench it` };
  if (i.uses > 0 && i.patches <= 1) return { verdict: "stable-veteran", reason: `used ${i.uses}×, low churn` };
  return { verdict: "active", reason: "in rotation" };
}
