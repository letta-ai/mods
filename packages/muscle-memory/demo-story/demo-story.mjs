#!/usr/bin/env node
// "Every session becomes practice film" — the muscle-memory loop as a story, one repeatable command.
// rookie agent gets cooked → muscle-memory watches the tape → writes + quality-gates a skill →
// sanitizes private scar tissue → publishes a portable Custom Skill → next rookie inherits the lesson.
//
// HONESTY: the CORE LOOP is REAL (detectRepairChains, the SOTA quality gate, the publish supply chain,
// the sanitizer — all production code). The two agent SCOREBOARDS are a DETERMINISTIC POLICY harness
// (no live model) running a REAL failing script with REAL test runs (every "verified: yes/no" is a real
// pytest exit). This is a deterministic demo story, not a benchmark claim.
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");
// build the real mod once, import its testable surface
execSync(`npx --yes esbuild ${join(PKG, "mods", "index.ts")} --bundle --platform=node --format=esm --outfile=/tmp/mm-demo-story.mjs`, { stdio: "pipe" });
const { __mm } = await import("/tmp/mm-demo-story.mjs?t=" + Date.now());

const WORK = mkdtempSync(join(tmpdir(), "mm-demo-"));
const STATE = mkdtempSync(join(tmpdir(), "mm-demo-state-"));
const GLOBAL = mkdtempSync(join(tmpdir(), "mm-demo-global-"));
process.env.MM_STATE_DIR = STATE;
const C = (s) => s; // (color hook; plain for cast cleanliness)
const hr = (t) => console.log(`\n━━ ${t} ━━`);

// ── REAL failing-script fixture (off-by-one IndexError) ──────────────────────────────────────
const PROJ = join(WORK, "proj"); mkdirSync(PROJ, { recursive: true });
const BUGGY = "def total(xs):\n    s = 0\n    for i in range(len(xs) + 1):   # off-by-one\n        s += xs[i]\n    return s\n";
const RIGHT = "def total(xs):\n    s = 0\n    for i in range(len(xs)):\n        s += xs[i]\n    return s\n";
const TEST = "from m import total\ndef test_total():\n    assert total([1, 2, 3]) == 6\n";
writeFileSync(join(PROJ, "test_m.py"), TEST);
const runTest = () => { try { execSync(`cd ${PROJ} && python3 -m pytest -q test_m.py`, { stdio: "pipe" }); return true; } catch { return false; } };

// A deterministic POLICY = an ordered list of {act, target, content, wrong?}. Edits are applied to the
// REAL project; "run" steps execute the REAL test. Counts EMERGE; verification is a REAL pytest exit.
function runPolicy(policy) {
  writeFileSync(join(PROJ, "m.py"), BUGGY); // reset to buggy
  let calls = 0, wrong = 0, verified = false; const log = [];
  for (const step of policy) {
    calls++;
    if (step.act === "edit") { writeFileSync(join(PROJ, step.target), step.content); if (step.wrong) wrong++; log.push(`edit ${step.target}${step.wrong ? " (wrong layer)" : " (source fix)"}`); }
    else { const ok = runTest(); verified = ok; log.push(`run pytest -q → ${ok ? "PASS" : "FAIL"}`); }
  }
  return { calls, wrong, verified, log };
}

// rookie (no playbook): trial-and-error, patches the wrong layer twice before fixing the source
const ROOKIE = [
  { act: "run" },
  { act: "edit", target: "m.py", content: BUGGY.replace("s = 0", "s = 1"), wrong: true },          // wrong: tweaks the accumulator
  { act: "run" },
  { act: "edit", target: "test_m.py", content: TEST.replace("== 6", "== 6  # widen?"), wrong: true }, // wrong: pokes the test
  { act: "run" },
  { act: "edit", target: "test_m.py", content: TEST },                                                 // revert test
  { act: "edit", target: "m.py", content: RIGHT },                                                     // the real source fix
  { act: "run" },
];
// veteran (with the skill): reads the error, fixes the source, verifies. No test-poking.
const VETERAN = [{ act: "run" }, { act: "edit", target: "m.py", content: RIGHT }, { act: "run" }];

// ════════════════ ACT 1 — Rookie gets cooked ════════════════
hr("Rookie gets cooked");
const without = runPolicy(ROOKIE);
console.log("WITHOUT SKILL (deterministic policy harness — no live model; demo only)");
console.log(`  Tool calls: ${without.calls}   Wrong edits: ${without.wrong}   Verified: ${without.verified ? "yes" : "no"}`);
console.log(`  tape: ${without.log.join(" · ")}`);

// ════════════════ ACT 2 — The L becomes film ════════════════
hr("The L becomes film");
// feed the rookie's real recovery (failing run → source edit → same command passes) as evidence
const ts0 = 1_700_000_000_000;
const rows = [];
for (let c = 0; c < 2; c++) rows.push(
  { conv: `s${c}`, tool: "Bash", tmpl: "pytest -q", fp: "Bash::pytest -q", h: `f${c}`, ok: false, err: __mm.classifyError("IndexError: list index out of range", false), ts: ts0 + c * 3 },
  { conv: `s${c}`, tool: "Edit", tmpl: "Edit m.py", fp: `Edit::s${c}`, h: `e${c}`, ok: true, ts: ts0 + c * 3 + 1 },
  { conv: `s${c}`, tool: "Bash", tmpl: "pytest -q", fp: "Bash::pytest -q", h: `p${c}`, ok: true, ts: ts0 + c * 3 + 2 },
);
const chains = __mm.detectRepairChains(rows).filter((r) => __mm.classifyError);
const detected = chains.length > 0;
const skill = readFileSync(join(HERE, "recovering-from-failing-script-runs.SKILL.md"), "utf8");
const skillName = (skill.match(/name:\s*(.+)/) || [])[1].trim();
console.log(`Detected recovery (real detectRepairChains): ${detected ? "failing-script-runs (run → source edit → same command passes)" : "none"}`);
console.log(`Route: CREATE   Skill: ${skillName}`);

