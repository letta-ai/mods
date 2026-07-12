// muscle-memory · gate module (split from index.ts — behavior-preserving).
import { join } from "node:path";
import { Candidate, GLOBAL_SKILLS, Outcome, hash, listSkillNames, loadExperience, redactFragment, skillDesc, slug } from "./core";
import { RepairChain, detect, detectRepairChains } from "./detect";
import { reviewAndAuthor } from "./autopilot";

/** Anti-bloat gate: refuse near-duplicate skills (token overlap on description), scanning all dirs. */
export function dedupCheck(name: string, description: string, dirs: string[] = [GLOBAL_SKILLS]): { dup: boolean; reason: string; name: string; overlap: number } {
  const words = new Set(description.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const overlapWith = (desc: string): number => {
    const dw = new Set(desc.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
    let inter = 0; for (const w of words) if (dw.has(w)) inter++;
    return words.size ? inter / words.size : 0;
  };
  let worst = { name: "", overlap: 0 };
  for (const dir of dirs) {
    for (const n of listSkillNames(dir)) {
      if (n === name) return { dup: true, reason: `skill '${n}' already exists — patch it, don't duplicate`, name: n, overlap: 1 };
      const overlap = overlapWith(skillDesc(dir, n));
      if (overlap > worst.overlap) worst = { name: n, overlap };
    }
    // P0 2b · RETIRED QUARANTINE: near-duplicates of retired skills must not be silently recreated
    // under a new name. retiredSkillBlocker catches same-name recreates; this catches renamed clones.
    // (Receipt: the recovering-from-npx-failures class — retire, then recreate a sibling next day.)
    const retiredRoot = join(dir, "_retired");
    for (const rn of listSkillNames(retiredRoot)) {
      const base = rn.replace(/-\d{4}-\d{2}-\d{2}T[\dZ.-]+$/, "");
      if (base === name) return { dup: true, reason: `retired skill '${base}' exists in quarantine (${retiredRoot}/${rn}) — restore it or absorb instead of recreating`, name: base, overlap: 1 };
      const overlap = overlapWith(skillDesc(retiredRoot, rn));
      if (overlap > 0.6) return { dup: true, reason: `>60% description overlap with RETIRED skill '${base}' (${retiredRoot}/${rn}) — quarantined: restore/absorb instead of recreating a sibling`, name: base, overlap };
    }
  }
  return { dup: worst.overlap > 0.6, reason: worst.overlap > 0.6 ? `>60% description overlap with '${worst.name}' — patch/absorb instead` : "", name: worst.name, overlap: worst.overlap };
}


export function candidateName(c: Candidate): string {
  const key = c.key.replace(/<[^>]+>/g, "").replace(/[(){}]/g, "").replace(/→/g, " to ");
  // Drop tool/primitive words + the shell-script extension, and DEDUPE repeated tokens, so the
  // deterministic fallback name stays clean (e.g. "rename-photos.sh ~/Photos" → "rename-photos", not
  // "rename-photos-sh-photos-workflow"). Keep content tokens (md/py/json) — they carry meaning. 2026-06-27.
  const STOP = new Set(["str", "path", "url", "read", "write", "edit", "bash", "sh", "cd", "ls", "cat", "echo", "pwd", "true", "sleep", "mkdir", "amp"]);
  const seen = new Set<string>();
  const words = key.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w) && !seen.has(w) && seen.add(w));
  const base = words.slice(0, 5).join("-") || (c.kind === "sequence" ? "recurring-workflow" : "recurring-command");
  // append "-workflow" only for a lone word; multi-word bases already read as a class-level name
  const name = (words.length >= 2 || /ing$/.test(base)) ? base : `${base}-workflow`;
  return slug(name);
}

export function candidateDescription(c: Candidate): string {
  return `Use when repeating the observed ${c.kind} workflow '${c.key}' (${c.count} reps across ${c.convs} conversation${c.convs === 1 ? "" : "s"}${c.fixes ? `, ${c.fixes} error-recovery reps` : ""}); trigger on similar repeated tool-use, validation, or repair loops.`;
}

