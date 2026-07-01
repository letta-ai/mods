// muscle-memory · ui tests (split from the original suite).
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

test("renderMuscleMemoryPanel: each phase renders one legible line", () => {
  process.env.MM_REFLECT = "auto";
  const now = Date.now();
  expect(renderMuscleMemoryPanel({ phase: "reviewing", detail: "3 sessions", ts: now })[0]).toContain("reviewing 3 sessions");
  expect(renderMuscleMemoryPanel({ phase: "routing", route: "UPDATE → deploy-flow", ts: now })[0]).toContain("UPDATE → deploy-flow");
  expect(renderMuscleMemoryPanel({ phase: "writing", skill: "deploy-flow", ts: now })[0]).toContain("writing 'deploy-flow'");
  expect(renderMuscleMemoryPanel({ phase: "done", last: "graduated 'recovering-from-pytest-failures'", ts: now })[0]).toContain("graduated");
  expect(renderMuscleMemoryPanel({ phase: "protected", last: "blocked unsafe content (safe)", ts: now })[0]).toContain("🛡️");
});

test("renderMuscleMemoryPanel: FREEZE-PROOF — a stale transient phase self-heals to 'watching', never sticks", () => {
  process.env.MM_REFLECT = "auto";
  const stale = Date.now() - 130_000; // > 120s transient TTL — the exact 'writing…' freeze condition
  const out = renderMuscleMemoryPanel({ phase: "writing", skill: "x", ts: stale });
  expect(out[0]).toContain("watching");          // NOT stuck on "writing…"
  expect(out[0]).not.toContain("writing");
});

test("renderMuscleMemoryPanel: hidden when off+idle, watching when armed", () => {
  process.env.MM_REFLECT = "off";
  expect(renderMuscleMemoryPanel({})).toEqual([]);             // off + no activity → invisible
  process.env.MM_REFLECT = "auto";
  expect(renderMuscleMemoryPanel({})[0]).toContain("watching"); // armed → shows it's live
  delete process.env.MM_REFLECT;
});

// ── SOTA leap: skill-worthiness gate (reject noise) + class-generalized repairs (learn the lesson) ──
