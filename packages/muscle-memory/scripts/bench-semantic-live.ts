// muscle-memory · E4 LIVE SEMANTIC BENCHMARK — the same labeled routing cases as
// test/routing.eval.ts, but the semantic lane is REAL: a disposable Letta agent's archival
// memory, real passage embeddings, real client.agents.passages.search — through the exact
// production functions (syncSkillPassages → semanticSkillCandidates → routeSkill).
//
// What it measures, per case:
//   1. semantic recall — does real embedding search rank the fixture's expected neighbor #1?
//   2. decision quality — lexical-only vs hybrid-with-live-embeddings, vs class intent
//   3. latency — per passages.search round trip
//
// Requirements: LETTA_API_KEY in the environment (Letta Cloud or a self-hosted server via
// LETTA_BASE_URL). Creates ONE throwaway agent (mm-bench-<ts>) and deletes it afterwards,
// even on failure. Writes receipts to /tmp/mm-bench-live-<ts>.json.
//
// Run: LETTA_API_KEY=... bun scripts/bench-semantic-live.ts
import { writeFileSync } from "node:fs";
import { routeSkill, searchSkills } from "../mods/autopilot";
import { canaryPassages, parseSkillHits, semanticSkillCandidates, skillPassageTag, skillPassageText, SKILL_PASSAGE_TAG } from "../mods/engram";
import { CASES, intentSatisfied, materialize } from "../test/routing-cases";
import { reachFn } from "../mods/engram";

// Dynamic import by necessity: this package ships with ZERO dependencies, so the letta-client
// module cannot be a static import — it resolves from the host's letta-code install (or an
// explicit override), i.e. the specifier is genuinely runtime-selected per machine.
async function loadClientCtor(): Promise<new (opts?: { apiKey?: string | null }) => unknown> {
  const candidates = [
    process.env.LETTA_CLIENT_PATH,
    "@letta-ai/letta-client",
    `${process.env.HOME}/.local/lib/node_modules/@letta-ai/letta-code/node_modules/@letta-ai/letta-client/index.js`,
  ].filter((c): c is string => !!c);
  for (const spec of candidates) {
    try {
      const mod: unknown = await import(spec);
      if (mod && typeof mod === "object" && "Letta" in mod && typeof mod.Letta === "function") {
        return mod.Letta as new (opts?: { apiKey?: string | null }) => unknown;
      }
      if (mod && typeof mod === "object" && "default" in mod && typeof mod.default === "function") {
        return mod.default as new (opts?: { apiKey?: string | null }) => unknown;
      }
    } catch { /* try next */ }
  }
  throw new Error("letta-client not resolvable — set LETTA_CLIENT_PATH to its index.js");
}

if (!process.env.LETTA_API_KEY) { console.error("LETTA_API_KEY not set — aborting (no server to bench against)"); process.exit(2); }
process.env.MM_NATIVE = "passages"; // the lane under test is opt-in; enable it for this process

const LettaCtor = await loadClientCtor();
const client: unknown = new LettaCtor();

const createAgent = reachFn(client, ["agents", "create"]);
const deleteAgent = reachFn(client, ["agents", "delete"]);
const createPassage = reachFn(client, ["agents", "passages", "create"]);
const searchPassages = reachFn(client, ["agents", "passages", "search"]);
if (!createAgent || !deleteAgent || !createPassage || !searchPassages) { console.error("client missing agents/passages surface"); process.exit(2); }

function fieldStr(o: unknown, k: string): string {
  return o && typeof o === "object" && k in o && typeof Reflect.get(o, k) === "string" ? String(Reflect.get(o, k)) : "";
}

const created: unknown = await createAgent({ name: `mm-bench-${Date.now()}`, description: "muscle-memory E4 live routing benchmark — safe to delete" });
const agentId = fieldStr(created, "id");
if (!agentId) { console.error("agent create returned no id"); process.exit(2); }
console.log(`bench agent: ${agentId}`);

type CaseReceipt = { id: string; cls: string; recallAt1: boolean | null; lexRoute: string; hybRoute: string; lexIntentOk: boolean; hybIntentOk: boolean; searchMs: number; liveRank1: string | null; liveTop: string[] };
const receipts: CaseReceipt[] = [];
const latencies: number[] = [];

