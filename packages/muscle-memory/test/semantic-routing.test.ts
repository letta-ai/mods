// muscle-memory · E4 semantic routing tests (hybrid recall/precision).
//
// CONTRACT under test: embedding search (client.agents.passages.search) returns rank order with
// NO absolute score, so semantic evidence may only
//   (a) BOOST a candidate the lexical scorer already found distinctive overlap for, and
//   (b) park an autonomous CREATE when the semantic rank-1 hit has ZERO lexical support
//       (the paraphrase-duplicate class lexical routing misses by construction).
// It must NEVER route an UPDATE on its own (never patch the wrong skill), and with no semanticFn
// or an empty hit list, behavior must be byte-identical to lexical-only routing.
// Run: `bun test test/semantic-routing.test.ts`
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySemanticEvidence, pickUpdateTarget, reviewAndAuthor, routeSkill, SEMANTIC_RANK_BONUS } from "../mods/autopilot";
import { calibrateSkillHits, canaryPassages, parseSkillHits, resetMissingPassagesSurfaceWarning, semanticSkillCandidates, skillPassageTag, skillPassageText, syncSkillPassages, SKILL_CANARY_NAMES, SKILL_PASSAGE_TAG } from "../mods/engram";

type Match = { name: string; description: string; dir: string; score: number; matched: number };
const M = (name: string, score: number, matched: number): Match => ({ name, description: `desc of ${name}`, dir: "/tmp", score, matched });

function shelfWith(...skills: Array<[string, string]>): string {
  const dir = mkdtempSync(join(tmpdir(), "mm-sem-shelf-"));
  for (const [n, d] of skills) {
    mkdirSync(join(dir, n), { recursive: true });
    writeFileSync(join(dir, n, "SKILL.md"), `---\nname: ${n}\ndescription: ${d}\n---\n## Procedure\n1. ${d}\n## Pitfalls\n### 1. x\nTELL: y. Fix it.\n## Verification\n- ok.`);
  }
  return dir;
}

// ── applySemanticEvidence (pure) ────────────────────────────────────────────────────────────

test("corroboration boost: semantic rank-1 lifts an under-threshold lexical target past pickUpdateTarget", () => {
  const matches = [M("debugging-failing-tests", 14, 3), M("validating-mod-packages", 4, 1)];
  expect(pickUpdateTarget(matches, 18)).toBeNull(); // lexical alone: under threshold → CREATE
  const { matches: boosted, suspect } = applySemanticEvidence(matches, [{ name: "debugging-failing-tests", rank: 0 }], () => true);
  expect(boosted[0].score).toBe(14 + SEMANTIC_RANK_BONUS[0]);
  expect(suspect).toBeNull(); // corroborated, not suspect
  expect(pickUpdateTarget(boosted, 18)?.name).toBe("debugging-failing-tests"); // hybrid: routes UPDATE
});

test("boost never manufactures `matched`: a semantic hit with zero lexical overlap gets no score boost", () => {
  const matches = [M("some-other-skill", 20, 3), M("paraphrase-dupe", 0, 0)];
  const { matches: boosted } = applySemanticEvidence(matches, [{ name: "paraphrase-dupe", rank: 0 }], () => true);
  expect(boosted.find((m) => m.name === "paraphrase-dupe")?.score).toBe(0); // matched=0 → untouched
});

test("semantic-duplicate suspect: rank-1 hit on-shelf with no distinctive lexical overlap", () => {
  const { suspect } = applySemanticEvidence([M("unrelated", 6, 1)], [{ name: "paraphrase-dupe", rank: 0 }], (n) => n === "paraphrase-dupe");
  expect(suspect).toBe("paraphrase-dupe");
});

test("stale semantic hit (passage for a deleted skill) is never a suspect", () => {
  const { suspect } = applySemanticEvidence([M("unrelated", 6, 1)], [{ name: "ghost-skill", rank: 0 }], () => false);
  expect(suspect).toBeNull();
});

test("no hits → identity: matches unchanged, no suspect (lexical-only regression)", () => {
  const matches = [M("a", 10, 2), M("b", 5, 1)];
  const out = applySemanticEvidence(matches, [], () => true);
  expect(out.matches).toEqual(matches);
  expect(out.suspect).toBeNull();
});

