// muscle-memory · CREATE-gate tests (P0: n=1 gate + pre-create dedupe surface).
//
// RECEIPT this suite exists for: `recovering-from-npx-failures` — an n=1, command-shaped
// skill ("Observed 1× across 1 session") that was reflect-created TWICE on consecutive days
// and retired twice. Two holes let it happen:
//   (2a) the reflect lane's evidence floor is AGGREGATE (items >= 2): an n=1 repair can ride
//        in on an unrelated recurring workflow and become a skill with no multi-instance support;
//   (2b) the manual create / create_from_candidate dedupe surface (scanDirs) does NOT include
//        the STAGED shelf, and near-duplicates of RETIRED skills are invisible to dedupCheck
//        (retiredSkillBlocker is same-name only).
// Run: `bun test test/create-gates.test.ts`
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Row } from "../mods/index";
import { buildCrossConversationEvidence, multiInstanceSupport } from "../mods/detect";
import { runReflectiveReview } from "../mods/autopilot";
import { dedupCheck } from "../mods/gate";
import { createDedupeSurface, STAGED_DIR } from "../mods/core";

const T0 = 1_700_000_000_000;
let seq = 0;
function R(tool: string, tmpl: string, ok: boolean | undefined, opts: { conv?: string; ts?: number; err?: string } = {}): Row {
  return { tool, tmpl, fp: tmpl, h: tmpl, ok, ts: opts.ts ?? T0 + seq++ * 1000, conv: opts.conv ?? "c1", ...(opts.err ? { err: opts.err } : {}) } as Row;
}

/** The npx hole, reconstructed: ONE fail→fix→verify arc for a distinctive command in ONE
 * conversation, padded by an UNRELATED recurring workflow so the aggregate items floor passes. */
function n1Experience(): Row[] {
  seq = 0;
  return [
    // n=1 repair arc (single conversation, single instance)
    R("Bash", "npx quokka-visor migrate", false, { conv: "c1", err: "exit-code-1" }),
    R("Edit", "visor.config.mjs", true, { conv: "c1" }),
    R("Bash", "npx quokka-visor migrate", true, { conv: "c1" }),
    // unrelated padding workflow (3× → topTmpl signal) — this is what sneaks items past the floor
    R("Bash", "agenttrace --overview", true, { conv: "c2" }),
    R("Bash", "agenttrace --overview", true, { conv: "c3" }),
    R("Bash", "agenttrace --overview", true, { conv: "c4" }),
  ];
}

/** Same arc observed in TWO conversations → legitimately create-worthy. */
function n2Experience(): Row[] {
  const rows = n1Experience();
  return [
    ...rows,
    R("Bash", "npx quokka-visor migrate", false, { conv: "c5", err: "exit-code-1" }),
    R("Edit", "visor.config.mjs", true, { conv: "c5" }),
    R("Bash", "npx quokka-visor migrate", true, { conv: "c5" }),
  ];
}

const N1_DRAFT = [
  "---",
  "name: recovering-from-quokka-visor-failures",
  "description: Use when npx quokka-visor migrate fails — recover by editing visor.config.mjs and re-running, never blind-retrying.",
  "---",
  "## Procedure",
  "1. Read the exact error. 2. Edit visor.config.mjs. 3. Re-run the same command.",
  "## Pitfalls",
  "- Blind retry without editing the config reproduces the failure.",
  "## Verification",
  "Re-run `npx quokka-visor migrate` and confirm exit 0.",
].join("\n");

// ── 2a · evidence signals are structural, not just prose ────────────────────────────────────

test("2a · buildCrossConversationEvidence exposes per-signal instance counts (signals[])", () => {
  const ev = buildCrossConversationEvidence(n1Experience()) as any;
  expect(Array.isArray(ev.signals)).toBe(true);
  const repair = ev.signals.find((s: any) => /quokka-visor/.test(s.label));
  expect(repair).toBeTruthy();
  expect(repair.count).toBe(1);
  expect(repair.convs).toBe(1);
  const tmplSig = ev.signals.find((s: any) => /agenttrace/.test(s.label));
  expect(tmplSig).toBeTruthy();
  expect(tmplSig.count).toBeGreaterThanOrEqual(3);
});

// ── 2a · the pure gate ──────────────────────────────────────────────────────────────────────

test("2a · n=1 gate: a create grounded ONLY in a single-instance signal is refused", () => {
  const ev = buildCrossConversationEvidence(n1Experience()) as any;
  const g = multiInstanceSupport("recovering-from-quokka-visor-failures npx quokka-visor migrate fails", ev.signals);
  expect(g.ok).toBe(false);
  expect(g.reason).toMatch(/single|1|instance/i);
});

test("2a · n=1 gate: the SAME topic with 2 distinct instances (2 convs) passes", () => {
  const ev = buildCrossConversationEvidence(n2Experience()) as any;
  const g = multiInstanceSupport("recovering-from-quokka-visor-failures npx quokka-visor migrate fails", ev.signals);
  expect(g.ok).toBe(true);
  expect(g.matched).toMatch(/quokka-visor/);
});

