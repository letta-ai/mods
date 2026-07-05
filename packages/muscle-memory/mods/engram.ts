// muscle-memory · engram module (split from index.ts — behavior-preserving).
import { join } from "node:path";
import { NEOCORTEX_BLOCK, Row } from "./core";
import { HIGH_SIGNAL_TOOL_SET, detectAntiPatterns, detectInvocationGotchas, detectRepairChains, fingerprint, stepSig } from "./detect";
import { skillVerbs } from "./lifecycle";


// — FAILURE-DEFENSE (the edge Hermes lacks): Reflexion [trigger→error→consequence→defense] —
export type Defense = { trigger: string; errClass: string; consequence: string; defense: string; severity: number; count: number; kind: "fix" | "avoid" };

/** Build a DONT_DO / defense set from repair chains (known fixes) + anti-patterns (avoid). */
export function buildDefenses(rows: Row[]): Defense[] {
  const out: Defense[] = [];
  for (const r of detectRepairChains(rows)) out.push({ trigger: r.trigger, errClass: r.errClass, consequence: "fails until the known fix is applied", defense: `apply ${r.fixStep}, then re-run ${r.verifyStep}`, severity: Math.min(3, r.count + 1), count: r.count, kind: "fix" });
  for (const p of detectAntiPatterns(rows)) out.push({ trigger: p.step, errClass: p.errClass, consequence: "recurring failure with no known recovery", defense: "root-cause before retrying; do not blind-retry", severity: Math.min(3, p.fails), count: p.fails, kind: "avoid" });
  for (const g of detectInvocationGotchas(rows)) out.push({ trigger: g.trigger, errClass: "invocation", consequence: "fails unless invoked with the right flag/env", defense: `invoke with \`${g.delta}\``, severity: Math.min(3, g.count + 1), count: g.count, kind: "fix" });
  return out.sort((a, b) => b.severity - a.severity);
}

/** PRE-ACTION check: Letta's tool_start is the hook Hermes lacks. Returns a matching defense or null. */
export function preActionDefense(stepSignature: string, defenses: Defense[]): Defense | null {
  const s = stepSignature.toLowerCase();
  return defenses.find((d) => d.trigger.toLowerCase() === s) || defenses.find((d) => s.includes(d.trigger.toLowerCase()) && d.trigger.length > 3) || null;
}


// ════════════════════════════════════════════════════════════════════════════
// v5 ENGRAM — the Complementary-Learning-Systems loop (neuroscience-rooted).
// Hippocampus = the experience trace (fast, episodic, decaying); neocortex = the
// SKILL.md library (slow, gist, stable). The three governing dynamics no shipping
// agent-memory system implements: prediction-error reconsolidation, synaptic
// tagging & capture, reward-weighted prioritized replay. See muscle-memory.ENGRAM.md.
//
// E0: neuromodulatory SALIENCE + SYNAPTIC TAGGING & CAPTURE. Pure + deterministic,
// computed OFF the hot path from the existing trace — never a model call, never a
// write, never on tool_start. The testable core the rest of ENGRAM builds on.
// ════════════════════════════════════════════════════════════════════════════
export const ENGRAM = {
  W_PE: 3.0,                            // prediction-error weight — dominant (reconsolidation's gate)
  W_RW: 2.0,                            // reward weight (recovery / high-signal gate / win)
  W_NOV: 1.0,                           // novelty weight (first sight of a fingerprint)
  W_REC: 1.0,                           // recency weight (exponential decay)
  TAG_HALFLIFE_MS: 6 * 60 * 60 * 1000,  // tag-strength half-life (~one working session)
  CAPTURE_WINDOW_MS: 30 * 60 * 1000,    // behavioral-tagging window around a strong event (symmetric)
  PRP_THRESHOLD: 3.0,                   // salience that "synthesizes PRPs" (a strong/novel/rewarded event)
  WEAK_MAX: 1,                          // a fingerprint seen <= this is "weak" (would not consolidate alone)
};


export type Salience = { score: number; pe: number; rw: number; nov: number; rec: number };

export type Tagged = Row & { sal: Salience };


/** What consolidated memory PREDICTS for a step's outcome: avoid-defense ⇒ failure (false),
 *  fix/known-good defense ⇒ success once the fix is applied (true), nothing ⇒ undefined (unmodeled). */
