// muscle-memory · detect tests (split from the original suite).
// ENGRAM (v5) deterministic core tests — salience, synaptic tagging & capture,
// prediction-error reconsolidation, prioritized/reverse replay, interleaving.
// Pure functions only; no live model, no FS. Run: `bun test muscle-memory.engram.test.ts`.
import { test, expect } from "bun:test";
import { __mm } from "../mods/index";
import type { Row, Defense } from "../mods/index";
import { preserveExistingFrontmatterMetadata, isAmbiguousExistingRoute, compareSkillSections } from "../mods/index";
import { detect, detectRepairChains, draftWithRepair, isSkillWorthy } from "../mods/index";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join as _join } from "node:path";

const {
  tagExperience, predictionError, captureTagged, labileSkills, skillRetrieved,
  replayQueue, reverseReplay, interleave, ENGRAM,
} = __mm;

const T0 = 1_700_000_000_000;
const MIN = 60_000;

let seq = 0;
function R(tool: string, tmpl: string, ok: boolean | undefined, opts: { conv?: string; ts?: number; h?: string } = {}): Row {
  return { tool, tmpl, fp: tmpl, h: opts.h ?? tmpl, ok, ts: opts.ts ?? T0 + seq++ * 1000, conv: opts.conv ?? "c1" };
}

const fixDef: Defense = { trigger: "npm test", errClass: "exit-code-1", consequence: "", defense: "", severity: 2, count: 2, kind: "fix" };
const avoidDef: Defense = { trigger: "rm", errClass: "error", consequence: "", defense: "", severity: 2, count: 2, kind: "avoid" };

// ── prediction error (the reconsolidation trigger) ───────────────────────────
const skillBody = "## Observed pattern\n```text\nnpm test → edit → npm test\n```\n\n## Procedure\nrun the loop.\n";
const avoidHi: Defense = { trigger: "rm", errClass: "error", consequence: "", defense: "root-cause before retrying", severity: 3, count: 3, kind: "avoid" };
const fixHi: Defense = { trigger: "npm test", errClass: "exit-code-1", consequence: "", defense: "apply the fix", severity: 3, count: 3, kind: "fix" };
const { renderMuscleMemoryPanel } = __mm;
const { redactFragment, buildDiffFragment, buildCrossConversationEvidence } = __mm;

test("inferOutcomes: infers Bash fail→recovery from a verify re-run after an edit", () => {
  const { inferOutcomes } = __mm;
  const inf = inferOutcomes([
    R("Bash", "cd x && pytest", undefined, { ts: T0, h: "b1" }),         // first run — no tool_end
    R("Read", "app.py", true, { ts: T0 + 1000, h: "r1" }),
    R("Edit", "app.py", true, { ts: T0 + 2000, h: "e1" }),              // the fix
    R("Bash", "cd x && pytest", undefined, { ts: T0 + 3000, h: "b1" }), // re-run — no tool_end
  ]);
  const bash = inf.filter((r) => r.tool === "Bash");
  expect(bash[0].ok).toBe(false);                 // earlier run inferred failed
  expect(bash[0].err).toBe("inferred-failure");
  expect(bash[1].ok).toBe(true);                  // later run inferred recovered
});

test("inferOutcomes: does NOT infer for non-verify commands, and never overrides a real outcome", () => {
  const { inferOutcomes } = __mm;
  const noisy = inferOutcomes([
    R("Bash", "cd x && cat notes", undefined, { ts: T0, h: "c1" }),
    R("Edit", "x", true, { ts: T0 + 1000, h: "e2" }),
    R("Bash", "cd x && cat notes", undefined, { ts: T0 + 2000, h: "c1" }),
  ]);
  expect(noisy.filter((r) => r.tool === "Bash").every((r) => r.ok === undefined)).toBe(true); // "cat" isn't a verify
  const real = inferOutcomes([
    R("Bash", "cd x && pytest", true, { ts: T0, h: "b2" }),             // real outcome present
    R("Edit", "x", true, { ts: T0 + 1000, h: "e3" }),
    R("Bash", "cd x && pytest", undefined, { ts: T0 + 2000, h: "b2" }),
  ]);
  expect(real.filter((r) => r.tool === "Bash")[0].ok).toBe(true);      // not flipped to false
});