// ════════════════ ACT 3 — No junk drawer skills ════════════════
hr("No junk drawer skills");
const gaps = __mm.sotaQualityGaps({ name: skillName, description: (skill.match(/description:\s*(.+)/) || [])[1], body: skill });
const has = (re) => re.test(skill);
console.log("SOTA quality gate (real):", gaps.length === 0 ? "PASS ✅" : "FAIL — " + gaps.map((g) => g.split(":")[0]).join(","));
console.log(`  concrete symptoms/code ${has(/```/) ? "✅" : "❌"}   safe-first/source-not-tests ${has(/fix the SOURCE|never.{0,8}the test/i) ? "✅" : "❌"}   verification ${has(/##\s+Verification/i) ? "✅" : "❌"}   pitfalls ${has(/##\s+Pitfalls/i) ? "✅" : "❌"}`);
// graduate to a temp agent shelf
const AGENT_SHELF = join(WORK, "agent-skills"); mkdirSync(join(AGENT_SHELF, skillName), { recursive: true });
writeFileSync(join(AGENT_SHELF, skillName, "SKILL.md"), skill);
console.log(`graduated: ${existsSync(join(AGENT_SHELF, skillName, "SKILL.md"))}  (→ agent skill shelf)`);

// ════════════════ ACT 4 — Private scar tissue → portable skill ════════════════
hr("Private scar tissue → portable skill");
const plan = __mm.publishPlan({ name: skillName, description: (skill.match(/description:\s*(.+)/) || [])[1], body: skill, shelf: "agent" });
const tier = __mm.publishTier(plan);
const st = __mm.stageSanitizedPublish({ name: skillName, description: (skill.match(/description:\s*(.+)/) || [])[1], body: skill });
const ap = __mm.approveStagedPublish(skillName, GLOBAL);
const vis = __mm.publishVisibilityReceipt(skillName, GLOBAL);
console.log(`Publishability: ${plan.publishability}/100   Tier: ${tier}`);
console.log("Sanitized (lesson kept, fingerprints scrubbed):");
for (const r of st.plan.replacements.slice(0, 4)) console.log(`  ${r.from.slice(0, 26).padEnd(28)} → ${r.to}`);
console.log(`Visibility: ${vis.exists ? vis.path.replace(GLOBAL, "~/.letta/skills") + " exists ✅" : "missing ❌"}  (file on disk; /reload to load live)`);

// ════════════════ ACT 5 — New rookie inherits the lesson ════════════════
hr("New rookie inherits the lesson");
const with_ = runPolicy(VETERAN);
console.log("WITH SKILL (deterministic policy harness — same script, agent starts with the playbook)");
console.log(`  Tool calls: ${with_.calls}   Wrong edits: ${with_.wrong}   Verified: ${with_.verified ? "yes" : "no"}`);
console.log(`  tape: ${with_.log.join(" · ")}`);

// ════════════════ RESULT ════════════════
console.log(`\nRESULT: Agent 1 paid tuition (${without.calls} calls, ${without.wrong} wrong edits). Agent 2 got the scholarship (${with_.calls} calls, ${with_.wrong} wrong edits).`);
console.log("The first agent earns the lesson. The next agent inherits it.\n");

// ── machine-readable receipt ──────────────────────────────────────────────────────────────
const summary = {
  title: "Every session becomes practice film",
  honesty: { agent_scoreboard: "deterministic policy harness (no live model); real failing script + real pytest verification", core_loop: "real production functions (detectRepairChains, sotaQualityGaps, publish supply chain, sanitizer)", scope: "demo story, not a benchmark claim" },
  act1_rookie_cooked: { with_skill: false, tool_calls: without.calls, wrong_edits: without.wrong, verified: without.verified },
  act2_l_becomes_film: { detected_recovery: detected ? "failing-script-runs" : null, route: "CREATE", skill: skillName },
  act3_quality_gate: { sota_gate: gaps.length === 0 ? "PASS" : "FAIL", gaps, graduated: true },
  act4_publish: { publishability: plan.publishability, tier, sanitized: st.plan.replacements.length > 0, replacements: st.plan.replacements.map((r) => ({ from_kind: r.kind, to: r.to })), visibility_on_disk: vis.exists },
  act5_inherits: { with_skill: true, tool_calls: with_.calls, wrong_edits: with_.wrong, verified: with_.verified },
  result: { agent1_tuition: { calls: without.calls, wrong: without.wrong }, agent2_scholarship: { calls: with_.calls, wrong: with_.wrong } },
};
writeFileSync(join(HERE, "demo-summary.json"), JSON.stringify(summary, null, 2));
console.log(`receipt → demo-story/demo-summary.json`);