export function draftSkillFromCandidate(c: Candidate): { name: string; description: string; body: string } {
  const name = candidateName(c);
  const description = candidateDescription(c);
  const parts = c.key.split(/\s*→\s*/).filter(Boolean);
  const steps = parts.length > 1
    ? parts.map((s, i) => `${i + 1}. **${s}** — perform this step intentionally; adapt paths/args to the current repo/session.`).join("\n")
    : `1. **${c.key}** — run the recurring command/template only after confirming the current repo/session context.\n2. Inspect the output and capture the success/failure receipt.\n3. If it fails, patch the root cause and rerun the same validation once.`;
  const recovery = c.fixes
    ? `\n## Failure recovery\nThis pattern includes ${c.fixes} observed error-recovery rep${c.fixes === 1 ? "" : "s"}. Preserve the recovery loop:\n\n1. Treat the first failure as diagnostic signal, not random noise.\n2. Inspect the concrete error output.\n3. Patch the smallest root cause.\n4. Rerun the same validation command/tool before claiming fixed.\n`
    : "";
  const body = `# ${name}\n\nThis skill was drafted from repeated real tool-use captured by muscle-memory. Treat it as a starting playbook: refine after the next successful/failed use.\n\n## Trigger\n${description}\n\n## Observed pattern\n\`\`\`text\n${c.key}\n\`\`\`\n\n- Kind: ${c.kind}\n- Repetitions: ${c.count}\n- Conversation spread: ${c.convs}\n- Error-recovery reps: ${c.fixes}\n- Maturity score: ${c.maturity}\n\n## Procedure\n${steps}${recovery}\n## Verification\n- Capture the concrete command/tool output that proves the workflow succeeded.\n- If this touches files, inspect diff/status before claiming done.\n- If this changes a package/mod, bundle/import or run its package-local test.\n- If this is visual/frontend work, require visual receipts plus computed boxes, not presence-only proof.\n\n## Anti-bloat / refinement rule\n- Patch this skill in place when a step is too vague, stale, or misses a failure mode.\n- Do not create a duplicate skill for the same workflow; merge or absorb instead.\n- Retire/quarantine it if future usage shows it does not earn its context.\n`;
  return { name, description, body };
}

export function findCandidate(candidateKey?: string): Candidate | undefined {
  const { candidates } = detect(loadExperience()); // v2: outcome-aware
  if (!candidateKey) return candidates[0];
  return candidates.find((c) => c.key === candidateKey || c.key.includes(candidateKey));
}

/** v2: find the repair chain whose trigger matches a candidate's first step, if any. */
export function repairForCandidate(c: Candidate): RepairChain | undefined {
  if (!c.fixes) return undefined;
  const first = c.key.split(/\s*→\s*/)[0];
  return detectRepairChains(loadExperience()).find((r) => r.trigger === first || r.verifyStep === first || c.key.includes(r.trigger) || c.key.includes(r.verifyStep));
}


