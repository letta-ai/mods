// muscle-memory · publish tests (split from the original suite).
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

test("publish preflight: sanitizes identifiers (preserving mechanism), hard-blocks secrets, recommends", () => {
  const { sanitizeForPublish, publishHardBlocks, publishabilityScore, publishPlan } = __mm;
  const body = "Run against agent-71b0883e-c63f-4e79-bab1 at /Users/kev/proj. Set ZAI_API_KEY.\n```bash\ncurl https://x\n```";
  const { sanitized, replacements } = sanitizeForPublish(body);
  expect(sanitized).not.toContain("agent-71b0883e");
  expect(sanitized).toContain("<agent id>");
  expect(sanitized).toContain("<local path>");
  expect(sanitized).toContain("PROVIDER_API_KEY");
  expect(sanitized).toContain("curl https://x");          // mechanism preserved
  expect(replacements.length).toBeGreaterThanOrEqual(3);

  const secret = 'token = "' + "sk-" + 'abcdefabcdef1234567890"';
  expect(publishHardBlocks(secret).length).toBeGreaterThan(0);
  const blocked = publishabilityScore({ name: "x", description: "Use when something specific happens here", body: secret + "\n## Procedure\n1. x" });
  expect(blocked.recommended).toBe("block");
  expect(blocked.score).toBeLessThanOrEqual(15);

  const clean = "## When to use\nWhen a pytest suite fails.\n## Procedure\n```bash\npytest -q\n```\n## Pitfalls\n### 1. Wrong op\nTELL: sign flip. Fix it.\n```python\nreturn a + b\n```\n## Verification\n- green.\n## Anti-bloat\n- retire if 0 uses.";
  expect(publishabilityScore({ name: "debugging-failing-tests", description: "Use when a pytest suite fails with assertions", body: clean }).recommended).toBe("publish");
  expect(publishPlan({ name: "s", description: "Use when relevant in this case", body }).recommended).toBe("stage-sanitized");
});

// ── security scanner: blocks TRUE threats, allows legitimate destructive workflow ops ────────

test("publish supply chain: tier/dedup/stage/approve/visibility/tamper-guard", () => {
  const M = __mm;
  expect(M.publishTier({ publishability: 90, hardBlocks: [], replacements: [] })).toBe("marketplace-candidate");
  expect(M.publishTier({ publishability: 70, hardBlocks: [], replacements: [{ kind: "agent-id" }] })).toBe("team-shareable");
  expect(M.publishTier({ publishability: 90, hardBlocks: ["x"], replacements: [] })).toBe("blocked");
  expect(M.findSimilarSkills("a-b-c", "d", [{ name: "a-b-c", description: "x" }]).some((d) => d.why.includes("exact"))).toBe(true);

  const g = mkdtempSync(tmpdir() + "/mm-pub-");
  const nm = "zz-pub-test-" + Date.now();
  const desc = "Use when testing the publish supply chain end to end";
  const body = "---\nname: " + nm + "\ndescription: " + desc + "\n---\n## Procedure\n1. hit agent-71b0883e-c63f-4e79-bab1\n```bash\necho hi\n```\n## Pitfalls\n### 1. y\nTELL: z. Fix it.\n## Verification\n- ok.";
  const st = M.stageSanitizedPublish({ name: nm, description: desc, body });
  expect(st.staged).toBe(true);
  const ap = M.approveStagedPublish(nm, g);
  expect(ap.published).toBe(true);
  const pub = readFileSync(ap.path, "utf8");
  expect(pub).not.toContain("agent-71b0883e");        // sanitized identifiers
  expect(pub).toContain("origin: muscle-memory");      // provenance metadata
  expect(M.publishVisibilityReceipt(nm, g).exists).toBe(true);
  // tamper guard: a secret injected into the staged copy must block re-approve
  const staged = _join(st.dir, "SKILL.md");
  writeFileSync(staged, readFileSync(staged, "utf8") + '\nkey="' + "sk-" + 'abcd1234567890abcdef"');
  expect(M.approveStagedPublish(nm, mkdtempSync(tmpdir() + "/mm-g2-")).published).toBe(false);
});

// ── live visibility: liveSkillVisible degrades gracefully (never throws / never false-claims) ─

test("liveSkillVisible: graceful fallback with no/invalid agent (never throws, never claims false visibility)", () => {
  const M = __mm;
  const noAgent = M.liveSkillVisible("some-skill");
  expect(noAgent.checked).toBe(false);
  expect(noAgent.visible).toBe(false);
  expect(noAgent.note).toMatch(/reload/i);
  // an invalid agent id must fail gracefully (letta errors → caught), not throw or claim visibility
  const bad = M.liveSkillVisible("some-skill", "definitely-not-a-real-agent-id-zzz");
  expect(bad.visible).toBe(false);
  expect(typeof bad.note).toBe("string");
});

// ── cross-shelf duplicate detection: flag same-name DIVERGENT copies, ignore consistent mirrors ──

test("publishHardBlocks: catches Anthropic sk-ant- keys (found by the Letta-baseline eval)", () => {
  const k = "sk-ant-" + "api03" + "abcdef0123456789abcdef0123";
  expect(__mm.publishHardBlocks('TOKEN="' + k + '"').length).toBeGreaterThan(0);
});