export function expectationFor(sig: string, defenses: Defense[]): boolean | undefined {
  const d = preActionDefense(sig, defenses);
  if (!d) return undefined;
  return d.kind === "avoid" ? false : true;
}


/** Prediction error for one row vs. what memory expected (0..1). A contradiction (expected
 *  success → errored, or expected failure → succeeded) is full surprise; an unmodeled failure
 *  is mild surprise; a confirmed expectation is none. This is the reconsolidation trigger. */
export function predictionError(row: Row, defenses: Defense[]): number {
  if (row.ok === undefined) return 0;                       // no outcome correlated → no signal
  const exp = expectationFor(stepSig(row), defenses);
  if (exp === undefined) return row.ok === false ? 0.4 : 0; // unmodeled failure = mild surprise
  return exp !== row.ok ? 1 : 0;                            // contradiction = full prediction error
}


/** Tag every experience with a salience score (neuromodulatory gate). Sequence-aware: reward
 *  fires on error-recovery (a step that previously failed now succeeds — the reverse-replay anchor)
 *  or on passing a high-signal gate; novelty on first sight of a fingerprint; recency decays. Pure. */
export function tagExperience(rows: Row[], opts: { defenses?: Defense[]; now?: number; highSignal?: Set<string> } = {}): Tagged[] {
  const defenses = opts.defenses ?? [];
  const now = opts.now ?? Date.now();
  const highSignal = opts.highSignal ?? HIGH_SIGNAL_TOOL_SET;
  const failedSig = new Map<string, Set<string>>();         // conv -> unrecovered failed step-sigs
  const seen = new Map<string, number>();                   // fingerprint -> times seen so far (novelty)
  const out: Tagged[] = [];
  for (const r of [...rows].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))) {
    const conv = String(r.conv ?? "?");
    const sig = stepSig(r);
    const h = String(r.h ?? r.fp ?? sig);
    const nov = (seen.get(h) ?? 0) === 0 ? 1 : 0;
    seen.set(h, (seen.get(h) ?? 0) + 1);
    const pe = predictionError(r, defenses);
    const fset = failedSig.get(conv) ?? failedSig.set(conv, new Set()).get(conv)!;
    let rw = 0;
    if (r.ok === false) fset.add(sig);
    else if (r.ok === true) {
      if (fset.has(sig)) { rw = 1; fset.delete(sig); }       // recovery — the rewarded outcome
      else if (highSignal.has(r.tool)) rw = 1;               // passing a high-signal gate
    }
    const rec = Math.pow(0.5, Math.max(0, now - (r.ts ?? now)) / ENGRAM.TAG_HALFLIFE_MS);
    const score = +(ENGRAM.W_PE * pe + ENGRAM.W_RW * rw + ENGRAM.W_NOV * nov + ENGRAM.W_REC * rec).toFixed(3);
    out.push({ ...r, sal: { score, pe, rw, nov, rec: +rec.toFixed(3) } });
  }
  return out;
}


/** SYNAPTIC TAGGING & CAPTURE (behavioral tagging): a weak, sub-threshold trace within the capture
 *  window of a high-salience "PRP" event is rescued for consolidation — the one-shot lesson that sat
 *  next to what mattered. Symmetric in time (Frey/Morris). Returns rescued rows tagged with the ts of
 *  the capturing event. Pure + testable; this is the false-negative fix frequency-thresholding causes. */
export function captureTagged(tagged: Tagged[], opts: { window?: number; prpThreshold?: number; weakMax?: number } = {}): Array<Tagged & { capturedBy: number }> {
  const window = opts.window ?? ENGRAM.CAPTURE_WINDOW_MS;
  const prp = opts.prpThreshold ?? ENGRAM.PRP_THRESHOLD;
  const weakMax = opts.weakMax ?? ENGRAM.WEAK_MAX;
  const count = new Map<string, number>();
  for (const t of tagged) { const h = String(t.h ?? t.fp ?? stepSig(t)); count.set(h, (count.get(h) ?? 0) + 1); }
  const prpEvents = tagged.filter((t) => t.sal.score >= prp);
  const rescued: Array<Tagged & { capturedBy: number }> = [];
  for (const t of tagged) {
    const h = String(t.h ?? t.fp ?? stepSig(t));
    if ((count.get(h) ?? 0) > weakMax) continue;             // not weak — consolidates on its own
    if (t.sal.score >= prp) continue;                        // already strong — not a rescue
    const near = prpEvents.find((p) => p !== t && String(p.conv) === String(t.conv) && Math.abs((p.ts ?? 0) - (t.ts ?? 0)) <= window);
    if (near) rescued.push({ ...t, capturedBy: near.ts ?? 0 });
  }
  return rescued;
}


