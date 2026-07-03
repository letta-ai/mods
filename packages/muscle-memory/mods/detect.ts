// muscle-memory · detect module (split from index.ts — behavior-preserving).
import { join, dirname } from "node:path";
import { ABS_PATH, Candidate, HEXID, LONG_OPAQUE, MM, NUM, Outcome, QUOTED, Row, SECRETISH, SECRET_ASSIGN, SECRET_FLAG, SECRET_HEADER, SECRET_QUERY, slug } from "./core";


export function commandTemplate(cmd: string): string {
  let t = String(cmd).trim();
  // Scrub the credential token that FOLLOWS a bearer/token keyword (e.g. "Bearer sk-...").
  // Runs FIRST: header/flag rules only consume the first word after the colon, which would
  // otherwise orphan the actual secret token. Catch "Bearer <token>" before anything eats "Bearer".
  t = t.replace(/\b(?:bearer|token|apikey|api[_-]?key)\s+[^\s;&"']+/gi, "<cred> <redacted>");
  // v4 allow-list-leaning scrubs the deny-list misses (audit S1): URL userinfo, basic-auth user:pass,
  // attached/spaced password+token flags, secret-named identifiers followed by a bare value
  // (aws_secret_access_key AKIA…), and known opaque key prefixes regardless of length.
  t = t.replace(/([a-z][a-z0-9+.\-]*:\/\/)[^/\s:@]+(?::[^/\s@]+)?@/gi, "$1<cred>@");
  t = t.replace(/\b((?:aws[_-]?)?(?:secret|password|passwd|token|api[_-]?key|access[_-]?key(?:[_-]?id)?|auth)[a-z0-9_]*)\s+(["']?)[^\s"';|&]{3,}\2/gi, "$1 <redacted>");
  t = t.replace(/(^|\s)(--?user|-u)[=\s]+("?)[^\s"':;|&]+:[^\s"';|&]+\3/gi, "$1$2 <redacted>");
  t = t.replace(/(^|\s)(--?(?:password|passwd|token|access[-_]?token|api[-_]?key))[=\s]+\S+/gi, "$1$2 <redacted>");
  t = t.replace(/(^|\s)-p(?=\S)\S+/g, "$1-p <redacted>");
  t = t.replace(/\b(?:AKIA|ASIA|AIza|ghp_|gho_|ghu_|ghs_|github_pat_|glpat-|xox[baprs]-|sk-[A-Za-z0-9]*-?|eyJ)[A-Za-z0-9_\-.]{6,}/g, "<id>");
  // Scrub key=value / query / flag / header secret forms before generic cleanup so
  // short unquoted credential values do not leave partial fragments behind.
  t = t.replace(SECRET_ASSIGN, "<cred>=<redacted>");
  t = t.replace(SECRET_QUERY, "$1<cred>=<redacted>");
  t = t.replace(SECRET_FLAG, "--<cred>=<redacted>");
  t = t.replace(SECRET_HEADER, "<cred>:<redacted>");
  t = t.replace(QUOTED, "<str>");
  // Scrub secret-adjacent labels too, not only values. Even harmless phrases like
  // "bearer authenticate" should not survive into persistent fingerprints.
  t = t.replace(/\b(?:bearer|authorization|api[_-]?key|api\s+key|token|secret|password|passwd|cookie)\b/gi, "<cred>");
  t = t.replace(ABS_PATH, "<path>");
  t = t.replace(HEXID, "<id>");
  t = t.replace(LONG_OPAQUE, "<id>");
  t = t.replace(NUM, "<n>");
  t = t.replace(/\s+/g, " ").trim();
  return t.slice(0, 240);
}


/** High-signal tools get their reps tracked as first-class evidence signals. This is
 * deployment-specific vocabulary, so it is CONFIGURED, never hardcoded: set
 * MM_HIGH_SIGNAL_TOOLS to a comma-separated list of your own gate/receipt tool names
 * (e.g. "design_review_gate,release_readiness_check"). Empty by default. */
export const HIGH_SIGNAL_TOOL_SET = new Set<string>((process.env.MM_HIGH_SIGNAL_TOOLS || "").split(",").map((s) => s.trim()).filter(Boolean));


export function fingerprint(tool: string, args: Record<string, unknown>): { fp: string; tmpl: string | null } {
  let tmpl: string | null = null;
  const keys = Object.keys(args || {}).sort();
  if (tool === "Bash" && typeof args?.command === "string") {
    tmpl = commandTemplate(args.command);
  } else if (tool === "exec_command" && typeof args?.cmd === "string") {
    // Codex/default toolsets expose shell as exec_command(cmd) rather than Bash(command).
    // Normalize it into the same command-template lane so cloud and local reps both mature.
    tmpl = commandTemplate(args.cmd);
  } else if ((tool === "Read" || tool === "Edit" || tool === "Write" || tool === "fast_apply") && typeof args?.file_path === "string") {
    const ext = (String(args.file_path).match(/\.[A-Za-z0-9]+$/)?.[0]) || "";
    tmpl = `${tool} <path>${ext}`;
  } else if (tool === "Grep" || tool === "Glob" || tool === "structural_search") {
    tmpl = `${tool} ${keys.join(",")}`;
  } else if (tool === "Skill" && typeof args?.skill === "string") {
    tmpl = `Skill ${slug(String(args.skill))}`;
  } else if (HIGH_SIGNAL_TOOL_SET.has(tool)) {
    // Configured high-signal tools (MM_HIGH_SIGNAL_TOOLS) get a stable arg-shape template.
    tmpl = `${tool} ${keys.join(",")}`;
  }
  const shape = keys.filter((k) => !SECRETISH.test(k)).join(",");
  const fp = `${tool}(${shape})${tmpl ? " :: " + tmpl : ""}`;
  return { fp, tmpl };
}


export function maturityScore(count: number, convs: number, fixes: number): number {
  return MM.W_FREQ * Math.log2(count) + MM.W_SPREAD * (convs - 1) + MM.W_FIX * (fixes > 0 ? 1 : 0);
}


export function isMature(count: number, convs: number, m: number): boolean {
  const enoughSpread = convs >= MM.MIN_CONVS || count >= MM.STRONG_SINGLE;
  return count >= MM.MIN_COUNT && enoughSpread && m >= MM.MATURE_AT;
}


// Trivial verbs carry no procedural meaning on their own — a sequence made only of
// these is noise, not a skill.
export const TRIVIAL = new Set(["echo", "cd", "ls", "cat", "true", "pwd", "sleep", ":"]);

// Multi-subcommand tools where the 2nd token is the meaningful verb (git commit vs git add).
export const SUBCMD = new Set(["git", "letta", "npm", "npx", "gh", "docker", "cargo", "bun", "pnpm", "yarn", "kubectl", "jq"]);


/** Extract the salient "what does this step DO" signature from a row. */
export function stepSig(row: Row): string {
  if (row.tool !== "Bash") {
    // file ops / other tools: tool + ext if present (Edit .md, Read .ts)
    const m = (row.tmpl || "").match(/\.[A-Za-z0-9]+$/);
    return m ? `${row.tool}${m[0]}` : row.tool;
  }
  const t = (row.tmpl || "").replace(/\bcd <[^>]+>\s*&&\s*/g, " ").replace(/\becho <str>\s*&&?\s*/g, " ");
  // first meaningful command across &&, |, ; segments
  for (const seg of t.split(/&&|\|\||\||;/)) {
    const toks = seg.trim().split(/\s+/).filter(Boolean);
    if (!toks.length) continue;
    let v = toks[0].replace(/^.*\//, ""); // strip path prefix
    if (TRIVIAL.has(v)) continue;
    if (SUBCMD.has(v) && toks[1] && /^[a-z]/i.test(toks[1])) v = `${v} ${toks[1]}`;
    return v.slice(0, 24);
  }
  return "Bash";
}


/** Mine recurring command/file templates. */
export function detectTemplates(rows: Row[]): Candidate[] {
  const byKey = new Map<string, { count: number; convs: Set<string>; fixes: number; lastFail: boolean }>();
  // track per-conversation fail->success recovery on the same template
  const failPending = new Map<string, boolean>(); // key=conv|tmpl
  for (const r of rows) {
    if (!r.tmpl) continue;
    const k = r.tmpl;
    let e = byKey.get(k);
    if (!e) { e = { count: 0, convs: new Set(), fixes: 0, lastFail: false }; byKey.set(k, e); }
    e.count++;
    e.convs.add(String(r.conv ?? "?"));
    const fk = `${r.conv}|${k}`;
    if (r.ok === false) failPending.set(fk, true);
    else if (r.ok === true && failPending.get(fk)) { e.fixes++; failPending.set(fk, false); }
  }
  return finalize("template", byKey);
}


/** Mine recurring n-gram tool sequences within a conversation. */
export function detectSequences(rows: Row[], n = MM.NGRAM): Candidate[] {
  const byConv = new Map<string, Row[]>();
  for (const r of rows) {
    const c = String(r.conv ?? "?");
    if (!byConv.has(c)) byConv.set(c, []);
    byConv.get(c)!.push(r);
  }
  const byKey = new Map<string, { count: number; convs: Set<string>; fixes: number }>();
  for (const [conv, rs] of byConv) {
    rs.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
    for (let i = 0; i + n <= rs.length; i++) {
      const win = rs.slice(i, i + n);
      const sigs = win.map(stepSig);
      // Meaningfulness guard: a window with <2 distinct steps, or all-Bash-generic, is noise.
      const distinct = new Set(sigs);
      if (distinct.size < 2) continue;
      if (sigs.every((s) => s === "Bash")) continue;
      const gram = sigs.join(" → ");
      let e = byKey.get(gram);
      if (!e) { e = { count: 0, convs: new Set(), fixes: 0 }; byKey.set(gram, e); }
      e.count++;
      e.convs.add(conv);
      if (win.some((x) => x.ok === false)) e.fixes++;
    }
  }
  return finalize("sequence", byKey as any);
}


export function finalize(kind: "template" | "sequence", byKey: Map<string, { count: number; convs: Set<string>; fixes: number }>): Candidate[] {
  const out: Candidate[] = [];
  for (const [key, e] of byKey) {
    const convs = e.convs.size;
    const m = maturityScore(e.count, convs, e.fixes);
    const mature = isMature(e.count, convs, m);
    out.push({ kind, key, count: e.count, convs, fixes: e.fixes, maturity: +m.toFixed(2), mature });
  }
  return out.sort((a, b) => b.maturity - a.maturity);
}


// A single tool-call primitive (read a file, write a file, grep) is never a "skill".
// Skills are multi-step workflows or distinctive command pipelines.
export const PRIMITIVE = /^(Read|Write|Edit|Glob|Grep|fast_apply|structural_search)\b/;

// Shell noise: commands that are the universal texture of every session, never a skill on their own.
export const TRIVIAL_CMD = new Set(["echo", "cd", "ls", "cat", "true", "false", "pwd", "sleep", ":", "mkdir", "rmdir", "touch", "which", "whoami", "find", "head", "tail", "wc", "chmod", "chown", "cp", "mv", "rm", "export", "unset", "source", "clear", "env", "printenv", "date", "tree", "cut", "tr", "sort", "uniq", "basename", "dirname", "realpath", "test"]);

// Bare interpreter/runtime invocation ("run it") — the universal step; only a skill with a real fix or distinctive verb.
export const BARE_RUN = /^(python3?|node|deno|bun|ruby|go|php|perl|java|dotnet|sh|bash|zsh)$|^\.\//i;

/** First meaningful command verb of a bash template key (mirrors stepSig, for the gate). */
export function templateVerb(key: string): string {
  for (const seg of key.split(/&&|\|\||\||;/)) {
    const toks = seg.trim().split(/\s+/).filter(Boolean);
    if (!toks.length) continue;
    let v = toks[0].replace(/^.*\//, "");
    if (TRIVIAL.has(v)) continue;
    if (SUBCMD.has(v) && toks[1] && /^[a-z]/i.test(toks[1])) v = `${v} ${toks[1]}`;
    return v;
  }
  return (key.split(/\s+/)[0] || key).replace(/^.*\//, "");
}

/** A step that carries a real procedural lesson: a domain command (git commit, docker build, make,
 * cargo test, npm run…) — NOT a file primitive, a bare interpreter run, or shell noise. */
export function isDistinctiveStep(sig: string): boolean {
  if (PRIMITIVE.test(sig)) return false;
  if (BARE_RUN.test(sig)) return false;
  const v = sig.split(/\s+/)[0].replace(/^.*\//, "");
  if (TRIVIAL_CMD.has(v)) return false;
  return /[a-z]/i.test(sig);
}

export function isSkillWorthy(c: Candidate): boolean {
  if (!c.mature) return false;
  if (c.kind === "template") {
    if (PRIMITIVE.test(c.key)) return false;                // primitive file-op, not a skill
    if (TRIVIAL_CMD.has(templateVerb(c.key))) return false; // shell noise (ls/cat/echo/mkdir…) — never a skill
    return true;
  }
  // sequence: a fix-free chain of only primitives/bare-runs/noise is the universal edit→run loop, not a skill.
  if (c.kind === "sequence" && c.fixes === 0 && !c.key.split(/→/).some((s) => isDistinctiveStep(s.trim()))) return false;
  return true;
}


/** A real recovery IS a high-value skill. In realistic varied work the same literal command rarely
 * recurs, but the same repair SHAPE does — so mature repairs (incl. generalized cross-command classes)
 * become first-class distill candidates, not just enrichment for a separately-maturing sequence. */
export function repairCandidates(rows: Row[]): Candidate[] {
  const out: Candidate[] = [];
  for (const r of detectRepairChains(rows)) {
    // a real recovery is high-signal: mature at ≥2 reps/≥2 sessions, OR a generalized cross-command class, OR ≥3 reps.
    const mature = (r.convs >= MM.MIN_CONVS && r.count >= 2) || (!!r.generalized && r.count >= 2) || r.count >= MM.MIN_COUNT;
    if (!mature) continue;
    out.push({ kind: "sequence", key: r.verifyStep, count: r.count, convs: r.convs, fixes: r.count, maturity: +maturityScore(r.count, r.convs, r.count).toFixed(2), mature: true });
  }
  return out;
}


export function detect(rows: Row[]): { templates: Candidate[]; sequences: Candidate[]; candidates: Candidate[] } {
  const templates = detectTemplates(rows);
  const sequences = detectSequences(rows);
  const repairs = repairCandidates(rows); // mature recoveries are first-class, highest-value candidates
  const repairKeys = new Set(repairs.map((r) => r.key));
  const rest = [...templates, ...sequences].filter((c) => !repairKeys.has(c.key)); // dedupe vs a literal sequence
  const candidates = [...repairs, ...rest].filter(isSkillWorthy).sort((a, b) => b.maturity - a.maturity);
  return { templates, sequences, candidates };
}


// — A. OUTCOME CAPTURE (tool_end) —
/** Classify + REDACT a tool failure into a short stable error class (never secrets/payloads). */
export function classifyError(resultText: unknown, ok?: boolean): string | null {
  if (ok !== false) return null;
  const raw = String(resultText ?? "");
  // Payload-free (audit S2): map to a stable known error-class token; NEVER echo arbitrary output.
  const known = raw.match(/\b(?:ENOENT|EACCES|EPERM|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|command not found|no such file|not found|permission denied|denied|refused|unauthorized|forbidden|invalid|conflict|timed out|timeout|rate.?limit|exit code \d+|assertion|syntax error|type ?error|module not found|cannot find)\b/i);
  return known ? known[0].toLowerCase().replace(/\s+/g, "-").slice(0, 40) : "error";
}

/** Merge tool_end outcomes onto tool_start rows by call id. Pure + testable. */
export function mergeOutcomes(rows: Row[], ends: Array<{ id?: string; ok?: boolean; err?: string | null }>): Row[] {
  const byId = new Map<string, { ok?: boolean; err?: string | null }>();
  for (const e of ends) if (e.id) byId.set(e.id, { ok: e.ok, err: e.err ?? null });
  return rows.map((r) => (r.id && byId.has(r.id) ? { ...r, ...byId.get(r.id) } : r));
}

/** v2.1: correlate tool_end outcomes onto tool_start rows. Exact id when present; else
 * (conv + tool + nearest unmatched start within window); else FIFO oldest unmatched in conv;
 * else drop. Handles local backends that omit toolCallId on tool_start. Pure + testable. */
export function correlateOutcomes(starts: Row[], ends: Outcome[], opts: { windowMs?: number } = {}): Row[] {
  const windowMs = opts.windowMs ?? 5 * 60 * 1000;
  const rows = starts.map((r) => ({ ...r }));
  const used = new Set<number>();
  const byId = new Map<string, number>();
  rows.forEach((r, i) => { if (r.id != null && !byId.has(String(r.id))) byId.set(String(r.id), i); });
  const pending: Outcome[] = [];
  for (const e of ends) {
    const eid = e.id != null ? String(e.id) : null;
    if (eid && byId.has(eid) && !used.has(byId.get(eid)!)) { const i = byId.get(eid)!; rows[i].ok = e.ok; rows[i].err = e.err ?? null; rows[i].errMsg = e.errMsg ?? rows[i].errMsg ?? null; used.add(i); }
    else pending.push(e);
  }
  for (const e of [...pending].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))) {
    const cands = rows.map((r, i) => ({ r, i })).filter(({ r, i }) => !used.has(i) && r.ok === undefined && String(r.conv) === String(e.conv) && (e.ts ?? 0) - (r.ts ?? 0) >= 0 && (e.ts ?? 0) - (r.ts ?? 0) <= windowMs);
    if (!cands.length) continue;
    let pick;
    if (e.tool != null) {
      const same = cands.filter((c) => c.r.tool === e.tool);
      const pool = same.length ? same : cands;
      pick = pool.reduce((a, b) => ((e.ts ?? 0) - (a.r.ts ?? 0)) <= ((e.ts ?? 0) - (b.r.ts ?? 0)) ? a : b); // nearest preceding
    } else {
      pick = cands.reduce((a, b) => (a.r.ts ?? 0) <= (b.r.ts ?? 0) ? a : b); // FIFO oldest unmatched
    }
    rows[pick.i].ok = e.ok; rows[pick.i].err = e.err ?? null; rows[pick.i].errMsg = e.errMsg ?? rows[pick.i].errMsg ?? null; used.add(pick.i);
  }
  return rows;
}

// — A1.5: BEHAVIORAL OUTCOME INFERENCE — the real-agent unlock. Letta Code (0.27.18) emits NO
// tool_end for Bash/Task (313 real Bash starts → 0 outcomes), so shell failures — where real coding
// fails — are invisible to the whole failure-learning loop. The brain infers outcomes from action
// SEQUENCES when explicit feedback is absent; so do we: a verify-command re-run after an intervening
// fix-edit is a fail→fix→retry. Fills ONLY ok===undefined rows; never overrides a real tool_end. Pure.
export const VERIFY_RE = /\b(tests?|build|lint|tsc|type-?check|vitest|jest|pytest|mocha|check|compile|make|cargo|gradle|mvn|deploy|e2e|playwright|eslint|ruff|mypy|pyright|gate|qa|smoke|run|python3?|node|deno|ruby|go)\b|\.\/|\.(?:py|js|ts|tsx|sh|rb|go)\b/i;

export const FIX_TOOL_RE = /^(Edit|Write|fast_apply)/;

export function inferOutcomes(rows: Row[], opts: { windowMs?: number } = {}): Row[] {
  const windowMs = opts.windowMs ?? 10 * 60 * 1000;
  const out = rows.map((r) => ({ ...r }));
  const byConv = new Map<string, number[]>();
  out.forEach((r, i) => { const c = String(r.conv ?? "?"); (byConv.get(c) ?? byConv.set(c, []).get(c)!).push(i); });
  for (const [, idxs] of byConv) {
    idxs.sort((a, b) => (out[a].ts ?? 0) - (out[b].ts ?? 0));
    const occ = new Map<string, number[]>();
    for (const i of idxs) {
      const r = out[i];
      if (r.ok !== undefined || (r.tool !== "Bash" && r.tool !== "exec_command")) continue;
      if (!VERIFY_RE.test(String(r.tmpl ?? r.fp ?? ""))) continue;
      (occ.get(stepSig(r)) ?? occ.set(stepSig(r), []).get(stepSig(r))!).push(i);
    }
    for (const [, list] of occ) {
      for (let p = 0; p < list.length - 1; p++) {
        const a = list[p], b = list[p + 1];
        if ((out[b].ts ?? 0) - (out[a].ts ?? 0) > windowMs) continue;
        const fixBetween = idxs.some((j) => (out[j].ts ?? 0) > (out[a].ts ?? 0) && (out[j].ts ?? 0) < (out[b].ts ?? 0) && FIX_TOOL_RE.test(out[j].tool));
        const at = String(out[a].tmpl ?? ""), bt = String(out[b].tmpl ?? "");
        const invocationRefined = at !== "" && bt !== "" && bt !== at && bt.includes(at); // re-ran SAME base + added flag/env → invocation/env gotcha (no edit)
        if (!fixBetween && !invocationRefined) continue;
        if (out[a].ok === undefined) { out[a].ok = false; out[a].err = out[a].err ?? "inferred-failure"; }
        if (out[b].ok === undefined) out[b].ok = true;
      }
    }
  }
  return out;
}


// — A1.6: INVOCATION / ENV GOTCHAS — the class repair-chains miss (LongMemEval-V2 "environment
// gotchas"). The SAME base command fails, then succeeds re-run with an added flag/env prefix; the
// fix is the changed INVOCATION, not a code edit. Lesson: invoke it WITH the delta. Pure + testable.
export type InvocationGotcha = { trigger: string; delta: string; count: number; convs: number };

export function detectInvocationGotchas(rows: Row[]): InvocationGotcha[] {
  const byConv = new Map<string, Row[]>();
  for (const r of rows) { const c = String(r.conv ?? "?"); (byConv.get(c) ?? byConv.set(c, []).get(c)!).push(r); }
  const acc = new Map<string, { count: number; convs: Set<string> }>();
  for (const [conv, rs] of byConv) {
    rs.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
    for (let i = 0; i < rs.length; i++) {
      if ((rs[i].tool !== "Bash" && rs[i].tool !== "exec_command") || !VERIFY_RE.test(String(rs[i].tmpl ?? rs[i].fp ?? ""))) continue; // a verify-ish shell command
      const at = String(rs[i].tmpl ?? ""); if (!at) continue;
      for (let j = i + 1; j < Math.min(rs.length, i + 6); j++) {
        const bt = String(rs[j].tmpl ?? "");
        if ((rs[j].tool === "Bash" || rs[j].tool === "exec_command") && bt && bt !== at && bt.includes(at)) { // re-ran the SAME base + a flag/env delta → gotcha
          const delta = bt.replace(at, "").trim();
          if (!/^(--?[a-z]|[A-Z][A-Z0-9_]*=)/.test(delta)) break; // the delta must be a flag/env (the gotcha class) — not appended script
          const key = `${stepSig(rs[i])}|${delta}`;
          const e = acc.get(key) ?? { count: 0, convs: new Set<string>() };
          e.count++; e.convs.add(conv); acc.set(key, e);
          break;
        }
      }
    }
  }
  return [...acc.entries()].map(([k, e]) => { const [trigger, delta] = k.split("|"); return { trigger, delta, count: e.count, convs: e.convs.size }; }).sort((a, b) => b.count - a.count);
}


// — A2. REPAIR CHAINS: FAIL(x) → EDIT/PATCH → PASS(x') within a conversation —
export type RepairChain = { trigger: string; errClass: string; fixStep: string; verifyStep: string; count: number; convs: number; generalized?: boolean; examples?: string[]; worked?: Array<{ cmd: string; errMsg?: string; fix?: string }> };

export const FIX_VERBS = /^(Edit|Write|fast_apply|git commit|git add|patch|sed|npm|npx|bun|cargo)/i;

// Generalize a repair trigger to a CLASS so the same recovery SHAPE learned from DIFFERENT commands or
// languages compounds into ONE mature, general skill (the brain generalizing from instances) instead of
// fragmenting into per-command pieces that never mature on realistic varied work. A distinctive command
// returns null → keeps its literal identity (a recurring pytest-specific repair stays "pytest").
export function triggerClass(sig: string): { key: string; label: string } | null {
  const v = sig.split(/\s+/)[0].replace(/^.*\//, "").toLowerCase();
  if (/^(python3?|node|deno|bun|ruby|go|php|perl|java|dotnet)$/.test(v) || /\.(py|js|ts|tsx|rb|go|sh)$/.test(sig)) return { key: "script-run", label: "failing-script-runs" };
  if (/^(pytest|jest|vitest|mocha|cargo|gradle|mvn|make|gotest|rspec|phpunit)$/.test(v)) return { key: "test-build", label: "failing-tests-or-builds" };
  if (/^(tsc|mypy|pyright|eslint|ruff|prettier|biome|flake8)$/.test(v) || /type-?check/.test(v)) return { key: "typecheck-lint", label: "type-check-or-lint-failures" };
  return null;
}

export function fixClass(sig: string): string { return /^(Edit|Write|fast_apply)/.test(sig) ? "edit the source" : sig; }

export function detectRepairChains(rows: Row[]): RepairChain[] {
  const byConv = new Map<string, Row[]>();
  for (const r of rows) { const c = String(r.conv ?? "?"); (byConv.get(c) ?? byConv.set(c, []).get(c)!).push(r); }
  type Worked = { cmd: string; errMsg?: string; fix?: string };
  const acc = new Map<string, { errClass: string; count: number; convs: Set<string>; worked: Worked[] }>();
  for (const [conv, rs] of byConv) {
    rs.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
    for (let i = 0; i < rs.length; i++) {
      if (rs[i].ok !== false) continue;            // a failure
      const trigger = stepSig(rs[i]); const errClass = rs[i].err || classifyError("", false) || "error";
      // look ahead up to 6 steps for a fix verb then a later success of the same trigger
      let fixStep = ""; let fixRow: Row | undefined;
      for (let j = i + 1; j < Math.min(rs.length, i + 7); j++) {
        const sig = stepSig(rs[j]);
        if (!fixStep && FIX_VERBS.test(sig)) { fixStep = sig; fixRow = rs[j]; }
        if (fixStep && rs[j].ok === true && stepSig(rs[j]) === trigger) {
          const key = `${trigger}|${fixStep}`;
          const e = acc.get(key) ?? { errClass, count: 0, convs: new Set<string>(), worked: [] };
          e.count++; e.convs.add(conv);
          // OPT-IN worked example (MM_CAPTURE): the real (redacted) error symptom + the real fix.
          const errMsg = rs[i].errMsg || undefined; const fix = fixRow?.fix || undefined;
          if (errMsg || fix) e.worked.push({ cmd: trigger, errMsg, fix });
          acc.set(key, e);
          break;
        }
      }
    }
  }
  // Distinct symptom/fix pairs ARE the cross-session breadth — dedupe so identical loops don't repeat,
  // but DIVERSE failures of the same class are preserved (the lever fingerprint-collapse used to erase).
  const dedupeWorked = (ws: Worked[]): Worked[] => {
    const seen = new Set<string>(); const out: Worked[] = [];
    for (const w of ws) { const k = `${w.errMsg ?? ""}|${w.fix ?? ""}`; if (seen.has(k)) continue; seen.add(k); out.push(w); }
    return out.slice(0, 12); // keep ALL distinct worked-examples (was 5 — that cap silently dropped diverse failure classes, the exact depth concrete examples improve). Distinct cases preserve useful specificity; 12 bounds pathological cases.
  };
  type Lit = { trigger: string; errClass: string; fixStep: string; count: number; convs: Set<string>; worked: Worked[] };
  const literal: Lit[] = [...acc.entries()].map(([k, e]) => { const [trigger, fixStep] = k.split("|"); return { trigger, errClass: e.errClass, fixStep, count: e.count, convs: e.convs, worked: e.worked }; });
  // CLASS GENERALIZATION: group same-shape recoveries (by trigger-class + fix-class). When ≥2 DISTINCT
  // commands share the shape, emit ONE generalized repair (the cross-language lesson) and absorb the
  // literals; otherwise keep the literal repair (preserving a specific recurring command's identity).
  const groups = new Map<string, { label: string; lits: Lit[] }>();
  for (const l of literal) {
    const tc = triggerClass(l.trigger); if (!tc) continue;
    const gk = `${tc.key}|${fixClass(l.fixStep)}`;
    const g = groups.get(gk) ?? { label: tc.label, lits: [] }; g.lits.push(l); groups.set(gk, g);
  }
  const absorbed = new Set<string>(); const out: RepairChain[] = [];
  for (const g of groups.values()) {
    const distinct = new Set(g.lits.map((l) => l.trigger));
    if (distinct.size < 2) continue; // generalize only when the shape recurred across ≥2 distinct commands
    const convs = new Set<string>(); let count = 0; let errClass = ""; const worked: Worked[] = [];
    for (const l of g.lits) { l.convs.forEach((c) => convs.add(c)); count += l.count; errClass ||= l.errClass; worked.push(...l.worked); absorbed.add(`${l.trigger}|${l.fixStep}`); }
    const rep = g.lits.slice().sort((a, b) => b.count - a.count)[0]; // representative literal (re-runnable example)
    const dw = dedupeWorked(worked);
    out.push({ trigger: g.label, errClass, fixStep: fixClass(rep.fixStep), verifyStep: rep.trigger, count, convs: convs.size, generalized: true, examples: [...distinct], ...(dw.length ? { worked: dw } : {}) });
  }
  for (const l of literal) { if (absorbed.has(`${l.trigger}|${l.fixStep}`)) continue; const dw = dedupeWorked(l.worked); out.push({ trigger: l.trigger, errClass: l.errClass, fixStep: l.fixStep, verifyStep: l.trigger, count: l.count, convs: l.convs.size, ...(dw.length ? { worked: dw } : {}) }); }
  return out.sort((a, b) => b.count - a.count);
}

// — A3. ANTI-PATTERNS: recurring FAILs that never recover → "don't do X" tombstones —
export type AntiPattern = { step: string; errClass: string; fails: number; recovered: number; convs: number };

export function detectAntiPatterns(rows: Row[]): AntiPattern[] {
  const repairs = new Set(detectRepairChains(rows).map((r) => r.trigger));
  const acc = new Map<string, { errClass: string; fails: number; convs: Set<string> }>();
  for (const r of rows) {
    if (r.ok !== false) continue;
    const step = stepSig(r); const e = acc.get(step) ?? { errClass: r.err || "error", fails: 0, convs: new Set<string>() };
    e.fails++; e.convs.add(String(r.conv ?? "?")); if (r.err) e.errClass = r.err; acc.set(step, e);
  }
  return [...acc.entries()].filter(([step, e]) => e.fails >= 2 && !repairs.has(step))
    .map(([step, e]) => ({ step, errClass: e.errClass, fails: e.fails, recovered: 0, convs: e.convs.size }))
    .sort((a, b) => b.fails - a.fails);
}


// — B. IMPACT SCORE: outcome-aware, not just repetition —
export type Impact = { score: number; repetition: number; spread: number; fixes: number; recency: number; safety: number; bloat: number };

export const DESTRUCTIVE = /\b(rm|rmdir|drop|delete|truncate|reset --hard|force|push --force|mkfs|dd)\b/i;

export function impactScore(c: Candidate, opts: { nowConvIdx?: number; convIdx?: number; bloatOverlap?: number } = {}): Impact {
  const repetition = Math.log2(Math.max(1, c.count));
  const spread = c.convs - 1;
  const fixes = c.fixes;
  const recency = 1; // hook: decays with age when ts wired; neutral here
  const safety = DESTRUCTIVE.test(c.key) ? -2 : 0;            // destructive workflows are risky to bottle
  const bloat = -(opts.bloatOverlap ?? 0) * 2;               // penalize near-dupes
  const score = +(1.0 * repetition + 1.5 * spread + 2.0 * (fixes > 0 ? 1 : 0) + recency + safety + bloat).toFixed(2);
  return { score, repetition: +repetition.toFixed(2), spread, fixes, recency, safety, bloat: +bloat.toFixed(2) };
}


// ════════════════════════════════════════════════════════════════════════════
// v3.1 — REFLECTIVE REVIEWER (the surpass): the deterministic detectors become
// EVIDENCE SOURCES; an LLM reviewer authors class-level skills from CROSS-CONVERSATION
// evidence (Letta recall — the structural edge Hermes lacks). Gated by a negative
// filter (don't learn env-noise) + class-level naming + security + lint.
// ════════════════════════════════════════════════════════════════════════════

/** NEGATIVE FILTER: durable lessons only — never env-failures
 * (command-not-found, missing binaries, creds, transient) or tool-negatives. They harden
 * into self-sabotage. Returns false = DO NOT learn this. */
export function isDurableLesson(text: unknown): boolean {
  const t = String(text ?? "").toLowerCase().trim();
  if (!t) return false;
  const ENV = /(command not found|no such file|cannot find module|not installed|uninstalled|missing (binary|package|dependency)|permission denied|\beacces\b|\benoent\b|\beperm\b|connection refused|timed out|rate.?limit|quota|insufficient balance|unauthorized|401|403|invalid auth|credential|fresh.install|not configured)/;
  if (ENV.test(t)) return false;
  if (/(is broken|does ?n'?t work|cannot use|unavailable|not supported)/.test(t)) return false; // tool-negative
  return true;
}


/** CLASS-LEVEL NAMING GATE (Hermes): reject x-to-y transitions, fix-/debug-/audit- artifacts,
 * dates/PR-numbers/versions, error-string names. Only durable class-level names pass. */
export function isValidSkillName(name: unknown): boolean {
  const n = String(name ?? "").trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(n) || n.length > 64) return false;
  const ANTI = [/^fix-/, /^debug-/, /^audit-/, /^patch-/, /-to-/, /\d{3,}/, /v?\d+[._]\d+/, /\berror\b|\bexception\b/, /-today$|-now$|-temp$|-wip$/];
  return !ANTI.some((p) => p.test(n));
}


/** THE LETTA EDGE: aggregate REAL grounded pitfalls across ALL conversations in the log
 * (Letta recall). Hermes reviews one conversation; this digests the agent's whole history. */
/** Structured per-signal instance counts — the n=1 CREATE gate's ground truth (P0 2a).
 * label carries the signal's identifying text; count/convs carry how often and how widely
 * it was actually observed. Instances = max(count, convs). */
export type EvidenceSignal = { label: string; kind: "repair" | "antipattern" | "template" | "high-signal"; count: number; convs: number };

/** P0 2a · n=1 CREATE gate (pure). A reflect-lane CREATE must be topically grounded in a signal
 * with >= minInstances observed instances (count OR conversation spread). Receipt: the aggregate
 * items floor let `recovering-from-npx-failures` ("Observed 1× across 1 session") ship TWICE by
 * riding in on an unrelated recurring workflow. Topic-matching stops instance borrowing. */
export function multiInstanceSupport(topic: string, signals: EvidenceSignal[], minInstances = 2): { ok: boolean; matched?: string; instances?: number; reason: string } {
  const GENERIC = new Set(["recovering", "recover", "failure", "failures", "fails", "failed", "failing", "when", "never", "running", "using", "with", "from", "this", "that", "command", "commands", "error", "errors", "instead", "blind", "retrying", "workflow", "recurring", "skill", "use", "then", "same", "exact", "exit", "code"]);
  const tok = (s: string) => new Set(String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !GENERIC.has(w)));
  const topicTokens = tok(topic);
  let best: { label: string; instances: number; overlap: number } | null = null;
  for (const s of signals || []) {
    const lt = tok(s.label);
    let inter = 0; for (const w of topicTokens) if (lt.has(w)) inter++;
    if (inter < 1) continue; // topically unrelated — its instances may NOT be borrowed
    const instances = Math.max(s.count || 0, s.convs || 0);
    if (!best || instances > best.instances || (instances === best.instances && inter > best.overlap)) best = { label: s.label, instances, overlap: inter };
  }
  if (!best) return { ok: false, reason: "no grounded evidence signal matches this skill's topic — refusing ungrounded create" };
  if (best.instances < minInstances) return { ok: false, matched: best.label, instances: best.instances, reason: `single-instance evidence: strongest topical signal "${best.label}" was observed ${best.instances}× — need >=${minInstances} distinct instances before a CREATE` };
  return { ok: true, matched: best.label, instances: best.instances, reason: `grounded: "${best.label}" observed ${best.instances}×` };
}

export function buildCrossConversationEvidence(rows: Row[]): { digest: string; convs: number; items: number; signals: EvidenceSignal[]; rejected: Array<{ item: string; reason: string }> } {
  const convs = new Set(rows.map((r) => String(r.conv ?? "?"))).size;
  const allRepairs = detectRepairChains(rows), allAps = detectAntiPatterns(rows);
  const repairs = allRepairs.filter((r) => isDurableLesson(r.errClass));
  const aps = allAps.filter((p) => isDurableLesson(p.errClass));
  const rejected: Array<{ item: string; reason: string }> = [];
  for (const r of allRepairs) if (!isDurableLesson(r.errClass)) rejected.push({ item: `${r.trigger} (${r.errClass})`, reason: "environment/transient — negative filter" });
  for (const p of allAps) if (!isDurableLesson(p.errClass)) rejected.push({ item: `${p.step} (${p.errClass})`, reason: "environment/transient — negative filter" });
  const tmpl = new Map<string, number>();
  const highSignal = new Map<string, { count: number; failures: number; convs: Set<string>; tool: string }>();
  for (const r of rows) if (r.tmpl) {
    tmpl.set(r.tmpl, (tmpl.get(r.tmpl) || 0) + 1);
    if (HIGH_SIGNAL_TOOL_SET.has(r.tool)) {
      const e = highSignal.get(r.tmpl) || { count: 0, failures: 0, convs: new Set<string>(), tool: r.tool };
      e.count++; if (r.ok === false) e.failures++; e.convs.add(String(r.conv ?? "?")); highSignal.set(r.tmpl, e);
    }
  }
  const topTmpl = [...tmpl.entries()].filter(([t, c]) => c >= 3 && !PRIMITIVE.test(t)).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const high = [...highSignal.entries()].sort((a, b) => b[1].failures - a[1].failures || b[1].count - a[1].count).slice(0, 10);
  const L: string[] = [`CROSS-CONVERSATION EVIDENCE (aggregated over ${convs} sessions of real tool-use):`];
  for (const r of repairs.slice(0, 12)) {
    L.push(`- recovered failure: "${r.trigger}" failed (${r.errClass}) → fixed via "${r.fixStep}" → re-ran "${r.verifyStep}" [${r.count}× across ${r.convs} sessions]`);
    for (const w of (r.worked ?? [])) {
      const sym = w.errMsg ? ` symptom: ${w.errMsg.replace(/\s+/g, " ").slice(0, 160)}` : "";
      const fx = w.fix ? ` | fix: ${w.fix.replace(/\s+/g, " ").slice(0, 200)}` : "";
      if (sym || fx) L.push(`    · example —${sym}${fx}`);
    }
  }
  for (const p of aps.slice(0, 8)) L.push(`- recurring failure (no clean fix yet): "${p.step}" — ${p.errClass} [${p.fails}×]`);
  for (const [t, c] of topTmpl) L.push(`- recurring workflow: ${t} [${c}×]`);
  for (const [t, e] of high) L.push(`- high-signal receipt workflow: ${t} [${e.count}× across ${e.convs.size} session${e.convs.size === 1 ? "" : "s"}${e.failures ? `, ${e.failures} failed/partial receipt${e.failures === 1 ? "" : "s"}` : ""}]`);
  // P0 2a: structured per-signal instance counts for the n=1 CREATE gate (same items, now countable).
  const signals: EvidenceSignal[] = [
    ...repairs.map((r) => ({ label: `${r.trigger} ${r.errClass} ${r.fixStep}`, kind: "repair" as const, count: r.count, convs: r.convs })),
    ...aps.map((p) => ({ label: `${p.step} ${p.errClass}`, kind: "antipattern" as const, count: p.fails, convs: p.convs })),
    ...topTmpl.map(([t, c]) => ({ label: t, kind: "template" as const, count: c, convs: 1 })),
    ...high.map(([t, e]) => ({ label: t, kind: "high-signal" as const, count: e.count, convs: e.convs.size })),
  ];
  return { digest: L.join("\n"), convs, items: repairs.length + aps.length + topTmpl.length + high.length, rejected, signals };
}
