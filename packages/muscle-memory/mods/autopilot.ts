// muscle-memory · autopilot module (split from index.ts — behavior-preserving).
import { mkdirSync, readFileSync, existsSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { AUTOPILOT_STATE, Candidate, MM, MM_TAG, RECEIPTS_DIR, REFLECT_HANDLED, Row, STAGED_DIR, STAGED_RETIRED_DIR, STATE_DIR, agentSkillsDir, appendMeshFeed, appendUiEvent, ensureDir, hash, isManaged, listSkillNames, loadExperience, readSkill, scanDirs, scanSkillContent, skillDesc, slug, writeSkill, writeUiState } from "./core";
import { DESTRUCTIVE, RepairChain, buildCrossConversationEvidence, detect, detectAntiPatterns, detectRepairChains, impactScore, isValidSkillName, multiInstanceSupport } from "./detect";
import { dedupCheck, draftWithRepair, effectivenessVerdict, findCandidate, lintSkillDraft, repairForCandidate, sotaQualityGaps } from "./gate";
import { publishPlan, publishSkillToCatalog, publishTier } from "./publish";
import { ENGRAM, engramConsolidate } from "./engram";
import { loadUsage, retireManagedSkill, retiredSkillBlocker, skillVerbs, specDrift } from "./lifecycle";

export type AutopilotMode = "off" | "staged" | "auto";

export type AutopilotConfig = { mode: AutopilotMode; dailyBudget: number; minImpact: number };

export const AUTOPILOT_DEFAULT: AutopilotConfig = { mode: "staged", dailyBudget: 5, minImpact: 4.0 };


export type AutopilotDecision =
  | { op: "distill"; candidate: Candidate; name: string; reason: string; gate: "graduate" | "stage" }
  | { op: "refine"; skill: string; reason: string }
  | { op: "retire"; skill: string; reason: string; absorbedInto?: string };

export type ManagedView = { name: string; description: string; body: string; uses: number; ageDays: number; pinned?: boolean };

export type AutopilotPlan = { decisions: AutopilotDecision[]; skipped: Array<{ what: string; why: string }>; budget: { used: number; limit: number }; mode: AutopilotMode };


export function repairForRows(c: Candidate, rows: Row[]): RepairChain | undefined {
  if (!c.fixes) return undefined;
  const first = c.key.split(/\s*→\s*/)[0];
  return detectRepairChains(rows).find((r) => r.trigger === first || r.verifyStep === first || c.key.includes(r.trigger) || c.key.includes(r.verifyStep));
}


/** PURE decision engine: what should the autopilot do right now? Fully testable. */
export function autopilotPlan(input: { rows: Row[]; managed: ManagedView[]; dirsForDedup: string[]; config?: AutopilotConfig; budgetUsedToday?: number }): AutopilotPlan {
  const cfg = input.config || AUTOPILOT_DEFAULT;
  const decisions: AutopilotDecision[] = [];
  const skipped: Array<{ what: string; why: string }> = [];
  let used = input.budgetUsedToday || 0;
  if (cfg.mode === "off") return { decisions, skipped: [{ what: "all", why: "autopilot off" }], budget: { used, limit: cfg.dailyBudget }, mode: cfg.mode };

  const existing = new Set(input.managed.map((m) => m.name));
  const refineTargets = new Set<string>();

  // 1) REFINE: a managed skill whose documented failure recurs in current anti-patterns.
  const apSteps = detectAntiPatterns(input.rows).map((p) => p.step.toLowerCase());
  for (const m of input.managed) {
    if (m.pinned) continue;
    const verbs = skillVerbs(m.body);
    if (verbs.length && verbs.some((v) => apSteps.some((s) => s === v || s.includes(v) || v.includes(s)))) {
      decisions.push({ op: "refine", skill: m.name, reason: "documented failure recurring — strengthen the pitfall" });
      refineTargets.add(m.name);
    }
  }

  // 2) DISTILL: mature, high-impact, novel candidates (gated + budgeted).
  for (const c of detect(input.rows).candidates) {
    if (used >= cfg.dailyBudget) { skipped.push({ what: c.key, why: "daily budget reached" }); continue; }
    if (DESTRUCTIVE.test(c.key)) { skipped.push({ what: c.key, why: "destructive workflow — never auto-distilled" }); continue; } // explicit safety gate, before impact
    const imp = impactScore(c).score;
    if (imp < cfg.minImpact) { skipped.push({ what: c.key, why: `impact ${imp} < ${cfg.minImpact}` }); continue; }
    const draft = draftWithRepair(c, repairForRows(c, input.rows));
    const nm = slug(draft.name);
    if (existing.has(nm)) { skipped.push({ what: nm, why: "already managed — refine, don't re-distill" }); continue; }
    const dc = dedupCheck(nm, draft.description, input.dirsForDedup);
    if (dc.dup) { skipped.push({ what: nm, why: `dedup: ${dc.reason}` }); continue; }
    const lint = lintSkillDraft({ name: nm, description: draft.description, body: draft.body }, { needsPitfalls: !!c.fixes });
    if (!lint.ok) { skipped.push({ what: nm, why: `lint: ${lint.issues[0]}` }); continue; }
    // Auto-graduate only in full-auto mode AND with a verified success in the pattern; else stage for 1-tap.
    const verified = c.fixes > 0 || c.count >= MM.STRONG_SINGLE;
    const gate: "graduate" | "stage" = cfg.mode === "auto" && verified ? "graduate" : "stage";
    decisions.push({ op: "distill", candidate: c, name: nm, reason: `impact ${imp}, ${c.count} reps${verified ? ", verified" : ""}`, gate });
    existing.add(nm); // dedup: same repair surfaced as both a template + a sequence won't double-distill this pass
    used++;
  }

  // 3) RETIRE: stale/unused/drifted managed skills (not refine-flagged, not pinned). Reversible.
  for (const m of input.managed) {
    if (m.pinned || refineTargets.has(m.name)) continue;
    const drift = specDrift(m.body, input.rows).drift;
    const ev = effectivenessVerdict({ uses: m.uses, ageDays: m.ageDays, staleAntiPattern: false });
    if (drift) decisions.push({ op: "retire", skill: m.name, reason: "spec-drift: referenced commands no longer occur" });
    else if (ev.verdict === "retire_candidate") decisions.push({ op: "retire", skill: m.name, reason: ev.reason });
  }

  return { decisions, skipped, budget: { used, limit: cfg.dailyBudget }, mode: cfg.mode };
}


export function provenanceBlock(c: Candidate): string {
  return `\n<!-- ${MM_TAG}: autopilot ${new Date().toISOString().slice(0, 10)}; candidate=${c.kind}:${c.key}; reps=${c.count}; convs=${c.convs}; fixes=${c.fixes}; impact=${impactScore(c).score} -->\n`;
}

export function appendRecurrenceNote(dir: string, name: string, note: string): boolean {
  if (!existsSync(join(dir, name, "SKILL.md"))) return false;
  let t = readSkill(dir, name);
  const stamp = new Date().toISOString().slice(0, 10);
  const line = `- (${stamp}) autopilot: ${note}\n`;
  if (/##\s+Pitfalls/i.test(t)) t = t.replace(/(##\s+Pitfalls[^\n]*\n)/i, `$1${line}`);
  else t = t.replace(/(\n## Verification)/, `\n## Pitfalls (autopilot)\n${line}\n$1`);
  writeSkill(dir, name, t);
  return true;
}


/** Execute a plan with explicit deps (testable). author defaults to the deterministic drafter. */
export function executeAutopilotPlan(plan: AutopilotPlan, opts: { skillsDir: string; rows: Row[]; author?: (c: Candidate, r?: RepairChain) => { name: string; description: string; body: string }; ctx?: any }): { graduated: string[]; staged: string[]; refined: string[]; retired: string[]; receipts: any[] } {
  const author = opts.author || ((c, r) => draftWithRepair(c, r));
  const graduated: string[] = [], staged: string[] = [], refined: string[] = [], retired: string[] = [];
  const receipts: any[] = [];
  for (const d of plan.decisions) {
    try {
      if (d.op === "distill") {
        const draft = author(d.candidate, repairForRows(d.candidate, opts.rows));
        const content = `---\nname: ${d.name}\ndescription: ${draft.description}\n---\n\n${draft.body}${provenanceBlock(d.candidate)}\n`;
        const sec = scanSkillContent(content); // M2: security gate on autopilot graduate/stage
        if (!sec.ok) { receipts.push({ op: "distill", name: d.name, blocked: `security: ${sec.issues.join("; ")}`, ts: Date.now() }); continue; }
        if (d.gate === "graduate") { writeSkill(opts.skillsDir, d.name, content); graduated.push(d.name); }
        else { writeSkill(STAGED_DIR, d.name, content); staged.push(d.name); }
        receipts.push({ op: "distill", name: d.name, gate: d.gate, reason: d.reason, ts: Date.now() });
      } else if (d.op === "refine") {
        if (appendRecurrenceNote(opts.skillsDir, d.skill, d.reason)) { refined.push(d.skill); receipts.push({ op: "refine", name: d.skill, reason: d.reason, ts: Date.now() }); }
      } else if (d.op === "retire") {
        const target = retireManagedSkill(d.skill, d.reason, opts.ctx, d.absorbedInto);
        retired.push(d.skill); receipts.push({ op: "retire", name: d.skill, reason: d.reason, target, ts: Date.now() });
      }
    } catch (e: any) { receipts.push({ op: d.op, error: String(e?.message ?? e) }); }
  }
  return { graduated, staged, refined, retired, receipts };
}


// budget persistence (per-day trust budget)
export function loadAutopilotState(): { date: string; used: number } { try { const s = JSON.parse(readFileSync(AUTOPILOT_STATE, "utf8")); const today = new Date().toISOString().slice(0, 10); return s.date === today ? s : { date: today, used: 0 }; } catch { return { date: new Date().toISOString().slice(0, 10), used: 0 }; } }

export function saveAutopilotState(s: { date: string; used: number }) { try { ensureDir(); writeFileSync(AUTOPILOT_STATE, JSON.stringify(s)); } catch { /* */ } }


/** Build the managed-skill view (uses + age + pin) from disk + usage sidecar. */
export function managedView(dirs: string[]): ManagedView[] {
  const usage = loadUsage();
  const out: ManagedView[] = [];
  for (const d of dirs) for (const n of listSkillNames(d)) {
    if (!isManaged(d, n)) continue;
    const u = usage[n] || {};
    const created = u.created || Date.now();
    out.push({ name: n, description: skillDesc(d, n), body: readSkill(d, n), uses: u.uses || 0, ageDays: Math.floor((Date.now() - created) / 86400000), pinned: !!u.pinned });
  }
  return out;
}


/** Extract text from a stream chunk across the shapes Letta/providers emit (string, {text}, {delta},
 * {content:string|{text}|[{text}]}, OpenAI {choices:[{delta:{content}}]}). Returns "" for non-text
 * control chunks — so we NEVER accumulate "[object Object]" (the live fork-author reject bug). */
export function streamChunkText(c: any): string {
  if (c == null) return "";
  if (typeof c === "string") return c;
  if (typeof c.text === "string") return c.text;
  if (typeof c.delta === "string") return c.delta;
  if (typeof c.content === "string") return c.content;
  if (typeof c.delta?.text === "string") return c.delta.text;
  if (typeof c.delta?.content === "string") return c.delta.content;
  if (typeof c.content?.text === "string") return c.content.text;
  if (Array.isArray(c.content)) return c.content.map((x: any) => (typeof x === "string" ? x : x?.text ?? "")).join("");
  if (typeof c.choices?.[0]?.delta?.content === "string") return c.choices[0].delta.content;
  if (typeof c.choices?.[0]?.text === "string") return c.choices[0].text;
  return "";
}


/** Consume a model-fork stream but NEVER hang: resolve with whatever accumulated after a hard timeout.
 * The freeze guard — an unbounded `for await` on a stalled stream is what froze the panel on
 * "writing skill…" for an hour. Bounded by MM_FORK_TIMEOUT_MS (default 60s). The dangling reader is
 * parked harmlessly; the caller always proceeds to a terminal UI state. */
export async function consumeStreamBounded(stream: AsyncIterable<unknown>): Promise<string> {
  const ms = Number(process.env.MM_FORK_TIMEOUT_MS) || 60_000;
  let out = "";
  const reader = (async () => { try { for await (const c of stream) out += streamChunkText(c); } catch { /* */ } return out; })();
  const timer = new Promise<string>((resolve) => setTimeout(() => resolve(out), ms));
  return Promise.race([reader, timer]);
}


/** Optional model-fork author: the model writes a richer SKILL.md body in a hidden conversation.
 * Fully guarded — ANY failure returns null and the executor falls back to the deterministic drafter,
 * so the autopilot loop can never break. (Live-only path; the deterministic fallback is what's unit-tested.) */
export async function forkAuthor(ctx: any, c: Candidate, repair?: RepairChain): Promise<{ name: string; description: string; body: string } | null> {
  try {
    if (typeof ctx?.conversation?.fork !== "function") return null;
    const det = draftWithRepair(c, repair);
    const prompt = `You are muscle-memory's skill author. Write ONLY the markdown BODY (no YAML frontmatter) of a SKILL.md capturing this recurring real workflow. Keep it under 120 lines. Required sections in order: "## Trigger", "## Observed pattern" (include the exact pattern in a code block), "## Procedure" (numbered, concrete, adaptable), ${repair ? `"## Pitfalls" (the observed error "${repair.errClass}" and its fix "${repair.fixStep}"), ` : ""}"## Verification". Pattern: ${c.key}. Reps: ${c.count} across ${c.convs} conversation(s). Output ONLY the markdown body, nothing else.`;
    const forked = await ctx.conversation.fork({ hidden: true });
    const stream = await forked.sendMessageStream([{ role: "user", content: prompt }]);
    let body = await consumeStreamBounded(stream as AsyncIterable<unknown>);
    body = body.trim().replace(/^```(?:markdown|md)?\n?|\n?```$/g, "");
    if (body.length < 80 || !/##\s*Procedure/i.test(body) || !/##\s*Verification/i.test(body)) return null; // malformed → fallback
    const lint = lintSkillDraft({ name: det.name, description: det.description, body }, { needsPitfalls: !!c.fixes });
    if (!lint.ok) return null; // model body failed the linter → fallback to deterministic
    const sec = scanSkillContent(body);
    if (!sec.ok) return null; // dangerous/secret model output → reject, fall back to deterministic (no live write)
    return { name: det.name, description: det.description, body };
  } catch { return null; }
}


/** Live autopilot run: build plan from real state, model-author richer bodies (best-effort), execute, persist. */
export async function runAutopilot(ctx: any, config?: AutopilotConfig): Promise<AutopilotPlan & { result?: any }> {
  const cfg = config || AUTOPILOT_DEFAULT;
  const dirs = scanDirs(ctx);
  const rows = loadExperience();
  const st = loadAutopilotState();
  const plan = autopilotPlan({ rows, managed: managedView(dirs), dirsForDedup: dirs, config: cfg, budgetUsedToday: st.used });
  if (cfg.mode === "off" || !plan.decisions.length) return plan;
  // DETERMINISTIC authoring — synchronous, headless-safe: never blocks/hangs on a model fork, so the
  // skill ALWAYS ships even if the process exits right after conversation_close (the live-flow bug this
  // fixes: awaiting per-decision forks meant headless `-p` exited before anything was written). Richer
  // model-authored class-level skills are the REFLECTIVE-REVIEW path (MM_REFLECT); autopilot stays fast.
  const result = executeAutopilotPlan(plan, { skillsDir: agentSkillsDir(ctx), rows, ctx });
  saveAutopilotState({ date: st.date, used: st.used + result.graduated.length + result.staged.length });
  // Mirror autopilot activity to the LIVE PANEL — the always-on path (fires even with MM_REFLECT=off).
  // This is the showcase moment: the agent watches itself distill a skill, with no user command.
  if (result.graduated.length || result.staged.length) {
    const g = result.graduated[0], s = result.staged[0];
    const summary = g
      ? `graduated '${g}'${result.graduated.length > 1 ? ` +${result.graduated.length - 1}` : ""}`
      : `staged '${s}'${result.staged.length > 1 ? ` +${result.staged.length - 1}` : ""} for review`;
    appendUiEvent({ phase: g ? "skill_graduated" : "skill_staged", summary, skill: g || s, action: g ? "graduate" : "stage", route: "autopilot" });
    writeUiState({ phase: "done", last: summary, route: `AUTOPILOT · ${g ? "graduate" : "stage"}` });
    for (const n of result.graduated) appendMeshFeed({ type: "skill_graduated", skill: n, route: "AUTOPILOT", signals: 0 });
    // v1.1 parity: auto publishability preflight (read-only) on AUTOPILOT graduation too, not just manual.
    for (const n of result.graduated) { try { const _d = agentSkillsDir(ctx); const _b = readSkill(_d, n); if (_b) { const _p = publishPlan({ name: n, description: skillDesc(_d, n), body: _b, shelf: "agent" }); appendUiEvent({ phase: "skill_publish_preflight", summary: `${n}: ${_p.publishability}/100 · tier=${publishTier(_p)} · ${_p.recommended}`, skill: n, route: "auto-after-graduate" }); } } catch { /* preflight must never break autopilot */ } }
  }
  // OPT-IN promotion (MM_PUBLISH=auto): copy freshly-graduated skills to the shared shelf
  // (~/.letta/skills) so they appear under the app's Custom Skills, reusable for ALL agents.
  // Default off — graduate is agent-scoped; publishing to the global catalog is a deliberate step.
  // Best-effort + privacy/lint-gated inside publishSkillToCatalog: a block never breaks the loop.
  const published: string[] = [];
  if (process.env.MM_PUBLISH === "auto" && result.graduated.length) {
    for (const n of result.graduated) { try { publishSkillToCatalog(n, ctx); published.push(n); } catch { /* privacy/lint gate or no-op — skip */ } }
    if (published.length) {
      appendUiEvent({ phase: "skill_published", summary: `published ${published.length} to catalog (Custom Skills)`, skill: published[0], action: "publish", route: "autopilot" });
      writeUiState({ phase: "done", last: `published '${published[0]}' to catalog`, route: "AUTOPILOT · publish" });
      for (const n of published) appendMeshFeed({ type: "skill_published", skill: n, route: "CATALOG", signals: 0 });
    }
  }
  try { ensureDir(); mkdirSync(RECEIPTS_DIR, { recursive: true }); writeFileSync(join(RECEIPTS_DIR, `autopilot-${Date.now()}.json`), JSON.stringify({ mode: cfg.mode, ...result, published, ts: Date.now() }, null, 2)); } catch { /* */ }
  return { ...plan, result };
}


// The tuned v3 reviewer prompt (benchmark-proven Hermes-level: 43-44/50, hermes_level=yes).
export const REVIEW_PROMPT = `You are the skill-library reviewer for a self-improving AI coding agent (agentskills.io). From the cross-session evidence, author ONE genuinely valuable CLASS-LEVEL skill IF a durable reusable lesson emerged.

Write a COMPLETE skill — completeness matters more than brevity. Structure: frontmatter (name + description with triggers), then "## When to use" (concrete triggers), "## Procedure" (numbered, concrete, safe-first), "## Pitfalls" (one entry per genuinely-distinct hard-won failure, each as the real symptom → the exact fix → a one-line diagnostic TELL), "## Verification", and — when the evidence is diverse — a "## Worked examples (real cases)" section. MATCH LENGTH TO EVIDENCE: a short skill is right for simple/sparse evidence; a RICH, exhaustive skill is right when the evidence is diverse (many distinct real failures) — never sacrifice a real pitfall or worked-example to hit a length target. FINISH every section — never trail off mid-sentence or mid-code-block. Stay organized + hygienic (clear sections, short fenced snippets), never a wall of text.

HARD RULES:
- CAPTURE EVERY REAL PITFALL: include each genuinely-distinct hard-won failure in the evidence (this breadth of real, cross-session lessons IS the whole advantage), each with its exact fix. Cut filler, redundancy, and obvious steps ruthlessly — but never drop a real pitfall to save space.
- DECISION-AWARE: for recovery/debugging/troubleshooting skills especially, structure the Procedure as a DECISION GUIDE — symptom → safest fix first → fallback — so the reader knows WHICH path to take, not just a menu of options.
- CONCRETE + ACCURATE: show exact, CORRECT code/commands in fenced blocks (a wrong or hand-wavy example is worse than none — verify it actually fixes the stated problem). Keep code snippets short + self-contained so they never get cut off. Every step specific.
- SAFE FIRST: ALWAYS make a non-destructive safety net (a backup branch/tag, a stash, or a copy) the EXPLICIT first step before any destructive/irreversible command (reset --hard, force-push, rm, drop, db migrate) — and name it as the safety net so a wrong move is recoverable.
- NAMING: class-level only; never an x-to-y transition, error string, PR number, date, codename, or fix-/debug-/audit-today artifact.
- NEGATIVE FILTER: never capture environment-dependent failures (command-not-found, missing binaries, uninstalled packages, creds) or tool-negatives ("X is broken").
- WORKED EXAMPLES (the edge — use them FULLY): the evidence may include real, cross-session symptom→fix examples. Do TWO things, not one: (1) GENERALIZE them into a high-altitude decision guide in the Procedure/Pitfalls (transfers across languages/projects), giving each a one-line diagnostic TELL; AND (2) when the evidence is diverse, ALSO include an explicit "## Worked examples (real cases)" section that catalogs EACH distinct real case compactly — symptom (one line) → the exact fix → the TELL. The generalized guide gives ALTITUDE; the worked-examples catalog gives CONCRETENESS — include BOTH; the catalog is a strength when the cases are real and diverse, not a weakness. CRITICAL: do NOT collapse genuinely-distinct failure classes (e.g. float-truncation vs type-coercion vs input-mutation vs off-by-one are DIFFERENT bugs) into one generic bucket — emit a distinct pitfall + example for EACH. Beyond the observed examples, also cover the 2-3 most common ADJACENT failure modes for this class (e.g. order/state-dependence, import/path errors, masked cascading failures) so the skill is broad. Include a safe-first step (inspect/diff before editing; change source not tests; smallest reversible edit). Still emit the required frontmatter: a CLASS-level name (a noun phrase like debugging-failing-tests; obey the NAMING rule) and a description that STARTS WITH "Use when".
Output ONLY the complete SKILL.md (no preamble, not truncated), or exactly "NOTHING-TO-SAVE".`;

// Compressed fallback reviewer prompt — used ONLY by the graceful-degradation ladder when the full
// REVIEW_PROMPT returns empty/thin (some models choke on the long dense prompt). Same contract, fewer
// tokens. NOT for quality tuning — purely a reliability fallback so authoring never silently emits nothing.
export const REVIEW_PROMPT_COMPACT = `From the cross-session evidence below, author ONE class-level reusable skill as a COMPLETE SKILL.md, IF a durable lesson emerged. Format: YAML frontmatter (name: a class-level lowercase-hyphen slug; description: STARTS WITH "Use when"), then "## Procedure" (numbered, safe-first), "## Pitfalls" (each: symptom → exact fix → one-line TELL), "## Verification". Concrete correct fenced code; no preamble. Output ONLY the SKILL.md markdown, or exactly "NOTHING-TO-SAVE".`;


/** ★ THE MEMFS LEVER: reliable in-mod KEYWORD search over existing skills (no QMD dependency —
 * semantic memfs_search crashes on some boxes). Powers UPDATE-FIRST routing: retrieve the skill
 * that already covers a domain so we PATCH it instead of authoring a duplicate (Hermes's #1
 * anti-bloat priority — but matched on real CONTENT, not just names like Hermes's skills_list). */
// Generic dev/agent words that must NOT drive update-first routing (they false-positive across
// unrelated skills, e.g. "validate"/"run"/"tool" matching shopify-cli for mod-validation work).
export const SEARCH_STOP = new Set("the and for with via use using used run running runs tool tools command commands file files validate validating validation build builds building test testing tests check checking code into from that this your you any new real step steps workflow workflows work works working session sessions across before after fix fixed fixing error errors fail failed failing not add get set make made need want call calls called when then them they here there what which how its has have will can may also same each only over under out off across recurring observed".split(" "));

export const SEARCH_DISTINCT_MIN = 3; // ≥3 distinctive (non-stopword) hits in name/desc — prevents cross-domain false-positives (e.g. browser-QA→cloud-forensics)

export function searchSkills(dirs: string[], query: string, k = 5): Array<{ name: string; description: string; dir: string; score: number; matched: number }> {
  const terms = [...new Set(String(query).toLowerCase().split(/[^a-z0-9.]+/).filter((t) => t.length > 2 && !SEARCH_STOP.has(t)))];
  const out: Array<{ name: string; description: string; dir: string; score: number; matched: number }> = [];
  for (const d of dirs) for (const n of listSkillNames(d)) {
    const body = readSkill(d, n).toLowerCase();
    const desc = skillDesc(d, n);
    const nl = n.toLowerCase(), dl = desc.toLowerCase();
    let score = 0, matched = 0; // matched = # of distinctive query terms present in name/description
    for (const t of terms) {
      const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const inName = nl.includes(t), inDesc = dl.includes(t);
      if (inName || inDesc) matched++;
      const bc = Math.min((body.match(new RegExp("\\b" + esc, "g")) || []).length, 3);
      score += (inName ? 8 : 0) + (inDesc ? 4 : 0) + bc;
    }
    if (matched > 0) out.push({ name: n, description: desc, dir: d, score, matched });
  }
  return out.sort((a, b) => b.score - a.score || b.matched - a.matched).slice(0, k);
}

/** Decide a SAFE update-first target: must clear the threshold, have ≥N distinctive name/desc hits,
 * AND dominate the runner-up. Tied/weak/ambiguous → null (→ CREATE, never patch the wrong skill). */
export function pickUpdateTarget<T extends { name: string; score: number; matched: number }>(matches: T[], threshold = 18): (T & { confidence: "high" }) | null {
  const top = matches[0]; if (!top) return null;
  const second = matches[1];
  const clearlyLeads = !second || top.score >= 1.5 * second.score;
  // Normal active-library routing requires clearLead to avoid patching the wrong durable skill.
  // Staged queue exception: if the best match is already staged and has enough distinctive overlap,
  // UPDATE it even without 1.5× clearLead. Repeated staged reflects should refine/consolidate the
  // current candidate, not spray sibling staged skills while waiting for review. (Live dogfood catch.)
  const topDir = String((top as any).dir || "");
  const topIsStaged = topDir === STAGED_DIR || /[\\/]staged$/.test(topDir);
  if (top.score >= threshold && top.matched >= SEARCH_DISTINCT_MIN && (clearlyLeads || topIsStaged)) return { ...top, confidence: "high" };
  return null;
}


// ── COMPOUNDS-TRULY safety layer (from Kev's preserve-update lane): an update must never destroy a
// proven skill's core, and ambiguous overlap must refuse autonomous create (anti-bloat). ──
export function isAmbiguousExistingRoute<T extends { name: string; score: number; matched: number }>(matches: T[], threshold = 18): boolean {
  const top = matches[0], second = matches[1];
  if (!top || !second) return false;
  if (pickUpdateTarget(matches, threshold)) return false; // a safe update target exists → not ambiguous
  const topStrong = top.score >= threshold && top.matched >= SEARCH_DISTINCT_MIN;
  // Ambiguous = runner-up has MORE distinctive name/desc overlap than the top (cross-cutting territory,
  // e.g. ledger vs package-validation) — refuse to spawn a sibling that half-overlaps two proven skills.
  const secondStrong = second.score >= Math.max(threshold, top.score * 0.65) && second.matched > top.matched;
  return topStrong && secondStrong;
}

export function frontmatterOf(content: string): string {
  return (String(content || "").match(/^---\n([\s\S]*?)\n---\s*/)?.[1] || "").trimEnd();
}

export function metadataBlockFromFrontmatter(fm: string): string {
  const lines = fm.split("\n");
  const start = lines.findIndex((l) => /^metadata\s*:/i.test(l.trim()));
  if (start < 0) return "";
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^[A-Za-z0-9_-]+\s*:/.test(line) && !/^\s/.test(line)) break; // next top-level key ends the block
    out.push(line);
  }
  return out.join("\n").trimEnd();
}

/** Carry the old skill's frontmatter `metadata:` block into a rewritten skill so an UPDATE never
 * silently drops proven provenance/metadata the author forgot to re-emit. */
export function preserveExistingFrontmatterMetadata(newContent: string, oldContent?: string): string {
  if (!oldContent) return newContent;
  const oldMeta = metadataBlockFromFrontmatter(frontmatterOf(oldContent));
  if (!oldMeta || /^---\n[\s\S]*?\nmetadata\s*:/im.test(newContent)) return newContent; // already has one
  return newContent.replace(/^---\n([\s\S]*?)\n---\s*/m, (_m, fm) => `---\n${String(fm).trimEnd()}\n${oldMeta}\n---\n\n`);
}

export function skillSectionNames(content: string): string[] {
  const out: string[] = [];
  const text = String(content || "").replace(/```[\s\S]*?```/g, ""); // ignore fenced code
  for (const m of text.matchAll(/^##\s+(.+?)\s*$/gim)) {
    const section = m[1].trim().replace(/[`*_]/g, "").toLowerCase();
    if (section && !out.includes(section)) out.push(section);
  }
  return out;
}

/** Section-level diff between an old and rewritten skill — surfaces what an UPDATE dropped/kept/added
 * so destructive rewrites are reviewable beyond a hash change. */
export function compareSkillSections(oldContent?: string, newContent?: string) {
  const oldSections = skillSectionNames(oldContent || "");
  const newSections = skillSectionNames(newContent || "");
  const preservedSections = oldSections.filter((s) => newSections.includes(s));
  const droppedSections = oldSections.filter((s) => !newSections.includes(s));
  const addedSections = newSections.filter((s) => !oldSections.includes(s));
  return { oldSections, newSections, preservedSections, droppedSections, addedSections };
}


export type ReviewResult = { action: "create" | "update" | "none" | "reject"; name?: string; description?: string; body?: string; content?: string; reason?: string; updateTarget?: string; matches?: Array<{ name: string; score: number; matched: number }>; degraded?: string; wrote?: string };

/** Author + gate a skill from evidence, with MemFS update-first routing. authorFn(system,user)->text injectable. */
export async function reviewAndAuthor(evidence: string, dirs: string[], authorFn: (sys: string, user: string) => Promise<string>, opts: { updateThreshold?: number } = {}): Promise<ReviewResult> {
  // MemFS update-first: does a skill SAFELY cover this domain? (distinctive overlap + clearLead, not generic words)
  const matches = searchSkills(dirs, evidence, 3);
  const threshold = opts.updateThreshold ?? 18;
  const updTarget = pickUpdateTarget(matches, threshold);
  const slimEarly = matches.map((m) => ({ name: m.name, score: m.score, matched: m.matched }));
  // Ambiguous overlap (two proven skills both half-cover this) → refuse autonomous create (anti-bloat).
  if (!updTarget && isAmbiguousExistingRoute(matches, threshold)) {
    return { action: "none", reason: `ambiguous existing skills: ${matches.slice(0, 3).map((m) => `${m.name}(s${m.score}/m${m.matched})`).join(", ")}; refusing autonomous create`, matches: slimEarly };
  }
  // On UPDATE, show the model the existing proven skill so it PATCHES rather than rewrites from scratch.
  const existingForUpdate = updTarget ? (() => { try { const d = dirs.find((x) => existsSync(join(x, updTarget.name, "SKILL.md"))); return d ? readSkill(d, updTarget.name) : ""; } catch { return ""; } })() : "";
  const updateContext = existingForUpdate ? `\n\nEXISTING SKILL CONTENT (preserve proven core; patch in new lessons, do not rewrite from scratch):\n\`\`\`markdown\n${existingForUpdate.slice(0, 3500)}\n\`\`\`` : "";
  const hint = updTarget
    ? `\n\nUPDATE-FIRST (anti-bloat): an existing skill already covers this territory — "${updTarget.name}": ${updTarget.description}. Extend it: keep that exact name, preserve useful existing sections/frontmatter metadata/provenance, and fold ONLY the new pitfalls/steps into one improved full SKILL.md. Do not delete valuable original structure just to make a cleaner rewrite. Only use a different name if the territory is genuinely distinct.${updateContext}`
    : (matches.length ? `\n\nExisting skills (avoid duplicating): ${matches.map((m) => m.name).join(", ")}.` : "");
  // ── ADAPTIVE DEPTH (2026-06-28): scale skill richness to evidence DIVERSITY. Sparse/cold-start evidence
  // → a tight, hygienic skill (preserves the cold-start strength). Diverse, deep evidence (many distinct real
  // failures) → an exhaustive skill that catalogs every distinct case + a worked-examples section —
  // completeness is the edge that closes the depth gap vs full-session capture, without losing hygiene.
  const _classes = (evidence.match(/^- recovered failure:/gm) || []).length;
  const _examples = (evidence.match(/·\s*example\s*—/g) || []).length;
  const _diverse = Math.max(_classes, _examples) >= 4;
  const depthDirective = _diverse
    ? `\n\nEVIDENCE DEPTH: this evidence holds ${_examples} concrete worked-example${_examples === 1 ? "" : "s"} spanning distinct failure classes. HIGH-DIVERSITY regime — completeness matters more than brevity. The skill should have ALL of these sections (a Procedure-only skill is INCOMPLETE and will be REJECTED):\n- "## Procedure" — a generalized decision guide (symptom → safest fix path).\n- "## Pitfalls" — ONE entry per DISTINCT failure class (symptom → exact fix → one-line diagnostic TELL). Never merge different bugs into one generic bucket; emit a separate pitfall for each of the ${_examples} cases' classes.\n- "## Verification" — how to confirm green with no regressions.\n- "## Worked examples (real cases)" — catalog ALL ${_examples} real cases compactly: symptom (one line) → exact fix → TELL.\nThe ~70-line cap is LIFTED (target a rich ~120-180 lines); be EXHAUSTIVE on the diverse evidence — that breadth is the whole edge — but stay sectioned + hygienic (no wall of text).`
    : "";
  // ROBUST extraction — models may prepend reasoning/preamble, wrap in ```fences, or use a
  // "# Title" heading instead of YAML frontmatter. Tolerate all; fall back to the update target.
  const parseDraft = (raw: string): { name: string; description: string; body: string; unsafeName?: string; invalidName?: string } | null => {
    let skill = (raw || "").replace(/<\/?think>/gi, "").trim();
    const startIdx = skill.search(/(^|\n)\s*(---\s*\n|#\s+|name:\s)/i);
    if (startIdx > 0) skill = skill.slice(startIdx).trim();
    skill = skill.replace(/^```(?:markdown|md|yaml)?\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    if (/^NOTHING-TO-SAVE/i.test(skill) || skill.length < 40) return null;
    const rawName = (skill.match(/^name:\s*["']?(.+?)["']?\s*$/im)?.[1] || "").trim();
    if (rawName && (/[\/\\;|&]|\.\./.test(rawName) || rawName.length > 64)) return { name: "", description: "", body: "", unsafeName: rawName };
    let name = slug(rawName);
    // Do not let deterministic repair launder an explicitly bad model-authored name (e.g. edit-to-npx).
    // Repair may fill missing structure, but the class-level naming gate must still reject named artifacts.
    if (rawName && name && !isValidSkillName(name)) return { name, description: "", body: "", invalidName: name };
    if (!name) name = slug((skill.match(/^#\s+(.+?)\s*$/m)?.[1] || "").trim());
    if (!name && updTarget) name = updTarget.name; // update-first: we already know the target
    let description = (skill.match(/^description:\s*["']?(.+?)["']?\s*$/im)?.[1] || "").trim();
    if (!description) description = (skill.split("\n").find((l) => { const t = l.trim(); return t.length > 25 && !/^([#`>*-]|---|name:|title:|description:)/i.test(t); }) || "").trim();
    if (!description && updTarget) description = updTarget.description;
    let body = skill;
    const secStart = body.search(/(^|\n)##\s+/);
    if (secStart >= 0) body = body.slice(secStart);
    else body = body.replace(/^---[\s\S]*?\n---\s*\n?/, "").replace(/^#\s+.+\n+/, "");
    body = body.replace(/\n---\s*(\n[\s\S]*)?$/, "").trim();
    return { name, description, body };
  };
  const isCleanDraft = (p: { name: string; description: string; body: string }) =>
    isValidSkillName(p.name) && !!p.description && p.description.length >= 20 && lintSkillDraft(p).ok;

  // ── DETERMINISTIC REPAIR closure (built from the SAME experience log) — used both as the graceful-
  // degradation fallback when the author returns empty/thin AND to fill structural gaps later. ──
  let _fb: { name: string; description: string; body: string } | null | undefined;
  const fallback = () => { if (_fb === undefined) { try { const c = findCandidate(); _fb = c ? draftWithRepair(c, repairForCandidate(c)) : null; } catch { _fb = null; } } return _fb; };
  const fbUsable = (f: { name: string; description: string; body: string } | null | undefined): f is { name: string; description: string; body: string } => !!f && isValidSkillName(f.name) && !!f.body && f.body.trim().length >= 40 && lintSkillDraft(f).ok && scanSkillContent(f.body).ok;

  // ── GRACEFUL DEGRADATION LADDER (P0 reliability invariant): the author model can return empty/thin output
  // (any model, any reason — dense prompt, refusal, truncation). NEVER silently emit nothing or a partial
  // skill. Ladder: same-prompt retry → compressed-prompt retry → deterministic drafter → explicit rejected
  // receipt with the reason. Invariant: no code path emits an empty/sub-threshold skill silently.
  const looksEmpty = (s: string) => { const t = (s || "").replace(/<\/?think>/gi, "").trim(); return t.length < 40 && !/^NOTHING-TO-SAVE/i.test(t); };
  const saidNothing = (s: string) => /^NOTHING-TO-SAVE/i.test((s || "").replace(/<\/?think>/gi, "").trim());
  let degraded: string | undefined;
  let raw = (await authorFn(REVIEW_PROMPT, evidence + hint + depthDirective)) || "";
  if (looksEmpty(raw)) { degraded = "author-empty→retry-same"; try { raw = (await authorFn(REVIEW_PROMPT, evidence + hint + depthDirective)) || raw; } catch { /* */ } }
  if (looksEmpty(raw)) { degraded = "author-empty→retry-compressed"; try { raw = (await authorFn(REVIEW_PROMPT_COMPACT, evidence)) || raw; } catch { /* */ } }
  try { ensureDir(); writeFileSync(join(STATE_DIR, "reflect-last-raw.txt"), `=== ${new Date().toISOString()}${degraded ? " [" + degraded + "]" : ""} ===\n${raw}\n`); } catch { /* */ }
  let parsed = parseDraft(raw);
  if (parsed?.unsafeName) return { action: "reject", reason: `name "${parsed.unsafeName.slice(0, 40)}" has unsafe characters (path/injection)`, degraded };
  if (parsed?.invalidName) return { action: "reject", reason: `name "${parsed.invalidName}" not class-level`, degraded };
  if (!parsed) {
    // Explicit author decision (legit, not a failure) — honor WITH a reason; never silent.
    if (saidNothing(raw)) return { action: "none", reason: "author judged NOTHING-TO-SAVE" };
    // L3: deterministic drafter fallback when the model produced nothing usable.
    const f = fallback();
    if (fbUsable(f)) { parsed = { name: f.name, description: f.description, body: f.body }; degraded = (degraded ? degraded + "→" : "author-empty→") + "deterministic-fallback"; }
    // L4 terminal floor: nothing usable from model OR deterministic drafter → explicit reject, never silent.
    else return { action: "reject", reason: `author produced no usable skill after same+compressed retries; deterministic fallback ${f ? "sub-threshold" : "unavailable"}`, degraded: (degraded || "author-empty") + "→no-usable-skill" };
  }
  // Empty shells are not salvageable: repair may fill missing sections, but must not invent a full skill body.
  if (!parsed.body || parsed.body.trim().length < 10) return { action: "reject", reason: "body too thin" };
  // HIGH-DIVERSITY completeness: a diverse-evidence skill MUST carry distinct Pitfalls + a Worked-examples
  // catalog (the depth that improves pitfalls/concreteness). A Procedure-only draft passes lint but is too thin —
  // enforce the depth sections via the corrective retry so richness is CONSISTENT across regimes. 2026-06-28.
  const depthComplete = (b: string) => !_diverse || (/##\s+pitfalls/i.test(b) && /##\s+worked\s+examples/i.test(b));
  const sotaGaps = sotaQualityGaps(parsed);
  if ((!isCleanDraft(parsed) || !depthComplete(parsed.body) || sotaGaps.length) && !(degraded || "").includes("deterministic-fallback")) {
    const why = lintSkillDraft(parsed).issues
      .concat(isValidSkillName(parsed.name) ? [] : ["name must be a class-level lowercase-hyphen slug"])
      .concat((parsed.description || "").length >= 20 ? [] : ["description too short"])
      .concat(depthComplete(parsed.body) ? [] : [`HIGH-DIVERSITY skill is MISSING required depth sections (needs both "## Pitfalls" with one entry per distinct class AND "## Worked examples (real cases)" cataloging all ${_examples} cases) — a Procedure-only skill is too thin`])
      .concat(sotaGaps); // SOTA quality gate — make every skill top-tier, not just valid
    const corrective = `\n\nYOUR PREVIOUS DRAFT IS NOT YET SOTA (${why.join("; ")}). A top-tier skill ALWAYS has: concrete correct fenced code, a one-line diagnostic TELL on every Pitfall, an explicit safe-first step before any destructive command, and a class-level (not one-off) frame. Re-output ONE complete SKILL.md and NOTHING else, fixing every issue above: YAML frontmatter with a class-level "name:" (lowercase-hyphen) + a "description:" that STARTS WITH "Use when"; a body with "## Procedure", "## Pitfalls" (each with symptom → exact fix → TELL), "## Verification"${_diverse ? ', AND "## Worked examples (real cases)" cataloging every real case' : ""}.`;
    try {
      const raw2 = (await authorFn(REVIEW_PROMPT, evidence + hint + depthDirective + corrective)) || "";
      try { writeFileSync(join(STATE_DIR, "reflect-last-raw.txt"), `=== ${new Date().toISOString()} (retry) ===\n${raw2}\n`); } catch { /* */ }
      const p2 = parseDraft(raw2);
      // accept the retry only if it's valid, depth-complete, and NO WORSE on SOTA quality
      if (p2 && !p2.unsafeName && isCleanDraft(p2) && depthComplete(p2.body) && sotaQualityGaps(p2).length <= sotaGaps.length) { parsed = p2; raw = raw2; }
    } catch { /* keep attempt 1 */ }
  }
  let { name, description, body } = parsed;

  // ── DETERMINISTIC REPAIR from real evidence (fallback closure defined above) — fills only structural gaps
  // (name/description/sections). Security is NEVER repaired around; the drafter is grounded in the real log. ──
  if (!isValidSkillName(name)) { const f = fallback(); name = (updTarget && isValidSkillName(updTarget.name)) ? updTarget.name : (f && isValidSkillName(f.name) ? f.name : name); }
  if (!isValidSkillName(name)) return { action: "reject", reason: `name "${name}" not class-level`, degraded };
  const secEarly = scanSkillContent(body); if (!secEarly.ok) return { action: "reject", reason: `security: ${secEarly.issues.join("; ")}`, degraded };
  const descOk = (d: string) => !!d && d.length >= 20 && /\b(use when|trigger|when )/i.test(d);
  if (!descOk(description)) {
    if (description && description.length >= 12 && !/\b(use when|trigger|when )/i.test(description)) description = `Use when ${description}`.slice(0, 700);
    if (!descOk(description)) { const f = fallback(); description = (f && descOk(f.description)) ? f.description : ((updTarget && descOk(updTarget.description)) ? updTarget.description : description); }
  }
  if (!/##\s+procedure/i.test(body) || !/##\s+verification/i.test(body)) {
    const f = fallback();
    if (f) {
      if (!/##\s+procedure/i.test(body)) { const m = f.body.match(/(##\s+Procedure[\s\S]*?)(?=\n##\s|\s*$)/i); body += `\n\n${m ? m[1].trim() : "## Procedure\n1. Repeat the observed workflow, adapting paths/args to the current context.\n2. Capture the success/failure receipt before moving on."}`; }
      if (!/##\s+verification/i.test(body)) { const m = f.body.match(/(##\s+Verification[\s\S]*?)(?=\n##\s|\s*$)/i); body += `\n\n${m ? m[1].trim() : "## Verification\n- Confirm via concrete command/tool output that the workflow actually succeeded."}`; }
    }
  }
  // ── FINAL gates after repair: security re-scan (hard) + lint; last resort = full deterministic fallback. ──
  const sec = scanSkillContent(body); if (!sec.ok) return { action: "reject", reason: `security: ${sec.issues.join("; ")}`, degraded };
  const lint = lintSkillDraft({ name, description, body });
  if (!lint.ok) { const f = fallback(); if (f && lintSkillDraft(f).ok && isValidSkillName(f.name)) { ({ name, description, body } = f); degraded = (degraded ? degraded + "→" : "") + "lint-repair-fallback"; } else return { action: "reject", reason: `lint: ${lint.issues.join("; ")}`, degraded }; }
  const content = `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
  // UPDATE if the chosen name matches an existing skill (routed or coincidental) — anti-bloat path.
  const slim = matches.map((m) => ({ name: m.name, score: m.score, matched: m.matched }));
  const existingNames = new Set(matches.map((m) => m.name));
  if (existingNames.has(name)) {
    // Compounds-truly: carry the old skill's frontmatter metadata block into the rewrite so an update
    // never silently drops proven provenance the author forgot to re-emit.
    const preserved = preserveExistingFrontmatterMetadata(content, existingForUpdate);
    return { action: "update", name, description, body, content: preserved, updateTarget: name, matches: slim, degraded };
  }
  return { action: "create", name, description, body, content, matches: slim, degraded };
}


// ════════════════════════════════════════════════════════════════════════════
// v3.2 — IMMACULATE: evidence manifests, persona-personalized patching, coverage
// map, churn-aware lifecycle. Each skill becomes an evidence-backed git object.
// ════════════════════════════════════════════════════════════════════════════

// 1. EVIDENCE-PACK MANIFEST — provenance next to each skill: "not model vibes, a git object."
export type EvidenceManifest = { ts: string; action: string; skill: string; updateTarget?: string; sources: { conversations: number; durableSignals: number }; memfsHits: Array<{ name: string; score: number; matched: number }>; preferencesInjected: string[]; rejectedNoise: Array<{ item: string; reason: string }>; newHash: string; oldHash?: string; sectionDiff?: { preserved: string[]; dropped: string[]; added: string[] }; gates: { naming: boolean; security: boolean; lint: boolean } };

export function buildEvidenceManifest(i: { action: string; skill: string; updateTarget?: string; convs: number; signals: number; memfsHits: Array<{ name: string; score: number; matched: number }>; preferences: string[]; rejected: Array<{ item: string; reason: string }>; newContent: string; oldContent?: string }): EvidenceManifest {
  // On UPDATE, record the section-level diff so a destructive rewrite is reviewable beyond a hash change.
  const sd = i.oldContent ? compareSkillSections(i.oldContent, i.newContent) : undefined;
  return { ts: new Date().toISOString(), action: i.action, skill: i.skill, updateTarget: i.updateTarget, sources: { conversations: i.convs, durableSignals: i.signals }, memfsHits: i.memfsHits.map((m) => ({ name: m.name, score: m.score, matched: m.matched })), preferencesInjected: i.preferences, rejectedNoise: i.rejected, newHash: hash(i.newContent), oldHash: i.oldContent ? hash(i.oldContent) : undefined, sectionDiff: sd ? { preserved: sd.preservedSections, dropped: sd.droppedSections, added: sd.addedSections } : undefined, gates: { naming: true, security: true, lint: true } };
}


// 2. PERSONA/PREFS RETRIEVAL — Hermes PROMPTS for "how this user wants it"; Letta RETRIEVES it from memory.
export function retrievePreferences(evidence: string, memDir?: string): string[] {
  const dir = memDir || process.env.MEMORY_DIR; if (!dir) return [];
  const prefs: string[] = [];
  for (const s of ["persona.md", "system/persona.md", "system/human.md", "human.md", "system/human/preferences.md"]) {
    const p = join(dir, s); if (!existsSync(p)) continue;
    try { for (const line of readFileSync(p, "utf8").split("\n")) { const l = line.trim().replace(/^[-*#>\s]+/, ""); if (/\b(prefer|preference|always|never|wants?|likes?|hates?|style|format|verbos|concise|terse|tone|don'?t)\b/i.test(l) && l.length > 20 && l.length < 220) prefs.push(l); } } catch { /* */ }
  }
  return [...new Set(prefs)].slice(0, 6);
}

export function reflectSignature(ev: { digest: string; convs: number; items: number }): string { return hash(`${ev.convs}\n${ev.items}\n${ev.digest}`); }

export function loadHandledReflects(): Record<string, { ts: number; route: string }> { try { return existsSync(REFLECT_HANDLED) ? JSON.parse(readFileSync(REFLECT_HANDLED, "utf8")) : {}; } catch { return {}; } }

export function markHandledReflect(sig: string, route: string) { try { ensureDir(); const h = loadHandledReflects(); h[sig] = { ts: Date.now(), route }; writeFileSync(REFLECT_HANDLED, JSON.stringify(h, null, 2)); } catch { /* */ } }


export function isHighConfidenceCreate(res: ReviewResult, ev: { items: number; convs: number }): boolean {
  if (res.action !== "create") return false;
  const top = res.matches?.[0];
  const cleanRoute = !pickUpdateTarget(res.matches || [], 18);
  const richDraft = !!res.description && res.description.length >= 80 && /##\s+Pitfalls/i.test(res.body || "") && /##\s+Verification/i.test(res.body || "");
  return ev.convs >= 3 && ev.items >= 1 && cleanRoute && richDraft;
}


export function graduateStagedSkill(name: string, ctx?: any): string {
  const nm = slug(name);
  if (!nm) throw new Error("name required");
  const srcDir = join(STAGED_DIR, nm);
  const src = join(srcDir, "SKILL.md");
  if (!existsSync(src)) throw new Error(`no staged skill '${nm}'`);
  const retiredBlock = retiredSkillBlocker(nm, ctx);
  if (retiredBlock) throw new Error(`retire-sticky blocked graduate: ${retiredBlock}`);
  const content = readFileSync(src, "utf8");
  const desc = (content.match(/^description:\s*(.+)$/im)?.[1] || "").trim();
  const body = content.replace(/^---[\s\S]*?\n---\s*\n?/, "");
  const lint = lintSkillDraft({ name: nm, description: desc, body });
  if (!lint.ok) throw new Error(`linter blocked: ${lint.issues.join("; ")}`);
  const sec = scanSkillContent(body); if (!sec.ok) throw new Error(`security blocked: ${sec.issues.join("; ")}`);
  const dstRoot = agentSkillsDir(ctx);
  const dst = writeSkill(dstRoot, nm, content.includes(MM_TAG) ? content : content + `\n<!-- ${MM_TAG}: graduated ${new Date().toISOString().slice(0, 10)} -->\n`);
  mkdirSync(STAGED_RETIRED_DIR, { recursive: true });
  try { renameSync(srcDir, join(STAGED_RETIRED_DIR, `${nm}-graduated-${Date.now()}`)); } catch { /* best-effort quarantine */ }
  appendUiEvent({ phase: "skill_graduated", summary: `graduated '${nm}'`, skill: nm, action: "graduate", route: "manual" });
  appendMeshFeed({ type: "skill_graduated", skill: nm, route: "GRADUATE", signals: 0 });
  writeUiState({ phase: "done", last: `graduated '${nm}'`, route: "GRADUATE · live" });
  // MM_PUBLISH v1.1: auto-run the publishability preflight right after graduation (READ-ONLY — never
  // auto-publishes). Surfaces quality+publishability score, tier, and the recommended shelf so a good
  // skill can be promoted to shared Custom Skills without manual babysitting. Best-effort, never breaks graduation.
  try { const _b = readSkill(dstRoot, nm); if (_b) { const _p = publishPlan({ name: nm, description: skillDesc(dstRoot, nm), body: _b, shelf: "agent" }); appendUiEvent({ phase: "skill_publish_preflight", summary: `${nm}: ${_p.publishability}/100 · tier=${publishTier(_p)} · ${_p.recommended}`, skill: nm, route: "auto-after-graduate" }); } } catch { /* preflight must never break graduation */ }
  return dst;
}


/** Fork-based reviewer author: the model authors a skill in a hidden conversation. Guarded —
 * any failure returns "" and the caller treats it as "nothing to save". (Same pattern as the autopilot fork.) */
export function reviewForkAuthor(ctx: any): (sys: string, user: string) => Promise<string> {
  return async (sys: string, user: string) => {
    try {
      if (typeof ctx?.conversation?.fork !== "function") return "";
      const forked = await ctx.conversation.fork({ hidden: true });
      const stream = await forked.sendMessageStream([{ role: "user", content: `${sys}\n\n${user}` }]);
      const out = await consumeStreamBounded(stream as AsyncIterable<unknown>);
      return out.trim();
    } catch { return ""; }
  };
}


/** v3.1 AUTONOMOUS REFLECTIVE REVIEW: cross-conversation evidence → forked reviewer → update-first
 * routing + gates → write (staged by default; live in auto mode). Reversible + receipted. The surpass, autonomous. */
export async function runReflectiveReview(ctx: any, config: { mode?: "staged" | "auto"; minItems?: number; minInstances?: number; authorFn?: (s: string, u: string) => Promise<string>; experience?: Row[]; dirs?: string[]; stagedDir?: string } = {}): Promise<ReviewResult & { wrote?: string }> {
  // dirs/stagedDir injectable (same pattern as `experience`) so callers/tests are hermetic —
  // scanDirs(ctx) reads the HOST's real shelves (agent MemFS + ~/.letta/skills), which made the
  // n=1 wiring test pass only on machines with an empty global shelf (fake-green class).
  const dirs = config.dirs ?? scanDirs(ctx);
  const stagedShelf = config.stagedDir ?? STAGED_DIR;
  // In staged mode, staged skills are part of the dedupe surface. Otherwise repeated manual reflects
  // can spray near-duplicate staged siblings before review/graduation (live dogfood catch).
  const reviewDirs = config.mode === "auto" ? dirs : [...dirs, stagedShelf];
  const exp = config.experience ?? loadExperience();
  const ev = buildCrossConversationEvidence(exp);
  // ENGRAM: the prioritized-replay + reconsolidation brief over the SAME trace. This is the
  // salience-triaged, reverse-replay-credited, reconsolidation-aware evidence that REPLACES a
  // uniform recent-history scan — the core v5 behavior, applied live to what the reviewer sees.
  const engram = engramConsolidate(exp, managedView(reviewDirs).map((m) => ({ name: m.name, body: m.body })));
  appendUiEvent({ phase: "review_started", summary: `reviewing ${ev.convs} sessions / ${ev.items} durable signals` }); writeUiState({ phase: "reviewing", detail: `${ev.convs} sessions / ${ev.items} signals` });
  if (ev.items < (config.minItems ?? 2)) { appendUiEvent({ phase: "reflect_none", summary: `nothing to save yet (${ev.items} signals)` }); writeUiState({ phase: "idle", last: "nothing to save yet" }); return { action: "none", reason: `only ${ev.items} cross-session signals (need ≥${config.minItems ?? 2})` }; }
  // PERSONALIZED PATCHING: retrieve the user's actual preferences from memory and inject them.
  const prefs = retrievePreferences(ev.digest, process.env.MEMORY_DIR);
  const digest = `${engram.digest}\n\n${ev.digest}` + (prefs.length ? `\n\nUSER PREFERENCES (from this agent's memory — bake the relevant ones into the skill's guidance):\n${prefs.map((p) => `- ${p}`).join("\n")}` : "");
  // LIVE MIRROR: surface the route + writing phase during the (long) author call, so the panel animates.
  const preTgt = pickUpdateTarget(searchSkills(reviewDirs, digest, 3), 18);
  const routeKey = preTgt ? `UPDATE:${preTgt.name}` : "CREATE";
  const sig = reflectSignature(ev);
  if (loadHandledReflects()[sig]) {
    const summary = `already reflected ${routeKey.toLowerCase()} for this evidence signature`;
    appendUiEvent({ phase: "reflect_none", summary });
    writeUiState({ phase: "idle", last: summary, route: "SKIP · handled" });
    return { action: "none", reason: summary };
  }
  writeUiState({ phase: "routing", route: preTgt ? `UPDATE → ${preTgt.name}` : "CREATE (new skill)" });
  appendUiEvent({ phase: "review_planned", summary: preTgt ? `route UPDATE → ${preTgt.name}` : "route CREATE — no existing skill safely covers this" });
  writeUiState({ phase: "writing", skill: preTgt?.name, route: preTgt ? `UPDATE → ${preTgt.name}` : "CREATE" });
  const author = config.authorFn || reviewForkAuthor(ctx);
  let res: ReviewResult;
  try {
    res = await reviewAndAuthor(digest, reviewDirs, author);
  } catch (e: any) {
    // author/review threw — never leave the panel stuck on "writing…"; write a terminal state.
    appendUiEvent({ phase: "reflect_error", summary: `author failed: ${String(e?.message ?? e).slice(0, 80)}` });
    writeUiState({ phase: "idle", last: "review interrupted — will retry next session", route: "ERROR · safe" });
    return { action: "none", reason: `author error: ${String(e?.message ?? e).slice(0, 120)}` };
  }
  if ((res.action === "create" || res.action === "update") && res.name && res.content) {
    const live = config.mode === "auto";
    const graduate = live || res.action === "update" || isHighConfidenceCreate(res, ev);
    const dir = graduate ? agentSkillsDir(ctx) : stagedShelf;
    const tagged = res.content.includes(MM_TAG) ? res.content : res.content + `\n<!-- ${MM_TAG}: reflective ${new Date().toISOString().slice(0, 10)}; action=${res.action}; convs=${ev.convs}; ${graduate ? "graduated=true" : "staged=true"} -->\n`;
    try {
      if (res.action === "create" && !res.updateTarget) {
        const retiredBlock = retiredSkillBlocker(res.name, ctx);
        if (retiredBlock) {
          markHandledReflect(sig, `RETIRED:${res.name}`);
          appendUiEvent({ phase: "reflect_none", summary: `retire-sticky blocked '${res.name}'` });
          writeUiState({ phase: "idle", last: `retire-sticky blocked '${res.name}'`, route: "SKIP · retired" });
          return { action: "none", name: res.name, reason: retiredBlock } as ReviewResult & { wrote?: string };
        }
        // P0 2a · n=1 CREATE gate: a create must be topically grounded in a >=2-instance signal.
        // The aggregate items floor is NOT enough — an n=1 repair can ride in on an unrelated
        // recurring workflow (receipt: recovering-from-npx-failures, created 2×, retired 2×).
        // A second observed instance changes the evidence signature, so parking here never
        // permanently blocks a pattern that later matures.
        const n1 = multiInstanceSupport(`${res.name} ${res.description ?? ""}`, ev.signals ?? [], config.minInstances ?? 2);
        if (!n1.ok) {
          markHandledReflect(sig, `N1-PARKED:${res.name}`);
          appendUiEvent({ phase: "reflect_none", summary: `n=1 gate parked '${res.name}': ${n1.reason.slice(0, 120)}` });
          writeUiState({ phase: "idle", last: `n=1 gate parked '${res.name}'`, route: "SKIP · n=1" });
          return { action: "none", name: res.name, reason: `n=1 gate: ${n1.reason}` } as ReviewResult & { wrote?: string };
        }
      }
      const oldContent = res.action === "update" && res.updateTarget ? (() => { const d = reviewDirs.find((x) => existsSync(join(x, res.updateTarget!, "SKILL.md"))); return d ? readSkill(d, res.updateTarget!) : undefined; })() : undefined;
      writeSkill(dir, res.name, tagged);
      // EVIDENCE-PACK MANIFEST: provenance next to the skill (not model vibes — a git object).
      const manifest = buildEvidenceManifest({ action: res.action, skill: res.name, updateTarget: res.updateTarget, convs: ev.convs, signals: ev.items, memfsHits: res.matches || [], preferences: prefs, rejected: ev.rejected, newContent: tagged, oldContent });
      const evDir = join(dir, res.name, "references", "evidence"); mkdirSync(evDir, { recursive: true });
      writeFileSync(join(evDir, `${Date.now()}.json`), JSON.stringify(manifest, null, 2));
      ensureDir(); mkdirSync(RECEIPTS_DIR, { recursive: true });
      writeFileSync(join(RECEIPTS_DIR, `reflect-${Date.now()}.json`), JSON.stringify({ action: res.action, name: res.name, updateTarget: res.updateTarget, convs: ev.convs, items: ev.items, prefsInjected: prefs.length, rejected: ev.rejected.length, degraded: res.degraded || null, dir, ts: Date.now() }, null, 2));
      if (res.degraded) appendUiEvent({ phase: "author_degraded", summary: `authored via graceful degradation: ${res.degraded}`, skill: res.name });
      // v3.3 VISIBLE SUMMARY: Hermes-style finished-action events (no chain-of-thought).
      const phase = graduate ? "skill_graduated" : "skill_staged";
      const verb = graduate ? "graduated" : (res.action === "update" ? "staged update to" : "staged");
      const summary = `${verb} '${res.name}' (${res.action === "update" ? "update-first" : "new"}, ${ev.convs} sessions/${ev.items} signals)`;
      appendUiEvent({ phase, summary, skill: res.name, action: res.action, route: res.updateTarget ? `update ${res.updateTarget}` : "create" });
      appendMeshFeed({ type: phase, skill: res.name, route: graduate ? "GRADUATE" : res.action.toUpperCase(), signals: ev.items }); // cross-agent feed (see Mack + Kev distilling)
      markHandledReflect(sig, routeKey);
      appendUiEvent({ phase: "evidence_manifest_written", summary: "wrote evidence manifest" });
      if (ev.rejected.length) appendUiEvent({ phase: "noise_rejected", summary: `rejected ${ev.rejected.length} env-noise items` });
      if (prefs.length) appendUiEvent({ phase: "memory_pref_injected", summary: `injected ${prefs.length} user preferences` });
      writeUiState({ phase: "done", last: summary, route: `${graduate ? "GRADUATE" : res.action.toUpperCase()}${res.updateTarget ? " " + res.updateTarget : ""} · ${graduate ? "live" : "staged"}` });
      return { ...res, wrote: join(dir, res.name) };
    } catch (e: any) { appendUiEvent({ phase: "reflect_error", summary: `write failed: ${String(e?.message ?? e).slice(0, 80)}` }); return { ...res, reason: String(e?.message ?? e) }; }
  }
  if (res.action === "reject") {
    const safe = /\bsecurity:/i.test(res.reason || ""); // a security block is the gate PROTECTING you, not a failure
    markHandledReflect(sig, routeKey);
    // Explicit rejected receipt (P0 invariant: never silent) — a durable record with the reason + any degradation.
    try { ensureDir(); mkdirSync(RECEIPTS_DIR, { recursive: true }); writeFileSync(join(RECEIPTS_DIR, `reflect-rejected-${Date.now()}.json`), JSON.stringify({ action: "reject", safe, reason: res.reason || "(none)", degraded: res.degraded || null, convs: ev.convs, items: ev.items, ts: Date.now() }, null, 2)); } catch { /* */ }
    appendUiEvent({ phase: safe ? "blocked_unsafe" : "reflect_none", summary: safe ? `🛡️ blocked unsafe content (safe): ${res.reason}` : `draft rejected; nothing saved (${res.reason})${res.degraded ? " [degraded: " + res.degraded + "]" : ""}` });
    writeUiState({ phase: safe ? "protected" : "idle", last: safe ? "blocked unsafe content (safe)" : `draft rejected; nothing saved`, route: safe ? "BLOCKED · protected" : "SKIP · rejected-draft" });
  }
  else { markHandledReflect(sig, routeKey); appendUiEvent({ phase: "reflect_none", summary: "nothing durable to save" }); writeUiState({ phase: "idle", last: "nothing to save" }); } // mark handled so the autonomous nudge doesn't re-review identical evidence every turn
  return res;
}