// ── reviewAndAuthor wiring ──────────────────────────────────────────────────────────────────

const EVIDENCE = "- recovered failure: alembic upgrade head (services/checkout)\n· example — KeyError revision → repair the version file and re-run";

test("wiring: semantic-only dupe parks the autonomous CREATE before the author is ever called", async () => {
  // Shelf skill covers the same territory in DISJOINT vocabulary — lexical routing scores ~0.
  const shelf = shelfWith(["handling-broken-schema-changes", "Use when a database change script blows up mid-apply: inspect the failed step, repair the script, apply again."]);
  let authored = 0;
  const res = await reviewAndAuthor(EVIDENCE, [shelf], async () => { authored++; return ""; }, {
    semanticFn: async () => [{ name: "handling-broken-schema-changes", rank: 0 }],
  });
  expect(res.action).toBe("none");
  expect(res.reason || "").toMatch(/semantic duplicate/i);
  expect(authored).toBe(0); // parked in routing — no model call, no write
});

test("wiring: a throwing semanticFn degrades to pure lexical routing (never blocks)", async () => {
  const shelf = shelfWith(["handling-broken-schema-changes", "Use when a database change script blows up mid-apply: inspect the failed step, repair the script, apply again."]);
  let authored = 0;
  // A VALID author draft makes the outcome deterministic regardless of host/suite state —
  // asserting on the action of an EMPTY author leaned on the deterministic fallback, whose
  // availability depends on whatever experience state other tests (or the host) left behind.
  const DRAFT = [
    "---", "name: recovering-from-visor-migration-failures",
    "description: Use when a migration verifier fails with a stale-ledger error — read the verifier, repair the config epoch, re-run to confirm.",
    "---", "## Procedure", "1. Read the exact error. 2. Repair the config. 3. Re-run the verifier.",
    "## Pitfalls", "### 1. Blind retry", "TELL: identical error twice. Fix the config first.",
    "## Verification", "- Verifier exits 0.",
  ].join("\n");
  const res = await reviewAndAuthor(EVIDENCE, [shelf], async () => { authored++; return DRAFT; }, {
    semanticFn: async () => { throw new Error("server down"); },
  });
  expect(authored).toBeGreaterThan(0); // routing survived the throwing semantic lane; the author ran
  expect(res.action).toBe("create");   // and the pure-lexical route completed end to end
});

// ── passage index primitives ────────────────────────────────────────────────────────────────

test("parseSkillHits: name from mm:skill:<name> tag, content fallback, invalid names dropped, deduped", () => {
  const hits = parseSkillHits({ count: 4, results: [
    { id: "p1", content: "skill: debugging-failing-tests\n...", tags: [SKILL_PASSAGE_TAG, skillPassageTag("debugging-failing-tests")] },
    { id: "p2", content: "skill: validating-mod-packages\n...", tags: [SKILL_PASSAGE_TAG] }, // no name tag → content fallback
    { id: "p3", content: "skill: NOT A VALID NAME!!\n...", tags: [SKILL_PASSAGE_TAG] },
    { id: "p4", content: "skill: debugging-failing-tests\n...", tags: [skillPassageTag("debugging-failing-tests")] }, // dupe
  ] });
  expect(hits.map((h) => h.name)).toEqual(["debugging-failing-tests", "validating-mod-packages"]);
  expect(hits.map((h) => h.rank)).toEqual([0, 1]);
});

test("parseSkillHits: malformed responses are empty, never throw", () => {
  expect(parseSkillHits(undefined)).toEqual([]);
  expect(parseSkillHits("nope")).toEqual([]);
  expect(parseSkillHits({ results: "nope" })).toEqual([]);
  expect(parseSkillHits({ results: [null, 42, {}] })).toEqual([]);
});