// — my-add #1. AUTHORING LINTER (the highest-ROI anti-bloat lever) —
export function lintSkillDraft(d: { name: string; description: string; body: string }, opts: { needsPitfalls?: boolean } = {}): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.name)) issues.push("name must be lowercase-hyphen slug");
  if (d.name.length > 64) issues.push("name > 64 chars");
  if (!d.description || d.description.length < 20) issues.push("description too short");
  if (!/\b(use when|trigger|when )/i.test(d.description)) issues.push("description must state WHEN to use (trigger phrase)");
  if (d.description.length > 700) issues.push("description > 700 chars (keep routing lean)");
  const approxTokens = Math.ceil(d.body.length / 4);
  if (approxTokens > 5000) issues.push(`body ~${approxTokens} tokens > 5000 (decompose into references/)`);
  if (!/##\s+procedure/i.test(d.body)) issues.push("body missing ## Procedure");
  if (!/##\s+verification/i.test(d.body)) issues.push("body missing ## Verification");
  if (opts.needsPitfalls && !/##\s+(pitfalls|failure recovery)/i.test(d.body)) issues.push("fix-pattern skill must include ## Pitfalls / Failure recovery");
  return { ok: issues.length === 0, issues };
}


// — SOTA QUALITY GATE (2026-06-28): structural lint proves a skill is VALID; this proves it's TOP-TIER.
// Deterministic checks for the elements a world-class skill always has (the exact gaps a neutral judge
// flags on sub-SOTA skills): concrete code, a diagnostic TELL per pitfall, a safe-first step before any
// destructive command, and class-level generality (not a hardcoded one-off). Returns the missing elements
// so reviewAndAuthor can regenerate with targeted feedback — making EVERY distilled skill self-correct
// toward SOTA, not just the high-diversity ones. The bar that beat Hermes, enforced on every skill.
export function sotaQualityGaps(d: { name: string; description: string; body: string }): string[] {
  const gaps: string[] = []; const b = d.body; const lc = b.toLowerCase();
  // TYPE-AWARE: only hold PROCEDURAL skills (how-to: have a Procedure/Steps/Pitfalls/Method) to the
  // concrete-code + TELL bars. Descriptive/router skills (a "when to use library X" guide with no
  // procedure) legitimately carry no code — don't false-flag them. mm only ever distils procedural skills.
  const procedural = /##\s+(procedure|steps|workflow|method|pitfalls|failure recovery|recipe|how to)/i.test(b);
  // 1. CONCRETENESS — a top-tier procedural skill shows exact correct code/commands, not prose. NOTE: this
  // is a reliable signal for mm's distilled fix/debug/validate skills (validated vs a neutral judge); on
  // rich prose-heavy DOMAIN PLAYBOOKS it can over-flag, so the library-wide audit is a TRIAGE, not a verdict.
  if (procedural && (b.match(/```/g) || []).length < 2) gaps.push('CONCRETENESS: add real fenced code/command examples (show the exact correct fix, never hand-wave)');
  // 2. DIAGNOSTIC TELLS — the #1 gap on sub-SOTA skills: each pitfall needs the at-a-glance symptom.
  if (/##\s+pitfalls/i.test(b)) {
    const tells = (lc.match(/\btell\b|\bsymptom\b|at-a-glance|the signal|you'll see|gives it away/g) || []).length;
    const pitfalls = (b.split(/##\s+pitfalls/i)[1] || "").match(/^\s*(?:[-*]|\d+\.|###)\s/gm)?.length || 0;
    if (pitfalls >= 2 && tells < Math.min(2, pitfalls)) gaps.push('DIAGNOSTIC TELLS: give each Pitfall a one-line TELL — the at-a-glance symptom/error-string that identifies that failure class');
  }
  // 3. SAFE-FIRST — any destructive command must be preceded by a named non-destructive safety net.
  const destructive = /\b(rm\s+-rf?|reset\s+--hard|force[- ]?push|git\s+push\s+--force|--force\b|drop\s+(table|database)|db[: ]?migrate|delete\s+from|truncate\b|mv\s+[^\n]*\/)/i.test(b);
  const safeFirst = /\b(back\s?up|snapshot|stash|dry[- ]?run|--dry-run|--check|copy first|inspect|diff before|reversible|safety net|to a branch|tag first)\b/i.test(lc);
  if (destructive && !safeFirst) gaps.push('SAFE-FIRST: add an explicit non-destructive safety net (backup/snapshot/dry-run/inspect) as the first step before any destructive command');
  // 4. GENERALITY — a hardcoded single-target skill reads one-off; lift the rule, keep specifics as examples.
  const idMatches = b.match(/\b(agent-[a-f0-9-]{8,}|[A-Za-z0-9_]+\.com\/[A-Za-z0-9_./-]+|sk-[A-Za-z0-9]{6,})\b/g) || [];
  if (idMatches.length >= 3) gaps.push('GENERALITY: this reads as a one-off (hardcoded ids/paths) — generalize to a class-level rule and demote the specifics to a worked example');
  return gaps;
}


// LIBRARY-WIDE SOTA AUDIT (2026-06-28): the SOTA gate is a pure function, so it scores ANY skill — not
// just mm-distilled ones. This turns muscle-memory into a library quality engine: scan every skill
// (installed, hand-authored, or distilled), flag the sub-SOTA ones + their exact gaps, so they can be
// upgraded (fact-preserving) to top-tier. Read-only; the upgrade itself stays staged/reversible.
export function auditSkills(skills: Array<{ name: string; description?: string; body: string }>): {
  total: number; clean: number; flagged: Array<{ name: string; gaps: string[] }>; gapCounts: Record<string, number>;
} {
  const flagged: Array<{ name: string; gaps: string[] }> = []; const gapCounts: Record<string, number> = {};
  for (const s of skills) {
    const gaps = sotaQualityGaps({ name: s.name, description: s.description ?? "Use when relevant", body: s.body });
    if (gaps.length) { flagged.push({ name: s.name, gaps }); for (const g of gaps) { const k = g.split(":")[0]; gapCounts[k] = (gapCounts[k] || 0) + 1; } }
  }
  return { total: skills.length, clean: skills.length - flagged.length, flagged, gapCounts };
}


// CROSS-SHELF DUPLICATE DETECTOR (2026-06-28): the same skill NAME on >1 shelf (agent + global) with
// DIVERGENT content is anti-bloat — a stale copy drifting from the live one. The library audit used to
// silently skip the 2nd occurrence, so it never caught this. Consistent copies (e.g. an up-to-date
// published mirror) are NOT flagged — only genuine divergence. Provenance comments/whitespace are ignored.
export function crossShelfDuplicates(entries: Array<{ name: string; shelf: string; body: string }>): Array<{ name: string; shelves: string[]; divergent: boolean }> {
  const byName = new Map<string, Array<{ shelf: string; body: string }>>();
  for (const e of entries) { const a = byName.get(e.name) || []; a.push({ shelf: e.shelf, body: e.body }); byName.set(e.name, a); }
  const out: Array<{ name: string; shelves: string[]; divergent: boolean }> = [];
  const norm = (b: string) => hash(b.replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ").trim());
  for (const [name, copies] of byName) {
    if (copies.length < 2) continue;
    const divergent = new Set(copies.map((c) => norm(c.body))).size > 1;
    out.push({ name, shelves: [...new Set(copies.map((c) => c.shelf))], divergent });
  }
  return out;
}

/** Outcome-driven verdict for a managed skill (Library-Drift load-bearing mechanism). */
export function effectivenessVerdict(input: { uses: number; ageDays: number; staleAntiPattern: boolean }): { verdict: "keep" | "review" | "retire_candidate"; reason: string } {
  if (input.staleAntiPattern) return { verdict: "retire_candidate", reason: "the failure it targeted keeps recurring — skill isn't working" };
  if (input.uses === 0 && input.ageDays > 14) return { verdict: "retire_candidate", reason: `0 uses in ${input.ageDays}d — not earning its context` };
  if (input.uses === 0) return { verdict: "review", reason: "no observed use yet — keep if newly created" };
  return { verdict: "keep", reason: `used ${input.uses}×` };
}


// — repair-CENTERED draft: when a recurring observed failure→fix exists, the skill IS the recovery
// procedure (the high-value "the agent learned how to fix X" case). Meaningful name + steps from the
// real repair data — deterministic, useful, headless-safe (no model needed). Model authoring (reflect)
// adds richer class-level skills on top; this guarantees the repair case always graduates something good.
/** Render captured worked-examples (real, redacted) as a skill section. Empty when none captured. */
export function renderWorkedExamples(worked?: Array<{ cmd: string; errMsg?: string; fix?: string }>): string {
  if (!worked || !worked.length) return "";
  const items = worked.map((w) => {
    const sym = w.errMsg ? `**symptom:** \`${w.errMsg.replace(/\s+/g, " ").slice(0, 180)}\`` : "**symptom:** (captured)";
    const fix = w.fix ? `\n  \`\`\`diff\n${w.fix.split("\n").slice(0, 10).map((l) => "  " + l).join("\n")}\n  \`\`\`` : "";
    return `- ${sym}${fix}`;
  }).join("\n");
  return `\n\n## Worked examples (real, redacted)\nReal symptom\u2192fix pairs captured across sessions (credentials/paths scrubbed):\n${items}\n`;
}


/** Build a compact redacted diff fragment from an Edit/Write tool's args (MM_CAPTURE=worked). */
export function buildDiffFragment(args: Record<string, unknown>): string | undefined {
  const oldS = typeof args?.old_string === "string" ? args.old_string : "";
  const newS = typeof args?.new_string === "string" ? args.new_string : (typeof args?.content === "string" ? args.content : "");
  if (!oldS && !newS) return undefined;
  const o = redactFragment(oldS, 6, 200); const n = redactFragment(newS, 6, 200);
  const lines: string[] = [];
  for (const l of (o ? o.split("\n") : [])) lines.push(`- ${l}`);
  for (const l of (n ? n.split("\n") : [])) lines.push(`+ ${l}`);
  const out = lines.join("\n").slice(0, 400);
  return out || undefined;
}


export function draftWithRepair(c: Candidate, repair?: RepairChain): { name: string; description: string; body: string } {
  if (!repair) return draftSkillFromCandidate(c);
  const workedMd = renderWorkedExamples(repair.worked);
  const errTag = repair.errClass && repair.errClass !== "inferred-failure" ? repair.errClass : "";
  const s = repair.convs === 1 ? "" : "s";
  if (repair.generalized) {
    // CROSS-LANGUAGE general lesson: same recovery shape across multiple commands → one reusable skill.
    const name = slug(`recovering-from-${repair.trigger}`).slice(0, 64); // trigger = class label, e.g. "failing-script-runs"
    const exs = (repair.examples?.length ? repair.examples : [repair.verifyStep]).slice(0, 4);
    const exList = exs.map((e) => `\`${e}\``).join(", ");
    const worked = exs.map((e) => `- \`${e}\` failed${errTag ? ` (\`${errTag}\`)` : ""} → edit the **source** to fix the cause → re-ran \`${e}\` → PASS`).join("\n");
    const description = `Use when a test or script run fails (seen with ${exList}) — recover by editing the source and re-running the same command, never blind-retrying. Triggers on any fix-then-recheck loop, in any language.`;
    const body = `# ${name}\n\nA recovery discipline distilled from ${repair.count} real fix-then-recheck loops across ${repair.convs} session${s} (${exList}). The command differs by language; the discipline does not.\n\n## When to use\n- A test/script run fails (assertion, traceback, or wrong output) and you need to recover.\n- You're about to re-run a failed command unchanged, hoping it passes.\n- Any edit→re-run loop, regardless of language.\n\n## Procedure (decision guide)\n1. Re-run the exact failing command and READ the concrete error — assertion, traceback, or a wrong printed value.\n2. Do NOT blind-retry. Edit the **source** (not the test) for that specific error — smallest change first.\n3. Re-run the SAME command; confirm it passes (exit 0).\n4. Run it once more to rule out a flaky / state-dependent pass.\n\n## Worked examples (observed)\n${worked}\n\n## Pitfalls (symptom → fix)\n- Re-running a failed command unchanged → it stays red; nothing passes until the source changes.\n- Exit code 0 but wrong output (e.g. \`go run\` prints the wrong value) → the failure is in stdout, not the exit code; assert on the value, not just the exit.\n- Editing the test to force a green → fix the code the test exercises, not the assertion.\n\n## Verification\n- [ ] The failure reproduced before the fix (you saw the real error).\n- [ ] The same command passes after the fix (exit 0).\n- [ ] A second independent run also passes.`;
    return { name, description, body: body + workedMd };
  }
  const verb = slug(repair.verifyStep) || slug(c.key) || "a-recurring-check";
  const name = slug(`recovering-from-${verb}-failures`).slice(0, 64);
  const description = `Use when \`${repair.verifyStep}\` fails${errTag ? ` (\`${errTag}\`)` : ""} — recover by applying \`${repair.fixStep}\` then re-running \`${repair.verifyStep}\`, never blind-retrying. Observed ${repair.count}× across ${repair.convs} session${s}.`;
  const body = `# ${name}\n\nA recovery discipline distilled from ${repair.count} real \`${repair.verifyStep}\` fix-then-recheck loop${repair.count === 1 ? "" : "s"} across ${repair.convs} session${s}. The fix is known — apply it instead of re-deriving.\n\n## When to use\n- \`${repair.verifyStep}\` fails${errTag ? ` with \`${errTag}\`` : ""}, or any check→fix→recheck loop on it.\n- You're about to re-run \`${repair.verifyStep}\` unchanged after it failed.\n\n## Procedure (decision guide)\n1. Run \`${repair.verifyStep}\` and read the concrete error${errTag ? ` (expect \`${errTag}\`)` : ""}.\n2. Do NOT blind-retry. Apply the known fix: \`${repair.fixStep}\` — addressing that specific error.\n3. Re-run \`${repair.verifyStep}\` to confirm it passes (exit 0).\n4. Run once more to rule out a flaky pass.\n\n## Worked example (observed)\n- \`${repair.verifyStep}\` failed${errTag ? ` (\`${errTag}\`)` : ""} → \`${repair.fixStep}\` → re-ran \`${repair.verifyStep}\` → PASS  (${repair.count}× / ${repair.convs} session${s})\n\n## Pitfalls (symptom → fix)\n- Re-running \`${repair.verifyStep}\` unchanged → stays red; it won't pass until \`${repair.fixStep}\` is applied.\n- Treating the first failure as noise → it's signal; the fix is known from ${repair.count} prior recoveries.\n\n## Verification\n- [ ] \`${repair.verifyStep}\` failed before the fix (real error seen).\n- [ ] \`${repair.verifyStep}\` passes after \`${repair.fixStep}\` (exit 0).\n- [ ] A second run also passes.`;
  return { name, description, body: body + workedMd };
}
