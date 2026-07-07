// Tests for the reseed skip-if-exists behavior. The reseed code
// path in mods/index.ts has a loop that copies asset files to the
// steward bundle, skipping any destination that already exists. We
// don't import that loop directly (it's entangled with state IO);
// instead we replicate the per-file decision logic here as a small
// standalone helper and test the units we care about.
//
// If the production loop is ever refactored into a testable helper,
// this file's logic should be replaced with a direct call to that
// helper and the `ReseedPlan` shape dropped.

import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

type Decision = "copied" | "skipped" | "errored";

// Replicates the loop in mods/index.ts:handleInit --reseed branch.
// Returns a per-file decision so we can assert on the simulated
// behavior without depending on the asset bundle or the steward
// MemFS layout.
function planReseed(srcDir: string, dstDir: string, assetFiles: string[]): Record<string, Decision> {
  const out: Record<string, Decision> = {};
  for (const rel of assetFiles) {
    const dst = join(dstDir, rel);
    try {
      mkdirSync(join(dstDir, rel, ".."), { recursive: true });
      if (existsSync(dst)) {
        out[rel] = "skipped";
        continue;
      }
      out[rel] = "copied";
    } catch {
      out[rel] = "errored";
    }
  }
  return out;
}

describe("planReseed — skip-if-exists", () => {
  it("copies a file that doesn't exist on the destination side", () => {
    const tmp = mkdtempSync(join(tmpdir(), "teamtalk-reseed-"));
    try {
      mkdirSync(join(tmp, "src", "rules", "global"), { recursive: true });
      writeFileSync(join(tmp, "src", "rules", "global", "rule-x.md"), "rule content", "utf8");

      const result = planReseed(join(tmp, "src"), join(tmp, "dst"), [
        "rules/global/rule-x.md",
      ]);
      expect(result["rules/global/rule-x.md"]).toBe("copied");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("skips a file that already exists on the destination side", () => {
    const tmp = mkdtempSync(join(tmpdir(), "teamtalk-reseed-"));
    try {
      mkdirSync(join(tmp, "src", "rules", "global"), { recursive: true });
      mkdirSync(join(tmp, "dst", "rules", "global"), { recursive: true });
      writeFileSync(join(tmp, "src", "rules", "global", "rule-x.md"), "asset version", "utf8");
      writeFileSync(join(tmp, "dst", "rules", "global", "rule-x.md"), "live bundle version", "utf8");

      const result = planReseed(join(tmp, "src"), join(tmp, "dst"), [
        "rules/global/rule-x.md",
      ]);
      expect(result["rules/global/rule-x.md"]).toBe("skipped");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("preserves distinct handling per file in the same reseed", () => {
    const tmp = mkdtempSync(join(tmpdir(), "teamtalk-reseed-"));
    try {
      mkdirSync(join(tmp, "src", "rules", "global"), { recursive: true });
      mkdirSync(join(tmp, "dst", "rules", "global"), { recursive: true });

      writeFileSync(join(tmp, "src", "rules", "global", "rule-a.md"), "rule-a asset", "utf8");
      writeFileSync(join(tmp, "src", "rules", "global", "rule-b.md"), "rule-b asset", "utf8");
      writeFileSync(join(tmp, "dst", "rules", "global", "rule-b.md"), "rule-b live", "utf8");

      const result = planReseed(join(tmp, "src"), join(tmp, "dst"), [
        "rules/global/rule-a.md",
        "rules/global/rule-b.md",
      ]);
      expect(result["rules/global/rule-a.md"]).toBe("copied");
      expect(result["rules/global/rule-b.md"]).toBe("skipped");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("treats an empty destination as a fresh copy", () => {
    const tmp = mkdtempSync(join(tmpdir(), "teamtalk-reseed-"));
    try {
      mkdirSync(join(tmp, "src", "rules", "global"), { recursive: true });
      mkdirSync(join(tmp, "dst"));

      const result = planReseed(join(tmp, "src"), join(tmp, "dst"), [
        "rules/global/rule-a.md",
        "rules/global/rule-b.md",
      ]);
      expect(result["rules/global/rule-a.md"]).toBe("copied");
      expect(result["rules/global/rule-b.md"]).toBe("copied");
      // planReseed creates parent dirs but doesn't actually copy.
      expect(existsSync(join(tmp, "dst", "rules", "global"))).toBe(true);
      expect(readdirSync(join(tmp, "dst", "rules", "global"))).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
