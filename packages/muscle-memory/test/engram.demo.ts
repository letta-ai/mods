// muscle-memory — the FULL lifecycle of a skill, end to end, DETERMINISTIC (no live model):
// CREATION → MATURATION (generalize across languages) → GRADUATION → USE → REFINE (compound) → PRUNE (reversible).
// Run isolated:  MM_STATE_DIR=$(mktemp -d) MEMORY_DIR=$(mktemp -d) MM_GLOBAL_SKILLS_DIR=$(mktemp -d) bun run muscle-memory.engram.demo.ts
import { __mm } from "../mods/index";
import type { Row } from "../mods/index";
import { writeFileSync, existsSync, readFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Self-contained isolation: the mod reads MM_STATE_DIR / MEMORY_DIR / MM_GLOBAL_SKILLS_DIR at import.
// IMPORTANT: Letta Code sessions usually already have MEMORY_DIR set, so demos MUST NOT trust inherited
// env by default or they will write to the real agent MemFS. Unless MM_DEMO_USE_REAL=1 is explicit, mint
// temp state + temp MemFS + temp global shelf and re-exec with those paths. Keeps `npm run verify` safe.
if (process.env.MM_DEMO_ISOLATED !== "1" && process.env.MM_DEMO_USE_REAL !== "1") {
  const env = { ...process.env,
    MM_DEMO_ISOLATED: "1",
    MM_STATE_DIR: mkdtempSync(join(tmpdir(), "mm-demo-state-")),
    MEMORY_DIR: mkdtempSync(join(tmpdir(), "mm-demo-memory-")),
    MM_GLOBAL_SKILLS_DIR: mkdtempSync(join(tmpdir(), "mm-demo-global-skills-")),
  };
  const child = Bun.spawnSync([process.execPath, "run", import.meta.path], { env, stdout: "inherit", stderr: "inherit" });
  process.exit(child.exitCode ?? 0);
}

const {
  detect, detectRepairChains, autopilotPlan, executeAutopilotPlan, AUTOPILOT_DEFAULT,
  managedView, runAutonomousPrune, buildRegistry, effectivenessVerdict, restoreManagedSkill,
  buildDefenses, engramConsolidate,
} = __mm;

const SKILLS = join(process.env.MEMORY_DIR as string, "skills");
const GLOBAL_SKILLS = process.env.MM_GLOBAL_SKILLS_DIR as string;
mkdirSync(SKILLS, { recursive: true });
mkdirSync(GLOBAL_SKILLS, { recursive: true });
const STATE = process.env.MM_STATE_DIR as string;
const USAGE = join(STATE, "skill-usage.json");
const readUsage = (): Record<string, any> => (existsSync(USAGE) ? JSON.parse(readFileSync(USAGE, "utf8")) : {});
const writeUsage = (u: Record<string, any>) => writeFileSync(USAGE, JSON.stringify(u, null, 2));
let s = 0;
const R = (tool: string, tmpl: string, ok: boolean | undefined, conv: string): Row =>
  ({ tool, tmpl, fp: tmpl, h: tmpl, ok, ts: 1_700_000_000_000 + s++ * 1000, conv });
const line = (t: string) => console.log(`\n━━ ${t} ━━`);

// Two real sessions of the SAME recovery SHAPE in DIFFERENT languages (python, node).
const rows: Row[] = [
  R("Bash", "python3 test.py", false, "s1"), R("Edit", "math.py", true, "s1"), R("Bash", "python3 test.py", true, "s1"),
  R("Bash", "node test.js", false, "s2"),    R("Edit", "sum.js", true, "s2"),  R("Bash", "node test.js", true, "s2"),
];

// ── 1. CREATION — capture real tool-use, detect a recurring recovery (generalized across languages) ──
line("1. CREATION — capture tool-use → detect a recurring recovery");
const rep = detectRepairChains(rows).find((r) => r.generalized);
if (!rep) { console.error("no generalized repair"); process.exit(1); }
console.log(`  recovery detected: "${rep.trigger}" — ${rep.count} recoveries / ${rep.convs} sessions, seen with ${rep.examples?.join(", ")}`);
const cand = detect(rows).candidates[0];
console.log(`  → matured candidate (maturity=${cand.maturity}); the literal commands differ, the LESSON is shared`);

// ── 2. GRADUATION — autopilot distills + writes a real SKILL.md (deterministic-first, headless-safe) ──
line("2. GRADUATION — autopilot writes the skill to the library");
const plan = autopilotPlan({ rows, managed: managedView([SKILLS]), dirsForDedup: [SKILLS], config: { ...AUTOPILOT_DEFAULT, mode: "auto" } });
const res = executeAutopilotPlan(plan, { skillsDir: SKILLS, rows });
const name = res.graduated[0];
const skillPath = join(SKILLS, name, "SKILL.md");
console.log(`  graduated: ${name}  →  ${skillPath}`);
console.log(readFileSync(skillPath, "utf8").split("\n").slice(0, 6).map((l) => "  | " + l).join("\n"));

// ── 3. USE — the agent reuses the skill in a later session; it earns its context ──
line("3. USE — the agent invokes the skill; it earns its keep");
const u = readUsage();
u[name] = { ...(u[name] || {}), uses: 3, created: u[name]?.created ?? Date.now(), lastActivity: Date.now(), state: "active" };
writeUsage(u);
const rec = buildRegistry([SKILLS]).skills.find((x) => x.name === name);
console.log(`  registry: ${rec?.name} — uses=${rec?.uses}, state=${rec?.state}  ·  verdict=${effectivenessVerdict({ uses: 3, ageDays: 2, staleAntiPattern: false }).verdict}`);

// ── 4. REFINE — a 3rd language (go) hits the SAME shape → folds into the SAME skill (anti-bloat) ──
line("4. REFINE — a new language hits the same shape → compounds, no sibling skill");
const rows2 = [...rows, R("Bash", "go run main.go", false, "s3"), R("Edit", "main.go", true, "s3"), R("Bash", "go run main.go", true, "s3")];
const rep2 = detectRepairChains(rows2).find((r) => r.generalized);
console.log(`  same skill "${name}" now generalizes across: ${rep2?.examples?.join(", ")} (${rep2?.count} recoveries / ${rep2?.convs} sessions) → routes as UPDATE`);
// Reconsolidation needs a skill that PREDICTS a step succeeds (a recovery skill is CONFIRMED, not
// contradicted, by the failure it handles). Model a "stable flow" skill whose assumed-good step now fails.
const predicting = [{ name: "ship-pr-flow", body: "## Observed pattern\n```text\ntsc → vitest → vercel\n```\n## Procedure\nrun the loop.\n" }];
const contra = [...rows2,
  R("Bash", "tsc --noEmit", false, "s4"), R("Edit", "api.ts", true, "s4"), R("Bash", "tsc --noEmit", true, "s4"), // learns tsc is "fixed"
  R("Bash", "tsc --noEmit", false, "s5")]; // …then tsc fails AGAIN → prediction error vs the learned fix
const cons = engramConsolidate(contra, predicting, { defenses: buildDefenses(contra) });
console.log(`  reconsolidation: ${cons.labile.length ? `"${cons.labile[0].name}" flagged LABILE (a predicted-good step failed → re-author the proven core, don't blindly append)` : "stable"}`);

// ── 5. PRUNE — a stale, never-used skill is retired, reversibly (Hermes "never delete") ──
line("5. PRUNE — a stale 0-use skill is retired (reversible quarantine)");
const stale = "legacy-debug-ritual";
mkdirSync(join(SKILLS, stale), { recursive: true });
writeFileSync(join(SKILLS, stale, "SKILL.md"), `---\nname: ${stale}\ndescription: an old trick nobody runs\n---\n## Procedure\n1. do the thing\n<!-- muscle-memory provenance: seeded-demo -->\n`);
const u2 = readUsage();
u2[stale] = { uses: 0, created: Date.now() - 40 * 86400000, state: "active" }; // 40 days old, never used
writeUsage(u2);
console.log(`  verdict(${stale}): ${effectivenessVerdict({ uses: 0, ageDays: 40, staleAntiPattern: false }).verdict}`);
const pruned = runAutonomousPrune(undefined, { maxRetire: 1 });
const gone = !existsSync(join(SKILLS, stale, "SKILL.md"));
console.log(`  retired: ${pruned.retired.join(", ") || "(none)"}  ·  kept: ${pruned.kept.join(", ")}`);
const restored = pruned.retired.includes(stale) ? restoreManagedSkill(stale) : "";
console.log(`  reversible: file removed=${gone}, restored from quarantine=${restored ? "OK" : "n/a"}`);

// ── the FULL cycle must behave, not just print ──
line("LIFECYCLE VERIFIED");
const ok =
  !!rep.generalized &&
  name === "recovering-from-failing-script-runs" &&
  rec?.uses === 3 &&
  (rep2?.examples?.length ?? 0) >= 3 &&
  cons.labile.length > 0 &&
  pruned.retired.includes(stale) && gone && !!restored;
console.log(ok ? "✅ creation → graduation → use → refine → prune — all verified end-to-end, no live model" : "❌ lifecycle assertion FAILED");
process.exit(ok ? 0 : 1);
