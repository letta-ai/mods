// muscle-memory · autopilot tests (split from the original suite).
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

test("preserveExistingFrontmatterMetadata: carries old metadata block into a rewrite that dropped it", () => {
  const oldC = `---\nname: deploy-flow\ndescription: Use when deploying\nmetadata:\n  uses: 7\n  created: 2026-01-01\n---\n\n## Procedure\n1. old`;
  const newC = `---\nname: deploy-flow\ndescription: Use when deploying (improved)\n---\n\n## Procedure\n1. new\n## Pitfalls\n- x`;
  const merged = preserveExistingFrontmatterMetadata(newC, oldC);
  expect(merged).toContain("metadata:");
  expect(merged).toContain("uses: 7");
  expect(merged).toContain("(improved)"); // new content kept
});

test("preserveExistingFrontmatterMetadata: no-ops when the rewrite already has metadata or there is no old", () => {
  const withMeta = `---\nname: x\ndescription: d\nmetadata:\n  uses: 1\n---\n\n## Procedure\n1. a`;
  expect(preserveExistingFrontmatterMetadata(withMeta, `---\nname: x\nmetadata:\n  uses: 9\n---`)).toBe(withMeta); // don't clobber
  expect(preserveExistingFrontmatterMetadata(withMeta, undefined)).toBe(withMeta); // no old → unchanged
});

test("isAmbiguousExistingRoute: refuses create when two proven skills both half-cover (runner-up MORE distinctive)", () => {
  const ambiguous = [{ name: "ledger", score: 30, matched: 3 }, { name: "package-validation", score: 26, matched: 5 }];
  expect(isAmbiguousExistingRoute(ambiguous)).toBe(true);
  const clear = [{ name: "ledger", score: 40, matched: 6 }, { name: "misc", score: 8, matched: 1 }]; // top clearlyLeads → update target
  expect(isAmbiguousExistingRoute(clear)).toBe(false);
  expect(isAmbiguousExistingRoute([{ name: "solo", score: 30, matched: 4 }])).toBe(false); // novel → allow create
});

test("compareSkillSections: surfaces dropped/preserved/added sections for review", () => {
  const oldC = `## Procedure\n## Pitfalls\n## Verification`;
  const newC = `## Procedure\n## Verification\n## Examples`;
  const d = compareSkillSections(oldC, newC);
  expect(d.droppedSections).toContain("pitfalls"); // a real destructive drop is visible
  expect(d.preservedSections).toEqual(expect.arrayContaining(["procedure", "verification"]));
  expect(d.addedSections).toContain("examples");
});

// ── UI panel: legible live-mirror + freeze-proof (the showcase surface; Adrian's hour-long freeze) ──

test("buildEvidenceManifest: an UPDATE records a section-level diff (destructive rewrite is reviewable)", () => {
  const { buildEvidenceManifest } = __mm;
  const oldC = "---\nname: x\n---\n## Procedure\n## Pitfalls\n## Verification";
  const newC = "---\nname: x\n---\n## Procedure\n## Verification\n## Examples";
  const m = buildEvidenceManifest({ action: "update", skill: "x", convs: 2, signals: 3, memfsHits: [], preferences: [], rejected: [], newContent: newC, oldContent: oldC });
  expect(m.sectionDiff?.dropped).toContain("pitfalls");          // a dropped section is surfaced
  expect(m.sectionDiff?.preserved).toEqual(expect.arrayContaining(["procedure", "verification"]));
  expect(m.oldHash).toBeTruthy();
  const create = buildEvidenceManifest({ action: "create", skill: "y", convs: 1, signals: 2, memfsHits: [], preferences: [], rejected: [], newContent: newC });
  expect(create.sectionDiff).toBeUndefined();                    // no diff for a fresh create
});

// ── v6 WORKED-EXAMPLE CAPTURE (MM_CAPTURE) — concreteness + cross-session breadth, privacy-gated ──