test("semanticSkillCandidates + syncSkillPassages: gated off without MM_NATIVE=passages; upsert deletes stale then creates", async () => {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const client = { agents: { passages: {
    search: (...args: unknown[]) => { calls.push({ op: "search", args }); return Promise.resolve({ count: 1, results: [{ id: "old-1", content: "skill: a-skill\nx", tags: [SKILL_PASSAGE_TAG, skillPassageTag("a-skill")] }] }); },
    create: (...args: unknown[]) => { calls.push({ op: "create", args }); return Promise.resolve([]); },
    delete: (...args: unknown[]) => { calls.push({ op: "delete", args }); return Promise.resolve({}); },
  } } };
  const prev = process.env.MM_NATIVE;
  delete process.env.MM_NATIVE;
  try {
    expect(await semanticSkillCandidates(client, "agent-1", "query")).toEqual([]); // env off → no-op
    expect(await syncSkillPassages(client, "agent-1", [{ name: "a-skill", description: "d" }])).toBe(0);
    expect(calls.length).toBe(0); // gated: the client was never touched
    process.env.MM_NATIVE = "passages";
    const hits = await semanticSkillCandidates(client, "agent-1", "query text");
    expect(hits).toEqual([{ name: "a-skill", rank: 0 }]);
    calls.length = 0;
    expect(await syncSkillPassages(client, "agent-1", [{ name: "a-skill", description: "does the thing" }])).toBe(1); // canaries excluded from the count
    // BATCHED contract (review follow-up): ONE global index search up front, then only the
    // writes that are needed — stale a-skill passage removed + recreated, two canaries created
    // (no priors). Reconciliation reuses the same index: zero extra searches.
    expect(calls.map((c) => c.op)).toEqual(["search", "delete", "create", "create", "create"]);
    const created = calls[2].args[1];
    expect(created && typeof created === "object" && "text" in created ? created.text : "").toBe(skillPassageText("a-skill", "does the thing"));
    const canaryCreate = calls[3].args[1];
    expect(canaryCreate && typeof canaryCreate === "object" && "tags" in canaryCreate ? canaryCreate.tags : []).toEqual([SKILL_PASSAGE_TAG, skillPassageTag(SKILL_CANARY_NAMES[0])]);
  } finally {
    if (prev === undefined) delete process.env.MM_NATIVE; else process.env.MM_NATIVE = prev;
  }
});

test("sync hygiene: unchanged skills skip the round-trip; removed skills get reconciled; canaries survive", async () => {
  const keptText = skillPassageText("kept-skill", "does the thing");
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const client = { agents: { passages: {
    search: (...args: unknown[]) => {
      calls.push({ op: "search", args });
      // BATCHED contract: one global index search serves everything. Results carry tags + text
      // (as the real API does): the kept skill (byte-identical → skip), a ghost (reconciled),
      // and canary #0 with its true text (unchanged → skip; canary #1 absent → created).
      return Promise.resolve({ results: [
        { id: "k1", text: keptText, tags: [SKILL_PASSAGE_TAG, skillPassageTag("kept-skill")] },
        { id: "g1", text: "leftover", tags: [SKILL_PASSAGE_TAG, skillPassageTag("ghost-skill")] },
        { id: "c1", text: canaryPassages()[0].text, tags: [SKILL_PASSAGE_TAG, skillPassageTag(SKILL_CANARY_NAMES[0])] },
      ] });
    },
    create: (...args: unknown[]) => { calls.push({ op: "create", args }); return Promise.resolve([]); },
    delete: (...args: unknown[]) => { calls.push({ op: "delete", args }); return Promise.resolve({}); },
  } } };
  const prev = process.env.MM_NATIVE;
  process.env.MM_NATIVE = "passages";
  try {
    const synced = await syncSkillPassages(client, "agent-1", [{ name: "kept-skill", description: "does the thing" }]);
    expect(synced).toBe(1); // skipped-unchanged still counts as synced (it IS on the index)
    const deletes = calls.filter((c) => c.op === "delete").map((c) => c.args[0]);
    expect(deletes).toEqual(["g1"]); // ONLY the ghost — kept skill skipped, canary immune
    const creates = calls.filter((c) => c.op === "create");
    expect(creates.length).toBe(1); // only canary #1 (absent); kept-skill AND canary #0 skipped — total API calls: 1 search + 1 delete + 1 create
    for (const c of creates) {
      const body = c.args[1] as { tags?: string[] };
      expect((body.tags ?? []).some((t) => t.includes("mm-canary-"))).toBe(true);
    }
  } finally {
    if (prev === undefined) delete process.env.MM_NATIVE; else process.env.MM_NATIVE = prev;
  }
});

