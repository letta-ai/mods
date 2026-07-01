// P0 reliability invariant: the authoring path must NEVER silently emit nothing or a partial/empty skill.
// The author model can return empty/thin (any model, any reason). reviewAndAuthor must degrade gracefully —
// same-prompt retry → compressed-prompt retry → deterministic drafter → explicit rejected receipt with a
// reason — and never return a bare {action:"none"} with no reason, and never an empty/sub-threshold body.
import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { reviewAndAuthor } from "../mods/autopilot";

const EVIDENCE = "- recovered failure: python -m pytest (services/checkout)\n· example — IndexError: list index out of range → guard the bound\n- recovered failure: npm test\n· example — missing return → return the value";
const tmp = () => [mkdtempSync(join(tmpdir(), "mm-reliability-"))];

test("graceful degradation: an always-empty author NEVER silently returns {action:'none'}", async () => {
  const emptyAuthor = async () => ""; // model emits nothing on every call (the GLM-5.2 REVIEW_PROMPT defect)
  const res = await reviewAndAuthor(EVIDENCE, tmp(), emptyAuthor);
  // INVARIANT: must be a real terminal outcome, never a silent no-op.
  expect(["create", "update", "reject"]).toContain(res.action);
  // the old silent defect was a bare {action:"none"} with no reason — that must be impossible now.
  expect(res.action === "none" && !res.reason).toBe(false);
  // empty author ⇒ degradation must be recorded (fallback used, or explicit reject reason).
  if (res.action === "reject") { expect((res.reason || "").length).toBeGreaterThan(0); expect(res.degraded).toBeTruthy(); }
});

test("graceful degradation: explicit NOTHING-TO-SAVE is honored WITH a reason (not silent, not a failure)", async () => {
  const res = await reviewAndAuthor(EVIDENCE, tmp(), async () => "NOTHING-TO-SAVE");
  expect(res.action).toBe("none");
  expect((res.reason || "")).toMatch(/nothing-to-save/i); // explicit decision is recorded, never bare-silent
});

test("invariant: a create/update result NEVER carries an empty/sub-threshold skill body", async () => {
  // a thin garbage author: every attempt returns sub-threshold junk
  const res = await reviewAndAuthor(EVIDENCE, tmp(), async () => "## ");
  if (res.action === "create" || res.action === "update") {
    expect((res.body || "").trim().length).toBeGreaterThanOrEqual(40); // never a partial/empty body
    expect(res.content && res.content.includes("name:")).toBeTruthy();
  } else {
    expect(res.action).toBe("reject"); // otherwise an explicit reject with a reason — never silent
    expect((res.reason || "").length).toBeGreaterThan(0);
  }
});

test("graceful degradation: a working author still produces a clean skill with no degraded marker", async () => {
  const good = async () => "---\nname: recovering-from-failing-tests\ndescription: Use when a test runner goes red — read the error, fix the source, re-run.\n---\n## Procedure\n1. Re-run quietly: `pytest -q 2>&1 | tail -20`.\n2. Fix the SOURCE the traceback points to, never the test.\n## Pitfalls\n### 1. Patching the test\nTELL: the test shows in git diff. Fix: revert the test; change the source.\n## Verification\n- the original command exits 0.";
  const res = await reviewAndAuthor(EVIDENCE, tmp(), good);
  expect(["create", "update"]).toContain(res.action);
  expect(res.degraded).toBeFalsy(); // happy path is NOT flagged degraded
  expect((res.body || "").length).toBeGreaterThan(40);
});