// ── E1: PREDICTION-ERROR RECONSOLIDATION ─────────────────────────────────────
// Retrieval (a managed skill's verbs appear in the live trace) + a prediction error
// (a step it recommends fails, or a warning it encodes is contradicted) opens the
// LABILE window: the skill is re-authored — corrected, weakened, or retired — NOT
// appended-beside. The neural form of fake-green prevention (a claim that stops
// earning its prediction gets rewritten). Pure; the sleep pass executes the rewrite.
export type LabileSkill = { name: string; reason: string; pe: number; conflicts: string[] };


/** A managed skill is "retrieved" when its referenced verbs occur in the experience trace. */
export function skillRetrieved(verbs: string[], rows: Row[]): boolean {
  if (!verbs.length) return false;
  const vset = verbs.map((v) => v.toLowerCase());
  return rows.some((r) => { const s = stepSig(r).toLowerCase(); return vset.some((v) => s === v || (v.length > 3 && s.includes(v))); });
}


/** Reconsolidation candidates: managed skills retrieved AND contradicted by outcomes (prediction
 *  error ≥ 1). Each conflict names the step + how reality diverged from the skill's expectation. */
export function labileSkills(skills: Array<{ name: string; body: string }>, rows: Row[], defenses: Defense[]): LabileSkill[] {
  const tagged = tagExperience(rows, { defenses });
  const out: LabileSkill[] = [];
  for (const s of skills) {
    const verbs = skillVerbs(s.body);
    if (!verbs.length) continue;
    const vset = verbs.map((v) => v.toLowerCase());
    const used = tagged.filter((t) => { const sig = stepSig(t).toLowerCase(); return vset.some((v) => sig === v || (v.length > 3 && sig.includes(v))); });
    if (!used.length) continue;                              // not retrieved → no reconsolidation
    const hits = used.filter((t) => t.sal.pe >= 1);
    if (!hits.length) continue;
    const conflicts = [...new Set(hits.map((t) => `${stepSig(t)} ${t.ok === false ? "failed" : "succeeded-unexpectedly"} (${t.err || "ok"})`))].slice(0, 5);
    out.push({ name: s.name, reason: `retrieved + ${hits.length} prediction-error(s) → labile (re-author, do not append)`, pe: Math.max(...hits.map((t) => t.sal.pe)), conflicts });
  }
  return out.sort((a, b) => b.pe - a.pe || b.conflicts.length - a.conflicts.length);
}


// ── E2: REWARD-WEIGHTED PRIORITIZED REPLAY ───────────────────────────────────
// Sleep replay is not uniform. (a) replayQueue: salience-ranked triage. (b) reverseReplay:
// from each rewarded terminal, walk back and assign decaying credit to the steps that led to
// the win (credit assignment). (c) interleave: alternate novel hippocampal items with familiar
// consolidated skills so consolidating the new never destabilizes the old (Golden 2025). Pure.
export type ReplayItem = Tagged & { credit: number };


/** Salience-ranked replay queue (memory triage): the top-K experiences worth consolidating now. */
export function replayQueue(tagged: Tagged[], k = 12): Tagged[] {
  return [...tagged].sort((a, b) => b.sal.score - a.sal.score || (b.ts ?? 0) - (a.ts ?? 0)).slice(0, k);
}


/** Reverse replay: credit-assign backwards from each rewarded terminal outcome within its conversation. */
export function reverseReplay(tagged: Tagged[], opts: { lookback?: number; decay?: number } = {}): ReplayItem[] {
  const lookback = opts.lookback ?? 6;
  const decay = opts.decay ?? 0.7;
  const byConv = new Map<string, Tagged[]>();
  for (const t of tagged) { const c = String(t.conv ?? "?"); (byConv.get(c) ?? byConv.set(c, []).get(c)!).push(t); }
  const credit = new Map<Tagged, number>();
  for (const [, rs] of byConv) {
    rs.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
    rs.forEach((t, i) => {
      if (t.sal.rw > 0) for (let j = 0; j <= lookback && i - j >= 0; j++) { const step = rs[i - j]; credit.set(step, (credit.get(step) ?? 0) + Math.pow(decay, j)); }
    });
  }
  return [...credit.entries()].map(([t, c]) => ({ ...t, credit: +c.toFixed(3) })).sort((a, b) => b.credit - a.credit);
}