// ── canary calibration (calibrateSkillHits, pure) ───────────────────────────────────────────

test("calibrateSkillHits: canaries stripped, survivors densely re-ranked and k-truncated, aboveCanary vs the BEST canary rank", () => {
  const raw = [
    { name: "alpha", rank: 0 },
    { name: SKILL_CANARY_NAMES[0], rank: 1 }, // best canary — THE relevance floor
    { name: "beta", rank: 2 },
    { name: "gamma", rank: 3 },
    { name: SKILL_CANARY_NAMES[1], rank: 4 }, // worse canary must NOT move the floor
    { name: "delta", rank: 5 },
  ];
  expect(calibrateSkillHits(raw, 3)).toEqual([
    { name: "alpha", rank: 0, aboveCanary: true },  // raw 0 beat canary raw 1
    { name: "beta", rank: 1, aboveCanary: false },  // raw 2 lost to the BEST canary, not the worst
    { name: "gamma", rank: 2, aboveCanary: false }, // dense re-rank: canary gaps closed
  ]); // delta dropped: truncation to k happens AFTER canary removal
});

test("calibrateSkillHits: canary at wire rank 0 → every survivor is below the floor (the novel-evidence window)", () => {
  expect(calibrateSkillHits([{ name: SKILL_CANARY_NAMES[1], rank: 0 }, { name: "alpha", rank: 1 }], 3))
    .toEqual([{ name: "alpha", rank: 0, aboveCanary: false }]);
});

test("calibrateSkillHits: no canary in the window → survivors carry NO aboveCanary key (uncalibrated)", () => {
  const out = calibrateSkillHits([{ name: "alpha", rank: 0 }, { name: "beta", rank: 1 }], 3);
  expect(out).toEqual([{ name: "alpha", rank: 0 }, { name: "beta", rank: 1 }]);
  // toEqual ignores undefined-valued keys, but the consumer gate is `aboveCanary !== undefined` —
  // an `aboveCanary: undefined` key would still calibrate the window. Pin the key's ABSENCE.
  expect(out.every((h) => !("aboveCanary" in h))).toBe(true);
});

test("calibrateSkillHits: a window of only canaries yields no candidates", () => {
  expect(calibrateSkillHits([{ name: SKILL_CANARY_NAMES[0], rank: 0 }, { name: SKILL_CANARY_NAMES[1], rank: 1 }], 3)).toEqual([]);
});

// ── calibrated suspect trust (applySemanticEvidence / routeSkill) ───────────────────────────

test("calibrated: deep on-shelf above-canary hit suspects past off-shelf ghosts — rank is not the gate", () => {
  const hits = [
    { name: "ghost-a", rank: 0, aboveCanary: true }, // stale passages of deleted skills — transparent
    { name: "ghost-b", rank: 1, aboveCanary: true },
    { name: "paraphrase-dupe", rank: 2, aboveCanary: true },
  ];
  const { route, suspect } = routeSkill([M("unrelated", 6, 1)], hits, (n) => n === "paraphrase-dupe");
  expect(suspect).toBe("paraphrase-dupe");
  expect(route).toBe("park-semantic");
});

test("calibrated: rank-0 on-shelf hit BELOW the floor never suspects — novel evidence routes CREATE", () => {
  // The production over-park class: index ≡ shelf, so any novel query still nominates some
  // nearest managed skill at rank 0. Below the canary line = merely nearest, not related.
  const { route, suspect } = routeSkill([M("unrelated", 6, 1)], [{ name: "nearest-but-unrelated", rank: 0, aboveCanary: false }], () => true);
  expect(suspect).toBeNull();
  expect(route).toBe("create");
});

test("calibrated: the HIGHEST-ranked qualifying hit is the suspect, not a later one", () => {
  const hits = [
    { name: "ghost", rank: 0, aboveCanary: true },      // off-shelf — skipped
    { name: "first-dupe", rank: 1, aboveCanary: true }, // ← first on-shelf above the floor
    { name: "second-dupe", rank: 2, aboveCanary: true },
  ];
  const { suspect } = applySemanticEvidence([M("unrelated", 6, 1)], hits, (n) => n !== "ghost");
  expect(suspect).toBe("first-dupe");
});