// ── invocation / env gotchas (the class repair-chains miss; LongMemEval-V2 "environment gotchas") ──

test("detectInvocationGotchas: learns flag and env gotchas, ignores benign re-runs", () => {
  const { detectInvocationGotchas, inferOutcomes } = __mm;
  const flagRows = [
    R("Bash", "python3 run.py", undefined, { ts: T0, h: "g1" }),
    R("Read", "run.py", true, { ts: T0 + 1000, h: "gr" }),               // investigation, not an edit
    R("Bash", "python3 run.py --safe", undefined, { ts: T0 + 2000, h: "g2" }),
  ];
  const flag = detectInvocationGotchas(flagRows);
  expect(flag.length).toBe(1);
  expect(flag[0].trigger).toBe("python3");
  expect(flag[0].delta).toBe("--safe");
  // inferOutcomes marks the bare run failed via invocation-refinement (same step-sig), no edit needed
  expect(inferOutcomes(flagRows).filter((r) => r.tool === "Bash")[0].ok).toBe(false);

  const env = detectInvocationGotchas([
    R("Bash", "make build", undefined, { ts: T0, h: "m1" }),
    R("Bash", "API_TOKEN=x make build", undefined, { ts: T0 + 1000, h: "m2" }),
  ]);
  expect(env.length).toBe(1);
  expect(env[0].delta).toBe("API_TOKEN=x");                              // env-prefix gotcha learned

  const benign = detectInvocationGotchas([
    R("Bash", "pytest test_a.py", undefined, { ts: T0, h: "p1" }),
    R("Bash", "pytest test_b.py", undefined, { ts: T0 + 1000, h: "p2" }),
  ]);
  expect(benign.length).toBe(0);                                        // different target ≠ refinement
});

// ── Compounds-truly: preserve-update safety (an update must never destroy a proven skill's core) ──

test("isSkillWorthy: rejects shell-noise templates and trivial primitive-pair sequences; keeps rituals", () => {
  const mat = { count: 5, convs: 3, fixes: 0, maturity: 9, mature: true } as const;
  expect(isSkillWorthy({ kind: "template", key: "ls <path>", ...mat })).toBe(false);   // shell noise
  expect(isSkillWorthy({ kind: "template", key: "cat <path>", ...mat })).toBe(false);   // shell noise
  expect(isSkillWorthy({ kind: "sequence", key: "Edit.py → python3", ...mat })).toBe(false); // universal edit→run loop, no fix
  expect(isSkillWorthy({ kind: "sequence", key: "git add → git commit", ...mat })).toBe(true);  // a real ritual
  expect(isSkillWorthy({ kind: "template", key: "docker build <str>", ...mat })).toBe(true);    // distinctive command
  expect(isSkillWorthy({ kind: "sequence", key: "Edit.py → python3", count: 3, convs: 2, fixes: 2, maturity: 9, mature: true })).toBe(true); // a repair embedded → keep
});

test("detectRepairChains: GENERALIZES same-shape recoveries across different commands into one lesson", () => {
  const rows: Row[] = [
    R("Bash", "python3 test.py", false, { conv: "a", ts: 1 }), R("Edit", "math.py", true, { conv: "a", ts: 2 }), R("Bash", "python3 test.py", true, { conv: "a", ts: 3 }),
    R("Bash", "node test.js", false, { conv: "b", ts: 4 }),    R("Edit", "sum.js", true, { conv: "b", ts: 5 }),  R("Bash", "node test.js", true, { conv: "b", ts: 6 }),
  ];
  const reps = detectRepairChains(rows);
  const gen = reps.find((r) => r.generalized);
  expect(gen).toBeTruthy();
  expect(gen!.count).toBe(2);                                   // python3-fix + node-fix merged
  expect(gen!.convs).toBe(2);                                   // across 2 sessions → matures
  expect(gen!.examples).toEqual(expect.arrayContaining(["python3", "node"]));
  expect(reps.some((r) => r.trigger === "python3" && !r.generalized)).toBe(false); // literals absorbed, not duplicated
});

