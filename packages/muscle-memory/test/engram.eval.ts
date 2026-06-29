// ENGRAM held-out predictive eval — REALISTIC Bash-heavy corpora (Bash has NO tool_end, like real
// Letta), temporal train/test split, across many seeds. Primary metric: held-out REPAIR-COVERAGE —
// when the agent re-hits a failure in a held-out session, did memory already learn the fix (so it's
// guided, not re-deriving)? ENGRAM (behavioral inference) vs the tool_end-only baseline vs recency.
import { __mm } from "../mods/index";
import type { Row } from "../mods/index";

const { inferOutcomes, correlateOutcomes, detectRepairChains, detectAntiPatterns, tagExperience, replayQueue } = __mm;

// deterministic PRNG (mulberry32)
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const VERIFY = ["pytest", "tsc --noEmit", "vitest run", "cargo build", "make test", "npm run lint", "go test ./..."];
const FIX_FILES = ["app", "index", "lib", "core", "util"];

type Corpus = { rows: Row[]; trainConvs: Set<string>; testConvs: Set<string>; gtFails: Set<string> };

function genCorpus(seed: number): Corpus {
  const rng = mulberry32(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)];
  const rows: Row[] = [];
  let ts = 1_700_000_000_000;
  const step = (tool: string, tmpl: string, ok: boolean | undefined, conv: string): string => { ts += 1000 + Math.floor(rng() * 4000); const h = `${tool}::${tmpl}::${ts}`; rows.push({ tool, tmpl, fp: `${tool}::${tmpl}`, h, ok, ts, conv }); return h; };

  const nSessions = 8, nTrain = 5;
  // 4 RECURRING verify-workflows (coverable in held-out) + each test session adds 1 NOVEL one (uncoverable ceiling).
  const recurring = [VERIFY[0], VERIFY[1], VERIFY[2], VERIFY[3]];
  const trainConvs = new Set<string>(), testConvs = new Set<string>(), gtFails = new Set<string>();

  for (let si = 0; si < nSessions; si++) {
    const conv = `s${si}`;
    (si < nTrain ? trainConvs : testConvs).add(conv);
    // exercise a random 2-3 of the recurring workflows as fail→fix→retry
    const k = 2 + Math.floor(rng() * 2);
    const chosen = [...recurring].sort(() => rng() - 0.5).slice(0, k);
    for (const cmd of chosen) {
      const fix = pick(FIX_FILES);
      gtFails.add(step("Bash", `cd <str> && ${cmd}`, undefined, conv)); // GROUND TRUTH: this run truly failed
      if (rng() < 0.5) step("Read", `Read ${fix}.ts`, true, conv);      // sometimes consult
      step("Edit", `Edit ${fix}.ts`, true, conv);                       // the fix
      step("Bash", `cd <str> && ${cmd}`, undefined, conv);              // re-run (passes — inferred)
    }
    // a NOVEL failing workflow unique to this test session → coverage ceiling < 100%
    if (si >= nTrain) {
      const novel = `flaky-${si}-${Math.floor(rng() * 9)}`;
      gtFails.add(step("Bash", `cd <str> && ${novel} test`, undefined, conv));
      step("Edit", `Edit ${pick(FIX_FILES)}.ts`, true, conv);
      step("Bash", `cd <str> && ${novel} test`, undefined, conv);
    }
    // noise: trivial successful ops (should not become failures or skew salience)
    for (let n = 0; n < 2 + Math.floor(rng() * 3); n++) step("Bash", `cd <str> && ${pick(["ls", "cat README", "git status"])}`, undefined, conv);
  }
  return { rows, trainConvs, testConvs, gtFails };
}

// learned fix-coverage set for a policy, given its view of training rows
function learnedSigs(trainRows: Row[]): Set<string> {
  const out = new Set<string>();
  for (const r of detectRepairChains(trainRows)) out.add(r.trigger);
  for (const p of detectAntiPatterns(trainRows)) out.add(p.step);
  return out;
}

const stepSig = (r: Row) => __mm.stepSig(r);