try {
  // Seed the UNION shelf ONCE — the production shape: the passage index always covers the whole
  // managed shelf, never a per-case sliver. This also removes two harness artifacts the per-case
  // variant had: (1) eventually-consistent deletes leaking stale passages across cases, and
  // (2) trivially-small indexes where rank-1 carries no signal (a 1-passage index "matches"
  // anything). With ~20 competitors, recall@1 is strictly harder and actually means something.
  const seen = new Set<string>();
  let seeded = 0;
  for (const c of CASES) for (const [name, desc] of c.shelf) {
    if (seen.has(name)) continue; seen.add(name);
    await createPassage(agentId, { text: skillPassageText(name, desc), tags: [SKILL_PASSAGE_TAG, skillPassageTag(name)] });
    seeded++;
  }
  for (const c of canaryPassages()) {
    await createPassage(agentId, { text: c.text, tags: [SKILL_PASSAGE_TAG, skillPassageTag(c.name)] });
  }
  console.log(`seeded union skill index: ${seeded} passages + ${canaryPassages().length} canaries`);
  for (const c of CASES) {
    const t0 = Date.now();
    const hits = await semanticSkillCandidates(client, agentId, c.evidence, 3); // REAL embeddings, full index
    const searchMs = Date.now() - t0;
    latencies.push(searchMs);
    // Diagnostic only (never feeds decisions): the raw pre-calibration window with canary
    // positions marked, to audit where the relevance floor actually sits per case.
    const rawResp: unknown = await searchPassages(agentId, { query: c.evidence.slice(0, 4000), tags: [SKILL_PASSAGE_TAG], tag_match_mode: "all", top_k: 8 });
    const rawWindow = parseSkillHits(rawResp).map((h) => (h.name.startsWith("mm-canary-") ? `[${h.name.replace("mm-canary-", "")}]` : h.name));
    console.log(`      raw window: ${rawWindow.join(" › ")}`);
    // recall@1: only meaningful when the fixture expects an on-shelf rank-1 neighbor
    const expectedTop = c.neighbors[0]?.name && c.shelf.some(([n]) => n === c.neighbors[0].name) ? c.neighbors[0].name : null;
    const liveRank1 = hits[0]?.name ?? null;
    const recallAt1 = expectedTop ? liveRank1 === expectedTop : null;
    // Decision quality through the production head, live hits vs none. Hits naming skills outside
    // this case's shelf exercise the stale-passage path (onShelf=false → ignored), as in production.
    const dir = materialize(c.shelf);
    const onShelf = (n: string) => c.shelf.some(([name]) => name === n);
    const lexical = searchSkills([dir], c.evidence, 3);
    const dl = routeSkill(lexical, [], onShelf);
    const dh = routeSkill(lexical, hits, onShelf);
    receipts.push({
      id: c.id, cls: c.cls, recallAt1, lexRoute: dl.route, hybRoute: dh.route,
      lexIntentOk: intentSatisfied(c, dl.route, dl.target?.name ?? null),
      hybIntentOk: intentSatisfied(c, dh.route, dh.target?.name ?? null),
      searchMs, liveRank1, liveTop: hits.map((h) => h.name),
    });
    const missDetail = liveRank1 && recallAt1 === false ? `  (live top-3: ${hits.map((h) => h.name).join(" › ")})` : "";
    console.log(`  ${c.id.padEnd(26)} recall@1=${recallAt1 === null ? "n/a" : recallAt1} lex=${dl.route.padEnd(13)} hyb=${dh.route.padEnd(13)} ${searchMs}ms${missDetail}`);
  }
} finally {
  try { await deleteAgent(agentId); console.log(`bench agent deleted: ${agentId}`); }
  catch (e) { console.error(`CLEANUP FAILED — delete agent ${agentId} manually:`, e); }
}

const recallCases = receipts.filter((r) => r.recallAt1 !== null);
const recallOk = recallCases.filter((r) => r.recallAt1).length;
const lexOk = receipts.filter((r) => r.lexIntentOk).length;
const hybOk = receipts.filter((r) => r.hybIntentOk).length;
const sorted = [...latencies].sort((a, b) => a - b);
const p50 = sorted[Math.floor(sorted.length / 2)] ?? 0, max = sorted[sorted.length - 1] ?? 0;

console.log(`\nmuscle-memory · E4 LIVE benchmark — ${CASES.length} cases, real embeddings`);
console.log(`  semantic recall@1 : ${recallOk}/${recallCases.length}`);
console.log(`  decision quality  : lexical ${lexOk}/${receipts.length} → hybrid ${hybOk}/${receipts.length}`);
console.log(`  passages.search   : p50 ${p50}ms · max ${max}ms`);

const out = `/tmp/mm-bench-live-${Date.now()}.json`;
writeFileSync(out, JSON.stringify({ agentId, ts: Date.now(), recallAt1: `${recallOk}/${recallCases.length}`, lexIntent: lexOk, hybIntent: hybOk, p50, max, receipts }, null, 2));
console.log(`  receipts          : ${out}`);
if (hybOk < lexOk) { console.error("LIVE BENCH FAILURE: hybrid underperforms lexical with real embeddings"); process.exit(1); }
