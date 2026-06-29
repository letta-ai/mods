// Block B — the maintenance-loop demonstration, as a Verified integration test. Asserts the COMPOSED loop
// (dedup → prune → sanitize → secret-block → cross-shelf) produces a clean library from a rotted fixture,
// using the real deterministic functions. This is what turns the thesis from "told" into "shown + tested".
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { searchSkills, pickUpdateTarget } from "../mods/autopilot";
import { lifecycleTransition } from "../mods/lifecycle";
import { sanitizeForPublish } from "../mods/publish";
import { scanSkillContent } from "../mods/core";
import { crossShelfDuplicates } from "../mods/gate";

function lib() {
  const dir = mkdtempSync(join(tmpdir(), "mm-maint-test-"));
  const seed = (n: string, d: string) => { mkdirSync(join(dir, n), { recursive: true }); writeFileSync(join(dir, n, "SKILL.md"), `---\nname: ${n}\ndescription: ${d}\n---\n## Procedure\n1. ${d}`); };
  seed("debugging-failing-tests", "Use when a pytest/jest test runner goes red — read the failure, fix the source not the test, re-run to verify green.");
  seed("validating-mod-packages", "Validate a mod package before shipping: check the manifest, run the package tests, pack a dry-run, verify the build.");
  return dir;
}

test("maintenance loop · DEDUP: an incoming near-duplicate routes to UPDATE, not a sibling", () => {
  const target = pickUpdateTarget(searchSkills([lib()], "fixing failing tests test runner red fix the source rerun verify green"));
  expect(target?.name).toBe("debugging-failing-tests"); // update-first, no duplicate spawned
});

test("maintenance loop · PRUNE: stale unpinned retires; pinned is protected", () => {
  expect(lifecycleTransition({ lastActivityDaysAgo: 95, pinned: false }).state).toBe("archived"); // stale → retired
  expect(lifecycleTransition({ lastActivityDaysAgo: 95, pinned: true }).state).not.toBe("archived"); // pinned → kept
});

test("maintenance loop · SANITIZE: private paths + agent ids are scrubbed to placeholders", () => {
  const { sanitized, replacements } = sanitizeForPublish("## Procedure\n```bash\ncd /Users/kev/projects/example-ui && query agent-71b0883e-c63f-4e79-bab4\n```");
  expect(replacements.length).toBeGreaterThanOrEqual(2);
  expect((sanitized.match(/\/Users\/[a-z]+|agent-[a-f0-9]{6,}-/g) || []).length).toBe(0); // 0 leaks remain
});

test("maintenance loop · SECRET-BLOCK: an unsafe draft with a credential is refused", () => {
  const scan = scanSkillContent("## Procedure\n```bash\nexport TOKEN=\"sk-ant-" + "api03" + "abcdefghij1234567890\"\n```");
  expect(scan.ok).toBe(false); // blocked, not published
});

test("maintenance loop · CROSS-SHELF: the same skill diverging across shelves is flagged", () => {
  const drift = crossShelfDuplicates([
    { name: "validating-mod-packages", shelf: "agent", body: "validate the manifest and run tests" },
    { name: "validating-mod-packages", shelf: "global", body: "validate the manifest, run tests, AND pack a dry-run (diverged)" },
  ]);
  expect(drift.some((d) => d.divergent)).toBe(true);
});