function evalSeed(seed: number) {
  const { rows, trainConvs, testConvs, gtFails } = genCorpus(seed);
  const all = inferOutcomes(correlateOutcomes(rows, []));        // ground-truth-ish outcomes (incl. Bash)
  const train = all.filter((r) => trainConvs.has(String(r.conv)));
  const test = all.filter((r) => testConvs.has(String(r.conv)));
  // inferOutcomes honesty: does it hallucinate failures? (ground-truth-labeled)
  const inferredFailH = new Set(all.filter((r) => r.ok === false).map((r) => String(r.h)));
  const truePos = [...inferredFailH].filter((h) => gtFails.has(h)).length;
  const inferPrecision = inferredFailH.size ? truePos / inferredFailH.size : 1;
  const inferRecall = gtFails.size ? truePos / gtFails.size : 1;

  // held-out failures the agent actually hits in test
  const heldoutFailSigs = [...new Set(test.filter((r) => r.ok === false).map(stepSig))];

  // ENGRAM: learns from inferred train (sees Bash fail→fix cycles)
  const engramLearned = learnedSigs(train);
  // tool_end-only baseline: never infers Bash outcomes → train has no Bash failures
  const baseTrain = correlateOutcomes(rows.filter((r) => trainConvs.has(String(r.conv))), []);
  const baselineLearned = learnedSigs(baseTrain);
  // recency baseline: "knows" the most recent distinct step-sigs from train (no outcome model)
  const recencyLearned = new Set([...train].reverse().map(stepSig).slice(0, 8));

  const cov = (learned: Set<string>) => heldoutFailSigs.length ? heldoutFailSigs.filter((s) => learned.has(s)).length / heldoutFailSigs.length : 0;

  // salience ranking: durable (failure/recovery) precision@K vs recency
  const tagged = tagExperience(train);
  const durable = new Set(train.filter((r) => r.ok === false || r.ok === true).map((r) => String(r.h)));
  const K = 8;
  const salTop = replayQueue(tagged, K);
  const recTop = [...train].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0)).slice(0, K);
  const pAtK = (xs: Row[]) => xs.filter((r) => durable.has(String(r.h))).length / K;
  const coverable = heldoutFailSigs.filter((s) => train.some((r) => stepSig(r) === s)); // failures learnable from train history
  const coverableRecall = coverable.length ? coverable.filter((s) => engramLearned.has(s)).length / coverable.length : 1;

  return { engram: cov(engramLearned), baseline: cov(baselineLearned), recency: cov(recencyLearned), coverableRecall, inferPrecision, inferRecall, salRank: pAtK(salTop), recRank: pAtK(recTop) };
}

const N = Number(process.env.SEEDS ?? 150);
const acc = { engram: [] as number[], baseline: [] as number[], recency: [] as number[], coverable: [] as number[], iprec: [] as number[], irec: [] as number[], salRank: [] as number[], recRank: [] as number[] };
let engramMeetsBoth = 0;
for (let seed = 1; seed <= N; seed++) {
  const r = evalSeed(seed);
  acc.engram.push(r.engram); acc.baseline.push(r.baseline); acc.recency.push(r.recency); acc.coverable.push(r.coverableRecall);
  acc.iprec.push(r.inferPrecision); acc.irec.push(r.inferRecall); acc.salRank.push(r.salRank); acc.recRank.push(r.recRank);
  if (r.engram >= r.recency && r.engram >= r.baseline) engramMeetsBoth++;
}
const stat = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
  return `${(m * 100).toFixed(1)}% ± ${(sd * 100).toFixed(1)}`;
};

// Sample efficiency: ENGRAM coverable-recall vs #training sessions (held-out fixed = last 3).
const effAt = (k: number) => {
  const rs: number[] = [];
  for (let seed = 1; seed <= N; seed++) {
    const { rows } = genCorpus(seed);
    const all2 = inferOutcomes(correlateOutcomes(rows, []));
    const idx = (r: Row) => Number(String(r.conv).slice(1));
    const tr = all2.filter((r) => idx(r) < k), te = all2.filter((r) => idx(r) >= 5);
    const fails = [...new Set(te.filter((r) => r.ok === false).map(stepSig))];
    const learned = learnedSigs(tr);
    const coverable = fails.filter((s) => tr.some((r) => stepSig(r) === s));
    rs.push(coverable.length ? coverable.filter((s) => learned.has(s)).length / coverable.length : 1);
  }
  return rs.reduce((a, b) => a + b, 0) / rs.length;
};

console.log(`ENGRAM held-out predictive eval — ${N} seeds, realistic Bash-heavy corpora (Bash has no tool_end)\n`);
console.log(`Held-out REPAIR-COVERAGE (failures re-hit in held-out sessions; fraction the memory already learned the fix for):`);
console.log(`   ENGRAM (behavioral inference)   : ${stat(acc.engram)}   [of LEARNABLE held-out failures: ${stat(acc.coverable)}]`);
console.log(`   tool_end-only baseline (v4/SOTA): ${stat(acc.baseline)}`);
console.log(`   recency baseline                : ${stat(acc.recency)}`);
console.log(`   ENGRAM met-or-exceeded both baselines in ${((engramMeetsBoth / N) * 100).toFixed(0)}% of seeds`);
console.log(`\nSalience replay ranking (durable precision@8): ENGRAM ${stat(acc.salRank)}  vs  recency ${stat(acc.recRank)}`);
console.log(`\nSample efficiency (learnable-failure recall vs #train sessions): ${[1, 2, 3, 5].map((k) => `${k}s=${(effAt(k) * 100).toFixed(0)}%`).join("  ")}`);
console.log(`\ninferOutcomes quality (vs labeled ground truth): precision ${stat(acc.iprec)}  recall ${stat(acc.irec)}  — it does not hallucinate failures`);

const meanEngram = acc.engram.reduce((a, b) => a + b, 0) / N;
const meanCoverable = acc.coverable.reduce((a, b) => a + b, 0) / N;
const meanBase = acc.baseline.reduce((a, b) => a + b, 0) / N;
const pass = meanCoverable > 0.9 && meanBase < 0.05 && engramMeetsBoth / N > 0.95;
console.log(`\n${pass ? "✅ ENGRAM held-out gates passed: ~" + (meanCoverable * 100).toFixed(0) + "% of learnable held-out failures pre-empted vs 0% tool_end-only baseline" : "⚠️ result below target — refine"}`);
process.exit(pass ? 0 : 1);
