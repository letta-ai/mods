// muscle-memory · E4 ROUTING EVAL — lexical-only vs hybrid (semantic recall + lexical precision).
//
// Measures the SHIPPED decision path (searchSkills → routeSkill — the same head reviewAndAuthor
// consumes) on the shared labeled case set (test/routing-cases.ts).
//
// HONESTY NOTE: in this OFFLINE eval the semantic neighbors are hand-labeled fixtures that stand
// in for client.agents.passages.search results (rank order, no scores — same contract). The
// decision mechanics are fully real; the embedding QUALITY is validated separately by the live
// benchmark (scripts/bench-semantic-live.ts) against a real Letta agent.
//
// Run: bun test/routing.eval.ts   (also wired into `npm run verify`; exits 1 on regression)
import { routeSkill, searchSkills } from "../mods/autopilot";
import type { SkillRoute } from "../mods/autopilot";
import { CASES, intentSatisfied, materialize } from "./routing-cases";
import type { RoutingCase } from "./routing-cases";

type LaneResult = { correct: number; total: number; byClass: Record<string, { correct: number; total: number }>; failures: string[] };
const lane = (): LaneResult => ({ correct: 0, total: 0, byClass: {}, failures: [] });

function score(r: LaneResult, c: RoutingCase, got: SkillRoute, gotTarget: string | null, want: SkillRoute) {
  const cls = (r.byClass[c.cls] ??= { correct: 0, total: 0 });
  r.total++; cls.total++;
  const targetOk = want !== "update" || gotTarget === c.target;
  if (got === want && targetOk) { r.correct++; cls.correct++; }
  else r.failures.push(`${c.id}: expected ${want}${c.target ? `→${c.target}` : ""}, got ${got}${gotTarget ? `→${gotTarget}` : ""}`);
}

// Per-lane ground truth: the LEXICAL lane's "expected" column encodes today's shipped behavior
// (it is expected to miss classes B and C), so lexical accuracy is 100% BY CONSTRUCTION unless a
// regression changes routing. The interesting number is DECISION QUALITY vs class intent below.
const lex = lane(), hyb = lane();
let lexGood = 0, hybGood = 0;
for (const c of CASES) {
  const dir = materialize(c.shelf);
  const onShelf = (n: string) => c.shelf.some(([name]) => name === n);
  const lexical = searchSkills([dir], c.evidence, 3);
  const dl = routeSkill(lexical, [], onShelf);
  const dh = routeSkill(lexical, c.neighbors, onShelf);
  score(lex, c, dl.route, dl.target?.name ?? null, c.expected.lexical);
  score(hyb, c, dh.route, dh.target?.name ?? null, c.expected.hybrid);
  if (intentSatisfied(c, dl.route, dl.target?.name ?? null)) lexGood++;
  if (intentSatisfied(c, dh.route, dh.target?.name ?? null)) hybGood++;
}

const pct = (n: number, d: number) => ((100 * n) / d).toFixed(1);
console.log(`\nmuscle-memory · E4 routing eval — ${CASES.length} labeled cases (production routeSkill path)\n`);
console.log(`  lexical-only : ${lex.correct}/${lex.total}  (${pct(lex.correct, lex.total)}%)`);
console.log(`  hybrid       : ${hyb.correct}/${hyb.total}  (${pct(hyb.correct, hyb.total)}%)\n`);
for (const cls of Object.keys(hyb.byClass)) {
  const l = lex.byClass[cls], h = hyb.byClass[cls];
  console.log(`  ${cls.padEnd(18)} lexical ${l.correct}/${l.total}   hybrid ${h.correct}/${h.total}`);
}
if (lex.failures.length) console.log(`\n  lexical misses:\n    ${lex.failures.join("\n    ")}`);
if (hyb.failures.length) console.log(`\n  hybrid misses:\n    ${hyb.failures.join("\n    ")}`);
console.log(`\n  DECISION QUALITY vs class intent (the headline number):`);
console.log(`  lexical-only : ${lexGood}/${CASES.length}  (${pct(lexGood, CASES.length)}%)`);
console.log(`  hybrid       : ${hybGood}/${CASES.length}  (${pct(hybGood, CASES.length)}%)\n`);
if (hybGood <= lexGood) { console.error("EVAL FAILURE: hybrid does not beat lexical"); process.exit(1); }
if (hyb.correct !== hyb.total || lex.correct !== lex.total) { console.error("EVAL FAILURE: a lane missed its per-lane ground truth (routing regression)"); process.exit(1); }
