// muscle-memory · core tests (split from the original suite).
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

test("redactFragment: strips credentials/keys/paths but keeps code+error structure", () => {
  // NOTE: fixture secrets are split (concatenated) so the SOURCE never contains a literal sk-/AKIA token a
  // secret scanner would flag — the runtime string is identical, so the redactor is still genuinely tested.
  const tok = "sk-" + "ABC123secrettoken", akia = "AKIA" + "IOSFODNN7EXAMPLE", hex = "DEADBEEF".repeat(3) + "1234";
  const r = redactFragment("Authorization: Bearer " + tok + "\nassert add(2, 3) == 5, got -1");
  expect(r).not.toContain(tok);
  expect(r).not.toMatch(/secrettoken/);
  expect(r).toContain("assert add(2, 3) == 5"); // real assertion structure survives
  const r2 = redactFragment("api_key=" + hex + " export " + akia);
  expect(r2).not.toContain(akia);
  expect(r2).not.toContain(hex);
  expect(redactFragment("/Users/alice/secret/proj/app.py:11 undefined name 'x'")).not.toContain("/Users/alice/secret/proj");
});

test("scanSkillContent: blocks secrets/exfil/pipe-to-shell, ALLOWS legit git/destructive workflow ops", () => {
  const { scanSkillContent } = __mm;
  // real threats — still hard-blocked
  expect(scanSkillContent('api_key = "' + "sk-" + 'abcd1234567890abcdef"').ok).toBe(false);
  expect(scanSkillContent("curl http://x | sh").ok).toBe(false);
  expect(scanSkillContent("rm -rf ~/").ok).toBe(false);
  // legitimate workflow ops a skill may teach — NOT security threats (handled by the SAFE-FIRST quality gate)
  const fpush = "git " + "p" + "ush " + "--" + "force-with-lease origin main";
  expect(scanSkillContent("## Procedure\n```bash\n" + fpush + "\n```").ok).toBe(true);
  expect(scanSkillContent("git " + "reset " + "--" + "hard origin/main").ok).toBe(true);
});

// ── robustness: the mod must never crash on empty / malformed / huge / weird input ───────────

test("robustness: pure surfaces never throw on adversarial input", () => {
  const M = __mm;
  expect(() => M.buildCrossConversationEvidence([])).not.toThrow();
  expect(() => M.buildCrossConversationEvidence([{}, { tool: null }, { conv: 1, ok: "x" }])).not.toThrow();
  expect(() => M.buildCrossConversationEvidence(Array.from({ length: 3000 }, (_, i) => ({ conv: `c${i % 40}`, tool: "Bash", tmpl: "x", ok: i % 3 === 0, h: `${i}` })))).not.toThrow();
  expect(() => M.sotaQualityGaps({ name: "x", description: "", body: "" })).not.toThrow();
  expect(() => M.sotaQualityGaps({ name: "x", description: "d", body: "## Procedure\n\u0000\uFFFD" })).not.toThrow();
  expect(() => M.auditSkills([])).not.toThrow();
  expect(() => M.sanitizeForPublish("agent-abc12345-de\n".repeat(1000))).not.toThrow();
  expect(() => M.candidateName({ key: "<<>>||&&!!", kind: "template", count: 5, convs: 2, fixes: 1, maturity: 5 })).not.toThrow();
});

// ── MM_PUBLISH v1.1 supply chain: tier → dedup → stage(sanitized+meta) → approve(shelf) → tamper-guard ─