test("2a · n=1 gate: a topically UNGROUNDED create (no matching signal at all) is refused", () => {
  const ev = buildCrossConversationEvidence(n2Experience()) as any;
  const g = multiInstanceSupport("orchestrating-kubernetes-blue-green-deploys", ev.signals);
  expect(g.ok).toBe(false);
  expect(g.reason).toMatch(/no .*(grounded|matching|evidence)/i);
});

test("2a · n=1 gate: cannot ride in on an UNRELATED multi-instance signal (the padding hole)", () => {
  const ev = buildCrossConversationEvidence(n1Experience()) as any;
  // the padding workflow (agenttrace 3×) must NOT lend its instances to the quokka-visor topic
  const g = multiInstanceSupport("recovering-from-quokka-visor-failures npx quokka-visor migrate fails", ev.signals);
  expect(g.ok).toBe(false);
});

// ── 2a · wiring: runReflectiveReview refuses the n=1 create end-to-end ──────────────────────

test("2a · wiring: reflect lane parks an n=1 create as action:none with an n=1 reason (no write)", async () => {
  const memBefore = process.env.MEMORY_DIR;
  const tmpMem = mkdtempSync(join(tmpdir(), "mm-n1-mem-"));
  process.env.MEMORY_DIR = tmpMem; // isolate agent shelf; restored below
  try {
    // nonce the UNRELATED padding workflow so each run gets a fresh evidence signature —
    // the park writes a handled-reflects mark, and a fixed fixture would collide with
    // its own mark from a previous run ("already reflected") instead of exercising the gate.
    const nonce = `run${Date.now()}`;
    const experience = n1Experience().map((r) =>
      /agenttrace/.test(String(r.tmpl)) ? { ...r, tmpl: `agenttrace --overview --${nonce}`, fp: `agenttrace --overview --${nonce}`, h: `agenttrace --overview --${nonce}` } : r,
    );
    const res = await runReflectiveReview({}, {
      mode: "staged",
      authorFn: async () => N1_DRAFT,
      experience,
    } as any);
    expect(res.action).toBe("none");
    expect(res.reason || "").toMatch(/n=1|single.instance|multi.instance/i);
    expect(res.wrote).toBeFalsy();
  } finally {
    if (memBefore === undefined) delete process.env.MEMORY_DIR; else process.env.MEMORY_DIR = memBefore;
  }
});

// ── 2b · dedupe surface includes the STAGED shelf ───────────────────────────────────────────

test("2b · createDedupeSurface includes agent, global AND staged shelves", () => {
  const surface = createDedupeSurface();
  expect(surface).toContain(STAGED_DIR);
  expect(surface.length).toBeGreaterThanOrEqual(2);
});

test("2b · dedupCheck: a near-duplicate of a STAGED skill routes to PATCH, not a sibling create", () => {
  const staged = mkdtempSync(join(tmpdir(), "mm-staged-"));
  mkdirSync(join(staged, "recovering-from-quokka-visor-failures"), { recursive: true });
  writeFileSync(
    join(staged, "recovering-from-quokka-visor-failures", "SKILL.md"),
    "---\nname: recovering-from-quokka-visor-failures\ndescription: Use when npx quokka-visor migrate fails — recover by editing visor.config.mjs and re-running, never blind-retrying.\n---\n## Procedure\nfix then re-run.\n",
  );
  const dc = dedupCheck(
    "recovering-from-visor-migrate-errors",
    "Use when npx quokka-visor migrate fails — recover by editing visor.config.mjs and re-running instead of blind-retrying.",
    [staged],
  );
  expect(dc.dup).toBe(true);
  expect(dc.name).toBe("recovering-from-quokka-visor-failures");
});

// ── 2b · near-duplicates of RETIRED skills are quarantined (not silently recreated) ─────────

test("2b · dedupCheck: a near-duplicate of a RETIRED skill (different name) is quarantined", () => {
  const shelf = mkdtempSync(join(tmpdir(), "mm-shelf-"));
  const retired = join(shelf, "_retired", "recovering-from-quokka-visor-failures-2026-06-29T00-00-00-000Z");
  mkdirSync(retired, { recursive: true });
  writeFileSync(
    join(retired, "SKILL.md"),
    "---\nname: recovering-from-quokka-visor-failures\ndescription: Use when npx quokka-visor migrate fails — recover by editing visor.config.mjs and re-running, never blind-retrying.\n---\n## Procedure\nfix then re-run.\n",
  );
  const dc = dedupCheck(
    "recovering-from-visor-migrate-errors",
    "Use when npx quokka-visor migrate fails — recover by editing visor.config.mjs and re-running instead of blind-retrying.",
    [shelf],
  );
  expect(dc.dup).toBe(true);
  expect(dc.reason).toMatch(/retired|quarantine/i);
});
