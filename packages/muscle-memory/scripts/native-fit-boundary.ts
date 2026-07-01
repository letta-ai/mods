// Block N adversarial boundary proof — autonomous prune must NEVER retire a shared global Custom Skill.
// Run with a distinct global shelf (GLOBAL_SKILLS is a module-load const):
//   MM_GLOBAL_SKILLS_DIR=$(mktemp -d) MEMORY_DIR=$(mktemp -d) MM_STATE_DIR=$(mktemp -d) bun run scripts/native-fit-boundary.ts
import { writeSkill, agentSkillsDir, GLOBAL_SKILLS, MM_TAG, autonomousShelves } from "/Users/chan2saucy/work/kevos-lab/mack/mods-repo/packages/muscle-memory/mods/core.ts";
import { saveUsage, runAutonomousPrune } from "/Users/chan2saucy/work/kevos-lab/mack/mods-repo/packages/muscle-memory/mods/lifecycle.ts";
import { existsSync } from "node:fs"; import { join } from "node:path";
const agent = agentSkillsDir({});
const managed = (n: string) => `---\nname: ${n}\ndescription: Use when ${n} happens, do the thing\n---\n## Procedure\n1. do it\n<!-- ${MM_TAG}: adversarial-test -->`;
writeSkill(agent, "agent-stale", managed("agent-stale"));          // agent-local, stale, managed
writeSkill(GLOBAL_SKILLS, "global-stale", managed("global-stale")); // SHARED global, stale, managed, lexically-prunable
const old = Date.now() - 40 * 86400000;
saveUsage({ "agent-stale": { created: old, uses: 0, state: "active" }, "global-stale": { created: old, uses: 0, state: "active" } });
console.log("agent shelf:", agent);
console.log("global shelf:", GLOBAL_SKILLS, "(distinct:", agent !== GLOBAL_SKILLS, ")");
console.log("autonomousShelves:", autonomousShelves({}));
const res = runAutonomousPrune({}, { maxRetire: 5 });
console.log("retired:", res.retired);
const globalRemains = existsSync(join(GLOBAL_SKILLS, "global-stale", "SKILL.md"));
const agentRetired = !existsSync(join(agent, "agent-stale", "SKILL.md")) && res.retired.includes("agent-stale");
console.log("\n✅ ASSERT global Custom Skill UNTOUCHED:", globalRemains && !res.retired.includes("global-stale"));
console.log("✅ ASSERT agent-local stale skill retired:", agentRetired);
if (!(globalRemains && !res.retired.includes("global-stale") && agentRetired)) { console.log("\n❌ BOUNDARY VIOLATED"); process.exit(1); }
console.log("\nBLOCK N BOUNDARY HOLDS: autonomous prune retired only agent-local; global shelf safe.");
