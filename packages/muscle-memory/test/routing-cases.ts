// muscle-memory · E4 routing — the SHARED labeled case set.
//
// Consumed by BOTH test/routing.eval.ts (offline: fixture neighbors stand in for passages.search
// rank order) and scripts/bench-semantic-live.ts (live: the same cases run against a real Letta
// agent's archival memory, so the fixtures themselves get validated by real embeddings).
// Four classes:
//   A  strong-lexical duplicates   → both lanes must route UPDATE (no regression)
//   B  paraphrase duplicates       → lexical structurally CREATEs a sibling; hybrid must park
//   C  borderline corroboration    → lexical under threshold → CREATE; hybrid boost → UPDATE
//   D  genuinely novel evidence    → both lanes must CREATE (hybrid must not over-park)
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SkillRoute } from "../mods/autopilot";
import type { SemanticSkillHit } from "../mods/engram";

export type RoutingCase = {
  id: string;
  cls: "A-strong-lexical" | "B-paraphrase-dupe" | "C-borderline" | "D-novel";
  evidence: string;
  shelf: Array<[string, string]>;             // [name, description]
  neighbors: SemanticSkillHit[];              // fixture for passages.search rank order (offline lane)
  expected: { lexical: SkillRoute; hybrid: SkillRoute }; // per-lane ground truth
  target?: string;                            // required update target when route === "update"
};

/** Route each class SHOULD take — the decision-quality yardstick. For B, parking OR routing the
 * correct update both beat creating a sibling. */
export const CLASS_INTENT: Record<RoutingCase["cls"], SkillRoute> = {
  "A-strong-lexical": "update", "B-paraphrase-dupe": "park-semantic", "C-borderline": "update", "D-novel": "create",
};

export function intentSatisfied(c: RoutingCase, route: SkillRoute, target: string | null): boolean {
  const want = CLASS_INTENT[c.cls];
  if (want === "update") return route === "update" && (!c.target || target === c.target);
  if (want === "park-semantic") return route !== "create";
  return route === "create";
}

export function materialize(shelf: Array<[string, string]>): string {
  const dir = mkdtempSync(join(tmpdir(), "mm-routing-eval-"));
  for (const [n, d] of shelf) {
    mkdirSync(join(dir, n), { recursive: true });
    // Body deliberately does NOT repeat the description — repeating it double-counts every
    // desc term (+bc per occurrence) and silently inflates lexical scores past the threshold.
    writeFileSync(join(dir, n, "SKILL.md"), `---\nname: ${n}\ndescription: ${d}\n---\n## Procedure\n1. Follow the documented steps.`);
  }
  return dir;
}