test("calibrated suspect suppressed by strong lexical support — corroboration routes UPDATE, never parks", () => {
  // matched ≥ SEARCH_DISTINCT_MIN and boosted score ≥ threshold: lexical already found it
  // distinctively, so it is a corroborated target, not a missed paraphrase dupe.
  const { route, target, suspect } = routeSkill([M("covered-skill", 20, 3)], [{ name: "covered-skill", rank: 0, aboveCanary: true }], () => true);
  expect(suspect).toBeNull();
  expect(route).toBe("update");
  expect(target?.name).toBe("covered-skill");
});

test("uncalibrated window (no aboveCanary anywhere): only rank 0 can suspect — deeper on-shelf hits never park", () => {
  // Legacy conservative rule pinned: without a relevance floor, "nearest" is meaningless past rank 0.
  const hits = [{ name: "off-shelf-ghost", rank: 0 }, { name: "on-shelf-dupe", rank: 1 }];
  const { route, suspect } = routeSkill([M("unrelated", 6, 1)], hits, (n) => n === "on-shelf-dupe");
  expect(suspect).toBeNull();
  expect(route).toBe("create");
});

// ── over-fetch + calibration wiring (semanticSkillCandidates) ───────────────────────────────

test("semanticSkillCandidates: over-fetches top_k = k + canary count and returns calibrated hits", async () => {
  let searchParams: Record<string, unknown> | undefined;
  const client = { agents: { passages: {
    search: (_agentId: string, params: Record<string, unknown>) => {
      searchParams = params;
      return Promise.resolve({ count: 3, results: [
        { id: "p1", content: "skill: near-dupe\n...", tags: [SKILL_PASSAGE_TAG, skillPassageTag("near-dupe")] },
        { id: "p2", content: `skill: ${SKILL_CANARY_NAMES[0]}\n...`, tags: [SKILL_PASSAGE_TAG, skillPassageTag(SKILL_CANARY_NAMES[0])] },
        { id: "p3", content: "skill: merely-nearest\n...", tags: [SKILL_PASSAGE_TAG, skillPassageTag("merely-nearest")] },
      ] });
    },
  } } };
  const prev = process.env.MM_NATIVE;
  process.env.MM_NATIVE = "passages";
  try {
    const hits = await semanticSkillCandidates(client, "agent-1", "query text"); // default k = 3
    expect(searchParams?.top_k).toBe(3 + SKILL_CANARY_NAMES.length); // widened so canaries never evict real hits
    expect(hits).toEqual([
      { name: "near-dupe", rank: 0, aboveCanary: true },       // beat the canary on the wire
      { name: "merely-nearest", rank: 1, aboveCanary: false }, // dense re-rank after the canary was stripped
    ]);
  } finally {
    if (prev === undefined) delete process.env.MM_NATIVE; else process.env.MM_NATIVE = prev;
  }
});

test("review concern #7: MM_NATIVE=passages with NO passages surface warns ONCE — never silently", async () => {
  const warns: string[] = [];
  const origWarn = console.warn;
  console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(" ")); };
  const prev = process.env.MM_NATIVE;
  try {
    // gated off → no warning (nothing is broken; the channel is simply not enabled)
    delete process.env.MM_NATIVE;
    resetMissingPassagesSurfaceWarning();
    expect(await semanticSkillCandidates({}, "agent-1", "q")).toEqual([]);
    expect(warns.length).toBe(0);
    // enabled but the client has no passages surface → exactly ONE signal, behavior unchanged
    process.env.MM_NATIVE = "passages";
    expect(await semanticSkillCandidates({}, "agent-1", "query")).toEqual([]);      // still lexical-safe
    expect(await syncSkillPassages({}, "agent-1", [{ name: "a-skill", description: "d" }])).toBe(0);
    expect(await semanticSkillCandidates({}, "agent-1", "again")).toEqual([]);
    expect(warns.length).toBe(1);                                                   // once, not spam
    expect(warns[0]).toContain("MM_NATIVE=passages");
    expect(warns[0]).toContain("lexical");
  } finally {
    console.warn = origWarn;
    if (prev === undefined) delete process.env.MM_NATIVE; else process.env.MM_NATIVE = prev;
  }
});
