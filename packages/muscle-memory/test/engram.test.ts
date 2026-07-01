// muscle-memory · engram tests (split from the original suite).
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

test("predictionError: contradiction is full surprise, confirmation is none", () => {
  expect(predictionError(R("Bash", "npm test", false), [fixDef])).toBe(1); // expected success → failed
  expect(predictionError(R("Bash", "npm test", true), [fixDef])).toBe(0);  // expected success → succeeded
  expect(predictionError(R("Bash", "rm -rf x", true), [avoidDef])).toBe(1); // expected failure → succeeded
  expect(predictionError(R("Bash", "rm -rf x", false), [avoidDef])).toBe(0); // expected failure → failed
  expect(predictionError(R("Bash", "ls -la", false), [])).toBe(0.4);        // unmodeled failure = mild
  expect(predictionError(R("Bash", "ls -la", undefined), [])).toBe(0);      // no outcome → no signal
});

// ── salience tagging: reward on recovery, novelty on first sight ─────────────

test("tagExperience: recovery earns reward, repeat fingerprint loses novelty", () => {
  seq = 0;
  const rows: Row[] = [
    R("Bash", "npm test", false, { ts: T0, h: "f_test" }),
    R("Edit", "app.ts", true, { ts: T0 + 1000, h: "f_edit" }),
    R("Bash", "npm test", true, { ts: T0 + 2000, h: "f_test" }), // recovery
  ];
  const tg = tagExperience(rows, { now: T0 + 2000 });
  const rec = tg.find((t) => t.tool === "Bash" && t.ok === true)!;
  expect(rec.sal.rw).toBe(1); // recovery is the rewarded outcome
  expect(rec.sal.nov).toBe(0); // f_test already seen
  const edit = tg.find((t) => t.tool === "Edit")!;
  expect(edit.sal.nov).toBe(1); // first sight
  expect(edit.sal.rw).toBe(0);
});

test("tagExperience: recency decays a stale event below a fresh one", () => {
  seq = 0;
  const stale = R("Bash", "git status", true, { ts: T0, h: "f_a" });
  const fresh = R("Bash", "git diff", true, { ts: T0 + 12 * 60 * 60 * 1000, h: "f_b" }); // +12h
  const tg = tagExperience([stale, fresh], { now: T0 + 12 * 60 * 60 * 1000 });
  const s = tg.find((t) => t.h === "f_a")!;
  const f = tg.find((t) => t.h === "f_b")!;
  expect(f.sal.rec).toBeGreaterThan(s.sal.rec); // 2 half-lives older ⇒ ~0.25 vs ~1
});

// ── synaptic tagging & capture: rescue the weak one-shot near the win ────────

test("captureTagged: a weak one-shot near a high-salience event is rescued", () => {
  seq = 0;
  const rows: Row[] = [
    R("Bash", "npm test", false, { ts: T0, h: "f_test", conv: "c1" }),
    R("Read", "notes.md", true, { ts: T0 + 1000, h: "f_weak", conv: "c1" }),  // weak one-shot
    R("Bash", "npm test", true, { ts: T0 + 2000, h: "f_test", conv: "c1" }),  // recovery → PRP event
    R("Read", "far.md", true, { ts: T0 + 60 * MIN, h: "f_far", conv: "c1" }), // weak but far outside window
  ];
  const tg = tagExperience(rows, { now: T0 + 60 * MIN });
  const cap = captureTagged(tg);
  const names = cap.map((c) => c.h);
  expect(names).toContain("f_weak"); // rescued — sat next to what mattered
  expect(names).not.toContain("f_far"); // outside the capture window
  expect(names).not.toContain("f_test"); // not weak (seen twice)
});

// ── reconsolidation: a retrieved skill contradicted by reality goes labile ───

test("skillRetrieved: verbs present in trace ⇒ retrieved", () => {
  expect(skillRetrieved(["npm test", "edit"], [R("Bash", "npm test", true)])).toBe(true);
  expect(skillRetrieved(["npm test"], [R("Bash", "git status", true)])).toBe(false);
});

test("labileSkills: retrieved + prediction error ⇒ labile; confirmed ⇒ stable", () => {
  seq = 0;
  const labile = labileSkills([{ name: "testing-flow", body: skillBody }], [R("Bash", "npm test", false, { ts: T0 })], [fixDef]);
  expect(labile.length).toBe(1);
  expect(labile[0].name).toBe("testing-flow");
  expect(labile[0].pe).toBe(1);
  expect(labile[0].conflicts[0]).toContain("npm test");

  const stable = labileSkills([{ name: "testing-flow", body: skillBody }], [R("Bash", "npm test", true, { ts: T0 })], [fixDef]);
  expect(stable.length).toBe(0); // prediction confirmed → no reconsolidation
});

// ── prioritized replay + reverse replay (credit assignment) ──────────────────

test("replayQueue: returns top-K by salience, descending", () => {
  seq = 0;
  const rows: Row[] = [
    R("Bash", "npm test", false, { ts: T0, h: "f1" }),
    R("Edit", "a.ts", true, { ts: T0 + 1000, h: "f2" }),
    R("Bash", "npm test", true, { ts: T0 + 2000, h: "f1" }), // recovery → high salience
  ];
  const q = replayQueue(tagExperience(rows, { now: T0 + 2000 }), 2);
  expect(q.length).toBe(2);
  expect(q[0].sal.score).toBeGreaterThanOrEqual(q[1].sal.score);
});