test("class-generalized repair drafts ONE high-value cross-language skill + becomes a mature candidate", () => {
  const rows: Row[] = [
    R("Bash", "python3 test.py", false, { conv: "a", ts: 1 }), R("Edit", "math.py", true, { conv: "a", ts: 2 }), R("Bash", "python3 test.py", true, { conv: "a", ts: 3 }),
    R("Bash", "node test.js", false, { conv: "b", ts: 4 }),    R("Edit", "sum.js", true, { conv: "b", ts: 5 }),  R("Bash", "node test.js", true, { conv: "b", ts: 6 }),
  ];
  const cand = detect(rows).candidates;
  expect(cand.length).toBeGreaterThanOrEqual(1);                // the generalized repair surfaces (old bar: 0)
  const gen = detectRepairChains(rows).find((r) => r.generalized)!;
  const skill = draftWithRepair(cand[0], gen);
  expect(skill.name).toBe("recovering-from-failing-script-runs");
  expect(skill.description).toMatch(/any language/i);            // cross-language general lesson
  expect(skill.body).toMatch(/## Procedure/);
  expect(skill.body).toMatch(/## Worked example/i);             // concreteness: a worked example block
  expect(skill.body).toMatch(/PASS/);                           // concrete observed recovery
  expect(skill.body).toMatch(/python3|node/);                   // cites the real commands
});

test("detectRepairChains: DIVERSE failures keep DISTINCT worked examples (no fingerprint-collapse)", () => {
  seq = 0;
  const mk = (conv: string, errMsg: string, fix: string): Row[] => [
    { tool: "Bash", tmpl: "pytest -q", fp: "Bash::pytest", h: `f${conv}`, ok: false, err: "assertion", errMsg, conv, ts: T0 + seq++ * 1000 },
    { tool: "Edit", tmpl: "Edit <path>.py", fp: `Edit::${conv}`, h: `e${conv}`, ok: true, fix, conv, ts: T0 + seq++ * 1000 },
    { tool: "Bash", tmpl: "pytest -q", fp: "Bash::pytest", h: `p${conv}`, ok: true, conv, ts: T0 + seq++ * 1000 },
  ];
  const rows = [
    ...mk("c1", "got -1", "- a - b\n+ a + b"),
    ...mk("c2", "IndexError", "- range(n+1)\n+ range(n)"),
    ...mk("c3", "got None", "- result = f()\n+ return f()"),
  ];
  const chain = detectRepairChains(rows).find((c) => c.worked);
  expect(chain).toBeTruthy();
  expect(chain!.worked!.length).toBe(3); // three DISTINCT symptom/fix pairs preserved, not collapsed to one
  const syms = chain!.worked!.map((w) => w.errMsg);
  expect(new Set(syms).size).toBe(3);
  // and the digest surfaces them concretely for the author model
  const ev = buildCrossConversationEvidence(rows);
  expect(ev.digest).toContain("got None");
  expect(ev.digest).toContain("return f()");
});

test("detectRepairChains: WITHOUT capture, no worked key is attached (shape unchanged, backward compatible)", () => {
  seq = 0;
  const rows: Row[] = [
    R("Bash", "pytest -q", false, { conv: "c1", h: "f1" }),
    R("Edit", "app.py", true, { conv: "c1", h: "e1" }),
    R("Bash", "pytest -q", true, { conv: "c1", h: "p1" }),
  ];
  const chains = detectRepairChains(rows);
  expect(chains.length).toBeGreaterThan(0);
  expect(chains.every((c) => c.worked === undefined)).toBe(true); // no errMsg/fix => no worked examples
});

// ── SOTA quality gate: flags sub-SOTA skills, passes top-tier ones ───────────