export const CASES: RoutingCase[] = [
  // ── A · strong-lexical duplicates: hybrid must not disturb what lexical already gets right ──
  {
    id: "A1-pytest-verbatim", cls: "A-strong-lexical",
    evidence: "- recovered failure: python -m pytest tests/ (checkout) · AssertionError → fix source, re-run pytest until green",
    shelf: [["debugging-failing-pytest-runs", "Use when python -m pytest goes red: read the AssertionError, fix the source not the test, re-run pytest to verify green."],
            ["publishing-npm-packages", "Use when publishing an npm package: bump version, pack dry-run, verify tarball contents, publish."]],
    neighbors: [{ name: "debugging-failing-pytest-runs", rank: 0 }],
    expected: { lexical: "update", hybrid: "update" }, target: "debugging-failing-pytest-runs",
  },
  {
    id: "A2-tsc-verbatim", cls: "A-strong-lexical",
    evidence: "- recovered failure: tsc --noEmit strict null errors · fix the source types then re-run tsc --noEmit to verify",
    shelf: [["fixing-tsc-type-errors", "Use when tsc --noEmit reports type errors: read each diagnostic, fix source types, never cast to silence, re-run tsc."],
            ["managing-git-worktrees", "Use when juggling parallel branches with git worktree: add, prune, and keep one worktree per branch."]],
    neighbors: [{ name: "fixing-tsc-type-errors", rank: 0 }],
    expected: { lexical: "update", hybrid: "update" }, target: "fixing-tsc-type-errors",
  },
  {
    id: "A3-docker-build", cls: "A-strong-lexical",
    evidence: "- recovered failure: docker build layer cache miss · reorder COPY after deps install, re-run docker build",
    shelf: [["optimizing-docker-build-cache", "Use when docker build is slow or cache misses: order Dockerfile so deps install before COPY of source, verify with docker build."],
            ["rotating-api-credentials", "Use when rotating expired credentials: mint the new secret, update the store, verify the old one is revoked."]],
    neighbors: [{ name: "optimizing-docker-build-cache", rank: 0 }],
    expected: { lexical: "update", hybrid: "update" }, target: "optimizing-docker-build-cache",
  },
  // ── B · paraphrase duplicates: same territory, disjoint vocabulary — lexical misses by design ──
  {
    id: "B1-migration-paraphrase", cls: "B-paraphrase-dupe",
    evidence: "- recovered failure: alembic upgrade head (KeyError revision) · edit versions/9a1.py then alembic upgrade head again",
    shelf: [["handling-broken-schema-changes", "Use when a database change script blows up mid-apply: inspect the failing step, correct the script, apply it once more."]],
    neighbors: [{ name: "handling-broken-schema-changes", rank: 0 }],
    expected: { lexical: "create", hybrid: "park-semantic" },
  },
  {
    id: "B2-flaky-retry-paraphrase", cls: "B-paraphrase-dupe",
    evidence: "- recovered failure: vitest run intermittent timeout on CI · quarantine the flaky spec and stabilize the async wait",
    shelf: [["stabilizing-nondeterministic-checks", "Use when an automated suite passes locally but randomly goes red elsewhere: isolate the unstable case, remove timing races, make waits explicit."]],
    neighbors: [{ name: "stabilizing-nondeterministic-checks", rank: 0 }],
    expected: { lexical: "create", hybrid: "park-semantic" },
  },
  {
    id: "B3-oom-paraphrase", cls: "B-paraphrase-dupe",
    evidence: "- recovered failure: node heap out of memory during webpack production bundle · raise --max-old-space-size and split chunks",
    shelf: [["taming-memory-hungry-compilations", "Use when a large asset pipeline exhausts RAM mid-run: give the process more headroom and break the workload into smaller pieces."]],
    neighbors: [{ name: "taming-memory-hungry-compilations", rank: 0 }],
    expected: { lexical: "create", hybrid: "park-semantic" },
  },
  {
    id: "B4-lockfile-paraphrase", cls: "B-paraphrase-dupe",
    evidence: "- recovered failure: bun install frozen lockfile mismatch · regenerate bun.lock and commit it with the dependency bump",
    shelf: [["reconciling-dependency-manifests", "Use when the package manager refuses to proceed because the pinned manifest disagrees with declared requirements: refresh the pin file and check it in together."]],
    neighbors: [{ name: "reconciling-dependency-manifests", rank: 0 }],
    expected: { lexical: "create", hybrid: "park-semantic" },
  },
  {
    id: "B5-cors-paraphrase", cls: "B-paraphrase-dupe",
    evidence: "- recovered failure: fetch blocked by CORS preflight 403 on the staging API · add the origin to allowed list and expose headers",
    shelf: [["unblocking-cross-site-request-policies", "Use when the browser refuses a call to another host: adjust the server's permitted origins and returned policy so the client may proceed."]],
    neighbors: [{ name: "unblocking-cross-site-request-policies", rank: 0 }],
    expected: { lexical: "create", hybrid: "park-semantic" },
  },
  {
    id: "B6-secrets-paraphrase", cls: "B-paraphrase-dupe",
    evidence: "- recovered failure: CI job fails because AWS_SECRET_ACCESS_KEY env var missing · inject it from the repository secret store",
    shelf: [["provisioning-pipeline-credentials", "Use when an automated run cannot authenticate: source the token from the managed vault and expose it to the job at start."]],
    neighbors: [{ name: "provisioning-pipeline-credentials", rank: 0 }],
    expected: { lexical: "create", hybrid: "park-semantic" },
  },
  // ── C · borderline corroboration: exactly 3 distinctive desc-only shared terms → lexical score
  // ~15 (< threshold 18, ≥ matched floor 3); semantic rank-1 boost (+12) lifts past threshold ──
  {
    id: "C1-pytest-fixture-drift", cls: "C-borderline",
    evidence: "- recovered failure: pytest conftest fixtures drifted after a refactor · bring them back in line and run everything again",
    shelf: [["keeping-suites-healthy", "Use when pytest goes red from stale fixtures: refresh conftest, repair the source, verify by rerunning."],
            ["publishing-npm-packages", "Use when publishing an npm package: bump version, pack dry-run, verify tarball contents, publish."]],
    neighbors: [{ name: "keeping-suites-healthy", rank: 0 }],
    expected: { lexical: "create", hybrid: "update" }, target: "keeping-suites-healthy",
  },
  {
    id: "C2-worktree-detached", cls: "C-borderline",
    evidence: "- recovered failure: git worktree checkout left a detached HEAD · add tracking so later pulls land where intended",
    shelf: [["juggling-parallel-branch-copies", "Use when working across several git worktree copies: prune them and avoid a detached state."],
            ["fixing-tsc-type-errors", "Use when tsc --noEmit reports type errors: read each diagnostic, fix source types, re-run tsc."]],
    neighbors: [{ name: "juggling-parallel-branch-copies", rank: 0 }],
    expected: { lexical: "create", hybrid: "update" }, target: "juggling-parallel-branch-copies",
  },
  {
    id: "C3-docker-multistage", cls: "C-borderline",
    evidence: "- recovered failure: final container image too large in CI · introduce a multi-stage docker layout",
    shelf: [["shrinking-runtime-footprints", "Use when a docker image ships oversized: separate the stages and keep only runtime pieces."],
            ["rotating-api-credentials", "Use when rotating expired credentials: mint the new secret, update the store, verify revocation."]],
    neighbors: [{ name: "shrinking-runtime-footprints", rank: 0 }],
    expected: { lexical: "create", hybrid: "update" }, target: "shrinking-runtime-footprints",
  },
  // ── D · genuinely novel: hybrid must not over-park on weak/stale semantic noise ──
  {
    id: "D1-novel-webgl", cls: "D-novel",
    evidence: "- recovered failure: WebGL context lost on tab switch · listen for webglcontextlost and rebuild GPU resources",
    shelf: [["debugging-failing-pytest-runs", "Use when pytest goes red: read the failure, fix the source, re-run to verify green."]],
    neighbors: [], // embedding search finds nothing relevant above the floor
    expected: { lexical: "create", hybrid: "create" },
  },
  {
    id: "D2-novel-stale-passage", cls: "D-novel",
    evidence: "- recovered failure: Stripe webhook signature mismatch · verify raw body is passed unparsed to constructEvent",
    shelf: [["publishing-npm-packages", "Use when publishing an npm package: bump version, pack dry-run, verify tarball, publish."]],
    neighbors: [{ name: "retired-payments-skill", rank: 0 }], // stale passage — skill no longer on shelf
    expected: { lexical: "create", hybrid: "create" },
  },
  {
    id: "D3-novel-empty-shelf", cls: "D-novel",
    evidence: "- recovered failure: launchd plist rejected (path not absolute) · use absolute binary paths in ProgramArguments",
    shelf: [],
    neighbors: [],
    expected: { lexical: "create", hybrid: "create" },
  },
  {
    id: "D4-novel-weak-neighbor", cls: "D-novel",
    evidence: "- recovered failure: SIGBUS in mmap'd sqlite on NFS volume · move the database off networked storage",
    shelf: [["reconciling-dependency-manifests", "Use when the package manager refuses to proceed because the pinned manifest disagrees: refresh the pin file and check it in."]],
    // noise at rank 1 + off-shelf hit at rank 0: suspect only ever considers an ON-SHELF rank-1 — must not park
    neighbors: [{ name: "some-other-skill-off-shelf", rank: 0 }, { name: "reconciling-dependency-manifests", rank: 1 }],
    expected: { lexical: "create", hybrid: "create" },
  },
];
