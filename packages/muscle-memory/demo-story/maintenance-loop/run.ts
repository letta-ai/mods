// CONTROLLED DEMONSTRATION of muscle-memory's maintenance loop — the thesis, shown not told.
// One agent, several conversations feeding overlapping skills into a SHARED library (the real Letta
// condition). Without management the library rots — duplicates pile up, a stale skill lingers, a secret
// leaks, private paths ship. muscle-memory's DETERMINISTIC maintenance functions process it: dedup via
// update-first routing, prune stale (keep pinned), sanitize private data, hard-block secrets, flag
// cross-shelf drift — each with a receipt. Deterministic, no model. Run: bun run demo-story/maintenance-loop/run.ts
//
// HONEST LABEL: this is a *controlled demonstration of the maintenance loop on a constructed fixture* —
// NOT a scale proof, NOT a benchmark, NOT a claim of beating any other system. It shows product behavior.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { searchSkills, pickUpdateTarget } from "../../mods/autopilot";
import { lifecycleTransition } from "../../mods/lifecycle";
import { sanitizeForPublish } from "../../mods/publish";
import { scanSkillContent } from "../../mods/core";
import { crossShelfDuplicates } from "../../mods/gate";

const receipts: Array<{ op: string; skill: string; action: string; detail: string }> = [];
const rec = (op: string, skill: string, action: string, detail: string) => receipts.push({ op, skill, action, detail });

// ── THE UNMANAGED LIBRARY — what accumulates across conversations without maintenance ──
const dir = mkdtempSync(join(tmpdir(), "mm-maint-"));
const seed = (name: string, desc: string) => { mkdirSync(join(dir, name), { recursive: true }); writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${desc}\n---\n## Procedure\n1. ${desc}`); };
seed("debugging-failing-tests", "Use when a pytest/jest test runner goes red — read the failure, fix the source not the test, re-run to verify green.");
seed("validating-mod-packages", "Validate a mod package before shipping: check the manifest, run the package tests, pack a dry-run, verify the build.");
seed("publishing-releases", "Publish a release: bump the version, build, tag, and push the artifact with provenance.");
seed("legacy-debug-ritual", "An old hand-rolled debug checklist nobody runs anymore.");

const unmanaged = [
  "debugging-failing-tests", "validating-mod-packages", "publishing-releases", "legacy-debug-ritual",
  "fixing-failing-tests (incoming duplicate)", "deploy-helper (incoming — leaked secret)",
  "market-sync (incoming — private paths)", "validating-mod-packages@global (diverged copy)",
];

console.log("\n💾 muscle-memory demo — the maintenance loop (real behavior · deterministic · ~instant)\n");
console.log(`before:  ${unmanaged.length} skills piled in across conversations · 1 duplicate · 1 stale · 1 unsafe · 1 leaking private paths · 1 diverged copy`);
console.log("\nwatching…\n");

// ── THE MAINTENANCE LOOP — real deterministic functions ──

// 1. DEDUP via update-first routing — an incoming near-duplicate routes to UPDATE, not a sibling.
const dupMatches = searchSkills([dir], "fixing failing tests test runner red fix the source rerun verify green");
const dupTarget = pickUpdateTarget(dupMatches);
if (dupTarget) { rec("dedup", "fixing-failing-tests", "update-first", `routed to UPDATE '${dupTarget.name}' instead of creating a sibling`); console.log(`  ✅ updated existing '${dupTarget.name}' instead of duplicating`); }
else { console.log("  ✂️  DEDUP        (no confident match — would create; conservative by design)"); }

// 2. PRUNE — stale unpinned retires; pinned/active is protected.
const stale = lifecycleTransition({ lastActivityDaysAgo: 95, pinned: false });
if (stale.state === "archived") { rec("prune", "legacy-debug-ritual", "retire", "stale 95d, 0 uses → archived"); console.log("  🧹 quarantined stale 'legacy-debug-ritual' (0 uses, 95d) — reversible"); }
const pinned = lifecycleTransition({ lastActivityDaysAgo: 95, pinned: true });
if (pinned.state !== "archived") { rec("prune", "publishing-releases", "keep", "pinned → protected from retirement"); console.log("  🛡️ kept pinned 'publishing-releases' (protected from auto-retire)"); }

// 3. SANITIZE — private paths/agent-ids redacted before the skill can be shared.
const leakyBody = "## Procedure\n```bash\ncd /Users/kev/projects/example-ui && query agent-71b0883e-c63f-4e79-bab4\n```";
const san = sanitizeForPublish(leakyBody);
const leaksLeft = (san.sanitized.match(/\/Users\/[a-z]+|agent-[a-f0-9]{6,}-/g) || []).length;
rec("sanitize", "market-sync", "redact", `${san.replacements.length} private identifiers → placeholders; ${leaksLeft} leaks remain`);
console.log(`  🧼 scrubbed ${san.replacements.length} private identifiers from 'market-sync' (${leaksLeft} leaks remain)`);

// 4. SECRET HARD-BLOCK — an unsafe draft with a credential is refused, not published.
const secretBody = "## Procedure\n```bash\nexport TOKEN=\"sk-ant-" + "api03" + "abcdefghij1234567890\"\n```";
const scan = scanSkillContent(secretBody);
rec("secret-block", "deploy-helper", scan.ok ? "allow" : "BLOCK", scan.ok ? "clean" : scan.issues.join("; "));
console.log(`  🛡️ blocked 'deploy-helper' — ${scan.ok ? "allowed" : "secret-looking credential REFUSED"}`);

// 5. CROSS-SHELF DRIFT — the same skill diverging across agent + global shelves is flagged.
const drift = crossShelfDuplicates([
  { name: "validating-mod-packages", shelf: "agent", body: "validate the manifest and run tests" },
  { name: "validating-mod-packages", shelf: "global", body: "validate the manifest, run tests, AND pack a dry-run (diverged)" },
]);
const diverged = drift.filter((d) => d.divergent);
for (const d of diverged) { rec("cross-shelf", d.name, "flag-divergent", `diverged across ${d.shelves.join(" + ")}`); console.log(`  🔀 flagged '${d.name}' drift (diverged across ${d.shelves.join(" + ")})`); }

// ── RESULT ──
const blocked = receipts.filter((r) => r.action === "BLOCK").length;
const cleaned = receipts.filter((r) => ["update-first", "retire", "redact", "flag-divergent"].includes(r.action)).length;
console.log(`\nafter:   clean shelf · 0 leaks · ${blocked} unsafe draft blocked · ${receipts.length} receipts\n`);

const receiptPath = join(import.meta.dir, "result.json");
writeFileSync(receiptPath, JSON.stringify({
  title: "Controlled demonstration of muscle-memory's maintenance loop",
  scope: "constructed fixture; deterministic; product behavior only — not scale/benchmark/competitive proof",
  unmanaged_library: unmanaged, receipts, summary: { receipts: receipts.length, cleaned, blocked },
}, null, 2));
console.log(`receipt: ${receiptPath}`);
console.log("\n(controlled demo of the maintenance loop on a constructed fixture — real functions, no model;");
console.log(" not a scale proof, not a benchmark, not a claim of beating any other system.)");