test("reverseReplay: credit decays backward from the rewarded terminal", () => {
  seq = 0;
  const rows: Row[] = [
    R("Bash", "npm test", false, { ts: T0, h: "f1" }),
    R("Edit", "a.ts", true, { ts: T0 + 1000, h: "f2" }),
    R("Bash", "npm test", true, { ts: T0 + 2000, h: "f1" }), // rewarded terminal
  ];
  const rr = reverseReplay(tagExperience(rows, { now: T0 + 2000 }), { lookback: 6, decay: 0.7 });
  expect(rr[0].ok).toBe(true); // recovery row gets the most credit
  expect(rr[0].credit).toBeCloseTo(1, 5);
  // the step immediately before the win outranks the one before that
  const edit = rr.find((r) => r.tool === "Edit")!;
  const firstFail = rr.find((r) => r.tool === "Bash" && r.ok === false)!;
  expect(edit.credit).toBeGreaterThan(firstFail.credit);
});

// ── interleaving (anti-catastrophic-forgetting) ──────────────────────────────

test("interleave: alternates novel and familiar, keeps the longer tail", () => {
  expect(interleave([1, 2, 3], ["a", "b"])).toEqual([1, "a", 2, "b", 3]);
  expect(interleave<number, string>([], ["a"])).toEqual(["a"]);
  expect(interleave<number, string>([1], [])).toEqual([1]);
});

// ── invariants ───────────────────────────────────────────────────────────────

test("ENGRAM: prediction-error weight outweighs (reconsolidation's gate)", () => {
  expect(ENGRAM.W_PE).toBeGreaterThan(ENGRAM.W_RW);
  expect(ENGRAM.W_RW).toBeGreaterThan(ENGRAM.W_NOV);
});

// ── full consolidation plan (the unified sleep "dream") ──────────────────────

test("engramConsolidate: composes a prioritized, reconsolidation-aware plan", () => {
  seq = 0;
  const rows: Row[] = [
    R("Bash", "npm test", false, { ts: T0, h: "f_test", conv: "c1" }),
    R("Read", "notes.md", true, { ts: T0 + 1000, h: "f_weak", conv: "c1" }),
    R("Bash", "npm test", true, { ts: T0 + 2000, h: "f_test", conv: "c1" }), // recovery
  ];
  const plan = __mm.engramConsolidate(rows, [{ name: "testing-flow", body: skillBody }], { defenses: [fixDef], now: T0 + 2000 });
  expect(plan.hippoSize).toBe(3);
  expect(plan.replay.length).toBeGreaterThan(0);
  expect(plan.credited[0].credit).toBeCloseTo(1, 5);              // rewarded terminal leads credit
  expect(plan.rescued.some((r) => r.h === "f_weak")).toBe(true);  // one-shot rescued by capture
  expect(plan.labile.some((l) => l.name === "testing-flow")).toBe(true); // contradicted skill goes labile
  expect(plan.digest).toContain("ENGRAM consolidation brief");
  expect(plan.digest).toContain("RECONSOLIDATE");
});

// ── E3: enforced defense (permissions overlay) ───────────────────────────────

test("guardDecision: enforces high-severity AVOID defenses; fixes stay advisory; off is inert", () => {
  const { guardDecision } = __mm;
  expect(guardDecision("Bash", { command: "rm -rf build" }, [avoidHi], "deny")).toMatchObject({ decision: "deny" });
  expect(guardDecision("Bash", { command: "rm -rf build" }, [avoidHi], "ask")).toMatchObject({ decision: "ask" });
  expect(guardDecision("Bash", { command: "rm -rf build" }, [avoidHi], "off")).toBeNull();
  expect(guardDecision("Bash", { command: "ls -la" }, [avoidHi], "deny")).toBeNull();   // no matching defense
  expect(guardDecision("Bash", { command: "npm test" }, [fixHi], "deny")).toBeNull();    // fix = advisory, never enforced
});

// ── E3.5: native neocortex bridge (pure builder + flag) ──────────────────────

test("buildNeocortexBlock: bounded, head-preserving consolidated index", () => {
  const { buildNeocortexBlock } = __mm;
  const block = buildNeocortexBlock([{ name: "a-skill", description: "use when doing A" }, { name: "b-skill", description: "use when doing B" }]);
  expect(block).toContain("consolidated skills (neocortex)");
  expect(block).toContain("a-skill");
  expect(block).toContain("b-skill");
  const many = Array.from({ length: 50 }, (_, i) => ({ name: `skill-${i}`, description: "x".repeat(80) }));
  const bounded = buildNeocortexBlock(many, { limit: 400 });
  expect(bounded.length).toBeLessThanOrEqual(440); // head + fitted lines + truncation marker
  expect(bounded).toContain("more)");
});

test("nativeEnabled: parses the MM_NATIVE channel list (opt-in)", () => {
  const { nativeEnabled } = __mm;
  const prev = process.env.MM_NATIVE;
  process.env.MM_NATIVE = "blocks, passages";
  expect(nativeEnabled("blocks")).toBe(true);
  expect(nativeEnabled("passages")).toBe(true);
  expect(nativeEnabled("nope")).toBe(false);
  delete process.env.MM_NATIVE;
  expect(nativeEnabled("blocks")).toBe(false);
  if (prev !== undefined) process.env.MM_NATIVE = prev;
});

// ── behavioral outcome inference (the real-agent unlock: Bash emits no tool_end) ──