/** Interleave novel (hippocampal) items with familiar (consolidated) ones — anti-catastrophic-forgetting. */
export function interleave<A, B>(novel: A[], familiar: B[]): Array<A | B> {
  const out: Array<A | B> = [];
  const n = Math.max(novel.length, familiar.length);
  for (let i = 0; i < n; i++) { if (i < novel.length) out.push(novel[i]); if (i < familiar.length) out.push(familiar[i]); }
  return out;
}


// ── E2.5: CONSOLIDATION PLAN — the unified sleep "dream" ──────────────────────
// Pure: composes salience tagging + prioritized/reverse replay + synaptic capture +
// reconsolidation (labile skills) into ONE structured plan the sleep pass executes and
// the panel/command renders. The digest REPLACES the uniform recent-history scan that
// every other system feeds its reflector — this is the prioritized, interleaved brief.
export type EngramPlan = {
  hippoSize: number;                                  // experiences in the fast (hippocampal) store
  tagged: number;                                     // experiences considered
  replay: Tagged[];                                   // salience-ranked top-K worth consolidating now
  rescued: Array<Tagged & { capturedBy: number }>;    // weak one-shots rescued by synaptic capture
  credited: ReplayItem[];                             // reverse-replay credit-assigned steps
  labile: LabileSkill[];                              // managed skills to RE-AUTHOR (reconsolidation)
  digest: string;                                     // the consolidation brief (LLM/human readable)
};


/** Render the prioritized, interleaved consolidation brief that feeds the Reflector. Pure. */
export function renderEngramDigest(p: { replay: Tagged[]; rescued: Array<Tagged & { capturedBy: number }>; credited: ReplayItem[]; labile: LabileSkill[] }): string {
  const lines: string[] = ["# ENGRAM consolidation brief (prioritized replay, not recent-history)"];
  if (p.credited.length) {
    lines.push("\n## Rewarded paths (reverse-replay credit — steps that led to a win)");
    for (const c of p.credited.slice(0, 8)) lines.push(`- ${stepSig(c)} [credit ${c.credit}${c.ok === false ? " · was-a-failed-step" : ""}]`);
  }
  if (p.replay.length) {
    lines.push("\n## Highest-salience experiences");
    for (const t of p.replay.slice(0, 8)) lines.push(`- ${stepSig(t)} [sal ${t.sal.score} · pe ${t.sal.pe} · rw ${t.sal.rw} · nov ${t.sal.nov}]${t.err ? ` (${t.err})` : ""}`);
  }
  if (p.rescued.length) {
    lines.push("\n## Rescued one-shots (synaptic capture — rare, but sat next to what mattered)");
    for (const t of p.rescued.slice(0, 6)) lines.push(`- ${stepSig(t)}`);
  }
  if (p.labile.length) {
    lines.push("\n## Labile skills (RECONSOLIDATE — correct/weaken the contradicted claim; PRESERVE the proven core + frontmatter; never append a duplicate. Retire only if every prediction fails)");
    for (const l of p.labile.slice(0, 6)) lines.push(`- ${l.name}: ${l.reason}\n    conflicts: ${l.conflicts.join("; ")}`);
  }
  if (lines.length === 1) lines.push("(nothing salient to consolidate this cycle)");
  return lines.join("\n");
}


/** Build the full consolidation plan from the experience trace + managed skills. Pure + testable. */
export function engramConsolidate(rows: Row[], skills: Array<{ name: string; body: string }>, opts: { defenses?: Defense[]; now?: number; k?: number; highSignal?: Set<string> } = {}): EngramPlan {
  const defenses = opts.defenses ?? buildDefenses(rows);
  const tagged = tagExperience(rows, { defenses, now: opts.now, highSignal: opts.highSignal });
  const replay = replayQueue(tagged, opts.k ?? 12);
  const rescued = captureTagged(tagged);
  const credited = reverseReplay(tagged);
  const labile = labileSkills(skills, rows, defenses);
  return { hippoSize: rows.length, tagged: tagged.length, replay, rescued, credited, labile, digest: renderEngramDigest({ replay, rescued, credited, labile }) };
}


// ── E3: ENFORCED DEFENSE (permissions overlay) — the reconsolidated anti-pattern as PREVENTION ──
// A high-severity AVOID defense (a recurring failure with no known recovery) becomes a real
// deny/ask decision BEFORE the tool runs — not an advisory note. Letta's permissions.register
// is the hook Hermes/ACE lack. Gated by MM_GUARD=off|ask|deny (default off — safe-first). Pure
// decision fn so the policy is unit-tested without the live permission bus.
export type GuardMode = "off" | "ask" | "deny";

export function guardDecision(toolName: string, args: Record<string, unknown>, defenses: Defense[], mode: GuardMode): { decision: "ask" | "deny"; reason: string } | null {
  if (mode === "off") return null;
  const { fp, tmpl } = fingerprint(toolName, args ?? {});
  const hit = preActionDefense(stepSig({ tool: toolName, fp, tmpl }), defenses);
  if (!hit || hit.kind !== "avoid" || hit.severity < 2) return null; // only ENFORCE proven, unrecovered failures; fixes stay advisory
  return { decision: mode, reason: `muscle-memory: "${hit.trigger}" → ${hit.errClass} recurred ${hit.count}× with no recovery. ${hit.defense}` };
}


/** Render the consolidated-skills index for a core-memory block (char-bounded, head preserved). Pure. */
export function buildNeocortexBlock(managed: Array<{ name: string; description: string }>, opts: { limit?: number } = {}): string {
  const limit = opts.limit ?? 4000;
  const head = `# muscle-memory · consolidated skills (neocortex)\n# ${managed.length} learned skill(s); invoke by name with the Skill tool.\n`;
  const lines = managed.map((m) => `- ${m.name}: ${String(m.description).replace(/\s+/g, " ").slice(0, 140)}`);
  let body = head + lines.join("\n");
  if (body.length > limit) {
    const keep: string[] = [];
    let len = head.length;
    for (const l of lines) { if (len + l.length + 1 > limit) break; keep.push(l); len += l.length + 1; }
    body = `${head}${keep.join("\n")}\n- …(+${lines.length - keep.length} more)`;
  }
  return body;
}


/** True when MM_NATIVE opts into the given native channel ("blocks"|"passages"). */
export function nativeEnabled(channel: string): boolean {
  return (process.env.MM_NATIVE ?? "").split(/[,\s]+/).filter(Boolean).includes(channel);
}


// Walk a nested path on an unknown SDK client with typeof narrowing — no fabricated object shape,
// no inline cast-to-read. Returns the verified callable at the end of the path, BOUND to its
// receiver, or null. The binding is load-bearing: SDK resource methods (letta-client APIResource)
// read `this._client`, so an unbound extraction throws "undefined is not an object" at call time —
// which the best-effort catch blocks then swallow into a silent no-op (caught benchmarking live
// against the real letta-client SDK; the MM_NATIVE=blocks neocortex sync was silently failing).
export function reachFn(root: unknown, path: readonly string[]): ((...args: unknown[]) => unknown) | null {
  let cur: unknown = root;
  let receiver: unknown = null;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return null;
    receiver = cur;
    cur = Reflect.get(cur, key); // unknown-assignable; no shape assertion
  }
  // A verified function whose call signature can't be runtime-checked → narrow cast at the boundary.
  return typeof cur === "function" ? (cur as (...args: unknown[]) => unknown).bind(receiver) : null;
}


/** Best-effort: upsert the neocortex index into the agent's core memory block. Opt-in (MM_NATIVE has "blocks"). Never throws. */
export async function syncNeocortexBlock(client: unknown, agentId: string | null | undefined, content: string): Promise<boolean> {
  if (!agentId || !nativeEnabled("blocks")) return false;
  const update = reachFn(client, ["agents", "blocks", "update"]); // client.agents.blocks.update(label, params)
  if (!update) return false;
  try { await update(NEOCORTEX_BLOCK, { agent_id: agentId, value: content }); return true; } catch { return false; }
}


/** Best-effort: store a salient consolidated lesson as an archival passage. Opt-in (MM_NATIVE has "passages"). Never throws. */
export async function archivePassage(client: unknown, agentId: string | null | undefined, text: string, tags: string[] = ["muscle-memory"]): Promise<boolean> {
  if (!agentId || !nativeEnabled("passages") || !text.trim()) return false;
  const create = reachFn(client, ["agents", "passages", "create"]); // client.agents.passages.create(agentId, body)
  if (!create) return false;
  try { await create(agentId, { text, tags }); return true; } catch { return false; }
}
