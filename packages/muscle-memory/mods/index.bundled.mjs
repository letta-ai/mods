// mods/index.ts
import { mkdirSync as mkdirSync5, readFileSync as readFileSync5, existsSync as existsSync5, writeFileSync as writeFileSync5, readdirSync as readdirSync3 } from "node:fs";
import { join as join6 } from "node:path";

// mods/core.ts
import { appendFileSync, mkdirSync, readFileSync, existsSync, writeFileSync, readdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
var STATE_DIR = process.env.MM_STATE_DIR || join(homedir(), ".letta", "muscle-memory");
var LOG_PATH = join(STATE_DIR, "experience.jsonl");
var SESSIONS_PATH = join(STATE_DIR, "sessions.jsonl");
var GLOBAL_SKILLS_DIR = process.env.MM_GLOBAL_SKILLS_DIR || join(homedir(), ".letta", "skills");
var SECRETISH = /(?:key|token|secret|password|passwd|auth|bearer|cookie|api[_-]?key)/i;
var LONG_OPAQUE = /\b[A-Za-z0-9_\-]{24,}\b/g;
var HEXID = /\b[0-9a-f]{7,}\b/gi;
var ABS_PATH = /(?:\/[\w.\-~ ]+){2,}/g;
var QUOTED = /(['"])(?:\\.|(?!\1).)*\1/g;
var SECRET_ASSIGN = /\b(?=[A-Za-z_][A-Za-z0-9_]*\s*=)(?=[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|COOKIE|BEARER|API[_-]?KEY|APIKEY))[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s;&]+)/gi;
var SECRET_QUERY = /([?&])(?:access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|key|token|secret|password|passwd|auth|cookie|bearer)=([^&\s]+)/gi;
var SECRET_FLAG = /--(?:api[_-]?key|apikey|key|token|secret|password|passwd|auth|cookie|bearer)(?:=|\s+)(?:"[^"]*"|'[^']*'|[^\s;&]+)/gi;
var SECRET_HEADER = /\b(?:authorization|cookie|x-api-key|api-key)\s*:\s*(?:"[^"]*"|'[^']*'|[^\s;&]+)/gi;
var NUM = /\b\d+\b/g;
function scrubSecrets(t) {
  t = t.replace(/\b(?:bearer|token|apikey|api[_-]?key)\s+[^\s;&"']+/gi, "<cred> <redacted>");
  t = t.replace(/([a-z][a-z0-9+.\-]*:\/\/)[^/\s:@]+(?::[^/\s@]+)?@/gi, "$1<cred>@");
  t = t.replace(/\b((?:aws[_-]?)?(?:secret|password|passwd|token|api[_-]?key|access[_-]?key(?:[_-]?id)?|auth)[a-z0-9_]*)\s+(["']?)[^\s"';|&]{3,}\2/gi, "$1 <redacted>");
  t = t.replace(/(^|\s)(--?user|-u)[=\s]+("?)[^\s"':;|&]+:[^\s"';|&]+\3/gi, "$1$2 <redacted>");
  t = t.replace(/(^|\s)(--?(?:password|passwd|token|access[-_]?token|api[-_]?key))[=\s]+\S+/gi, "$1$2 <redacted>");
  t = t.replace(/(^|\s)-p(?=\S)\S+/g, "$1-p <redacted>");
  t = t.replace(/\b(?:AKIA|ASIA|AIza|ghp_|gho_|ghu_|ghs_|github_pat_|glpat-|xox[baprs]-|sk-[A-Za-z0-9]*-?|eyJ)[A-Za-z0-9_\-.]{6,}/g, "<id>");
  t = t.replace(SECRET_ASSIGN, "<cred>=<redacted>");
  t = t.replace(SECRET_QUERY, "$1<cred>=<redacted>");
  t = t.replace(SECRET_FLAG, "--<cred>=<redacted>");
  t = t.replace(SECRET_HEADER, "<cred>:<redacted>");
  return t;
}
function redactFragment(text, maxLines = 8, maxChars = 320) {
  const lines = String(text ?? "").split(/\r?\n/).slice(0, maxLines).map((ln) => {
    let s = scrubSecrets(ln);
    s = s.replace(ABS_PATH, "<path>");
    s = s.replace(/\b[A-Za-z0-9_\-]{28,}\b/g, "<id>");
    s = s.replace(/\b[0-9a-f]{12,}\b/gi, "<id>");
    return s.replace(/[ \t]+/g, " ").replace(/\s+$/, "");
  });
  return lines.join(`
`).replace(/\n{3,}/g, `

`).trim().slice(0, maxChars);
}
function hash(s) {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}
var MM = {
  MIN_COUNT: 3,
  MIN_CONVS: 2,
  STRONG_SINGLE: 8,
  MATURE_AT: 3,
  NGRAM: 2,
  W_FREQ: 1,
  W_SPREAD: 1.5,
  W_FIX: 2
};
function ensureDir() {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
  } catch {}
}
function appendJsonl(path, row) {
  try {
    ensureDir();
    appendFileSync(path, JSON.stringify(row) + `
`);
  } catch {}
}
function loadRows(path = LOG_PATH) {
  if (!existsSync(path))
    return [];
  const rows = [];
  for (const line of readFileSync(path, "utf8").split(`
`)) {
    if (!line)
      continue;
    try {
      rows.push(JSON.parse(line));
    } catch {}
  }
  return rows;
}
var GLOBAL_SKILLS = GLOBAL_SKILLS_DIR;
var MM_TAG = "muscle-memory provenance";
function agentSkillsDir(ctx) {
  if (process.env.MEMORY_DIR)
    return join(process.env.MEMORY_DIR, "skills");
  const id = ctx?.agent?.id || ctx?.agentId;
  if (id) {
    const projected = join(homedir(), ".letta", "agents", id, "memory", "skills");
    if (existsSync(join(homedir(), ".letta", "agents", id, "memory")))
      return projected;
    const local = join(homedir(), ".letta", "lc-local-backend", "memfs", id, "memory", "skills");
    if (existsSync(join(homedir(), ".letta", "lc-local-backend", "memfs", id)))
      return local;
  }
  return GLOBAL_SKILLS;
}
function scanDirs(ctx) {
  return [...new Set([agentSkillsDir(ctx), GLOBAL_SKILLS])];
}
function skillShelves(ctx) {
  const agent = agentSkillsDir(ctx);
  const shelves = [{ name: "agent", dir: agent, writable: true, autonomous: true, priority: 20 }];
  if (GLOBAL_SKILLS !== agent)
    shelves.push({ name: "global", dir: GLOBAL_SKILLS, writable: false, autonomous: false, priority: 10 });
  return shelves;
}
function autonomousShelves(ctx) {
  return skillShelves(ctx).filter((s) => s.autonomous).map((s) => s.dir);
}
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
}
function listSkillNames(dir) {
  try {
    return readdirSync(dir).filter((n) => existsSync(join(dir, n, "SKILL.md")));
  } catch {
    return [];
  }
}
function readSkill(dir, name) {
  try {
    return readFileSync(join(dir, name, "SKILL.md"), "utf8");
  } catch {
    return "";
  }
}
function skillDesc(dir, name) {
  return (readSkill(dir, name).match(/description:\s*(.+)/)?.[1] || "").trim();
}
function isManaged(dir, name) {
  return readSkill(dir, name).includes(MM_TAG);
}
function writeSkill(dir, name, content) {
  mkdirSync(join(dir, name), { recursive: true });
  const tmp = join(dir, name, ".SKILL.md.tmp");
  writeFileSync(tmp, content);
  renameSync(tmp, join(dir, name, "SKILL.md"));
  return join(dir, name, "SKILL.md");
}
var OUTCOME_PATH = join(STATE_DIR, "outcomes.jsonl");
var TELEMETRY_PATH = join(STATE_DIR, "telemetry.json");
var RECEIPTS_DIR = join(STATE_DIR, "receipts");
function loadOutcomes() {
  if (!existsSync(OUTCOME_PATH))
    return [];
  const out = [];
  for (const l of readFileSync(OUTCOME_PATH, "utf8").split(`
`)) {
    if (!l)
      continue;
    try {
      out.push(JSON.parse(l));
    } catch {}
  }
  return out;
}
function loadExperience() {
  return inferOutcomes(correlateOutcomes(loadRows(), loadOutcomes()));
}
var PUBLISH_STAGED_DIR = join(STATE_DIR, "publish-staged");
var USAGE_PATH = join(STATE_DIR, "skill-usage.json");
var NEOCORTEX_BLOCK = "muscle_memory";
var SECRET_TOKEN_RE = /\b(?:(?:sk|pk|ghp|gho|ghu|ghs|xox[baprs])[-_][A-Za-z0-9]{12,}|sk-ant-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16}|AIza[A-Za-z0-9_-]{20,})\b/;
function scanSkillContent(content) {
  const c = String(content || "");
  const issues = [];
  if (SECRET_TOKEN_RE.test(c) || /\b(?:authorization|api[_-]?key|secret|password)\s*[:=]\s*["']?[^\s"'<>]{6,}/i.test(c) || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(c))
    issues.push("secret-looking credential");
  if (/\bcurl\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/i.test(c) || /\bwget\b[^\n|]*\|\s*(?:ba)?sh\b/i.test(c))
    issues.push("pipe-to-shell (curl|sh)");
  if (/\brm\s+-[rf]{1,2}\s+(?:["']?[~/]|\$HOME|\*)/.test(c))
    issues.push("naked rm -rf on root/home/glob");
  if (/(?:^|[\s;&|])sudo\s+\S/i.test(c))
    issues.push("sudo command");
  if (Math.ceil(c.length / 4) > 5000)
    issues.push("body > 5000 tokens (decompose into references/)");
  if (/\bignore\s+(?:all\s+|the\s+)?(?:previous|prior|above)\s+(?:instructions|messages|prompts|rules)\b/i.test(c) || /\b(?:disregard|override)\s+(?:your\s+|the\s+)?(?:system|previous)\s+(?:prompt|instructions)\b/i.test(c))
    issues.push("prompt-injection phrasing");
  if (/<\/?muscle-memory-skill\b/i.test(c) || /(?:<\/?(?:system|assistant|user)>|\[(?:system|assistant)\]\s*:?)\s*[^<\n]{0,80}\b(?:you\s+are\s+now|new\s+instructions?|ignore|disregard|override)\b/i.test(c) || /\bpublish\s+this\s+skill\s+(?:anyway|without\s+review|now\b|regardless)/i.test(c))
    issues.push("prompt-injection / context-escape directive");
  if (/\b(?:sk-ant-[a-zA-Z0-9-]{8,}|sk-[a-zA-Z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[A-Za-z0-9-]{10,})\b/.test(c))
    issues.push("hardcoded API key/token");
  if (/\$\([^)]*(?:cat|head|tail|less)[^)]*(?:\.ssh|id_rsa|\.env|\.aws|credentials|\.netrc|passwd|secret|token)/i.test(c) || /(?:curl|wget|nc|ncat)\b[^\n]*(?:\$\(|`)[^\n]*(?:cat|\.ssh|\.env|credentials|secret)/i.test(c))
    issues.push("credential exfiltration pattern");
  if (/\beval\s*\(\s*(?:atob|Buffer\.from|decodeURIComponent|unescape)\s*\(/i.test(c) || /\bbase64\s+-d\b[^\n]*\|\s*(?:ba)?sh\b/i.test(c) || /\b(?:python3?|node|ruby|perl)\b[^\n]*\s-[ec]\b[^\n]*(?:atob|base64|exec\(|eval)/i.test(c))
    issues.push("obfuscated code execution");
  return { ok: issues.length === 0, issues };
}
function scanSupportFile(path, content) {
  const issues = [...scanSkillContent(content).issues];
  if (/\.(?:sh|mjs|cjs|js|ts|py|rb)$/i.test(path)) {
    const testDemo = /\b(?:test|demo|smoke|example|fixture)\b/i.test(path) || /\b(?:test|demo|smoke|example)\b/i.test(String(content).slice(0, 240));
    if (!testDemo && /\b(?:curl|wget|fetch\s*\(|https?:\/\/|rm\s+-[rf]|dd\s+if=|mkfs|>\s*\/dev\/)\b/i.test(content))
      issues.push("support script runs network/destructive ops without test/demo marking");
  }
  return { ok: issues.length === 0, issues };
}
var SUPPORT_SUBDIRS = new Set(["references", "templates", "scripts", "assets"]);
function validateSupportPath(filePath) {
  const p = String(filePath || "");
  if (!p)
    return { ok: false, reason: "file_path required" };
  if (p.includes(".."))
    return { ok: false, reason: "path traversal ('..') blocked" };
  if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("~"))
    return { ok: false, reason: "absolute/home path blocked" };
  const parts = p.split("/").filter(Boolean);
  if (parts.length < 2)
    return { ok: false, reason: "provide subdir/filename" };
  if (!SUPPORT_SUBDIRS.has(parts[0]))
    return { ok: false, reason: `must be under: ${[...SUPPORT_SUBDIRS].join(", ")}` };
  if (parts.some((s) => s.startsWith(".")))
    return { ok: false, reason: "dotfiles/segments blocked" };
  return { ok: true };
}
function skillDirOf(name, ctx) {
  return scanDirs(ctx).find((d) => existsSync(join(d, name, "SKILL.md"))) || null;
}
function writeSupportFile(name, filePath, content, ctx) {
  const v = validateSupportPath(filePath);
  if (!v.ok)
    throw new Error(v.reason);
  const sc = scanSupportFile(filePath, content);
  if (!sc.ok)
    throw new Error(`security: ${sc.issues.join("; ")}`);
  const d = skillDirOf(name, ctx);
  if (!d)
    throw new Error(`no skill '${name}'`);
  const full = join(d, name, filePath);
  mkdirSync(dirname(full), { recursive: true });
  const tmp = full + ".mmtmp";
  writeFileSync(tmp, content);
  renameSync(tmp, full);
  return full;
}
function removeSupportFile(name, filePath, ctx) {
  const v = validateSupportPath(filePath);
  if (!v.ok)
    throw new Error(v.reason);
  const d = skillDirOf(name, ctx);
  if (!d)
    throw new Error(`no skill '${name}'`);
  const full = join(d, name, filePath);
  if (!existsSync(full))
    throw new Error(`no such support file`);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const grave = join(STATE_DIR, "removed-files", name, `${filePath.replace(/\//g, "__")}-${stamp}`);
  mkdirSync(dirname(grave), { recursive: true });
  renameSync(full, grave);
  return grave;
}
var STAGED_DIR = join(STATE_DIR, "staged");
function createDedupeSurface(ctx) {
  return [...new Set([...scanDirs(ctx), STAGED_DIR])];
}
var STAGED_RETIRED_DIR = join(STATE_DIR, "staged-retired");
var AUTOPILOT_STATE = join(STATE_DIR, "autopilot-state.json");
var UI_EVENTS = join(STATE_DIR, "ui-events.jsonl");
var UI_STATE = join(STATE_DIR, "ui-state.json");
var REFLECT_HANDLED = join(STATE_DIR, "reflect-handled.json");
function appendUiEvent(e) {
  try {
    ensureDir();
    appendJsonl(UI_EVENTS, { ts: Date.now(), source: "muscle-memory", ...e });
  } catch {}
}
var livePanel = null;
function setLivePanel(p) {
  livePanel = p;
}
var panelUpdatePending = false;
function writeUiState(s) {
  try {
    ensureDir();
    writeFileSync(UI_STATE, JSON.stringify({ ...readUiState(), ...s, ts: Date.now() }));
  } catch {}
  if (livePanel && !panelUpdatePending) {
    panelUpdatePending = true;
    setTimeout(() => {
      panelUpdatePending = false;
      try {
        livePanel?.update();
      } catch {}
    }, 100);
  }
}
function readUiState() {
  try {
    return existsSync(UI_STATE) ? JSON.parse(readFileSync(UI_STATE, "utf8")) : {};
  } catch {
    return {};
  }
}
function loadUiEvents(n = 8) {
  if (!existsSync(UI_EVENTS))
    return [];
  const out = [];
  for (const l of readFileSync(UI_EVENTS, "utf8").trim().split(`
`)) {
    if (!l)
      continue;
    try {
      out.push(JSON.parse(l));
    } catch {}
  }
  return out.slice(-n);
}
var MESH_FEED = join(homedir(), ".local", "state", "mesh-skill-feed.jsonl");
function meshAgentLabel() {
  return process.env.MM_AGENT || (String(process.env.MEMORY_DIR || "").includes("be7d4413") ? "mack" : "agent");
}
function appendMeshFeed(e) {
  try {
    mkdirSync(dirname(MESH_FEED), { recursive: true });
    appendFileSync(MESH_FEED, JSON.stringify({ agent: meshAgentLabel(), ts: Date.now(), source: "muscle-memory", ...e }) + `
`);
  } catch {}
}
function loadMeshFeed(n = 6) {
  try {
    if (!existsSync(MESH_FEED))
      return [];
    const all = [];
    for (const l of readFileSync(MESH_FEED, "utf8").trim().split(`
`)) {
      if (l)
        try {
          all.push(JSON.parse(l));
        } catch {}
    }
    const seen = new Map;
    for (const e of all)
      seen.set(`${e.agent}|${e.skill}|${e.type}`, e);
    return [...seen.values()].slice(-n);
  } catch {
    return [];
  }
}
function renderMeshFeed(entries) {
  return entries.map((e) => `${(e.agent || "?").padEnd(5)} ${String(e.type || "").replace("skill_", "")} ${e.skill || ""}${e.route ? ` · ${e.route}` : ""}${e.signals ? ` · ${e.signals} signals` : ""}`.trim());
}

// mods/detect.ts
function commandTemplate2(cmd) {
  let t = String(cmd).trim();
  t = t.replace(/\b(?:bearer|token|apikey|api[_-]?key)\s+[^\s;&"']+/gi, "<cred> <redacted>");
  t = t.replace(/([a-z][a-z0-9+.\-]*:\/\/)[^/\s:@]+(?::[^/\s@]+)?@/gi, "$1<cred>@");
  t = t.replace(/\b((?:aws[_-]?)?(?:secret|password|passwd|token|api[_-]?key|access[_-]?key(?:[_-]?id)?|auth)[a-z0-9_]*)\s+(["']?)[^\s"';|&]{3,}\2/gi, "$1 <redacted>");
  t = t.replace(/(^|\s)(--?user|-u)[=\s]+("?)[^\s"':;|&]+:[^\s"';|&]+\3/gi, "$1$2 <redacted>");
  t = t.replace(/(^|\s)(--?(?:password|passwd|token|access[-_]?token|api[-_]?key))[=\s]+\S+/gi, "$1$2 <redacted>");
  t = t.replace(/(^|\s)-p(?=\S)\S+/g, "$1-p <redacted>");
  t = t.replace(/\b(?:AKIA|ASIA|AIza|ghp_|gho_|ghu_|ghs_|github_pat_|glpat-|xox[baprs]-|sk-[A-Za-z0-9]*-?|eyJ)[A-Za-z0-9_\-.]{6,}/g, "<id>");
  t = t.replace(SECRET_ASSIGN, "<cred>=<redacted>");
  t = t.replace(SECRET_QUERY, "$1<cred>=<redacted>");
  t = t.replace(SECRET_FLAG, "--<cred>=<redacted>");
  t = t.replace(SECRET_HEADER, "<cred>:<redacted>");
  t = t.replace(QUOTED, "<str>");
  t = t.replace(/\b(?:bearer|authorization|api[_-]?key|api\s+key|token|secret|password|passwd|cookie)\b/gi, "<cred>");
  t = t.replace(ABS_PATH, "<path>");
  t = t.replace(HEXID, "<id>");
  t = t.replace(LONG_OPAQUE, "<id>");
  t = t.replace(NUM, "<n>");
  t = t.replace(/\s+/g, " ").trim();
  return t.slice(0, 240);
}
var HIGH_SIGNAL_TOOL_SET = new Set((process.env.MM_HIGH_SIGNAL_TOOLS || "").split(",").map((s) => s.trim()).filter(Boolean));
function fingerprint2(tool, args) {
  let tmpl = null;
  const keys = Object.keys(args || {}).sort();
  if (tool === "Bash" && typeof args?.command === "string") {
    tmpl = commandTemplate2(args.command);
  } else if (tool === "exec_command" && typeof args?.cmd === "string") {
    tmpl = commandTemplate2(args.cmd);
  } else if ((tool === "Read" || tool === "Edit" || tool === "Write" || tool === "fast_apply") && typeof args?.file_path === "string") {
    const ext = String(args.file_path).match(/\.[A-Za-z0-9]+$/)?.[0] || "";
    tmpl = `${tool} <path>${ext}`;
  } else if (tool === "Grep" || tool === "Glob" || tool === "structural_search") {
    tmpl = `${tool} ${keys.join(",")}`;
  } else if (tool === "Skill" && typeof args?.skill === "string") {
    tmpl = `Skill ${slug(String(args.skill))}`;
  } else if (HIGH_SIGNAL_TOOL_SET.has(tool)) {
    tmpl = `${tool} ${keys.join(",")}`;
  }
  const shape = keys.filter((k) => !SECRETISH.test(k)).join(",");
  const fp = `${tool}(${shape})${tmpl ? " :: " + tmpl : ""}`;
  return { fp, tmpl };
}
function maturityScore(count, convs, fixes) {
  return MM.W_FREQ * Math.log2(count) + MM.W_SPREAD * (convs - 1) + MM.W_FIX * (fixes > 0 ? 1 : 0);
}
function isMature(count, convs, m) {
  const enoughSpread = convs >= MM.MIN_CONVS || count >= MM.STRONG_SINGLE;
  return count >= MM.MIN_COUNT && enoughSpread && m >= MM.MATURE_AT;
}
var TRIVIAL = new Set(["echo", "cd", "ls", "cat", "true", "pwd", "sleep", ":"]);
var SUBCMD = new Set(["git", "letta", "npm", "npx", "gh", "docker", "cargo", "bun", "pnpm", "yarn", "kubectl", "jq"]);
function stepSig(row) {
  if (row.tool !== "Bash") {
    const m = (row.tmpl || "").match(/\.[A-Za-z0-9]+$/);
    return m ? `${row.tool}${m[0]}` : row.tool;
  }
  const t = (row.tmpl || "").replace(/\bcd <[^>]+>\s*&&\s*/g, " ").replace(/\becho <str>\s*&&?\s*/g, " ");
  for (const seg of t.split(/&&|\|\||\||;/)) {
    const toks = seg.trim().split(/\s+/).filter(Boolean);
    if (!toks.length)
      continue;
    let v = toks[0].replace(/^.*\//, "");
    if (TRIVIAL.has(v))
      continue;
    if (SUBCMD.has(v) && toks[1] && /^[a-z]/i.test(toks[1]))
      v = `${v} ${toks[1]}`;
    return v.slice(0, 24);
  }
  return "Bash";
}
function detectTemplates(rows) {
  const byKey = new Map;
  const failPending = new Map;
  for (const r of rows) {
    if (!r.tmpl)
      continue;
    const k = r.tmpl;
    let e = byKey.get(k);
    if (!e) {
      e = { count: 0, convs: new Set, fixes: 0, lastFail: false };
      byKey.set(k, e);
    }
    e.count++;
    e.convs.add(String(r.conv ?? "?"));
    const fk = `${r.conv}|${k}`;
    if (r.ok === false)
      failPending.set(fk, true);
    else if (r.ok === true && failPending.get(fk)) {
      e.fixes++;
      failPending.set(fk, false);
    }
  }
  return finalize("template", byKey);
}
function detectSequences(rows, n = MM.NGRAM) {
  const byConv = new Map;
  for (const r of rows) {
    const c = String(r.conv ?? "?");
    if (!byConv.has(c))
      byConv.set(c, []);
    byConv.get(c).push(r);
  }
  const byKey = new Map;
  for (const [conv, rs] of byConv) {
    rs.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
    for (let i = 0;i + n <= rs.length; i++) {
      const win = rs.slice(i, i + n);
      const sigs = win.map(stepSig);
      const distinct = new Set(sigs);
      if (distinct.size < 2)
        continue;
      if (sigs.every((s) => s === "Bash"))
        continue;
      const gram = sigs.join(" → ");
      let e = byKey.get(gram);
      if (!e) {
        e = { count: 0, convs: new Set, fixes: 0 };
        byKey.set(gram, e);
      }
      e.count++;
      e.convs.add(conv);
      if (win.some((x) => x.ok === false))
        e.fixes++;
    }
  }
  return finalize("sequence", byKey);
}
function finalize(kind, byKey) {
  const out = [];
  for (const [key, e] of byKey) {
    const convs = e.convs.size;
    const m = maturityScore(e.count, convs, e.fixes);
    const mature = isMature(e.count, convs, m);
    out.push({ kind, key, count: e.count, convs, fixes: e.fixes, maturity: +m.toFixed(2), mature });
  }
  return out.sort((a, b) => b.maturity - a.maturity);
}
var PRIMITIVE = /^(Read|Write|Edit|Glob|Grep|fast_apply|structural_search)\b/;
var TRIVIAL_CMD = new Set(["echo", "cd", "ls", "cat", "true", "false", "pwd", "sleep", ":", "mkdir", "rmdir", "touch", "which", "whoami", "find", "head", "tail", "wc", "chmod", "chown", "cp", "mv", "rm", "export", "unset", "source", "clear", "env", "printenv", "date", "tree", "cut", "tr", "sort", "uniq", "basename", "dirname", "realpath", "test"]);
var BARE_RUN = /^(python3?|node|deno|bun|ruby|go|php|perl|java|dotnet|sh|bash|zsh)$|^\.\//i;
function templateVerb(key) {
  for (const seg of key.split(/&&|\|\||\||;/)) {
    const toks = seg.trim().split(/\s+/).filter(Boolean);
    if (!toks.length)
      continue;
    let v = toks[0].replace(/^.*\//, "");
    if (TRIVIAL.has(v))
      continue;
    if (SUBCMD.has(v) && toks[1] && /^[a-z]/i.test(toks[1]))
      v = `${v} ${toks[1]}`;
    return v;
  }
  return (key.split(/\s+/)[0] || key).replace(/^.*\//, "");
}
function isDistinctiveStep(sig) {
  if (PRIMITIVE.test(sig))
    return false;
  if (BARE_RUN.test(sig))
    return false;
  const v = sig.split(/\s+/)[0].replace(/^.*\//, "");
  if (TRIVIAL_CMD.has(v))
    return false;
  return /[a-z]/i.test(sig);
}
function isSkillWorthy(c) {
  if (!c.mature)
    return false;
  if (c.kind === "template") {
    if (PRIMITIVE.test(c.key))
      return false;
    if (TRIVIAL_CMD.has(templateVerb(c.key)))
      return false;
    return true;
  }
  if (c.kind === "sequence" && c.fixes === 0 && !c.key.split(/→/).some((s) => isDistinctiveStep(s.trim())))
    return false;
  return true;
}
function repairCandidates(rows) {
  const out = [];
  for (const r of detectRepairChains(rows)) {
    const mature = r.convs >= MM.MIN_CONVS && r.count >= 2 || !!r.generalized && r.count >= 2 || r.count >= MM.MIN_COUNT;
    if (!mature)
      continue;
    out.push({ kind: "sequence", key: r.verifyStep, count: r.count, convs: r.convs, fixes: r.count, maturity: +maturityScore(r.count, r.convs, r.count).toFixed(2), mature: true });
  }
  return out;
}
function detect(rows) {
  const templates = detectTemplates(rows);
  const sequences = detectSequences(rows);
  const repairs = repairCandidates(rows);
  const repairKeys = new Set(repairs.map((r) => r.key));
  const rest = [...templates, ...sequences].filter((c) => !repairKeys.has(c.key));
  const candidates = [...repairs, ...rest].filter(isSkillWorthy).sort((a, b) => b.maturity - a.maturity);
  return { templates, sequences, candidates };
}
function classifyError(resultText, ok) {
  if (ok !== false)
    return null;
  const raw = String(resultText ?? "");
  const known = raw.match(/\b(?:ENOENT|EACCES|EPERM|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|command not found|no such file|not found|permission denied|denied|refused|unauthorized|forbidden|invalid|conflict|timed out|timeout|rate.?limit|exit code \d+|assertion|syntax error|type ?error|module not found|cannot find)\b/i);
  return known ? known[0].toLowerCase().replace(/\s+/g, "-").slice(0, 40) : "error";
}
function mergeOutcomes(rows, ends) {
  const byId = new Map;
  for (const e of ends)
    if (e.id)
      byId.set(e.id, { ok: e.ok, err: e.err ?? null });
  return rows.map((r) => r.id && byId.has(r.id) ? { ...r, ...byId.get(r.id) } : r);
}
function correlateOutcomes(starts, ends, opts = {}) {
  const windowMs = opts.windowMs ?? 5 * 60 * 1000;
  const rows = starts.map((r) => ({ ...r }));
  const used = new Set;
  const byId = new Map;
  rows.forEach((r, i) => {
    if (r.id != null && !byId.has(String(r.id)))
      byId.set(String(r.id), i);
  });
  const pending = [];
  for (const e of ends) {
    const eid = e.id != null ? String(e.id) : null;
    if (eid && byId.has(eid) && !used.has(byId.get(eid))) {
      const i = byId.get(eid);
      rows[i].ok = e.ok;
      rows[i].err = e.err ?? null;
      rows[i].errMsg = e.errMsg ?? rows[i].errMsg ?? null;
      used.add(i);
    } else
      pending.push(e);
  }
  for (const e of [...pending].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))) {
    const cands = rows.map((r, i) => ({ r, i })).filter(({ r, i }) => !used.has(i) && r.ok === undefined && String(r.conv) === String(e.conv) && (e.ts ?? 0) - (r.ts ?? 0) >= 0 && (e.ts ?? 0) - (r.ts ?? 0) <= windowMs);
    if (!cands.length)
      continue;
    let pick;
    if (e.tool != null) {
      const same = cands.filter((c) => c.r.tool === e.tool);
      const pool = same.length ? same : cands;
      pick = pool.reduce((a, b) => (e.ts ?? 0) - (a.r.ts ?? 0) <= (e.ts ?? 0) - (b.r.ts ?? 0) ? a : b);
    } else {
      pick = cands.reduce((a, b) => (a.r.ts ?? 0) <= (b.r.ts ?? 0) ? a : b);
    }
    rows[pick.i].ok = e.ok;
    rows[pick.i].err = e.err ?? null;
    rows[pick.i].errMsg = e.errMsg ?? rows[pick.i].errMsg ?? null;
    used.add(pick.i);
  }
  return rows;
}
var VERIFY_RE = /\b(tests?|build|lint|tsc|type-?check|vitest|jest|pytest|mocha|check|compile|make|cargo|gradle|mvn|deploy|e2e|playwright|eslint|ruff|mypy|pyright|gate|qa|smoke|run|python3?|node|deno|ruby|go)\b|\.\/|\.(?:py|js|ts|tsx|sh|rb|go)\b/i;
var FIX_TOOL_RE = /^(Edit|Write|fast_apply)/;
function inferOutcomes(rows, opts = {}) {
  const windowMs = opts.windowMs ?? 10 * 60 * 1000;
  const out = rows.map((r) => ({ ...r }));
  const byConv = new Map;
  out.forEach((r, i) => {
    const c = String(r.conv ?? "?");
    (byConv.get(c) ?? byConv.set(c, []).get(c)).push(i);
  });
  for (const [, idxs] of byConv) {
    idxs.sort((a, b) => (out[a].ts ?? 0) - (out[b].ts ?? 0));
    const occ = new Map;
    for (const i of idxs) {
      const r = out[i];
      if (r.ok !== undefined || r.tool !== "Bash" && r.tool !== "exec_command")
        continue;
      if (!VERIFY_RE.test(String(r.tmpl ?? r.fp ?? "")))
        continue;
      (occ.get(stepSig(r)) ?? occ.set(stepSig(r), []).get(stepSig(r))).push(i);
    }
    for (const [, list] of occ) {
      for (let p = 0;p < list.length - 1; p++) {
        const a = list[p], b = list[p + 1];
        if ((out[b].ts ?? 0) - (out[a].ts ?? 0) > windowMs)
          continue;
        const fixBetween = idxs.some((j) => (out[j].ts ?? 0) > (out[a].ts ?? 0) && (out[j].ts ?? 0) < (out[b].ts ?? 0) && FIX_TOOL_RE.test(out[j].tool));
        const at = String(out[a].tmpl ?? ""), bt = String(out[b].tmpl ?? "");
        const invocationRefined = at !== "" && bt !== "" && bt !== at && bt.includes(at);
        if (!fixBetween && !invocationRefined)
          continue;
        if (out[a].ok === undefined) {
          out[a].ok = false;
          out[a].err = out[a].err ?? "inferred-failure";
        }
        if (out[b].ok === undefined)
          out[b].ok = true;
      }
    }
  }
  return out;
}
function detectInvocationGotchas(rows) {
  const byConv = new Map;
  for (const r of rows) {
    const c = String(r.conv ?? "?");
    (byConv.get(c) ?? byConv.set(c, []).get(c)).push(r);
  }
  const acc = new Map;
  for (const [conv, rs] of byConv) {
    rs.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
    for (let i = 0;i < rs.length; i++) {
      if (rs[i].tool !== "Bash" && rs[i].tool !== "exec_command" || !VERIFY_RE.test(String(rs[i].tmpl ?? rs[i].fp ?? "")))
        continue;
      const at = String(rs[i].tmpl ?? "");
      if (!at)
        continue;
      for (let j = i + 1;j < Math.min(rs.length, i + 6); j++) {
        const bt = String(rs[j].tmpl ?? "");
        if ((rs[j].tool === "Bash" || rs[j].tool === "exec_command") && bt && bt !== at && bt.includes(at)) {
          const delta = bt.replace(at, "").trim();
          if (!/^(--?[a-z]|[A-Z][A-Z0-9_]*=)/.test(delta))
            break;
          const key = `${stepSig(rs[i])}|${delta}`;
          const e = acc.get(key) ?? { count: 0, convs: new Set };
          e.count++;
          e.convs.add(conv);
          acc.set(key, e);
          break;
        }
      }
    }
  }
  return [...acc.entries()].map(([k, e]) => {
    const [trigger, delta] = k.split("|");
    return { trigger, delta, count: e.count, convs: e.convs.size };
  }).sort((a, b) => b.count - a.count);
}
var FIX_VERBS = /^(Edit|Write|fast_apply|git commit|git add|patch|sed|npm|npx|bun|cargo)/i;
function triggerClass(sig) {
  const v = sig.split(/\s+/)[0].replace(/^.*\//, "").toLowerCase();
  if (/^(python3?|node|deno|bun|ruby|go|php|perl|java|dotnet)$/.test(v) || /\.(py|js|ts|tsx|rb|go|sh)$/.test(sig))
    return { key: "script-run", label: "failing-script-runs" };
  if (/^(pytest|jest|vitest|mocha|cargo|gradle|mvn|make|gotest|rspec|phpunit)$/.test(v))
    return { key: "test-build", label: "failing-tests-or-builds" };
  if (/^(tsc|mypy|pyright|eslint|ruff|prettier|biome|flake8)$/.test(v) || /type-?check/.test(v))
    return { key: "typecheck-lint", label: "type-check-or-lint-failures" };
  return null;
}
function fixClass(sig) {
  return /^(Edit|Write|fast_apply)/.test(sig) ? "edit the source" : sig;
}
function detectRepairChains(rows) {
  const byConv = new Map;
  for (const r of rows) {
    const c = String(r.conv ?? "?");
    (byConv.get(c) ?? byConv.set(c, []).get(c)).push(r);
  }
  const acc = new Map;
  for (const [conv, rs] of byConv) {
    rs.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
    for (let i = 0;i < rs.length; i++) {
      if (rs[i].ok !== false)
        continue;
      const trigger = stepSig(rs[i]);
      const errClass = rs[i].err || classifyError("", false) || "error";
      let fixStep = "";
      let fixRow;
      for (let j = i + 1;j < Math.min(rs.length, i + 7); j++) {
        const sig = stepSig(rs[j]);
        if (!fixStep && FIX_VERBS.test(sig)) {
          fixStep = sig;
          fixRow = rs[j];
        }
        if (fixStep && rs[j].ok === true && stepSig(rs[j]) === trigger) {
          const key = `${trigger}|${fixStep}`;
          const e = acc.get(key) ?? { errClass, count: 0, convs: new Set, worked: [] };
          e.count++;
          e.convs.add(conv);
          const errMsg = rs[i].errMsg || undefined;
          const fix = fixRow?.fix || undefined;
          if (errMsg || fix)
            e.worked.push({ cmd: trigger, errMsg, fix });
          acc.set(key, e);
          break;
        }
      }
    }
  }
  const dedupeWorked = (ws) => {
    const seen = new Set;
    const out2 = [];
    for (const w of ws) {
      const k = `${w.errMsg ?? ""}|${w.fix ?? ""}`;
      if (seen.has(k))
        continue;
      seen.add(k);
      out2.push(w);
    }
    return out2.slice(0, 12);
  };
  const literal = [...acc.entries()].map(([k, e]) => {
    const [trigger, fixStep] = k.split("|");
    return { trigger, errClass: e.errClass, fixStep, count: e.count, convs: e.convs, worked: e.worked };
  });
  const groups = new Map;
  for (const l of literal) {
    const tc = triggerClass(l.trigger);
    if (!tc)
      continue;
    const gk = `${tc.key}|${fixClass(l.fixStep)}`;
    const g = groups.get(gk) ?? { label: tc.label, lits: [] };
    g.lits.push(l);
    groups.set(gk, g);
  }
  const absorbed = new Set;
  const out = [];
  for (const g of groups.values()) {
    const distinct = new Set(g.lits.map((l) => l.trigger));
    if (distinct.size < 2)
      continue;
    const convs = new Set;
    let count = 0;
    let errClass = "";
    const worked = [];
    for (const l of g.lits) {
      l.convs.forEach((c) => convs.add(c));
      count += l.count;
      errClass ||= l.errClass;
      worked.push(...l.worked);
      absorbed.add(`${l.trigger}|${l.fixStep}`);
    }
    const rep = g.lits.slice().sort((a, b) => b.count - a.count)[0];
    const dw = dedupeWorked(worked);
    out.push({ trigger: g.label, errClass, fixStep: fixClass(rep.fixStep), verifyStep: rep.trigger, count, convs: convs.size, generalized: true, examples: [...distinct], ...dw.length ? { worked: dw } : {} });
  }
  for (const l of literal) {
    if (absorbed.has(`${l.trigger}|${l.fixStep}`))
      continue;
    const dw = dedupeWorked(l.worked);
    out.push({ trigger: l.trigger, errClass: l.errClass, fixStep: l.fixStep, verifyStep: l.trigger, count: l.count, convs: l.convs.size, ...dw.length ? { worked: dw } : {} });
  }
  return out.sort((a, b) => b.count - a.count);
}
function detectAntiPatterns(rows) {
  const repairs = new Set(detectRepairChains(rows).map((r) => r.trigger));
  const acc = new Map;
  for (const r of rows) {
    if (r.ok !== false)
      continue;
    const step = stepSig(r);
    const e = acc.get(step) ?? { errClass: r.err || "error", fails: 0, convs: new Set };
    e.fails++;
    e.convs.add(String(r.conv ?? "?"));
    if (r.err)
      e.errClass = r.err;
    acc.set(step, e);
  }
  return [...acc.entries()].filter(([step, e]) => e.fails >= 2 && !repairs.has(step)).map(([step, e]) => ({ step, errClass: e.errClass, fails: e.fails, recovered: 0, convs: e.convs.size })).sort((a, b) => b.fails - a.fails);
}
var DESTRUCTIVE = /\b(rm|rmdir|drop|delete|truncate|reset --hard|force|push --force|mkfs|dd)\b/i;
function impactScore(c, opts = {}) {
  const repetition = Math.log2(Math.max(1, c.count));
  const spread = c.convs - 1;
  const fixes = c.fixes;
  const recency = 1;
  const safety = DESTRUCTIVE.test(c.key) ? -2 : 0;
  const bloat = -(opts.bloatOverlap ?? 0) * 2;
  const score = +(1 * repetition + 1.5 * spread + 2 * (fixes > 0 ? 1 : 0) + recency + safety + bloat).toFixed(2);
  return { score, repetition: +repetition.toFixed(2), spread, fixes, recency, safety, bloat: +bloat.toFixed(2) };
}
function isDurableLesson(text) {
  const t = String(text ?? "").toLowerCase().trim();
  if (!t)
    return false;
  const ENV = /(command not found|no such file|cannot find module|not installed|uninstalled|missing (binary|package|dependency)|permission denied|\beacces\b|\benoent\b|\beperm\b|connection refused|timed out|rate.?limit|quota|insufficient balance|unauthorized|401|403|invalid auth|credential|fresh.install|not configured)/;
  if (ENV.test(t))
    return false;
  if (/(is broken|does ?n'?t work|cannot use|unavailable|not supported)/.test(t))
    return false;
  return true;
}
function isValidSkillName(name) {
  const n = String(name ?? "").trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(n) || n.length > 64)
    return false;
  const ANTI = [/^fix-/, /^debug-/, /^audit-/, /^patch-/, /-to-/, /\d{3,}/, /v?\d+[._]\d+/, /\berror\b|\bexception\b/, /-today$|-now$|-temp$|-wip$/];
  return !ANTI.some((p) => p.test(n));
}
function multiInstanceSupport(topic, signals, minInstances = 2) {
  const GENERIC = new Set(["recovering", "recover", "failure", "failures", "fails", "failed", "failing", "when", "never", "running", "using", "with", "from", "this", "that", "command", "commands", "error", "errors", "instead", "blind", "retrying", "workflow", "recurring", "skill", "use", "then", "same", "exact", "exit", "code"]);
  const tok = (s) => new Set(String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !GENERIC.has(w)));
  const topicTokens = tok(topic);
  let best = null;
  for (const s of signals || []) {
    const lt = tok(s.label);
    let inter = 0;
    for (const w of topicTokens)
      if (lt.has(w))
        inter++;
    if (inter < 1)
      continue;
    const instances = Math.max(s.count || 0, s.convs || 0);
    if (!best || instances > best.instances || instances === best.instances && inter > best.overlap)
      best = { label: s.label, instances, overlap: inter };
  }
  if (!best)
    return { ok: false, reason: "no grounded evidence signal matches this skill's topic — refusing ungrounded create" };
  if (best.instances < minInstances)
    return { ok: false, matched: best.label, instances: best.instances, reason: `single-instance evidence: strongest topical signal "${best.label}" was observed ${best.instances}× — need >=${minInstances} distinct instances before a CREATE` };
  return { ok: true, matched: best.label, instances: best.instances, reason: `grounded: "${best.label}" observed ${best.instances}×` };
}
function buildCrossConversationEvidence(rows) {
  const convs = new Set(rows.map((r) => String(r.conv ?? "?"))).size;
  const allRepairs = detectRepairChains(rows), allAps = detectAntiPatterns(rows);
  const repairs = allRepairs.filter((r) => isDurableLesson(r.errClass));
  const aps = allAps.filter((p) => isDurableLesson(p.errClass));
  const rejected = [];
  for (const r of allRepairs)
    if (!isDurableLesson(r.errClass))
      rejected.push({ item: `${r.trigger} (${r.errClass})`, reason: "environment/transient — negative filter" });
  for (const p of allAps)
    if (!isDurableLesson(p.errClass))
      rejected.push({ item: `${p.step} (${p.errClass})`, reason: "environment/transient — negative filter" });
  const tmpl = new Map;
  const highSignal = new Map;
  for (const r of rows)
    if (r.tmpl) {
      tmpl.set(r.tmpl, (tmpl.get(r.tmpl) || 0) + 1);
      if (HIGH_SIGNAL_TOOL_SET.has(r.tool)) {
        const e = highSignal.get(r.tmpl) || { count: 0, failures: 0, convs: new Set, tool: r.tool };
        e.count++;
        if (r.ok === false)
          e.failures++;
        e.convs.add(String(r.conv ?? "?"));
        highSignal.set(r.tmpl, e);
      }
    }
  const topTmpl = [...tmpl.entries()].filter(([t, c]) => c >= 3 && !PRIMITIVE.test(t)).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const high = [...highSignal.entries()].sort((a, b) => b[1].failures - a[1].failures || b[1].count - a[1].count).slice(0, 10);
  const L = [`CROSS-CONVERSATION EVIDENCE (aggregated over ${convs} sessions of real tool-use):`];
  for (const r of repairs.slice(0, 12)) {
    L.push(`- recovered failure: "${r.trigger}" failed (${r.errClass}) → fixed via "${r.fixStep}" → re-ran "${r.verifyStep}" [${r.count}× across ${r.convs} sessions]`);
    for (const w of r.worked ?? []) {
      const sym = w.errMsg ? ` symptom: ${w.errMsg.replace(/\s+/g, " ").slice(0, 160)}` : "";
      const fx = w.fix ? ` | fix: ${w.fix.replace(/\s+/g, " ").slice(0, 200)}` : "";
      if (sym || fx)
        L.push(`    · example —${sym}${fx}`);
    }
  }
  for (const p of aps.slice(0, 8))
    L.push(`- recurring failure (no clean fix yet): "${p.step}" — ${p.errClass} [${p.fails}×]`);
  for (const [t, c] of topTmpl)
    L.push(`- recurring workflow: ${t} [${c}×]`);
  for (const [t, e] of high)
    L.push(`- high-signal receipt workflow: ${t} [${e.count}× across ${e.convs.size} session${e.convs.size === 1 ? "" : "s"}${e.failures ? `, ${e.failures} failed/partial receipt${e.failures === 1 ? "" : "s"}` : ""}]`);
  const signals = [
    ...repairs.map((r) => ({ label: `${r.trigger} ${r.errClass} ${r.fixStep}`, kind: "repair", count: r.count, convs: r.convs })),
    ...aps.map((p) => ({ label: `${p.step} ${p.errClass}`, kind: "antipattern", count: p.fails, convs: p.convs })),
    ...topTmpl.map(([t, c]) => ({ label: t, kind: "template", count: c, convs: 1 })),
    ...high.map(([t, e]) => ({ label: t, kind: "high-signal", count: e.count, convs: e.convs.size }))
  ];
  return { digest: L.join(`
`), convs, items: repairs.length + aps.length + topTmpl.length + high.length, rejected, signals };
}
// mods/gate.ts
import { join as join2 } from "node:path";
function dedupCheck(name, description, dirs = [GLOBAL_SKILLS]) {
  const words = new Set(description.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const overlapWith = (desc) => {
    const dw = new Set(desc.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
    let inter = 0;
    for (const w of words)
      if (dw.has(w))
        inter++;
    return words.size ? inter / words.size : 0;
  };
  let worst = { name: "", overlap: 0 };
  for (const dir of dirs) {
    for (const n of listSkillNames(dir)) {
      if (n === name)
        return { dup: true, reason: `skill '${n}' already exists — patch it, don't duplicate`, name: n, overlap: 1 };
      const overlap = overlapWith(skillDesc(dir, n));
      if (overlap > worst.overlap)
        worst = { name: n, overlap };
    }
    const retiredRoot = join2(dir, "_retired");
    for (const rn of listSkillNames(retiredRoot)) {
      const base = rn.replace(/-\d{4}-\d{2}-\d{2}T[\dZ.-]+$/, "");
      if (base === name)
        return { dup: true, reason: `retired skill '${base}' exists in quarantine (${retiredRoot}/${rn}) — restore it or absorb instead of recreating`, name: base, overlap: 1 };
      const overlap = overlapWith(skillDesc(retiredRoot, rn));
      if (overlap > 0.6)
        return { dup: true, reason: `>60% description overlap with RETIRED skill '${base}' (${retiredRoot}/${rn}) — quarantined: restore/absorb instead of recreating a sibling`, name: base, overlap };
    }
  }
  return { dup: worst.overlap > 0.6, reason: worst.overlap > 0.6 ? `>60% description overlap with '${worst.name}' — patch/absorb instead` : "", name: worst.name, overlap: worst.overlap };
}
function candidateName(c) {
  const key = c.key.replace(/<[^>]+>/g, "").replace(/[(){}]/g, "").replace(/→/g, " to ");
  const STOP = new Set(["str", "path", "url", "read", "write", "edit", "bash", "sh", "cd", "ls", "cat", "echo", "pwd", "true", "sleep", "mkdir", "amp"]);
  const seen = new Set;
  const words = key.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w) && !seen.has(w) && seen.add(w));
  const base = words.slice(0, 5).join("-") || (c.kind === "sequence" ? "recurring-workflow" : "recurring-command");
  const name = words.length >= 2 || /ing$/.test(base) ? base : `${base}-workflow`;
  return slug(name);
}
function candidateDescription(c) {
  return `Use when repeating the observed ${c.kind} workflow '${c.key}' (${c.count} reps across ${c.convs} conversation${c.convs === 1 ? "" : "s"}${c.fixes ? `, ${c.fixes} error-recovery reps` : ""}); trigger on similar repeated tool-use, validation, or repair loops.`;
}
function draftSkillFromCandidate(c) {
  const name = candidateName(c);
  const description = candidateDescription(c);
  const parts = c.key.split(/\s*→\s*/).filter(Boolean);
  const steps = parts.length > 1 ? parts.map((s, i) => `${i + 1}. **${s}** — perform this step intentionally; adapt paths/args to the current repo/session.`).join(`
`) : `1. **${c.key}** — run the recurring command/template only after confirming the current repo/session context.
2. Inspect the output and capture the success/failure receipt.
3. If it fails, patch the root cause and rerun the same validation once.`;
  const recovery = c.fixes ? `
## Failure recovery
This pattern includes ${c.fixes} observed error-recovery rep${c.fixes === 1 ? "" : "s"}. Preserve the recovery loop:

1. Treat the first failure as diagnostic signal, not random noise.
2. Inspect the concrete error output.
3. Patch the smallest root cause.
4. Rerun the same validation command/tool before claiming fixed.
` : "";
  const body = `# ${name}

This skill was drafted from repeated real tool-use captured by muscle-memory. Treat it as a starting playbook: refine after the next successful/failed use.

## Trigger
${description}

## Observed pattern
\`\`\`text
${c.key}
\`\`\`

- Kind: ${c.kind}
- Repetitions: ${c.count}
- Conversation spread: ${c.convs}
- Error-recovery reps: ${c.fixes}
- Maturity score: ${c.maturity}

## Procedure
${steps}${recovery}
## Verification
- Capture the concrete command/tool output that proves the workflow succeeded.
- If this touches files, inspect diff/status before claiming done.
- If this changes a package/mod, bundle/import or run its package-local test.
- If this is visual/frontend work, require visual receipts plus computed boxes, not presence-only proof.

## Anti-bloat / refinement rule
- Patch this skill in place when a step is too vague, stale, or misses a failure mode.
- Do not create a duplicate skill for the same workflow; merge or absorb instead.
- Retire/quarantine it if future usage shows it does not earn its context.
`;
  return { name, description, body };
}
function findCandidate(candidateKey) {
  const { candidates } = detect(loadExperience());
  if (!candidateKey)
    return candidates[0];
  return candidates.find((c) => c.key === candidateKey || c.key.includes(candidateKey));
}
function repairForCandidate(c) {
  if (!c.fixes)
    return;
  const first = c.key.split(/\s*→\s*/)[0];
  return detectRepairChains(loadExperience()).find((r) => r.trigger === first || r.verifyStep === first || c.key.includes(r.trigger) || c.key.includes(r.verifyStep));
}
function lintSkillDraft(d, opts = {}) {
  const issues = [];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.name))
    issues.push("name must be lowercase-hyphen slug");
  if (d.name.length > 64)
    issues.push("name > 64 chars");
  if (!d.description || d.description.length < 20)
    issues.push("description too short");
  if (!/\b(use when|trigger|when )/i.test(d.description))
    issues.push("description must state WHEN to use (trigger phrase)");
  if (d.description.length > 700)
    issues.push("description > 700 chars (keep routing lean)");
  const approxTokens = Math.ceil(d.body.length / 4);
  if (approxTokens > 5000)
    issues.push(`body ~${approxTokens} tokens > 5000 (decompose into references/)`);
  if (!/##\s+procedure/i.test(d.body))
    issues.push("body missing ## Procedure");
  if (!/##\s+verification/i.test(d.body))
    issues.push("body missing ## Verification");
  if (opts.needsPitfalls && !/##\s+(pitfalls|failure recovery)/i.test(d.body))
    issues.push("fix-pattern skill must include ## Pitfalls / Failure recovery");
  return { ok: issues.length === 0, issues };
}
function sotaQualityGaps(d) {
  const gaps = [];
  const b = d.body;
  const lc = b.toLowerCase();
  const procedural = /##\s+(procedure|steps|workflow|method|pitfalls|failure recovery|recipe|how to)/i.test(b);
  if (procedural && (b.match(/```/g) || []).length < 2)
    gaps.push("CONCRETENESS: add real fenced code/command examples (show the exact correct fix, never hand-wave)");
  if (/##\s+pitfalls/i.test(b)) {
    const tells = (lc.match(/\btell\b|\bsymptom\b|at-a-glance|the signal|you'll see|gives it away/g) || []).length;
    const pitfalls = (b.split(/##\s+pitfalls/i)[1] || "").match(/^\s*(?:[-*]|\d+\.|###)\s/gm)?.length || 0;
    if (pitfalls >= 2 && tells < Math.min(2, pitfalls))
      gaps.push("DIAGNOSTIC TELLS: give each Pitfall a one-line TELL — the at-a-glance symptom/error-string that identifies that failure class");
  }
  const destructive = /\b(rm\s+-rf?|reset\s+--hard|force[- ]?push|git\s+push\s+--force|--force\b|drop\s+(table|database)|db[: ]?migrate|delete\s+from|truncate\b|mv\s+[^\n]*\/)/i.test(b);
  const safeFirst = /\b(back\s?up|snapshot|stash|dry[- ]?run|--dry-run|--check|copy first|inspect|diff before|reversible|safety net|to a branch|tag first)\b/i.test(lc);
  if (destructive && !safeFirst)
    gaps.push("SAFE-FIRST: add an explicit non-destructive safety net (backup/snapshot/dry-run/inspect) as the first step before any destructive command");
  const idMatches = b.match(/\b(agent-[a-f0-9-]{8,}|[A-Za-z0-9_]+\.com\/[A-Za-z0-9_./-]+|sk-[A-Za-z0-9]{6,})\b/g) || [];
  if (idMatches.length >= 3)
    gaps.push("GENERALITY: this reads as a one-off (hardcoded ids/paths) — generalize to a class-level rule and demote the specifics to a worked example");
  return gaps;
}
function auditSkills(skills) {
  const flagged = [];
  const gapCounts = {};
  for (const s of skills) {
    const gaps = sotaQualityGaps({ name: s.name, description: s.description ?? "Use when relevant", body: s.body });
    if (gaps.length) {
      flagged.push({ name: s.name, gaps });
      for (const g of gaps) {
        const k = g.split(":")[0];
        gapCounts[k] = (gapCounts[k] || 0) + 1;
      }
    }
  }
  return { total: skills.length, clean: skills.length - flagged.length, flagged, gapCounts };
}
function crossShelfDuplicates(entries) {
  const byName = new Map;
  for (const e of entries) {
    const a = byName.get(e.name) || [];
    a.push({ shelf: e.shelf, body: e.body });
    byName.set(e.name, a);
  }
  const out = [];
  const norm = (b) => hash(b.replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ").trim());
  for (const [name, copies] of byName) {
    if (copies.length < 2)
      continue;
    const divergent = new Set(copies.map((c) => norm(c.body))).size > 1;
    out.push({ name, shelves: [...new Set(copies.map((c) => c.shelf))], divergent });
  }
  return out;
}
function effectivenessVerdict(input) {
  if (input.staleAntiPattern)
    return { verdict: "retire_candidate", reason: "the failure it targeted keeps recurring — skill isn't working" };
  if (input.uses === 0 && input.ageDays > 14)
    return { verdict: "retire_candidate", reason: `0 uses in ${input.ageDays}d — not earning its context` };
  if (input.uses === 0)
    return { verdict: "review", reason: "no observed use yet — keep if newly created" };
  return { verdict: "keep", reason: `used ${input.uses}×` };
}
function renderWorkedExamples(worked) {
  if (!worked || !worked.length)
    return "";
  const items = worked.map((w) => {
    const sym = w.errMsg ? `**symptom:** \`${w.errMsg.replace(/\s+/g, " ").slice(0, 180)}\`` : "**symptom:** (captured)";
    const fix = w.fix ? `
  \`\`\`diff
${w.fix.split(`
`).slice(0, 10).map((l) => "  " + l).join(`
`)}
  \`\`\`` : "";
    return `- ${sym}${fix}`;
  }).join(`
`);
  return `

## Worked examples (real, redacted)
Real symptom→fix pairs captured across sessions (credentials/paths scrubbed):
${items}
`;
}
function buildDiffFragment(args) {
  const oldS = typeof args?.old_string === "string" ? args.old_string : "";
  const newS = typeof args?.new_string === "string" ? args.new_string : typeof args?.content === "string" ? args.content : "";
  if (!oldS && !newS)
    return;
  const o = redactFragment(oldS, 6, 200);
  const n = redactFragment(newS, 6, 200);
  const lines = [];
  for (const l of o ? o.split(`
`) : [])
    lines.push(`- ${l}`);
  for (const l of n ? n.split(`
`) : [])
    lines.push(`+ ${l}`);
  const out = lines.join(`
`).slice(0, 400);
  return out || undefined;
}
function draftWithRepair(c, repair) {
  if (!repair)
    return draftSkillFromCandidate(c);
  const workedMd = renderWorkedExamples(repair.worked);
  const errTag = repair.errClass && repair.errClass !== "inferred-failure" ? repair.errClass : "";
  const s = repair.convs === 1 ? "" : "s";
  if (repair.generalized) {
    const name2 = slug(`recovering-from-${repair.trigger}`).slice(0, 64);
    const exs = ((repair.examples?.length) ? repair.examples : [repair.verifyStep]).slice(0, 4);
    const exList = exs.map((e) => `\`${e}\``).join(", ");
    const worked = exs.map((e) => `- \`${e}\` failed${errTag ? ` (\`${errTag}\`)` : ""} → edit the **source** to fix the cause → re-ran \`${e}\` → PASS`).join(`
`);
    const description2 = `Use when a test or script run fails (seen with ${exList}) — recover by editing the source and re-running the same command, never blind-retrying. Triggers on any fix-then-recheck loop, in any language.`;
    const body2 = `# ${name2}

A recovery discipline distilled from ${repair.count} real fix-then-recheck loops across ${repair.convs} session${s} (${exList}). The command differs by language; the discipline does not.

## When to use
- A test/script run fails (assertion, traceback, or wrong output) and you need to recover.
- You're about to re-run a failed command unchanged, hoping it passes.
- Any edit→re-run loop, regardless of language.

## Procedure (decision guide)
1. Re-run the exact failing command and READ the concrete error — assertion, traceback, or a wrong printed value.
2. Do NOT blind-retry. Edit the **source** (not the test) for that specific error — smallest change first.
3. Re-run the SAME command; confirm it passes (exit 0).
4. Run it once more to rule out a flaky / state-dependent pass.

## Worked examples (observed)
${worked}

## Pitfalls (symptom → fix)
- Re-running a failed command unchanged → it stays red; nothing passes until the source changes.
- Exit code 0 but wrong output (e.g. \`go run\` prints the wrong value) → the failure is in stdout, not the exit code; assert on the value, not just the exit.
- Editing the test to force a green → fix the code the test exercises, not the assertion.

## Verification
- [ ] The failure reproduced before the fix (you saw the real error).
- [ ] The same command passes after the fix (exit 0).
- [ ] A second independent run also passes.`;
    return { name: name2, description: description2, body: body2 + workedMd };
  }
  const verb = slug(repair.verifyStep) || slug(c.key) || "a-recurring-check";
  const name = slug(`recovering-from-${verb}-failures`).slice(0, 64);
  const description = `Use when \`${repair.verifyStep}\` fails${errTag ? ` (\`${errTag}\`)` : ""} — recover by applying \`${repair.fixStep}\` then re-running \`${repair.verifyStep}\`, never blind-retrying. Observed ${repair.count}× across ${repair.convs} session${s}.`;
  const body = `# ${name}

A recovery discipline distilled from ${repair.count} real \`${repair.verifyStep}\` fix-then-recheck loop${repair.count === 1 ? "" : "s"} across ${repair.convs} session${s}. The fix is known — apply it instead of re-deriving.

## When to use
- \`${repair.verifyStep}\` fails${errTag ? ` with \`${errTag}\`` : ""}, or any check→fix→recheck loop on it.
- You're about to re-run \`${repair.verifyStep}\` unchanged after it failed.

## Procedure (decision guide)
1. Run \`${repair.verifyStep}\` and read the concrete error${errTag ? ` (expect \`${errTag}\`)` : ""}.
2. Do NOT blind-retry. Apply the known fix: \`${repair.fixStep}\` — addressing that specific error.
3. Re-run \`${repair.verifyStep}\` to confirm it passes (exit 0).
4. Run once more to rule out a flaky pass.

## Worked example (observed)
- \`${repair.verifyStep}\` failed${errTag ? ` (\`${errTag}\`)` : ""} → \`${repair.fixStep}\` → re-ran \`${repair.verifyStep}\` → PASS  (${repair.count}× / ${repair.convs} session${s})

## Pitfalls (symptom → fix)
- Re-running \`${repair.verifyStep}\` unchanged → stays red; it won't pass until \`${repair.fixStep}\` is applied.
- Treating the first failure as noise → it's signal; the fix is known from ${repair.count} prior recoveries.

## Verification
- [ ] \`${repair.verifyStep}\` failed before the fix (real error seen).
- [ ] \`${repair.verifyStep}\` passes after \`${repair.fixStep}\` (exit 0).
- [ ] A second run also passes.`;
  return { name, description, body: body + workedMd };
}
// mods/autopilot.ts
import { mkdirSync as mkdirSync4, readFileSync as readFileSync4, existsSync as existsSync4, writeFileSync as writeFileSync4, renameSync as renameSync3 } from "node:fs";
import { join as join5 } from "node:path";

// mods/publish.ts
import { mkdirSync as mkdirSync2, readFileSync as readFileSync2, existsSync as existsSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join3 } from "node:path";
import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";
var PUBLISH_SECRET_RES = [
  /\bsk-ant-[A-Za-z0-9_-]{12,}\b/,
  /\bsk-[A-Za-z0-9]{16,}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bAIza[A-Za-z0-9_-]{20,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b[A-Z][A-Z0-9_]*_(?:API_)?KEY\s*[:=]\s*['"][A-Za-z0-9_-]{12,}['"]/
];
function publishHardBlocks(body) {
  const out = [];
  for (const re of PUBLISH_SECRET_RES) {
    const m = body.match(re);
    if (m)
      out.push(`secret/credential value present: ${m[0].slice(0, 14)}…`);
  }
  return out;
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function gitConfigValue(key) {
  const envKey = key === "user.name" ? "MM_TEST_GIT_USER_NAME" : key === "user.email" ? "MM_TEST_GIT_USER_EMAIL" : "";
  if (envKey && process.env[envKey])
    return process.env[envKey] || "";
  try {
    return execFileSync("git", ["config", "--get", key], { encoding: "utf8", timeout: 1500, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}
function runtimeUserIdentifiers() {
  const vals = new Set;
  const add = (v) => {
    const s = String(v || "").trim();
    if (s.length >= 3 && !/^(root|user|admin|runner|node|git|local)$/i.test(s))
      vals.add(s);
  };
  try {
    add(process.env.MM_TEST_USERINFO_USERNAME || userInfo().username);
  } catch {}
  const gitName = gitConfigValue("user.name");
  const gitEmail = gitConfigValue("user.email");
  add(gitName);
  add(gitEmail);
  if (gitEmail.includes("@"))
    add(gitEmail.split("@")[0]);
  return [...vals].sort((a, b) => b.length - a.length);
}
function sanitizeForPublish(body) {
  const replacements = [];
  let s = body;
  const sub = (kind, re, to) => {
    s = s.replace(re, (m) => {
      if (!replacements.some((r) => r.from === m))
        replacements.push({ kind, from: m, to });
      return to;
    });
  };
  sub("local-path", /\/Users\/[A-Za-z0-9._-]+/g, "<local path>");
  sub("agent-memfs", /(?:~\/)?\.letta\/(?:lc-local-backend\/memfs\/)?agents?\/[A-Za-z0-9._/-]+/g, "<agent memfs>");
  sub("agent-id", /\bagent-[a-f0-9]{6,}(?:-[a-f0-9]+)+\b/g, "<agent id>");
  sub("user", /\b(?:localuser|private-user|chan2saucy|adrianchan|adrian chan)\b/gi, "<user>");
  for (const id of runtimeUserIdentifiers())
    sub("user", new RegExp(`\\b${escapeRegExp(id)}\\b`, "gi"), "<user>");
  sub("project", /\b(?:ProjectX|ExampleCorp)\b/g, "<project>");
  sub("provider-env", /\b(?:ZAI|Z_AI|OPENAI|ANTHROPIC|GLM|MORPH|KIMI|MINIMAX|GEMINI|XAI)_API_KEY\b/g, "PROVIDER_API_KEY");
  return { sanitized: s, replacements };
}
function publishabilityScore(skill) {
  const b = skill.body;
  const issues = [];
  const hardBlocks = publishHardBlocks(b);
  const pen = (axis, penalty, detail) => issues.push({ axis, penalty, detail });
  const { replacements } = sanitizeForPublish(b);
  const kinds = new Set(replacements.map((r) => r.kind));
  for (const k of kinds)
    pen("portability", 8, `${k} present (sanitize before publish): e.g. ${replacements.find((r) => r.kind === k).from.slice(0, 28)}`);
  for (const g of sotaQualityGaps(skill))
    pen("quality", 10, g.split(":")[0]);
  for (const [re, label] of [[/##\s+when to use/i, "When to use"], [/##\s+procedure/i, "Procedure"], [/##\s+pitfalls|##\s+failure/i, "Pitfalls"], [/##\s+verification/i, "Verification"]])
    if (!re.test(b))
      pen("quality", 8, `missing ## ${label}`);
  if (!skill.description || skill.description.length < 30)
    pen("quality", 6, "description too thin for a shared shelf");
  if (/GENERALITY/.test(sotaQualityGaps(skill).join(" ")))
    pen("reusability", 10, "reads as a one-off (hardcoded specifics)");
  if (/(reset --hard|force[- ]?push|rm -rf|drop (table|database)|--force)/i.test(b) && !/(when not to use|do not use|scope|only when|caution)/i.test(b))
    pen("reusability", 5, "risky ops without a when-not-to-use / scope guard");
  if (!/(update|patch|retire|prune|absorb|anti-bloat|refine this skill|earn its context)/i.test(b))
    pen("compounding", 5, "no update/retire criteria (won't compound across agents)");
  let score = Math.max(0, 100 - issues.reduce((a, i) => a + i.penalty, 0));
  if (hardBlocks.length)
    score = Math.min(score, 15);
  const sanitizableLeft = kinds.size > 0;
  const recommended = hardBlocks.length ? "block" : score >= 80 && !sanitizableLeft ? "publish" : "stage-sanitized";
  return { score, hardBlocks, issues, recommended };
}
function publishPlan(skill) {
  const sc = publishabilityScore(skill);
  const san = sanitizeForPublish(skill.body);
  return {
    skill: skill.name,
    currentShelf: skill.shelf ?? "agent",
    recommendedShelf: sc.recommended === "block" ? "(blocked — keep agent-local)" : "Custom Skills",
    publishability: sc.score,
    recommended: sc.recommended,
    hardBlocks: sc.hardBlocks,
    issues: sc.issues,
    sanitizedPreview: san.sanitized,
    replacements: san.replacements
  };
}
function publishTier(plan) {
  if (plan.hardBlocks.length)
    return "blocked";
  const sanitizable = plan.replacements.length > 0;
  if (plan.publishability >= 85 && !sanitizable)
    return "marketplace-candidate";
  if (plan.publishability >= 65)
    return "team-shareable";
  return "agent-local";
}
function publishMetadata(plan, tier) {
  return { origin: "muscle-memory", publishability_score: plan.publishability, tier, privacy: plan.replacements.length ? "sanitized" : "as-is", published_at: new Date().toISOString().slice(0, 10) };
}
function findSimilarSkills(name, description, existing) {
  const toks = (s) => new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3 && !SEARCH_STOP.has(t)));
  const nT = toks(`${name} ${description}`);
  const out = [];
  for (const e of existing) {
    if (e.name === name) {
      out.push({ name: e.name, why: "exact name match — update it, don't duplicate" });
      continue;
    }
    const eT = toks(`${e.name} ${e.description}`);
    let shared = 0;
    for (const t of nT)
      if (eT.has(t))
        shared++;
    const overlap = shared / Math.max(1, Math.min(nT.size, eT.size));
    if (overlap >= 0.5 && shared >= 3)
      out.push({ name: e.name, why: `${Math.round(overlap * 100)}% topic overlap — consider merge/update` });
  }
  return out.slice(0, 3);
}
function stageSanitizedPublish(skill) {
  const plan = publishPlan(skill);
  const tier = publishTier(plan);
  if (plan.hardBlocks.length)
    return { staged: false, dir: "", plan, tier, reason: `blocked: ${plan.hardBlocks.join("; ")}` };
  const dir = join3(PUBLISH_STAGED_DIR, slug(skill.name));
  try {
    mkdirSync2(dir, { recursive: true });
  } catch {}
  const meta = publishMetadata(plan, tier);
  const body = /^---\n[\s\S]*?\n---/.test(plan.sanitizedPreview) ? plan.sanitizedPreview.replace(/^---\n([\s\S]*?)\n---/, (_m, fm) => `---
${fm.replace(/\n+$/, "")}
${Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join(`
`)}
---`) : `---
name: ${skill.name}
description: ${skill.description}
${Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join(`
`)}
---

${plan.sanitizedPreview}`;
  writeFileSync2(join3(dir, "SKILL.md"), body);
  writeFileSync2(join3(dir, "PUBLISH-PLAN.json"), JSON.stringify({ skill: skill.name, tier, publishability: plan.publishability, recommended: plan.recommended, issues: plan.issues, replacements: plan.replacements, metadata: meta, staged_at: Date.now() }, null, 2));
  return { staged: true, dir, plan, tier };
}
function approveStagedPublish(name, globalDir) {
  const staged = join3(PUBLISH_STAGED_DIR, slug(name), "SKILL.md");
  if (!existsSync2(staged))
    return { published: false, reason: "no staged copy — run `publish stage <skill>` first" };
  const body = readFileSync2(staged, "utf8");
  const hb = publishHardBlocks(body);
  if (hb.length)
    return { published: false, reason: `hard block on staged copy: ${hb.join("; ")}` };
  const sec = scanSkillContent(body);
  if (!sec.ok)
    return { published: false, reason: `security: ${sec.issues.join("; ")}` };
  const dst = join3(globalDir, slug(name));
  try {
    mkdirSync2(dst, { recursive: true });
  } catch {}
  writeFileSync2(join3(dst, "SKILL.md"), body);
  return { published: true, path: join3(dst, "SKILL.md") };
}
function publishVisibilityReceipt(name, globalDir) {
  const p = join3(globalDir, slug(name), "SKILL.md");
  return { exists: existsSync2(p), path: p, reloadHint: "run /reload (or restart the agent) so the skill index surfaces the new Custom Skill" };
}
function liveSkillVisible(name, agentId) {
  const onDisk = "on disk on the Custom Skills shelf — run /reload to load it into the live skill index";
  if (!agentId)
    return { checked: false, visible: false, note: onDisk };
  try {
    const out = execFileSync("letta", ["skills", "list", "--agent", agentId], { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "ignore"] });
    const visible = out.split(/\r?\n/).some((l) => l.includes(name));
    return { checked: true, visible, note: visible ? "✓ confirmed live: the agent's skill index now lists it" : `${onDisk} (not in the live index yet)` };
  } catch {
    return { checked: false, visible: false, note: `${onDisk} (live index query unavailable)` };
  }
}
function catalogPrivacyScan(content) {
  const issues = [];
  const body = content.replace(/^---[\s\S]*?\n---\s*\n?/, "");
  const sec = scanSkillContent(content);
  if (!sec.ok)
    issues.push(...sec.issues.map((i) => `security: ${i}`));
  if (/\/Users\/[A-Za-z0-9._-]+\//.test(content) || /\/home\/[A-Za-z0-9._-]+\//.test(content))
    issues.push("private absolute user path");
  if (/lc-local-backend/.test(content) || /~\/\.letta\/agents\//.test(content) || /~\/\.agents\/agents\//.test(content))
    issues.push("local harness path");
  if (/\b(?:private-store\.myshopify\.com|examplecorp|example-host|agent-71b0883e|localuser|private-user)\b/i.test(content))
    issues.push("private org/user/agent identifier");
  if (/references\/evidence|receipt json|final-gate-result\.json/i.test(body) && /\/Users\//.test(content))
    issues.push("private evidence reference");
  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}
function publishSkillToCatalog(name, ctx) {
  const nm = slug(name);
  if (!nm)
    throw new Error("name required");
  const d = scanDirs(ctx).find((x) => existsSync2(join3(x, nm, "SKILL.md")));
  if (!d)
    throw new Error(`no active skill '${nm}'`);
  const src = join3(d, nm, "SKILL.md");
  if (!existsSync2(src))
    throw new Error(`no SKILL.md for '${nm}'`);
  const content = readFileSync2(src, "utf8");
  const desc = (content.match(/^description:\s*(.+)$/im)?.[1] || "").trim();
  const body = content.replace(/^---[\s\S]*?\n---\s*\n?/, "");
  const lint = lintSkillDraft({ name: nm, description: desc, body });
  if (!lint.ok)
    throw new Error(`linter blocked: ${lint.issues.join("; ")}`);
  const priv = catalogPrivacyScan(content);
  if (!priv.ok)
    throw new Error(`privacy blocked: ${priv.issues.join("; ")}`);
  const dstDir = join3(GLOBAL_SKILLS_DIR, nm);
  mkdirSync2(dstDir, { recursive: true });
  const published = content.includes(MM_TAG) ? content : content + `
<!-- ${MM_TAG}: published ${new Date().toISOString().slice(0, 10)}; catalog=global -->
`;
  writeFileSync2(join3(dstDir, "SKILL.md"), published);
  appendUiEvent({ phase: "skill_published", summary: `published '${nm}' to custom skill catalog`, skill: nm, action: "publish", route: "global-catalog" });
  appendMeshFeed({ type: "skill_published", skill: nm, route: "PUBLISH", signals: 0 });
  writeUiState({ phase: "done", last: `published '${nm}' to catalog`, route: "PUBLISH · catalog" });
  return join3(dstDir, "SKILL.md");
}

// mods/lifecycle.ts
import { mkdirSync as mkdirSync3, readFileSync as readFileSync3, existsSync as existsSync3, writeFileSync as writeFileSync3, readdirSync as readdirSync2, renameSync as renameSync2 } from "node:fs";
import { join as join4 } from "node:path";
function managedSkillUsage(name, rows = loadRows()) {
  const n = slug(name);
  return rows.filter((r) => (r.tmpl || r.fp || "").toLowerCase().includes(`skill ${n}`)).length;
}
function curateManagedSkills(ctx) {
  const rows = loadRows();
  const dirs = scanDirs(ctx);
  const out = [];
  for (const d of dirs) {
    for (const n of listSkillNames(d)) {
      if (!isManaged(d, n))
        continue;
      const uses = managedSkillUsage(n, rows);
      let verdict = "keep";
      let reason = "managed skill has observed use or is newly created";
      if (uses === 0) {
        verdict = "review";
        reason = "no observed Skill-tool usage yet; keep if newly created, retire if stale";
      }
      out.push({ name: n, dir: d, uses, verdict, reason });
    }
  }
  return out.sort((a, b) => a.uses - b.uses || a.name.localeCompare(b.name));
}
function retireManagedSkill(name, reason, ctx, absorbedInto, restrictDirs) {
  const dirs = restrictDirs ?? scanDirs(ctx);
  const d = dirs.find((x) => existsSync3(join4(x, name, "SKILL.md")));
  if (!d)
    throw new Error(`no skill '${name}'`);
  if (!isManaged(d, name))
    throw new Error(`refusing to retire unmanaged skill '${name}'`);
  if (isPinned(name))
    throw new Error(`'${name}' is pinned — unpin first (pin protects from retire, not from patch)`);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const retiredRoot = join4(d, "_retired");
  mkdirSync3(retiredRoot, { recursive: true });
  const target = join4(retiredRoot, `${name}-${stamp}`);
  const forward = absorbedInto ? `absorbed_into: ${absorbedInto}
` : "";
  writeFileSync3(join4(d, name, "RETIRE-REASON.txt"), `${new Date().toISOString()}
${reason || "retired by muscle-memory curate"}
${forward}`);
  renameSync2(join4(d, name), target);
  const u = loadUsage();
  u[name] = { ...u[name] || {}, state: "archived", absorbedInto: absorbedInto || undefined };
  saveUsage(u);
  return target;
}
function retiredSkillBlocker(name, ctx) {
  const nm = slug(String(name || ""));
  if (!nm)
    return null;
  const usage = loadUsage();
  if (usage?.[nm]?.state === "archived") {
    return `skill '${nm}' is archived/retired; restore it before recreating or patch an existing replacement`;
  }
  for (const d of scanDirs(ctx)) {
    const retiredRoot = join4(d, "_retired");
    try {
      if (!existsSync3(retiredRoot))
        continue;
      const match = readdirSync2(retiredRoot).find((n) => n === nm || n.startsWith(`${nm}-`));
      if (match)
        return `skill '${nm}' is retired in ${retiredRoot}/${match}; restore it before recreating`;
    } catch {}
  }
  return null;
}
function runAutonomousPrune(ctx, opts = {}) {
  const maxRetire = Math.max(0, opts.maxRetire ?? 1);
  const usage = loadUsage();
  const now = Date.now();
  const retired = [];
  const retiredPaths = [];
  const flagged = [];
  const kept = [];
  for (const d of autonomousShelves(ctx)) {
    for (const n of listSkillNames(d)) {
      if (!isManaged(d, n)) {
        kept.push(n);
        continue;
      }
      const u = usage[n] || {};
      if (u.pinned) {
        kept.push(n);
        continue;
      }
      const uses = u.uses || 0;
      if (uses > 0 || u.lastActivity) {
        kept.push(n);
        continue;
      }
      const created = u.created || now;
      const ageDays = Math.floor((now - created) / 86400000);
      if (ageDays > 30 && retired.length < maxRetire) {
        const reason = `auto-prune: 0 uses in ${ageDays}d — not earning context (reversible quarantine)`;
        const target = retireManagedSkill(n, reason, ctx, undefined, [d]);
        retired.push(n);
        retiredPaths.push(target);
        appendUiEvent({ phase: "skill_retired", summary: `retired '${n}' (0 uses, ${ageDays}d) — reversible`, skill: n, action: "retire", route: "auto-prune" });
        appendMeshFeed({ type: "skill_retired", skill: n, route: "AUTO-PRUNE", signals: 0 });
      } else if (ageDays > 14) {
        flagged.push(n);
        appendUiEvent({ phase: "skill_review", summary: `review '${n}' (0 uses, ${ageDays}d)`, skill: n, action: "review", route: "auto-prune" });
      } else {
        kept.push(n);
      }
    }
  }
  if (retired.length)
    writeUiState({ phase: "done", last: `retired '${retired[0]}' — reversible`, route: "AUTO-PRUNE · live" });
  return { retired, retiredPaths, flagged, kept };
}
function aggregateTelemetry(spans) {
  return spans.reduce((a, s) => ({ calls: a.calls + 1, tokensIn: a.tokensIn + (s.tokensIn || 0), tokensOut: a.tokensOut + (s.tokensOut || 0), ms: a.ms + (s.ms || 0) }), { calls: 0, tokensIn: 0, tokensOut: 0, ms: 0 });
}
function buildRegistry(dirs) {
  const usage = loadUsage();
  const skills = [];
  for (const d of dirs)
    for (const n of listSkillNames(d)) {
      if (!isManaged(d, n))
        continue;
      const prov = (readSkill(d, n).match(/<!--\s*muscle-memory provenance:([^>]*)-->/)?.[1] || "").trim();
      const u = usage[n] || {};
      skills.push({ name: n, description: skillDesc(d, n), dir: d, provenance: prov, state: u.state || "active", pinned: !!u.pinned, uses: u.uses || 0, absorbedInto: u.absorbedInto });
    }
  return { generated: new Date().toISOString(), count: skills.length, skills: skills.sort((a, b) => a.name.localeCompare(b.name)) };
}
function curatorPass(managed) {
  const transitions = [];
  for (const m of managed) {
    const r = lifecycleTransition({ state: m.state, lastActivityDaysAgo: m.lastActivityDaysAgo, pinned: m.pinned });
    if (r.changed)
      transitions.push({ name: m.name, from: m.state || "active", to: r.state });
  }
  return { transitions };
}
function skillVerbs(body) {
  const out = new Set;
  const pat = body.match(/##\s*Observed pattern\s*```text\s*([\s\S]*?)```/i);
  if (pat)
    for (const seg of pat[1].split(/\s*→\s*|\n/)) {
      const t = seg.trim().toLowerCase();
      if (/^[a-z][a-z0-9 ._-]{1,23}$/.test(t) && !["text", "bash"].includes(t))
        out.add(t);
    }
  return [...out];
}
function specDrift(body, rows) {
  const verbs = skillVerbs(body);
  if (!verbs.length)
    return { drift: false, missing: [], verbs };
  const seen = new Set(rows.map((r) => stepSig(r).toLowerCase()));
  const seenArr = [...seen];
  const missing = verbs.filter((v) => !seenArr.some((s) => s === v || s.includes(v) || v.includes(s)));
  return { drift: missing.length === verbs.length, missing, verbs };
}
var CURATOR = { STALE_DAYS: 30, ARCHIVE_DAYS: 90, IDLE_HOURS: 2 };
function lifecycleTransition(input) {
  const state = input.state || "active";
  if (input.pinned)
    return { state, changed: false };
  const d = input.lastActivityDaysAgo;
  if (d >= CURATOR.ARCHIVE_DAYS && state !== "archived")
    return { state: "archived", changed: true };
  if (d >= CURATOR.STALE_DAYS && state === "active")
    return { state: "stale", changed: true };
  if (d < CURATOR.STALE_DAYS && state === "stale")
    return { state: "active", changed: true };
  return { state, changed: false };
}
function loadUsage() {
  try {
    return existsSync3(USAGE_PATH) ? JSON.parse(readFileSync3(USAGE_PATH, "utf8")) : {};
  } catch {
    return {};
  }
}
function saveUsage(u) {
  try {
    ensureDir();
    writeFileSync3(USAGE_PATH, JSON.stringify(u, null, 2));
  } catch {}
}
function bumpUsage(name) {
  const u = loadUsage();
  const r = u[name] || { created: Date.now(), state: "active" };
  r.uses = (r.uses || 0) + 1;
  r.lastActivity = Date.now();
  if (r.state === "stale" || r.state === "archived")
    r.state = "active";
  u[name] = r;
  saveUsage(u);
}
function setPinned(name, pinned) {
  const u = loadUsage();
  u[name] = { ...u[name] || { created: Date.now() }, pinned };
  saveUsage(u);
}
function isPinned(name) {
  return !!loadUsage()[name]?.pinned;
}
function restoreManagedSkill(name, ctx) {
  const dirs = scanDirs(ctx);
  for (const d of dirs) {
    const retiredRoot = join4(d, "_retired");
    if (!existsSync3(retiredRoot))
      continue;
    const matches = readdirSync2(retiredRoot).filter((n) => n === name || n.startsWith(`${name}-`)).sort().reverse();
    if (matches.length) {
      if (existsSync3(join4(d, name, "SKILL.md")))
        throw new Error(`'${name}' already active`);
      renameSync2(join4(retiredRoot, matches[0]), join4(d, name));
      const u = loadUsage();
      u[name] = { ...u[name] || {}, state: "active", lastActivity: Date.now() };
      saveUsage(u);
      return join4(d, name);
    }
  }
  throw new Error(`no retired skill '${name}' to restore`);
}
function coverageMap(rows, dirs) {
  const ev = buildCrossConversationEvidence(rows);
  const out = [];
  for (const r of detectRepairChains(rows).filter((x) => isDurableLesson(x.errClass))) {
    const hits = searchSkills(dirs, `${r.trigger} ${r.fixStep} ${r.errClass}`, 4);
    const tgt = pickUpdateTarget(hits, 18);
    const overCovered = hits.filter((h) => h.matched >= 2).length >= 2;
    out.push({ domain: r.trigger, status: tgt ? overCovered ? "over-covered" : "covered" : "uncovered", skill: tgt?.name, signals: r.count });
  }
  for (const rej of ev.rejected)
    out.push({ domain: rej.item, status: "noise", signals: 0 });
  return out;
}
function churnSignal(i) {
  if (i.reverted)
    return { verdict: "blocked", reason: "reverted — blocked from auto-regeneration unless new evidence overrides the old rejection" };
  if (i.patches >= 5 && i.ageDays <= 2)
    return { verdict: "needs-verification", reason: `patched ${i.patches}× in ${i.ageDays}d — unstable; verify before trusting` };
  if (i.uses === 0 && i.ageDays > 7)
    return { verdict: "g-league", reason: `created but never invoked in ${i.ageDays}d — bench it` };
  if (i.uses > 0 && i.patches <= 1)
    return { verdict: "stable-veteran", reason: `used ${i.uses}×, low churn` };
  return { verdict: "active", reason: "in rotation" };
}

// mods/engram.ts
function buildDefenses(rows) {
  const out = [];
  for (const r of detectRepairChains(rows))
    out.push({ trigger: r.trigger, errClass: r.errClass, consequence: "fails until the known fix is applied", defense: `apply ${r.fixStep}, then re-run ${r.verifyStep}`, severity: Math.min(3, r.count + 1), count: r.count, kind: "fix" });
  for (const p of detectAntiPatterns(rows))
    out.push({ trigger: p.step, errClass: p.errClass, consequence: "recurring failure with no known recovery", defense: "root-cause before retrying; do not blind-retry", severity: Math.min(3, p.fails), count: p.fails, kind: "avoid" });
  for (const g of detectInvocationGotchas(rows))
    out.push({ trigger: g.trigger, errClass: "invocation", consequence: "fails unless invoked with the right flag/env", defense: `invoke with \`${g.delta}\``, severity: Math.min(3, g.count + 1), count: g.count, kind: "fix" });
  return out.sort((a, b) => b.severity - a.severity);
}
function preActionDefense(stepSignature, defenses) {
  const s = stepSignature.toLowerCase();
  return defenses.find((d) => d.trigger.toLowerCase() === s) || defenses.find((d) => s.includes(d.trigger.toLowerCase()) && d.trigger.length > 3) || null;
}
var ENGRAM = {
  W_PE: 3,
  W_RW: 2,
  W_NOV: 1,
  W_REC: 1,
  TAG_HALFLIFE_MS: 6 * 60 * 60 * 1000,
  CAPTURE_WINDOW_MS: 30 * 60 * 1000,
  PRP_THRESHOLD: 3,
  WEAK_MAX: 1
};
function expectationFor(sig, defenses) {
  const d = preActionDefense(sig, defenses);
  if (!d)
    return;
  return d.kind === "avoid" ? false : true;
}
function predictionError(row, defenses) {
  if (row.ok === undefined)
    return 0;
  const exp = expectationFor(stepSig(row), defenses);
  if (exp === undefined)
    return row.ok === false ? 0.4 : 0;
  return exp !== row.ok ? 1 : 0;
}
function tagExperience(rows, opts = {}) {
  const defenses = opts.defenses ?? [];
  const now = opts.now ?? Date.now();
  const highSignal = opts.highSignal ?? HIGH_SIGNAL_TOOL_SET;
  const failedSig = new Map;
  const seen = new Map;
  const out = [];
  for (const r of [...rows].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))) {
    const conv = String(r.conv ?? "?");
    const sig = stepSig(r);
    const h = String(r.h ?? r.fp ?? sig);
    const nov = (seen.get(h) ?? 0) === 0 ? 1 : 0;
    seen.set(h, (seen.get(h) ?? 0) + 1);
    const pe = predictionError(r, defenses);
    const fset = failedSig.get(conv) ?? failedSig.set(conv, new Set).get(conv);
    let rw = 0;
    if (r.ok === false)
      fset.add(sig);
    else if (r.ok === true) {
      if (fset.has(sig)) {
        rw = 1;
        fset.delete(sig);
      } else if (highSignal.has(r.tool))
        rw = 1;
    }
    const rec = Math.pow(0.5, Math.max(0, now - (r.ts ?? now)) / ENGRAM.TAG_HALFLIFE_MS);
    const score = +(ENGRAM.W_PE * pe + ENGRAM.W_RW * rw + ENGRAM.W_NOV * nov + ENGRAM.W_REC * rec).toFixed(3);
    out.push({ ...r, sal: { score, pe, rw, nov, rec: +rec.toFixed(3) } });
  }
  return out;
}
function captureTagged(tagged, opts = {}) {
  const window = opts.window ?? ENGRAM.CAPTURE_WINDOW_MS;
  const prp = opts.prpThreshold ?? ENGRAM.PRP_THRESHOLD;
  const weakMax = opts.weakMax ?? ENGRAM.WEAK_MAX;
  const count = new Map;
  for (const t of tagged) {
    const h = String(t.h ?? t.fp ?? stepSig(t));
    count.set(h, (count.get(h) ?? 0) + 1);
  }
  const prpEvents = tagged.filter((t) => t.sal.score >= prp);
  const rescued = [];
  for (const t of tagged) {
    const h = String(t.h ?? t.fp ?? stepSig(t));
    if ((count.get(h) ?? 0) > weakMax)
      continue;
    if (t.sal.score >= prp)
      continue;
    const near = prpEvents.find((p) => p !== t && String(p.conv) === String(t.conv) && Math.abs((p.ts ?? 0) - (t.ts ?? 0)) <= window);
    if (near)
      rescued.push({ ...t, capturedBy: near.ts ?? 0 });
  }
  return rescued;
}
function skillRetrieved(verbs, rows) {
  if (!verbs.length)
    return false;
  const vset = verbs.map((v) => v.toLowerCase());
  return rows.some((r) => {
    const s = stepSig(r).toLowerCase();
    return vset.some((v) => s === v || v.length > 3 && s.includes(v));
  });
}
function labileSkills(skills, rows, defenses) {
  const tagged = tagExperience(rows, { defenses });
  const out = [];
  for (const s of skills) {
    const verbs = skillVerbs(s.body);
    if (!verbs.length)
      continue;
    const vset = verbs.map((v) => v.toLowerCase());
    const used = tagged.filter((t) => {
      const sig = stepSig(t).toLowerCase();
      return vset.some((v) => sig === v || v.length > 3 && sig.includes(v));
    });
    if (!used.length)
      continue;
    const hits = used.filter((t) => t.sal.pe >= 1);
    if (!hits.length)
      continue;
    const conflicts = [...new Set(hits.map((t) => `${stepSig(t)} ${t.ok === false ? "failed" : "succeeded-unexpectedly"} (${t.err || "ok"})`))].slice(0, 5);
    out.push({ name: s.name, reason: `retrieved + ${hits.length} prediction-error(s) → labile (re-author, do not append)`, pe: Math.max(...hits.map((t) => t.sal.pe)), conflicts });
  }
  return out.sort((a, b) => b.pe - a.pe || b.conflicts.length - a.conflicts.length);
}
function replayQueue(tagged, k = 12) {
  return [...tagged].sort((a, b) => b.sal.score - a.sal.score || (b.ts ?? 0) - (a.ts ?? 0)).slice(0, k);
}
function reverseReplay(tagged, opts = {}) {
  const lookback = opts.lookback ?? 6;
  const decay = opts.decay ?? 0.7;
  const byConv = new Map;
  for (const t of tagged) {
    const c = String(t.conv ?? "?");
    (byConv.get(c) ?? byConv.set(c, []).get(c)).push(t);
  }
  const credit = new Map;
  for (const [, rs] of byConv) {
    rs.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
    rs.forEach((t, i) => {
      if (t.sal.rw > 0)
        for (let j = 0;j <= lookback && i - j >= 0; j++) {
          const step = rs[i - j];
          credit.set(step, (credit.get(step) ?? 0) + Math.pow(decay, j));
        }
    });
  }
  return [...credit.entries()].map(([t, c]) => ({ ...t, credit: +c.toFixed(3) })).sort((a, b) => b.credit - a.credit);
}
function interleave(novel, familiar) {
  const out = [];
  const n = Math.max(novel.length, familiar.length);
  for (let i = 0;i < n; i++) {
    if (i < novel.length)
      out.push(novel[i]);
    if (i < familiar.length)
      out.push(familiar[i]);
  }
  return out;
}
function renderEngramDigest(p) {
  const lines = ["# ENGRAM consolidation brief (prioritized replay, not recent-history)"];
  if (p.credited.length) {
    lines.push(`
## Rewarded paths (reverse-replay credit — steps that led to a win)`);
    for (const c of p.credited.slice(0, 8))
      lines.push(`- ${stepSig(c)} [credit ${c.credit}${c.ok === false ? " · was-a-failed-step" : ""}]`);
  }
  if (p.replay.length) {
    lines.push(`
## Highest-salience experiences`);
    for (const t of p.replay.slice(0, 8))
      lines.push(`- ${stepSig(t)} [sal ${t.sal.score} · pe ${t.sal.pe} · rw ${t.sal.rw} · nov ${t.sal.nov}]${t.err ? ` (${t.err})` : ""}`);
  }
  if (p.rescued.length) {
    lines.push(`
## Rescued one-shots (synaptic capture — rare, but sat next to what mattered)`);
    for (const t of p.rescued.slice(0, 6))
      lines.push(`- ${stepSig(t)}`);
  }
  if (p.labile.length) {
    lines.push(`
## Labile skills (RECONSOLIDATE — correct/weaken the contradicted claim; PRESERVE the proven core + frontmatter; never append a duplicate. Retire only if every prediction fails)`);
    for (const l of p.labile.slice(0, 6))
      lines.push(`- ${l.name}: ${l.reason}
    conflicts: ${l.conflicts.join("; ")}`);
  }
  if (lines.length === 1)
    lines.push("(nothing salient to consolidate this cycle)");
  return lines.join(`
`);
}
function engramConsolidate(rows, skills, opts = {}) {
  const defenses = opts.defenses ?? buildDefenses(rows);
  const tagged = tagExperience(rows, { defenses, now: opts.now, highSignal: opts.highSignal });
  const replay = replayQueue(tagged, opts.k ?? 12);
  const rescued = captureTagged(tagged);
  const credited = reverseReplay(tagged);
  const labile = labileSkills(skills, rows, defenses);
  return { hippoSize: rows.length, tagged: tagged.length, replay, rescued, credited, labile, digest: renderEngramDigest({ replay, rescued, credited, labile }) };
}
function guardDecision(toolName, args, defenses, mode) {
  if (mode === "off")
    return null;
  const { fp, tmpl } = fingerprint2(toolName, args ?? {});
  const hit = preActionDefense(stepSig({ tool: toolName, fp, tmpl }), defenses);
  if (!hit || hit.kind !== "avoid" || hit.severity < 2)
    return null;
  return { decision: mode, reason: `muscle-memory: "${hit.trigger}" → ${hit.errClass} recurred ${hit.count}× with no recovery. ${hit.defense}` };
}
function buildNeocortexBlock(managed, opts = {}) {
  const limit = opts.limit ?? 4000;
  const head = `# muscle-memory · consolidated skills (neocortex)
# ${managed.length} learned skill(s); invoke by name with the Skill tool.
`;
  const lines = managed.map((m) => `- ${m.name}: ${String(m.description).replace(/\s+/g, " ").slice(0, 140)}`);
  let body = head + lines.join(`
`);
  if (body.length > limit) {
    const keep = [];
    let len = head.length;
    for (const l of lines) {
      if (len + l.length + 1 > limit)
        break;
      keep.push(l);
      len += l.length + 1;
    }
    body = `${head}${keep.join(`
`)}
- …(+${lines.length - keep.length} more)`;
  }
  return body;
}
function nativeEnabled(channel) {
  return (process.env.MM_NATIVE ?? "").split(/[,\s]+/).filter(Boolean).includes(channel);
}
function reachFn(root, path) {
  let cur = root;
  let receiver = null;
  for (const key of path) {
    if (!cur || typeof cur !== "object")
      return null;
    receiver = cur;
    cur = Reflect.get(cur, key);
  }
  return typeof cur === "function" ? cur.bind(receiver) : null;
}
async function syncNeocortexBlock(client, agentId, content) {
  if (!agentId || !nativeEnabled("blocks"))
    return false;
  const update = reachFn(client, ["agents", "blocks", "update"]);
  if (!update)
    return false;
  try {
    await update(NEOCORTEX_BLOCK, { agent_id: agentId, value: content });
    return true;
  } catch {
    return false;
  }
}
var SKILL_PASSAGE_TAG = "mm:skill";
function skillPassageTag(name) {
  return `${SKILL_PASSAGE_TAG}:${name}`;
}
var SKILL_CANARY_NAMES = ["mm-canary-general-software-work", "mm-canary-generic-repair-shape"];
function isCanaryName(name) {
  return SKILL_CANARY_NAMES.includes(name);
}
function canaryPassages() {
  return [
    { name: SKILL_CANARY_NAMES[0], text: `skill: ${SKILL_CANARY_NAMES[0]}
general software work
Writing code, editing files, running commands in the terminal, reading documentation, checking output, and re-running until it works.` },
    { name: SKILL_CANARY_NAMES[1], text: `skill: ${SKILL_CANARY_NAMES[1]}
generic repair shape
Something failed during a run: investigate the cause of the failure, apply a change, run it again, and verify the fix worked.` }
  ];
}
function skillPassageText(name, description) {
  return `skill: ${name}
${name.replace(/-/g, " ")}
${String(description || "").replace(/\s+/g, " ").slice(0, 500)}`;
}
function parseSkillHits(resp) {
  if (!resp || typeof resp !== "object" || !("results" in resp) || !Array.isArray(resp.results))
    return [];
  const out = [];
  for (const r of resp.results) {
    if (!r || typeof r !== "object")
      continue;
    const tags = "tags" in r && Array.isArray(r.tags) ? r.tags : [];
    const named = tags.find((t) => typeof t === "string" && t.startsWith(`${SKILL_PASSAGE_TAG}:`));
    let name = named ? named.slice(SKILL_PASSAGE_TAG.length + 1) : "";
    if (!name && "content" in r && typeof r.content === "string")
      name = r.content.match(/^skill:\s*([a-z0-9-]+)/i)?.[1] ?? "";
    if (name && isValidSkillName(name) && !out.some((h) => h.name === name))
      out.push({ name, rank: out.length });
  }
  return out;
}
function calibrateSkillHits(raw, k) {
  const canaryRank = raw.reduce((best, h) => isCanaryName(h.name) && h.rank < best ? h.rank : best, Infinity);
  return raw.filter((h) => !isCanaryName(h.name)).slice(0, k).map((h, i) => canaryRank === Infinity ? { name: h.name, rank: i } : { name: h.name, rank: i, aboveCanary: h.rank < canaryRank });
}
async function semanticSkillCandidates(client, agentId, query, k = 3) {
  if (!agentId || !nativeEnabled("passages") || !query.trim())
    return [];
  const search = reachFn(client, ["agents", "passages", "search"]);
  if (!search)
    return [];
  try {
    const resp = await search(agentId, { query: query.slice(0, 4000), tags: [SKILL_PASSAGE_TAG], tag_match_mode: "all", top_k: k + SKILL_CANARY_NAMES.length });
    return calibrateSkillHits(parseSkillHits(resp), k);
  } catch {
    return [];
  }
}
async function syncSkillPassages(client, agentId, managed) {
  if (!agentId || !nativeEnabled("passages") || !managed.length)
    return 0;
  const search = reachFn(client, ["agents", "passages", "search"]);
  const create = reachFn(client, ["agents", "passages", "create"]);
  const del = reachFn(client, ["agents", "passages", "delete"]);
  if (!create)
    return 0;
  let synced = 0;
  const entries = [...managed.map((m) => ({ name: m.name, text: skillPassageText(m.name, m.description) })), ...canaryPassages()];
  for (const m of entries) {
    try {
      if (search && del) {
        const prior = await search(agentId, { query: m.name, tags: [skillPassageTag(m.name)], tag_match_mode: "all", top_k: 5 });
        if (prior && typeof prior === "object" && "results" in prior && Array.isArray(prior.results)) {
          for (const r of prior.results) {
            if (r && typeof r === "object" && "id" in r && typeof r.id === "string")
              await del(r.id, { agent_id: agentId });
          }
        }
      }
      await create(agentId, { text: m.text, tags: [SKILL_PASSAGE_TAG, skillPassageTag(m.name)] });
      if (!isCanaryName(m.name))
        synced++;
    } catch {}
  }
  return synced;
}

// mods/autopilot.ts
var AUTOPILOT_DEFAULT = { mode: "staged", dailyBudget: 5, minImpact: 4 };
function repairForRows(c, rows) {
  if (!c.fixes)
    return;
  const first = c.key.split(/\s*→\s*/)[0];
  return detectRepairChains(rows).find((r) => r.trigger === first || r.verifyStep === first || c.key.includes(r.trigger) || c.key.includes(r.verifyStep));
}
function autopilotPlan(input) {
  const cfg = input.config || AUTOPILOT_DEFAULT;
  const decisions = [];
  const skipped = [];
  let used = input.budgetUsedToday || 0;
  if (cfg.mode === "off")
    return { decisions, skipped: [{ what: "all", why: "autopilot off" }], budget: { used, limit: cfg.dailyBudget }, mode: cfg.mode };
  const existing = new Set(input.managed.map((m) => m.name));
  const refineTargets = new Set;
  const apSteps = detectAntiPatterns(input.rows).map((p) => p.step.toLowerCase());
  for (const m of input.managed) {
    if (m.pinned)
      continue;
    const verbs = skillVerbs(m.body);
    if (verbs.length && verbs.some((v) => apSteps.some((s) => s === v || s.includes(v) || v.includes(s)))) {
      decisions.push({ op: "refine", skill: m.name, reason: "documented failure recurring — strengthen the pitfall" });
      refineTargets.add(m.name);
    }
  }
  for (const c of detect(input.rows).candidates) {
    if (used >= cfg.dailyBudget) {
      skipped.push({ what: c.key, why: "daily budget reached" });
      continue;
    }
    if (DESTRUCTIVE.test(c.key)) {
      skipped.push({ what: c.key, why: "destructive workflow — never auto-distilled" });
      continue;
    }
    const imp = impactScore(c).score;
    if (imp < cfg.minImpact) {
      skipped.push({ what: c.key, why: `impact ${imp} < ${cfg.minImpact}` });
      continue;
    }
    const draft = draftWithRepair(c, repairForRows(c, input.rows));
    const nm = slug(draft.name);
    if (existing.has(nm)) {
      skipped.push({ what: nm, why: "already managed — refine, don't re-distill" });
      continue;
    }
    const dc = dedupCheck(nm, draft.description, input.dirsForDedup);
    if (dc.dup) {
      skipped.push({ what: nm, why: `dedup: ${dc.reason}` });
      continue;
    }
    const lint = lintSkillDraft({ name: nm, description: draft.description, body: draft.body }, { needsPitfalls: !!c.fixes });
    if (!lint.ok) {
      skipped.push({ what: nm, why: `lint: ${lint.issues[0]}` });
      continue;
    }
    const verified = c.fixes > 0 || c.count >= MM.STRONG_SINGLE;
    const gate = cfg.mode === "auto" && verified ? "graduate" : "stage";
    decisions.push({ op: "distill", candidate: c, name: nm, reason: `impact ${imp}, ${c.count} reps${verified ? ", verified" : ""}`, gate });
    existing.add(nm);
    used++;
  }
  for (const m of input.managed) {
    if (m.pinned || refineTargets.has(m.name))
      continue;
    const drift = specDrift(m.body, input.rows).drift;
    const ev = effectivenessVerdict({ uses: m.uses, ageDays: m.ageDays, staleAntiPattern: false });
    if (drift)
      decisions.push({ op: "retire", skill: m.name, reason: "spec-drift: referenced commands no longer occur" });
    else if (ev.verdict === "retire_candidate")
      decisions.push({ op: "retire", skill: m.name, reason: ev.reason });
  }
  return { decisions, skipped, budget: { used, limit: cfg.dailyBudget }, mode: cfg.mode };
}
function provenanceBlock(c) {
  return `
<!-- ${MM_TAG}: autopilot ${new Date().toISOString().slice(0, 10)}; candidate=${c.kind}:${c.key}; reps=${c.count}; convs=${c.convs}; fixes=${c.fixes}; impact=${impactScore(c).score} -->
`;
}
function appendRecurrenceNote(dir, name, note) {
  if (!existsSync4(join5(dir, name, "SKILL.md")))
    return false;
  let t = readSkill(dir, name);
  const stamp = new Date().toISOString().slice(0, 10);
  const line = `- (${stamp}) autopilot: ${note}
`;
  if (/##\s+Pitfalls/i.test(t))
    t = t.replace(/(##\s+Pitfalls[^\n]*\n)/i, `$1${line}`);
  else
    t = t.replace(/(\n## Verification)/, `
## Pitfalls (autopilot)
${line}
$1`);
  writeSkill(dir, name, t);
  return true;
}
function executeAutopilotPlan(plan, opts) {
  const author = opts.author || ((c, r) => draftWithRepair(c, r));
  const graduated = [], staged = [], refined = [], retired = [];
  const receipts = [];
  for (const d of plan.decisions) {
    try {
      if (d.op === "distill") {
        const draft = author(d.candidate, repairForRows(d.candidate, opts.rows));
        const content = `---
name: ${d.name}
description: ${draft.description}
---

${draft.body}${provenanceBlock(d.candidate)}
`;
        const sec = scanSkillContent(content);
        if (!sec.ok) {
          receipts.push({ op: "distill", name: d.name, blocked: `security: ${sec.issues.join("; ")}`, ts: Date.now() });
          continue;
        }
        if (d.gate === "graduate") {
          writeSkill(opts.skillsDir, d.name, content);
          graduated.push(d.name);
        } else {
          writeSkill(STAGED_DIR, d.name, content);
          staged.push(d.name);
        }
        receipts.push({ op: "distill", name: d.name, gate: d.gate, reason: d.reason, ts: Date.now() });
      } else if (d.op === "refine") {
        if (appendRecurrenceNote(opts.skillsDir, d.skill, d.reason)) {
          refined.push(d.skill);
          receipts.push({ op: "refine", name: d.skill, reason: d.reason, ts: Date.now() });
        }
      } else if (d.op === "retire") {
        const target = retireManagedSkill(d.skill, d.reason, opts.ctx, d.absorbedInto);
        retired.push(d.skill);
        receipts.push({ op: "retire", name: d.skill, reason: d.reason, target, ts: Date.now() });
      }
    } catch (e) {
      receipts.push({ op: d.op, error: String(e?.message ?? e) });
    }
  }
  return { graduated, staged, refined, retired, receipts };
}
function loadAutopilotState() {
  try {
    const s = JSON.parse(readFileSync4(AUTOPILOT_STATE, "utf8"));
    const today = new Date().toISOString().slice(0, 10);
    return s.date === today ? s : { date: today, used: 0 };
  } catch {
    return { date: new Date().toISOString().slice(0, 10), used: 0 };
  }
}
function saveAutopilotState(s) {
  try {
    ensureDir();
    writeFileSync4(AUTOPILOT_STATE, JSON.stringify(s));
  } catch {}
}
function managedView(dirs) {
  const usage = loadUsage();
  const out = [];
  for (const d of dirs)
    for (const n of listSkillNames(d)) {
      if (!isManaged(d, n))
        continue;
      const u = usage[n] || {};
      const created = u.created || Date.now();
      out.push({ name: n, description: skillDesc(d, n), body: readSkill(d, n), uses: u.uses || 0, ageDays: Math.floor((Date.now() - created) / 86400000), pinned: !!u.pinned });
    }
  return out;
}
function streamChunkText(c) {
  if (c == null)
    return "";
  if (typeof c === "string")
    return c;
  if (typeof c.text === "string")
    return c.text;
  if (typeof c.delta === "string")
    return c.delta;
  if (typeof c.content === "string")
    return c.content;
  if (typeof c.delta?.text === "string")
    return c.delta.text;
  if (typeof c.delta?.content === "string")
    return c.delta.content;
  if (typeof c.content?.text === "string")
    return c.content.text;
  if (Array.isArray(c.content))
    return c.content.map((x) => typeof x === "string" ? x : x?.text ?? "").join("");
  if (typeof c.choices?.[0]?.delta?.content === "string")
    return c.choices[0].delta.content;
  if (typeof c.choices?.[0]?.text === "string")
    return c.choices[0].text;
  return "";
}
async function consumeStreamBounded(stream) {
  const ms = Number(process.env.MM_FORK_TIMEOUT_MS) || 60000;
  let out = "";
  const reader = (async () => {
    try {
      for await (const c of stream)
        out += streamChunkText(c);
    } catch {}
    return out;
  })();
  const timer = new Promise((resolve) => setTimeout(() => resolve(out), ms));
  return Promise.race([reader, timer]);
}
async function forkAuthor(ctx, c, repair) {
  try {
    if (typeof ctx?.conversation?.fork !== "function")
      return null;
    const det = draftWithRepair(c, repair);
    const prompt = `You are muscle-memory's skill author. Write ONLY the markdown BODY (no YAML frontmatter) of a SKILL.md capturing this recurring real workflow. Keep it under 120 lines. Required sections in order: "## Trigger", "## Observed pattern" (include the exact pattern in a code block), "## Procedure" (numbered, concrete, adaptable), ${repair ? `"## Pitfalls" (the observed error "${repair.errClass}" and its fix "${repair.fixStep}"), ` : ""}"## Verification". Pattern: ${c.key}. Reps: ${c.count} across ${c.convs} conversation(s). Output ONLY the markdown body, nothing else.`;
    const forked = await ctx.conversation.fork({ hidden: true });
    const stream = await forked.sendMessageStream([{ role: "user", content: prompt }]);
    let body = await consumeStreamBounded(stream);
    body = body.trim().replace(/^```(?:markdown|md)?\n?|\n?```$/g, "");
    if (body.length < 80 || !/##\s*Procedure/i.test(body) || !/##\s*Verification/i.test(body))
      return null;
    const lint = lintSkillDraft({ name: det.name, description: det.description, body }, { needsPitfalls: !!c.fixes });
    if (!lint.ok)
      return null;
    const sec = scanSkillContent(body);
    if (!sec.ok)
      return null;
    return { name: det.name, description: det.description, body };
  } catch {
    return null;
  }
}
async function runAutopilot(ctx, config) {
  const cfg = config || AUTOPILOT_DEFAULT;
  const dirs = scanDirs(ctx);
  const rows = loadExperience();
  const st = loadAutopilotState();
  const plan = autopilotPlan({ rows, managed: managedView(dirs), dirsForDedup: dirs, config: cfg, budgetUsedToday: st.used });
  if (cfg.mode === "off" || !plan.decisions.length)
    return plan;
  const result = executeAutopilotPlan(plan, { skillsDir: agentSkillsDir(ctx), rows, ctx });
  saveAutopilotState({ date: st.date, used: st.used + result.graduated.length + result.staged.length });
  if (result.graduated.length || result.staged.length) {
    const g = result.graduated[0], s = result.staged[0];
    const summary = g ? `graduated '${g}'${result.graduated.length > 1 ? ` +${result.graduated.length - 1}` : ""}` : `staged '${s}'${result.staged.length > 1 ? ` +${result.staged.length - 1}` : ""} for review`;
    appendUiEvent({ phase: g ? "skill_graduated" : "skill_staged", summary, skill: g || s, action: g ? "graduate" : "stage", route: "autopilot" });
    writeUiState({ phase: "done", last: summary, route: `AUTOPILOT · ${g ? "graduate" : "stage"}` });
    for (const n of result.graduated)
      appendMeshFeed({ type: "skill_graduated", skill: n, route: "AUTOPILOT", signals: 0 });
    for (const n of result.graduated) {
      try {
        const _d = agentSkillsDir(ctx);
        const _b = readSkill(_d, n);
        if (_b) {
          const _p = publishPlan({ name: n, description: skillDesc(_d, n), body: _b, shelf: "agent" });
          appendUiEvent({ phase: "skill_publish_preflight", summary: `${n}: ${_p.publishability}/100 · tier=${publishTier(_p)} · ${_p.recommended}`, skill: n, route: "auto-after-graduate" });
        }
      } catch {}
    }
  }
  const published = [];
  if (process.env.MM_PUBLISH === "auto" && result.graduated.length) {
    for (const n of result.graduated) {
      try {
        publishSkillToCatalog(n, ctx);
        published.push(n);
      } catch {}
    }
    if (published.length) {
      appendUiEvent({ phase: "skill_published", summary: `published ${published.length} to catalog (Custom Skills)`, skill: published[0], action: "publish", route: "autopilot" });
      writeUiState({ phase: "done", last: `published '${published[0]}' to catalog`, route: "AUTOPILOT · publish" });
      for (const n of published)
        appendMeshFeed({ type: "skill_published", skill: n, route: "CATALOG", signals: 0 });
    }
  }
  try {
    ensureDir();
    mkdirSync4(RECEIPTS_DIR, { recursive: true });
    writeFileSync4(join5(RECEIPTS_DIR, `autopilot-${Date.now()}.json`), JSON.stringify({ mode: cfg.mode, ...result, published, ts: Date.now() }, null, 2));
  } catch {}
  return { ...plan, result };
}
var REVIEW_PROMPT = `You are the skill-library reviewer for a self-improving AI coding agent (agentskills.io). From the cross-session evidence, author ONE genuinely valuable CLASS-LEVEL skill IF a durable reusable lesson emerged.

Write a COMPLETE skill — completeness matters more than brevity. Structure: frontmatter (name + description with triggers), then "## When to use" (concrete triggers), "## Procedure" (numbered, concrete, safe-first), "## Pitfalls" (one entry per genuinely-distinct hard-won failure, each as the real symptom → the exact fix → a one-line diagnostic TELL), "## Verification", and — when the evidence is diverse — a "## Worked examples (real cases)" section. MATCH LENGTH TO EVIDENCE: a short skill is right for simple/sparse evidence; a RICH, exhaustive skill is right when the evidence is diverse (many distinct real failures) — never sacrifice a real pitfall or worked-example to hit a length target. FINISH every section — never trail off mid-sentence or mid-code-block. Stay organized + hygienic (clear sections, short fenced snippets), never a wall of text.

HARD RULES:
- CAPTURE EVERY REAL PITFALL: include each genuinely-distinct hard-won failure in the evidence (this breadth of real, cross-session lessons IS the whole advantage), each with its exact fix. Cut filler, redundancy, and obvious steps ruthlessly — but never drop a real pitfall to save space.
- DECISION-AWARE: for recovery/debugging/troubleshooting skills especially, structure the Procedure as a DECISION GUIDE — symptom → safest fix first → fallback — so the reader knows WHICH path to take, not just a menu of options.
- CONCRETE + ACCURATE: show exact, CORRECT code/commands in fenced blocks (a wrong or hand-wavy example is worse than none — verify it actually fixes the stated problem). Keep code snippets short + self-contained so they never get cut off. Every step specific.
- SAFE FIRST: ALWAYS make a non-destructive safety net (a backup branch/tag, a stash, or a copy) the EXPLICIT first step before any destructive/irreversible command (reset --hard, force-push, rm, drop, db migrate) — and name it as the safety net so a wrong move is recoverable.
- NAMING: class-level only; never an x-to-y transition, error string, PR number, date, codename, or fix-/debug-/audit-today artifact.
- NEGATIVE FILTER: never capture environment-dependent failures (command-not-found, missing binaries, uninstalled packages, creds) or tool-negatives ("X is broken").
- WORKED EXAMPLES (the edge — use them FULLY): the evidence may include real, cross-session symptom→fix examples. Do TWO things, not one: (1) GENERALIZE them into a high-altitude decision guide in the Procedure/Pitfalls (transfers across languages/projects), giving each a one-line diagnostic TELL; AND (2) when the evidence is diverse, ALSO include an explicit "## Worked examples (real cases)" section that catalogs EACH distinct real case compactly — symptom (one line) → the exact fix → the TELL. The generalized guide gives ALTITUDE; the worked-examples catalog gives CONCRETENESS — include BOTH; the catalog is a strength when the cases are real and diverse, not a weakness. CRITICAL: do NOT collapse genuinely-distinct failure classes (e.g. float-truncation vs type-coercion vs input-mutation vs off-by-one are DIFFERENT bugs) into one generic bucket — emit a distinct pitfall + example for EACH. Beyond the observed examples, also cover the 2-3 most common ADJACENT failure modes for this class (e.g. order/state-dependence, import/path errors, masked cascading failures) so the skill is broad. Include a safe-first step (inspect/diff before editing; change source not tests; smallest reversible edit). Still emit the required frontmatter: a CLASS-level name (a noun phrase like debugging-failing-tests; obey the NAMING rule) and a description that STARTS WITH "Use when".
Output ONLY the complete SKILL.md (no preamble, not truncated), or exactly "NOTHING-TO-SAVE".`;
var REVIEW_PROMPT_COMPACT = `From the cross-session evidence below, author ONE class-level reusable skill as a COMPLETE SKILL.md, IF a durable lesson emerged. Format: YAML frontmatter (name: a class-level lowercase-hyphen slug; description: STARTS WITH "Use when"), then "## Procedure" (numbered, safe-first), "## Pitfalls" (each: symptom → exact fix → one-line TELL), "## Verification". Concrete correct fenced code; no preamble. Output ONLY the SKILL.md markdown, or exactly "NOTHING-TO-SAVE".`;
var SEARCH_STOP = new Set("the and for with via use using used run running runs tool tools command commands file files validate validating validation build builds building test testing tests check checking code into from that this your you any new real step steps workflow workflows work works working session sessions across before after fix fixed fixing error errors fail failed failing not add get set make made need want call calls called when then them they here there what which how its has have will can may also same each only over under out off across recurring observed".split(" "));
var SEARCH_DISTINCT_MIN = 3;
function searchSkills(dirs, query, k = 5) {
  const terms = [...new Set(String(query).toLowerCase().split(/[^a-z0-9.]+/).filter((t) => t.length > 2 && !SEARCH_STOP.has(t)))];
  const out = [];
  for (const d of dirs)
    for (const n of listSkillNames(d)) {
      const body = readSkill(d, n).toLowerCase();
      const desc = skillDesc(d, n);
      const nl = n.toLowerCase(), dl = desc.toLowerCase();
      let score = 0, matched = 0;
      for (const t of terms) {
        const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const inName = nl.includes(t), inDesc = dl.includes(t);
        if (inName || inDesc)
          matched++;
        const bc = Math.min((body.match(new RegExp("\\b" + esc, "g")) || []).length, 3);
        score += (inName ? 8 : 0) + (inDesc ? 4 : 0) + bc;
      }
      if (matched > 0)
        out.push({ name: n, description: desc, dir: d, score, matched });
    }
  return out.sort((a, b) => b.score - a.score || b.matched - a.matched).slice(0, k);
}
function pickUpdateTarget(matches, threshold = 18) {
  const top = matches[0];
  if (!top)
    return null;
  const second = matches[1];
  const clearlyLeads = !second || top.score >= 1.5 * second.score;
  const topDir = String(top.dir || "");
  const topIsStaged = topDir === STAGED_DIR || /[\\/]staged$/.test(topDir);
  if (top.score >= threshold && top.matched >= SEARCH_DISTINCT_MIN && (clearlyLeads || topIsStaged))
    return { ...top, confidence: "high" };
  return null;
}
function isAmbiguousExistingRoute(matches, threshold = 18) {
  const top = matches[0], second = matches[1];
  if (!top || !second)
    return false;
  if (pickUpdateTarget(matches, threshold))
    return false;
  const topStrong = top.score >= threshold && top.matched >= SEARCH_DISTINCT_MIN;
  const secondStrong = second.score >= Math.max(threshold, top.score * 0.65) && second.matched > top.matched;
  return topStrong && secondStrong;
}
var SEMANTIC_RANK_BONUS = [12, 6, 3];
function applySemanticEvidence(matches, hits, onShelf, threshold = 18) {
  if (!hits.length)
    return { matches, suspect: null };
  const boosted = matches.map((m) => {
    const hit = hits.find((h) => h.name === m.name);
    return hit && m.matched > 0 ? { ...m, score: m.score + (SEMANTIC_RANK_BONUS[hit.rank] ?? 0) } : m;
  }).sort((a, b) => b.score - a.score || b.matched - a.matched);
  const top = hits.some((h) => h.aboveCanary !== undefined) ? hits.find((h) => h.aboveCanary === true && onShelf(h.name)) : hits[0];
  const lex = top ? boosted.find((m) => m.name === top.name) : undefined;
  const suspect = top && onShelf(top.name) && (!lex || lex.matched < SEARCH_DISTINCT_MIN || lex.score < threshold) ? top.name : null;
  return { matches: boosted, suspect };
}
function routeSkill(lexical, hits, onShelf, threshold = 18) {
  const { matches, suspect } = applySemanticEvidence(lexical, hits, onShelf, threshold);
  const target = pickUpdateTarget(matches, threshold);
  if (target)
    return { route: "update", target, matches, suspect };
  if (isAmbiguousExistingRoute(matches, threshold))
    return { route: "park-ambiguous", target: null, matches, suspect };
  if (suspect)
    return { route: "park-semantic", target: null, matches, suspect };
  return { route: "create", target: null, matches, suspect };
}
function frontmatterOf(content) {
  return (String(content || "").match(/^---\n([\s\S]*?)\n---\s*/)?.[1] || "").trimEnd();
}
function metadataBlockFromFrontmatter(fm) {
  const lines = fm.split(`
`);
  const start = lines.findIndex((l) => /^metadata\s*:/i.test(l.trim()));
  if (start < 0)
    return "";
  const out = [lines[start]];
  for (let i = start + 1;i < lines.length; i++) {
    const line = lines[i];
    if (/^[A-Za-z0-9_-]+\s*:/.test(line) && !/^\s/.test(line))
      break;
    out.push(line);
  }
  return out.join(`
`).trimEnd();
}
function preserveExistingFrontmatterMetadata(newContent, oldContent) {
  if (!oldContent)
    return newContent;
  const oldMeta = metadataBlockFromFrontmatter(frontmatterOf(oldContent));
  if (!oldMeta || /^---\n[\s\S]*?\nmetadata\s*:/im.test(newContent))
    return newContent;
  return newContent.replace(/^---\n([\s\S]*?)\n---\s*/m, (_m, fm) => `---
${String(fm).trimEnd()}
${oldMeta}
---

`);
}
function skillSectionNames(content) {
  const out = [];
  const text = String(content || "").replace(/```[\s\S]*?```/g, "");
  for (const m of text.matchAll(/^##\s+(.+?)\s*$/gim)) {
    const section = m[1].trim().replace(/[`*_]/g, "").toLowerCase();
    if (section && !out.includes(section))
      out.push(section);
  }
  return out;
}
function compareSkillSections(oldContent, newContent) {
  const oldSections = skillSectionNames(oldContent || "");
  const newSections = skillSectionNames(newContent || "");
  const preservedSections = oldSections.filter((s) => newSections.includes(s));
  const droppedSections = oldSections.filter((s) => !newSections.includes(s));
  const addedSections = newSections.filter((s) => !oldSections.includes(s));
  return { oldSections, newSections, preservedSections, droppedSections, addedSections };
}
async function reviewAndAuthor(evidence, dirs, authorFn, opts = {}) {
  const threshold = opts.updateThreshold ?? 18;
  const hits = opts.semanticFn ? await opts.semanticFn(evidence, 3).catch(() => []) : [];
  const d = routeSkill(searchSkills(dirs, evidence, 3), hits, (n) => dirs.some((x) => existsSync4(join5(x, n, "SKILL.md"))), threshold);
  const { matches } = d;
  const updTarget = d.target;
  const slimEarly = matches.map((m) => ({ name: m.name, score: m.score, matched: m.matched }));
  if (d.route === "park-ambiguous") {
    return { action: "none", reason: `ambiguous existing skills: ${matches.slice(0, 3).map((m) => `${m.name}(s${m.score}/m${m.matched})`).join(", ")}; refusing autonomous create`, matches: slimEarly };
  }
  if (d.route === "park-semantic") {
    return { action: "none", reason: `possible semantic duplicate of '${d.suspect}' (embedding match without distinctive lexical overlap); refusing autonomous create — review or absorb manually`, matches: slimEarly };
  }
  const existingForUpdate = updTarget ? (() => {
    try {
      const d2 = dirs.find((x) => existsSync4(join5(x, updTarget.name, "SKILL.md")));
      return d2 ? readSkill(d2, updTarget.name) : "";
    } catch {
      return "";
    }
  })() : "";
  const updateContext = existingForUpdate ? `

EXISTING SKILL CONTENT (preserve proven core; patch in new lessons, do not rewrite from scratch):
\`\`\`markdown
${existingForUpdate.slice(0, 3500)}
\`\`\`` : "";
  const hint = updTarget ? `

UPDATE-FIRST (anti-bloat): an existing skill already covers this territory — "${updTarget.name}": ${updTarget.description}. Extend it: keep that exact name, preserve useful existing sections/frontmatter metadata/provenance, and fold ONLY the new pitfalls/steps into one improved full SKILL.md. Do not delete valuable original structure just to make a cleaner rewrite. Only use a different name if the territory is genuinely distinct.${updateContext}` : matches.length ? `

Existing skills (avoid duplicating): ${matches.map((m) => m.name).join(", ")}.` : "";
  const _classes = (evidence.match(/^- recovered failure:/gm) || []).length;
  const _examples = (evidence.match(/·\s*example\s*—/g) || []).length;
  const _diverse = Math.max(_classes, _examples) >= 4;
  const depthDirective = _diverse ? `

EVIDENCE DEPTH: this evidence holds ${_examples} concrete worked-example${_examples === 1 ? "" : "s"} spanning distinct failure classes. HIGH-DIVERSITY regime — completeness matters more than brevity. The skill should have ALL of these sections (a Procedure-only skill is INCOMPLETE and will be REJECTED):
- "## Procedure" — a generalized decision guide (symptom → safest fix path).
- "## Pitfalls" — ONE entry per DISTINCT failure class (symptom → exact fix → one-line diagnostic TELL). Never merge different bugs into one generic bucket; emit a separate pitfall for each of the ${_examples} cases' classes.
- "## Verification" — how to confirm green with no regressions.
- "## Worked examples (real cases)" — catalog ALL ${_examples} real cases compactly: symptom (one line) → exact fix → TELL.
The ~70-line cap is LIFTED (target a rich ~120-180 lines); be EXHAUSTIVE on the diverse evidence — that breadth is the whole edge — but stay sectioned + hygienic (no wall of text).` : "";
  const parseDraft = (raw2) => {
    let skill = (raw2 || "").replace(/<\/?think>/gi, "").trim();
    const startIdx = skill.search(/(^|\n)\s*(---\s*\n|#\s+|name:\s)/i);
    if (startIdx > 0)
      skill = skill.slice(startIdx).trim();
    skill = skill.replace(/^```(?:markdown|md|yaml)?\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    if (/^NOTHING-TO-SAVE/i.test(skill) || skill.length < 40)
      return null;
    const rawName = (skill.match(/^name:\s*["']?(.+?)["']?\s*$/im)?.[1] || "").trim();
    if (rawName && (/[\/\\;|&]|\.\./.test(rawName) || rawName.length > 64))
      return { name: "", description: "", body: "", unsafeName: rawName };
    let name2 = slug(rawName);
    if (rawName && name2 && !isValidSkillName(name2))
      return { name: name2, description: "", body: "", invalidName: name2 };
    if (!name2)
      name2 = slug((skill.match(/^#\s+(.+?)\s*$/m)?.[1] || "").trim());
    if (!name2 && updTarget)
      name2 = updTarget.name;
    let description2 = (skill.match(/^description:\s*["']?(.+?)["']?\s*$/im)?.[1] || "").trim();
    if (!description2)
      description2 = (skill.split(`
`).find((l) => {
        const t = l.trim();
        return t.length > 25 && !/^([#`>*-]|---|name:|title:|description:)/i.test(t);
      }) || "").trim();
    if (!description2 && updTarget)
      description2 = updTarget.description;
    let body2 = skill;
    const secStart = body2.search(/(^|\n)##\s+/);
    if (secStart >= 0)
      body2 = body2.slice(secStart);
    else
      body2 = body2.replace(/^---[\s\S]*?\n---\s*\n?/, "").replace(/^#\s+.+\n+/, "");
    body2 = body2.replace(/\n---\s*(\n[\s\S]*)?$/, "").trim();
    return { name: name2, description: description2, body: body2 };
  };
  const isCleanDraft = (p) => isValidSkillName(p.name) && !!p.description && p.description.length >= 20 && lintSkillDraft(p).ok;
  let _fb;
  const fallback = () => {
    if (_fb === undefined) {
      try {
        const c = findCandidate();
        _fb = c ? draftWithRepair(c, repairForCandidate(c)) : null;
      } catch {
        _fb = null;
      }
    }
    return _fb;
  };
  const fbUsable = (f) => !!f && isValidSkillName(f.name) && !!f.body && f.body.trim().length >= 40 && lintSkillDraft(f).ok && scanSkillContent(f.body).ok;
  const looksEmpty = (s) => {
    const t = (s || "").replace(/<\/?think>/gi, "").trim();
    return t.length < 40 && !/^NOTHING-TO-SAVE/i.test(t);
  };
  const saidNothing = (s) => /^NOTHING-TO-SAVE/i.test((s || "").replace(/<\/?think>/gi, "").trim());
  let degraded;
  let raw = await authorFn(REVIEW_PROMPT, evidence + hint + depthDirective) || "";
  if (looksEmpty(raw)) {
    degraded = "author-empty→retry-same";
    try {
      raw = await authorFn(REVIEW_PROMPT, evidence + hint + depthDirective) || raw;
    } catch {}
  }
  if (looksEmpty(raw)) {
    degraded = "author-empty→retry-compressed";
    try {
      raw = await authorFn(REVIEW_PROMPT_COMPACT, evidence) || raw;
    } catch {}
  }
  try {
    ensureDir();
    writeFileSync4(join5(STATE_DIR, "reflect-last-raw.txt"), `=== ${new Date().toISOString()}${degraded ? " [" + degraded + "]" : ""} ===
${raw}
`);
  } catch {}
  let parsed = parseDraft(raw);
  if (parsed?.unsafeName)
    return { action: "reject", reason: `name "${parsed.unsafeName.slice(0, 40)}" has unsafe characters (path/injection)`, degraded };
  if (parsed?.invalidName)
    return { action: "reject", reason: `name "${parsed.invalidName}" not class-level`, degraded };
  if (!parsed) {
    if (saidNothing(raw))
      return { action: "none", reason: "author judged NOTHING-TO-SAVE" };
    const f = fallback();
    if (fbUsable(f)) {
      parsed = { name: f.name, description: f.description, body: f.body };
      degraded = (degraded ? degraded + "→" : "author-empty→") + "deterministic-fallback";
    } else
      return { action: "reject", reason: `author produced no usable skill after same+compressed retries; deterministic fallback ${f ? "sub-threshold" : "unavailable"}`, degraded: (degraded || "author-empty") + "→no-usable-skill" };
  }
  if (!parsed.body || parsed.body.trim().length < 10)
    return { action: "reject", reason: "body too thin" };
  const depthComplete = (b) => !_diverse || /##\s+pitfalls/i.test(b) && /##\s+worked\s+examples/i.test(b);
  const sotaGaps = sotaQualityGaps(parsed);
  if ((!isCleanDraft(parsed) || !depthComplete(parsed.body) || sotaGaps.length) && !(degraded || "").includes("deterministic-fallback")) {
    const why = lintSkillDraft(parsed).issues.concat(isValidSkillName(parsed.name) ? [] : ["name must be a class-level lowercase-hyphen slug"]).concat((parsed.description || "").length >= 20 ? [] : ["description too short"]).concat(depthComplete(parsed.body) ? [] : [`HIGH-DIVERSITY skill is MISSING required depth sections (needs both "## Pitfalls" with one entry per distinct class AND "## Worked examples (real cases)" cataloging all ${_examples} cases) — a Procedure-only skill is too thin`]).concat(sotaGaps);
    const corrective = `

YOUR PREVIOUS DRAFT IS NOT YET SOTA (${why.join("; ")}). A top-tier skill ALWAYS has: concrete correct fenced code, a one-line diagnostic TELL on every Pitfall, an explicit safe-first step before any destructive command, and a class-level (not one-off) frame. Re-output ONE complete SKILL.md and NOTHING else, fixing every issue above: YAML frontmatter with a class-level "name:" (lowercase-hyphen) + a "description:" that STARTS WITH "Use when"; a body with "## Procedure", "## Pitfalls" (each with symptom → exact fix → TELL), "## Verification"${_diverse ? ', AND "## Worked examples (real cases)" cataloging every real case' : ""}.`;
    try {
      const raw2 = await authorFn(REVIEW_PROMPT, evidence + hint + depthDirective + corrective) || "";
      try {
        writeFileSync4(join5(STATE_DIR, "reflect-last-raw.txt"), `=== ${new Date().toISOString()} (retry) ===
${raw2}
`);
      } catch {}
      const p2 = parseDraft(raw2);
      if (p2 && !p2.unsafeName && isCleanDraft(p2) && depthComplete(p2.body) && sotaQualityGaps(p2).length <= sotaGaps.length) {
        parsed = p2;
        raw = raw2;
      }
    } catch {}
  }
  let { name, description, body } = parsed;
  if (!isValidSkillName(name)) {
    const f = fallback();
    name = updTarget && isValidSkillName(updTarget.name) ? updTarget.name : f && isValidSkillName(f.name) ? f.name : name;
  }
  if (!isValidSkillName(name))
    return { action: "reject", reason: `name "${name}" not class-level`, degraded };
  const secEarly = scanSkillContent(body);
  if (!secEarly.ok)
    return { action: "reject", reason: `security: ${secEarly.issues.join("; ")}`, degraded };
  const descOk = (d2) => !!d2 && d2.length >= 20 && /\b(use when|trigger|when )/i.test(d2);
  if (!descOk(description)) {
    if (description && description.length >= 12 && !/\b(use when|trigger|when )/i.test(description))
      description = `Use when ${description}`.slice(0, 700);
    if (!descOk(description)) {
      const f = fallback();
      description = f && descOk(f.description) ? f.description : updTarget && descOk(updTarget.description) ? updTarget.description : description;
    }
  }
  if (!/##\s+procedure/i.test(body) || !/##\s+verification/i.test(body)) {
    const f = fallback();
    if (f) {
      if (!/##\s+procedure/i.test(body)) {
        const m = f.body.match(/(##\s+Procedure[\s\S]*?)(?=\n##\s|\s*$)/i);
        body += `

${m ? m[1].trim() : `## Procedure
1. Repeat the observed workflow, adapting paths/args to the current context.
2. Capture the success/failure receipt before moving on.`}`;
      }
      if (!/##\s+verification/i.test(body)) {
        const m = f.body.match(/(##\s+Verification[\s\S]*?)(?=\n##\s|\s*$)/i);
        body += `

${m ? m[1].trim() : `## Verification
- Confirm via concrete command/tool output that the workflow actually succeeded.`}`;
      }
    }
  }
  const sec = scanSkillContent(body);
  if (!sec.ok)
    return { action: "reject", reason: `security: ${sec.issues.join("; ")}`, degraded };
  const lint = lintSkillDraft({ name, description, body });
  if (!lint.ok) {
    const f = fallback();
    if (f && lintSkillDraft(f).ok && isValidSkillName(f.name)) {
      ({ name, description, body } = f);
      degraded = (degraded ? degraded + "→" : "") + "lint-repair-fallback";
    } else
      return { action: "reject", reason: `lint: ${lint.issues.join("; ")}`, degraded };
  }
  const content = `---
name: ${name}
description: ${description}
---

${body}
`;
  const slim = matches.map((m) => ({ name: m.name, score: m.score, matched: m.matched }));
  const existingNames = new Set(matches.map((m) => m.name));
  if (existingNames.has(name)) {
    const preserved = preserveExistingFrontmatterMetadata(content, existingForUpdate);
    return { action: "update", name, description, body, content: preserved, updateTarget: name, matches: slim, degraded };
  }
  return { action: "create", name, description, body, content, matches: slim, degraded };
}
function buildEvidenceManifest(i) {
  const sd = i.oldContent ? compareSkillSections(i.oldContent, i.newContent) : undefined;
  return { ts: new Date().toISOString(), action: i.action, skill: i.skill, updateTarget: i.updateTarget, sources: { conversations: i.convs, durableSignals: i.signals }, memfsHits: i.memfsHits.map((m) => ({ name: m.name, score: m.score, matched: m.matched })), preferencesInjected: i.preferences, rejectedNoise: i.rejected, newHash: hash(i.newContent), oldHash: i.oldContent ? hash(i.oldContent) : undefined, sectionDiff: sd ? { preserved: sd.preservedSections, dropped: sd.droppedSections, added: sd.addedSections } : undefined, gates: { naming: true, security: true, lint: true } };
}
function retrievePreferences(evidence, memDir) {
  const dir = memDir || process.env.MEMORY_DIR;
  if (!dir)
    return [];
  const prefs = [];
  for (const s of ["persona.md", "system/persona.md", "system/human.md", "human.md", "system/human/preferences.md"]) {
    const p = join5(dir, s);
    if (!existsSync4(p))
      continue;
    try {
      for (const line of readFileSync4(p, "utf8").split(`
`)) {
        const l = line.trim().replace(/^[-*#>\s]+/, "");
        if (/\b(prefer|preference|always|never|wants?|likes?|hates?|style|format|verbos|concise|terse|tone|don'?t)\b/i.test(l) && l.length > 20 && l.length < 220)
          prefs.push(l);
      }
    } catch {}
  }
  return [...new Set(prefs)].slice(0, 6);
}
function reflectSignature(ev) {
  return hash(`${ev.convs}
${ev.items}
${ev.digest}`);
}
function loadHandledReflects() {
  try {
    return existsSync4(REFLECT_HANDLED) ? JSON.parse(readFileSync4(REFLECT_HANDLED, "utf8")) : {};
  } catch {
    return {};
  }
}
function markHandledReflect(sig, route) {
  try {
    ensureDir();
    const h = loadHandledReflects();
    h[sig] = { ts: Date.now(), route };
    writeFileSync4(REFLECT_HANDLED, JSON.stringify(h, null, 2));
  } catch {}
}
function isHighConfidenceCreate(res, ev) {
  if (res.action !== "create")
    return false;
  const top = res.matches?.[0];
  const cleanRoute = !pickUpdateTarget(res.matches || [], 18);
  const richDraft = !!res.description && res.description.length >= 80 && /##\s+Pitfalls/i.test(res.body || "") && /##\s+Verification/i.test(res.body || "");
  return ev.convs >= 3 && ev.items >= 1 && cleanRoute && richDraft;
}
function graduateStagedSkill(name, ctx) {
  const nm = slug(name);
  if (!nm)
    throw new Error("name required");
  const srcDir = join5(STAGED_DIR, nm);
  const src = join5(srcDir, "SKILL.md");
  if (!existsSync4(src))
    throw new Error(`no staged skill '${nm}'`);
  const retiredBlock = retiredSkillBlocker(nm, ctx);
  if (retiredBlock)
    throw new Error(`retire-sticky blocked graduate: ${retiredBlock}`);
  const content = readFileSync4(src, "utf8");
  const desc = (content.match(/^description:\s*(.+)$/im)?.[1] || "").trim();
  const body = content.replace(/^---[\s\S]*?\n---\s*\n?/, "");
  const lint = lintSkillDraft({ name: nm, description: desc, body });
  if (!lint.ok)
    throw new Error(`linter blocked: ${lint.issues.join("; ")}`);
  const sec = scanSkillContent(body);
  if (!sec.ok)
    throw new Error(`security blocked: ${sec.issues.join("; ")}`);
  const dstRoot = agentSkillsDir(ctx);
  const dst = writeSkill(dstRoot, nm, content.includes(MM_TAG) ? content : content + `
<!-- ${MM_TAG}: graduated ${new Date().toISOString().slice(0, 10)} -->
`);
  mkdirSync4(STAGED_RETIRED_DIR, { recursive: true });
  try {
    renameSync3(srcDir, join5(STAGED_RETIRED_DIR, `${nm}-graduated-${Date.now()}`));
  } catch {}
  appendUiEvent({ phase: "skill_graduated", summary: `graduated '${nm}'`, skill: nm, action: "graduate", route: "manual" });
  appendMeshFeed({ type: "skill_graduated", skill: nm, route: "GRADUATE", signals: 0 });
  writeUiState({ phase: "done", last: `graduated '${nm}'`, route: "GRADUATE · live" });
  try {
    const _b = readSkill(dstRoot, nm);
    if (_b) {
      const _p = publishPlan({ name: nm, description: skillDesc(dstRoot, nm), body: _b, shelf: "agent" });
      appendUiEvent({ phase: "skill_publish_preflight", summary: `${nm}: ${_p.publishability}/100 · tier=${publishTier(_p)} · ${_p.recommended}`, skill: nm, route: "auto-after-graduate" });
    }
  } catch {}
  return dst;
}
function reviewForkAuthor(ctx) {
  return async (sys, user) => {
    try {
      if (typeof ctx?.conversation?.fork !== "function")
        return "";
      const forked = await ctx.conversation.fork({ hidden: true });
      const stream = await forked.sendMessageStream([{ role: "user", content: `${sys}

${user}` }]);
      const out = await consumeStreamBounded(stream);
      return out.trim();
    } catch {
      return "";
    }
  };
}
async function runReflectiveReview(ctx, config = {}) {
  const dirs = config.dirs ?? scanDirs(ctx);
  const stagedShelf = config.stagedDir ?? STAGED_DIR;
  const reviewDirs = config.mode === "auto" ? dirs : [...dirs, stagedShelf];
  const exp = config.experience ?? loadExperience();
  const ev = buildCrossConversationEvidence(exp);
  const engram = engramConsolidate(exp, managedView(reviewDirs).map((m) => ({ name: m.name, body: m.body })));
  appendUiEvent({ phase: "review_started", summary: `reviewing ${ev.convs} sessions / ${ev.items} durable signals` });
  writeUiState({ phase: "reviewing", detail: `${ev.convs} sessions / ${ev.items} signals` });
  if (ev.items < (config.minItems ?? 2)) {
    appendUiEvent({ phase: "reflect_none", summary: `nothing to save yet (${ev.items} signals)` });
    writeUiState({ phase: "idle", last: "nothing to save yet" });
    return { action: "none", reason: `only ${ev.items} cross-session signals (need ≥${config.minItems ?? 2})` };
  }
  const prefs = retrievePreferences(ev.digest, process.env.MEMORY_DIR);
  const digest = `${engram.digest}

${ev.digest}` + (prefs.length ? `

USER PREFERENCES (from this agent's memory — bake the relevant ones into the skill's guidance):
${prefs.map((p) => `- ${p}`).join(`
`)}` : "");
  const preTgt = pickUpdateTarget(searchSkills(reviewDirs, digest, 3), 18);
  const routeKey = preTgt ? `UPDATE:${preTgt.name}` : "CREATE";
  const sig = reflectSignature(ev);
  if (loadHandledReflects()[sig]) {
    const summary = `already reflected ${routeKey.toLowerCase()} for this evidence signature`;
    appendUiEvent({ phase: "reflect_none", summary });
    writeUiState({ phase: "idle", last: summary, route: "SKIP · handled" });
    return { action: "none", reason: summary };
  }
  writeUiState({ phase: "routing", route: preTgt ? `UPDATE → ${preTgt.name}` : "CREATE (new skill)" });
  appendUiEvent({ phase: "review_planned", summary: preTgt ? `route UPDATE → ${preTgt.name}` : "route CREATE — no existing skill safely covers this" });
  writeUiState({ phase: "writing", skill: preTgt?.name, route: preTgt ? `UPDATE → ${preTgt.name}` : "CREATE" });
  const author = config.authorFn || reviewForkAuthor(ctx);
  let res;
  try {
    res = await reviewAndAuthor(digest, reviewDirs, author, { semanticFn: config.semanticFn });
  } catch (e) {
    appendUiEvent({ phase: "reflect_error", summary: `author failed: ${String(e?.message ?? e).slice(0, 80)}` });
    writeUiState({ phase: "idle", last: "review interrupted — will retry next session", route: "ERROR · safe" });
    return { action: "none", reason: `author error: ${String(e?.message ?? e).slice(0, 120)}` };
  }
  if ((res.action === "create" || res.action === "update") && res.name && res.content) {
    const live = config.mode === "auto";
    const graduate = live || res.action === "update" || isHighConfidenceCreate(res, ev);
    const dir = graduate ? agentSkillsDir(ctx) : stagedShelf;
    const tagged = res.content.includes(MM_TAG) ? res.content : res.content + `
<!-- ${MM_TAG}: reflective ${new Date().toISOString().slice(0, 10)}; action=${res.action}; convs=${ev.convs}; ${graduate ? "graduated=true" : "staged=true"} -->
`;
    try {
      if (res.action === "create" && !res.updateTarget) {
        const retiredBlock = retiredSkillBlocker(res.name, ctx);
        if (retiredBlock) {
          markHandledReflect(sig, `RETIRED:${res.name}`);
          appendUiEvent({ phase: "reflect_none", summary: `retire-sticky blocked '${res.name}'` });
          writeUiState({ phase: "idle", last: `retire-sticky blocked '${res.name}'`, route: "SKIP · retired" });
          return { action: "none", name: res.name, reason: retiredBlock };
        }
        const n1 = multiInstanceSupport(`${res.name} ${res.description ?? ""}`, ev.signals ?? [], config.minInstances ?? 2);
        if (!n1.ok) {
          markHandledReflect(sig, `N1-PARKED:${res.name}`);
          appendUiEvent({ phase: "reflect_none", summary: `n=1 gate parked '${res.name}': ${n1.reason.slice(0, 120)}` });
          writeUiState({ phase: "idle", last: `n=1 gate parked '${res.name}'`, route: "SKIP · n=1" });
          return { action: "none", name: res.name, reason: `n=1 gate: ${n1.reason}` };
        }
      }
      const oldContent = res.action === "update" && res.updateTarget ? (() => {
        const d = reviewDirs.find((x) => existsSync4(join5(x, res.updateTarget, "SKILL.md")));
        return d ? readSkill(d, res.updateTarget) : undefined;
      })() : undefined;
      writeSkill(dir, res.name, tagged);
      const manifest = buildEvidenceManifest({ action: res.action, skill: res.name, updateTarget: res.updateTarget, convs: ev.convs, signals: ev.items, memfsHits: res.matches || [], preferences: prefs, rejected: ev.rejected, newContent: tagged, oldContent });
      const evDir = join5(dir, res.name, "references", "evidence");
      mkdirSync4(evDir, { recursive: true });
      writeFileSync4(join5(evDir, `${Date.now()}.json`), JSON.stringify(manifest, null, 2));
      ensureDir();
      mkdirSync4(RECEIPTS_DIR, { recursive: true });
      writeFileSync4(join5(RECEIPTS_DIR, `reflect-${Date.now()}.json`), JSON.stringify({ action: res.action, name: res.name, updateTarget: res.updateTarget, convs: ev.convs, items: ev.items, prefsInjected: prefs.length, rejected: ev.rejected.length, degraded: res.degraded || null, dir, ts: Date.now() }, null, 2));
      if (res.degraded)
        appendUiEvent({ phase: "author_degraded", summary: `authored via graceful degradation: ${res.degraded}`, skill: res.name });
      const phase = graduate ? "skill_graduated" : "skill_staged";
      const verb = graduate ? "graduated" : res.action === "update" ? "staged update to" : "staged";
      const summary = `${verb} '${res.name}' (${res.action === "update" ? "update-first" : "new"}, ${ev.convs} sessions/${ev.items} signals)`;
      appendUiEvent({ phase, summary, skill: res.name, action: res.action, route: res.updateTarget ? `update ${res.updateTarget}` : "create" });
      appendMeshFeed({ type: phase, skill: res.name, route: graduate ? "GRADUATE" : res.action.toUpperCase(), signals: ev.items });
      markHandledReflect(sig, routeKey);
      appendUiEvent({ phase: "evidence_manifest_written", summary: "wrote evidence manifest" });
      if (ev.rejected.length)
        appendUiEvent({ phase: "noise_rejected", summary: `rejected ${ev.rejected.length} env-noise items` });
      if (prefs.length)
        appendUiEvent({ phase: "memory_pref_injected", summary: `injected ${prefs.length} user preferences` });
      writeUiState({ phase: "done", last: summary, route: `${graduate ? "GRADUATE" : res.action.toUpperCase()}${res.updateTarget ? " " + res.updateTarget : ""} · ${graduate ? "live" : "staged"}` });
      return { ...res, wrote: join5(dir, res.name) };
    } catch (e) {
      appendUiEvent({ phase: "reflect_error", summary: `write failed: ${String(e?.message ?? e).slice(0, 80)}` });
      return { ...res, reason: String(e?.message ?? e) };
    }
  }
  if (res.action === "reject") {
    const safe = /\bsecurity:/i.test(res.reason || "");
    markHandledReflect(sig, routeKey);
    try {
      ensureDir();
      mkdirSync4(RECEIPTS_DIR, { recursive: true });
      writeFileSync4(join5(RECEIPTS_DIR, `reflect-rejected-${Date.now()}.json`), JSON.stringify({ action: "reject", safe, reason: res.reason || "(none)", degraded: res.degraded || null, convs: ev.convs, items: ev.items, ts: Date.now() }, null, 2));
    } catch {}
    appendUiEvent({ phase: safe ? "blocked_unsafe" : "reflect_none", summary: safe ? `\uD83D\uDEE1️ blocked unsafe content (safe): ${res.reason}` : `draft rejected; nothing saved (${res.reason})${res.degraded ? " [degraded: " + res.degraded + "]" : ""}` });
    writeUiState({ phase: safe ? "protected" : "idle", last: safe ? "blocked unsafe content (safe)" : `draft rejected; nothing saved`, route: safe ? "BLOCKED · protected" : "SKIP · rejected-draft" });
  } else {
    markHandledReflect(sig, routeKey);
    appendUiEvent({ phase: "reflect_none", summary: "nothing durable to save" });
    writeUiState({ phase: "idle", last: "nothing to save" });
  }
  return res;
}
// mods/ui.ts
function summarizeReflectActions(events, mode = "compact") {
  const primaryPhases = ["skill_created", "skill_updated", "skill_staged", "skill_graduated", "skill_retired"];
  const writes = events.filter((e) => [...primaryPhases, "skill_review", "memory_pref_injected", "noise_rejected"].includes(e.phase));
  if (!writes.length) {
    const last = events[events.length - 1];
    return `\uD83D\uDCBE muscle-memory review: ${last ? last.summary : "nothing to save"}`;
  }
  const main = writes.filter((w) => primaryPhases.includes(w.phase)).map((w) => w.summary);
  const extras = mode === "verbose" ? writes.filter((w) => !primaryPhases.includes(w.phase)).map((w) => w.summary) : [];
  return `\uD83D\uDCBE muscle-memory review: ${[...main, ...extras].join(" · ") || writes[0].summary}`;
}
function renderMuscleMemoryPanel(state) {
  const mode = process.env.MM_REFLECT === "auto" ? "auto" : process.env.MM_REFLECT === "staged" ? "staged" : "off";
  if (!state || !state.last && !state.phase)
    return mode === "off" ? [] : [`\uD83D\uDCBE muscle-memory · ${mode} · watching`];
  const ageMs = typeof state.ts === "number" ? Date.now() - state.ts : 0;
  const TRANSIENT = state.phase === "reviewing" || state.phase === "routing" || state.phase === "writing";
  const ttlMs = state.phase === "idle" ? 60000 : state.phase === "done" ? 5 * 60000 : state.phase === "protected" ? 5 * 60000 : state.phase === "blocked" ? 5 * 60000 : TRANSIENT ? 120000 : 90000;
  if (ageMs > ttlMs)
    return mode === "off" ? [] : [`\uD83D\uDCBE muscle-memory · ${mode} · watching`];
  switch (state.phase) {
    case "reviewing":
      return [`\uD83D\uDCBE muscle-memory · \uD83D\uDD0D reviewing ${state.detail || "evidence…"}`];
    case "routing":
      return [`\uD83D\uDCBE muscle-memory · \uD83E\uDDED ${state.route || "routing…"}`];
    case "writing":
      return [`\uD83D\uDCBE muscle-memory · ✍️  writing ${state.skill ? `'${state.skill}'` : "skill"}…`];
    case "protected":
      return [`\uD83D\uDCBE muscle-memory · \uD83D\uDEE1️  ${state.last || "blocked unsafe content (safe)"}`];
    case "blocked":
      return [`\uD83D\uDCBE muscle-memory · ⚠️  ${state.last || "blocked"}`];
    default:
      return [`\uD83D\uDCBE muscle-memory · ${state.last || "ready"}`];
  }
}

// mods/index.ts
var __mm = {
  commandTemplate: commandTemplate2,
  fingerprint: fingerprint2,
  redactFragment,
  buildDiffFragment,
  detect,
  detectTemplates,
  detectSequences,
  maturityScore,
  MM,
  loadRows,
  dedupCheck,
  slug,
  draftSkillFromCandidate,
  candidateName,
  candidateDescription,
  curateManagedSkills,
  managedSkillUsage,
  streamChunkText,
  isDurableLesson,
  isValidSkillName,
  buildCrossConversationEvidence,
  REVIEW_PROMPT,
  reviewAndAuthor,
  searchSkills,
  pickUpdateTarget,
  runReflectiveReview,
  graduateStagedSkill,
  publishSkillToCatalog,
  catalogPrivacyScan,
  isHighConfidenceCreate,
  runAutonomousPrune,
  buildEvidenceManifest,
  retrievePreferences,
  coverageMap,
  churnSignal,
  summarizeReflectActions,
  renderMuscleMemoryPanel,
  loadMeshFeed,
  renderMeshFeed,
  buildRegistry,
  curatorPass,
  skillVerbs,
  specDrift,
  lifecycleTransition,
  CURATOR,
  setPinned,
  isPinned,
  buildDefenses,
  preActionDefense,
  autopilotPlan,
  executeAutopilotPlan,
  AUTOPILOT_DEFAULT,
  managedView,
  forkAuthor,
  scanSkillContent,
  scanSupportFile,
  validateSupportPath,
  writeSupportFile,
  removeSupportFile,
  restoreManagedSkill,
  classifyError,
  mergeOutcomes,
  correlateOutcomes,
  inferOutcomes,
  detectInvocationGotchas,
  loadExperience,
  detectRepairChains,
  detectAntiPatterns,
  impactScore,
  lintSkillDraft,
  aggregateTelemetry,
  effectivenessVerdict,
  draftWithRepair,
  stepSig,
  sotaQualityGaps,
  auditSkills,
  crossShelfDuplicates,
  publishabilityScore,
  sanitizeForPublish,
  publishHardBlocks,
  publishPlan,
  publishTier,
  publishMetadata,
  findSimilarSkills,
  stageSanitizedPublish,
  approveStagedPublish,
  publishVisibilityReceipt,
  liveSkillVisible,
  writeSkill,
  isManaged,
  listSkillNames,
  readSkill,
  retireManagedSkill,
  agentSkillsDir,
  scanDirs,
  MM_TAG,
  ENGRAM,
  expectationFor,
  predictionError,
  tagExperience,
  captureTagged,
  skillRetrieved,
  labileSkills,
  replayQueue,
  reverseReplay,
  interleave,
  engramConsolidate,
  renderEngramDigest,
  guardDecision,
  buildNeocortexBlock,
  nativeEnabled,
  NEOCORTEX_BLOCK,
  applySemanticEvidence,
  semanticSkillCandidates,
  syncSkillPassages
};
function activate(letta) {
  const disposers = [];
  let panel = null;
  const DEFENSE_HITS = join6(STATE_DIR, "defense-hits.jsonl");
  let defensesCache = [];
  const refreshDefenses = () => {
    try {
      defensesCache = buildDefenses(loadExperience());
    } catch {
      defensesCache = [];
    }
  };
  refreshDefenses();
  const semanticFnFor = (agentId) => (q, k) => semanticSkillCandidates(letta.client, agentId, q, k);
  if (typeof letta.permissions?.register === "function") {
    disposers.push(letta.permissions.register({
      id: "muscle-memory-guard",
      description: "Ask/deny before a tool that recurs into a learned, unrecovered failure (set MM_GUARD=ask|deny).",
      check: (event) => {
        try {
          const mode = process.env.MM_GUARD === "deny" ? "deny" : process.env.MM_GUARD === "ask" ? "ask" : "off";
          if (mode === "off" || event?.phase !== "approval")
            return;
          const d = guardDecision(String(event?.toolName ?? ""), event?.args ?? {}, defensesCache, mode);
          return d ? { decision: d.decision, reason: d.reason } : undefined;
        } catch {
          return;
        }
      }
    }));
  }
  if (letta.capabilities?.events?.tools) {
    disposers.push(letta.events.on("tool_start", (event) => {
      try {
        const tool = String(event?.toolName ?? "");
        if (!tool)
          return;
        const { fp, tmpl } = fingerprint2(tool, event?.args ?? {});
        const cap = process.env.MM_CAPTURE;
        const fix = cap === "worked" && (tool === "Edit" || tool === "Write" || tool === "fast_apply") ? buildDiffFragment(event?.args ?? {}) : undefined;
        appendJsonl(LOG_PATH, { ts: Date.now(), conv: event?.conversationId ?? null, agent: event?.agentId ?? null, tool, fp, tmpl, h: hash(fp), id: event?.toolCallId ?? null, ...fix ? { fix } : {} });
        if (tool === "Skill" && typeof event?.args?.skill === "string")
          bumpUsage(slug(String(event.args.skill)));
        if (defensesCache.length) {
          const hit = preActionDefense(stepSig({ tool, fp, tmpl }), defensesCache);
          if (hit && hit.severity >= 2)
            appendJsonl(DEFENSE_HITS, { ts: Date.now(), conv: event?.conversationId ?? null, step: hit.trigger, kind: hit.kind, errClass: hit.errClass, defense: hit.defense, severity: hit.severity });
        }
      } catch {}
      return;
    }));
    try {
      disposers.push(letta.events.on("tool_end", (event) => {
        try {
          const status = String(event?.status ?? "");
          const ok = status ? status === "success" : event?.ok ?? !(event?.isError || event?.error);
          const err = ok ? null : classifyError(event?.output ?? event?.resultText ?? event?.error ?? "", false);
          const cap = process.env.MM_CAPTURE;
          const errMsg = !ok && (cap === "context" || cap === "worked") ? redactFragment(event?.output ?? event?.resultText ?? event?.error ?? "", 8, 320) : undefined;
          appendJsonl(OUTCOME_PATH, { ts: Date.now(), id: event?.toolCallId ?? null, tool: event?.toolName ?? null, conv: event?.conversationId ?? null, ok, err, ...errMsg ? { errMsg } : {} });
        } catch {}
        return;
      }));
    } catch {}
  }
  if (letta.capabilities?.events?.llm) {
    const spanByConv = new Map;
    disposers.push(letta.events.on("llm_start", (event) => {
      try {
        spanByConv.set(String(event?.conversationId ?? "?"), Date.now());
      } catch {}
    }));
    disposers.push(letta.events.on("llm_end", (event) => {
      try {
        const started = spanByConv.get(String(event?.conversationId ?? "?")) ?? Date.now();
        const span = { tokensIn: event?.usage?.promptTokens ?? event?.tokensIn, tokensOut: event?.usage?.completionTokens ?? event?.tokensOut, ms: Date.now() - started, stop: event?.stopReason };
        let t = {};
        try {
          if (existsSync5(TELEMETRY_PATH))
            t = JSON.parse(readFileSync5(TELEMETRY_PATH, "utf8"));
        } catch {}
        const agg = aggregateTelemetry([span]);
        t.calls = (t.calls || 0) + agg.calls;
        t.tokensIn = (t.tokensIn || 0) + agg.tokensIn;
        t.tokensOut = (t.tokensOut || 0) + agg.tokensOut;
        t.ms = (t.ms || 0) + agg.ms;
        try {
          ensureDir();
          writeFileSync5(TELEMETRY_PATH, JSON.stringify(t));
        } catch {}
      } catch {}
    }));
  }
  if (letta.capabilities?.events?.compact) {
    disposers.push(letta.events.on("compact_start", (event) => {
      try {
        ensureDir();
        mkdirSync5(RECEIPTS_DIR, { recursive: true });
        const { candidates } = detect(loadExperience());
        writeFileSync5(join6(RECEIPTS_DIR, `compact-${Date.now()}.json`), JSON.stringify({ phase: "start", conv: event?.conversationId ?? null, candidatesPreserved: candidates.length, ts: Date.now() }));
      } catch {}
    }));
    disposers.push(letta.events.on("compact_end", (event) => {
      try {
        ensureDir();
        mkdirSync5(RECEIPTS_DIR, { recursive: true });
        writeFileSync5(join6(RECEIPTS_DIR, `compact-end-${Date.now()}.json`), JSON.stringify({ phase: "end", conv: event?.conversationId ?? null, trigger: event?.trigger ?? null, messagesBefore: event?.messagesBefore ?? null, messagesAfter: event?.messagesAfter ?? null, contextTokensBefore: event?.contextTokensBefore ?? null, contextTokensAfter: event?.contextTokensAfter ?? null, ts: Date.now() }));
      } catch {}
    }));
  }
  if (letta.capabilities?.events?.lifecycle) {
    disposers.push(letta.events.on("conversation_close", (event, ctx) => {
      appendJsonl(SESSIONS_PATH, { ts: Date.now(), conv: event?.conversationId ?? null, agent: event?.agentId ?? null, reason: event?.reason ?? null, toolCalls: event?.toolCallCount ?? null, messages: event?.messageCount ?? null, durationMs: event?.durationMs ?? null });
      refreshDefenses();
      if (nativeEnabled("blocks") || nativeEnabled("passages")) {
        try {
          const managed = managedView(scanDirs(ctx ?? {})).map((m) => ({ name: m.name, description: m.description }));
          if (nativeEnabled("blocks"))
            syncNeocortexBlock(letta.client, event?.agentId ?? null, buildNeocortexBlock(managed));
          if (nativeEnabled("passages"))
            syncSkillPassages(letta.client, event?.agentId ?? null, managed);
        } catch {}
      }
      const apMode = process.env.MM_AUTOPILOT;
      if (apMode === "staged" || apMode === "auto") {
        runAutopilot(ctx ?? { agentId: event?.agentId }, { ...AUTOPILOT_DEFAULT, mode: apMode }).catch(() => {});
      }
      const rfMode = process.env.MM_REFLECT;
      if (rfMode === "staged" || rfMode === "auto") {
        runReflectiveReview(ctx ?? { agentId: event?.agentId }, { mode: rfMode, semanticFn: semanticFnFor(event?.agentId ?? ctx?.agent?.id) }).then(() => {
          runAutonomousPrune(ctx ?? { agentId: event?.agentId }, { maxRetire: 1 });
          try {
            panel?.update();
          } catch {}
        }).catch(() => {});
      }
    }));
  }
  if (letta.capabilities?.events?.turns) {
    let autoReflectInFlight = false;
    disposers.push(letta.events.on("turn_end", (event, ctx) => {
      const rfMode = process.env.MM_REFLECT;
      if (rfMode !== "staged" && rfMode !== "auto" || autoReflectInFlight)
        return;
      try {
        const ev = buildCrossConversationEvidence(loadExperience());
        if (ev.items < 2 || loadHandledReflects()[reflectSignature(ev)])
          return;
      } catch {
        return;
      }
      autoReflectInFlight = true;
      runReflectiveReview(ctx ?? { agentId: event?.agentId }, { mode: rfMode, semanticFn: semanticFnFor(event?.agentId ?? ctx?.agent?.id) }).then(() => {
        runAutonomousPrune(ctx ?? { agentId: event?.agentId }, { maxRetire: 1 });
        try {
          panel?.update();
        } catch {}
      }).catch(() => {}).finally(() => {
        autoReflectInFlight = false;
      });
    }));
  }
  if (letta.capabilities?.ui?.panels && letta.ui?.openPanel) {
    try {
      panel = letta.ui.openPanel({ id: "muscle-memory-live", order: 20, render: () => {
        try {
          return renderMuscleMemoryPanel(readUiState());
        } catch {
          return [];
        }
      } });
      setLivePanel(panel);
      try {
        const s = readUiState();
        if (s && s.phase && s.phase !== "done")
          writeUiState({ phase: "idle", last: "ready", route: "" });
      } catch {}
      const t = setInterval(() => {
        try {
          panel?.update();
        } catch {}
      }, 20000);
      disposers.push(() => {
        clearInterval(t);
        try {
          panel?.close();
        } catch {}
      });
    } catch {}
  }
  if (letta.capabilities?.commands) {
    disposers.push(letta.commands.register({
      id: "muscle-memory",
      description: "Show muscle-memory observations + current mature skill candidates",
      async run(ctx = {}) {
        const argv = Array.isArray(ctx?.argv) ? ctx.argv : String(ctx?.args || "").trim().split(/\s+/).filter(Boolean);
        const sub = String(argv?.[0] || "").toLowerCase();
        if (sub === "events") {
          const n = Math.max(1, Math.min(50, Number(argv?.[1] || 8) || 8));
          const events2 = loadUiEvents(n);
          const lines = events2.map((e) => `\uD83D\uDCBE muscle-memory review: ${e.summary}`);
          return { type: "output", output: lines.join(`
`) || "(no muscle-memory review events yet)" };
        }
        if (sub === "squad") {
          const feed = loadMeshFeed(10);
          return { type: "output", output: feed.length ? `\uD83D\uDCBE squad distillations (cross-agent):
` + renderMeshFeed(feed).map((l) => `  ${l}`).join(`
`) : "(no squad distillations yet — Mack + Kev appear here as they distill)" };
        }
        if (sub === "staged") {
          let s = [];
          try {
            s = existsSync5(STAGED_DIR) ? readdirSync3(STAGED_DIR).filter((n) => existsSync5(join6(STAGED_DIR, n, "SKILL.md"))) : [];
          } catch {}
          return { type: "output", output: s.length ? `staged skills (1-tap to graduate):
` + s.map((n) => `  · ${n}`).join(`
`) : "(no staged skills yet — set MM_REFLECT=staged, work a few sessions)" };
        }
        if (sub === "coverage") {
          const cov2 = coverageMap(loadExperience(), scanDirs(ctx));
          const icon = (st) => st === "covered" ? "✓" : st === "uncovered" ? "＋" : st === "over-covered" ? "⧉" : "✗";
          return { type: "output", output: cov2.length ? cov2.map((c) => `${icon(c.status)} [${c.status}] ${c.domain}${c.skill ? ` → ${c.skill}` : ""}`).join(`
`) : "(no durable task-classes yet)" };
        }
        if (sub === "audit") {
          const dirs = scanDirs(ctx);
          const entries = [];
          for (const d of dirs) {
            const shelf = d === GLOBAL_SKILLS ? "global" : "agent";
            for (const n of listSkillNames(d)) {
              try {
                entries.push({ name: n, shelf, body: readSkill(d, n), description: skillDesc(d, n) });
              } catch {}
            }
          }
          const seen = new Set;
          const skills = [];
          for (const e of entries) {
            if (seen.has(e.name))
              continue;
            seen.add(e.name);
            skills.push({ name: e.name, description: e.description, body: e.body });
          }
          const r = auditSkills(skills);
          const dups = crossShelfDuplicates(entries).filter((x) => x.divergent);
          const pct = r.total ? Math.round(100 * r.clean / r.total) : 0;
          const gapline = Object.entries(r.gapCounts).sort((a, b) => b[1] - a[1]).map(([g, c]) => `${g} ×${c}`).join("  ") || "—";
          const top = r.flagged.slice(0, 20).map((f) => `  ⚠ ${f.name.slice(0, 46).padEnd(48)} ${f.gaps.map((g) => g.split(":")[0]).join(", ")}`).join(`
`);
          const dupline = dups.length ? `
⧉ cross-shelf duplicates (consolidate — stale copy diverging): ${dups.map((x) => `${x.name} [${x.shelves.join("+")}]`).join(", ")}` : "";
          return { type: "output", output: `\uD83C\uDFC5 SOTA library audit — ${r.total} skills · ${r.clean} top-tier (${pct}%) · ${r.flagged.length} to upgrade${dups.length ? ` · ${dups.length} dup` : ""}
gaps: ${gapline}
${top}${r.flagged.length > 20 ? `
  …and ${r.flagged.length - 20} more` : ""}${dupline}` };
        }
        if (sub === "publish") {
          const v1 = String(argv?.[1] || "").toLowerCase();
          const action = v1 === "stage" || v1 === "approve" ? v1 : "preflight";
          const target = String((action === "preflight" ? argv?.[1] : argv?.[2]) || "").trim();
          if (!target)
            return { type: "output", output: "usage: /muscle-memory publish <skill> | publish stage <skill> | publish approve <skill>  (never auto-publishes)" };
          const dirs = scanDirs(ctx);
          let found = null;
          for (const d of dirs)
            for (const n of listSkillNames(d))
              if (n.toLowerCase() === target.toLowerCase()) {
                found = { dir: d, name: n };
                break;
              }
          if (action === "approve") {
            const res = approveStagedPublish(target, GLOBAL_SKILLS);
            if (!res.published)
              return { type: "output", output: `\uD83D\uDEAB not published — ${res.reason}` };
            try {
              appendUiEvent({ phase: "skill_published", summary: `published '${target}' to Custom Skills`, skill: target, action: "publish" });
              appendMeshFeed({ type: "skill_published", skill: target, route: "PUBLISH", signals: 0 });
            } catch {}
            const vis = publishVisibilityReceipt(target, GLOBAL_SKILLS);
            const live = liveSkillVisible(slug(target), ctx?.agent?.id || ctx?.agentId);
            return { type: "output", output: `✅ published — ${res.path}
  on disk: ${vis.exists ? "yes ✓" : "NO ❌"}
  live index: ${live.checked ? live.visible ? "✓ visible to the agent now" : "not loaded yet" : "not queried"}  ·  ${live.note}` };
          }
          if (!found)
            return { type: "output", output: `skill "${target}" not found (try /muscle-memory audit to list)` };
          const skill = { name: found.name, description: skillDesc(found.dir, found.name), body: readSkill(found.dir, found.name), shelf: "agent" };
          const plan = publishPlan(skill);
          const tier = publishTier(plan);
          const existing = listSkillNames(GLOBAL_SKILLS).filter((n) => n !== found.name).map((n) => ({ name: n, description: skillDesc(GLOBAL_SKILLS, n) }));
          const dups = findSimilarSkills(found.name, skill.description, existing);
          if (action === "stage") {
            const st = stageSanitizedPublish(skill);
            if (!st.staged)
              return { type: "output", output: `\uD83D\uDEAB not staged — ${st.reason}` };
            try {
              appendUiEvent({ phase: "skill_publish_staged", summary: `staged '${found.name}' (tier=${st.tier}, ${plan.publishability}/100)`, skill: found.name, action: "stage" });
            } catch {}
            const dupline2 = dups.length ? `
⚠ similar Custom Skills: ${dups.map((d) => `${d.name} (${d.why})`).join("; ")}` : "";
            return { type: "output", output: `\uD83D\uDCE6 staged SANITIZED publish — ${found.name}
  ${st.dir}/SKILL.md  +  PUBLISH-PLAN.json
  tier: ${st.tier}  ·  publishability ${plan.publishability}/100${dupline2}
  next: review the sanitized SKILL.md, then \`/muscle-memory publish approve ${found.name}\`` };
          }
          try {
            appendUiEvent({ phase: "skill_publish_preflight", summary: `${plan.skill}: ${plan.publishability}/100 · tier=${tier} · ${plan.recommended}`, skill: found.name });
          } catch {}
          const blocks = plan.hardBlocks.length ? `
\uD83D\uDEAB HARD BLOCKS (never publish): ${plan.hardBlocks.join("; ")}` : "";
          const issues = plan.issues.length ? plan.issues.map((i) => `  - [${i.axis}] ${i.detail}`).join(`
`) : "  (none)";
          const reps = plan.replacements.length ? `
sanitize: ${plan.replacements.map((r) => `${r.from.slice(0, 22)} → ${r.to}`).join(", ")}` : "";
          const dupline = dups.length ? `
⚠ similar Custom Skills (consider merge/update): ${dups.map((d) => d.name).join(", ")}` : "";
          const act = plan.recommended === "publish" ? "✅ publish as-is (clean)" : plan.recommended === "stage-sanitized" ? "\uD83D\uDCE6 stage SANITIZED (run `publish stage`)" : "\uD83D\uDEAB block";
          return { type: "output", output: `\uD83D\uDEA2 publish preflight — ${plan.skill}
  ${plan.currentShelf} → ${plan.recommendedShelf}  ·  tier: ${tier}  ·  publishability ${plan.publishability}/100  ·  ${act}${blocks}
issues:
${issues}${reps}${dupline}
(dry-run — nothing published.)` };
        }
        if (sub === "engram") {
          const dirs = scanDirs(ctx);
          const plan = engramConsolidate(loadExperience(), managedView(dirs).map((m) => ({ name: m.name, body: m.body })));
          const head = `\uD83E\uDDE0 ENGRAM (CLS loop) · hippocampus ${plan.hippoSize} reps · ${plan.replay.length} replay · ${plan.rescued.length} rescued · ${plan.labile.length} labile`;
          return { type: "output", output: `${head}

${plan.digest}` };
        }
        if (sub === "lifecycle" || sub === "skills") {
          const dirs = scanDirs(ctx);
          const reg = buildRegistry(dirs);
          let staged2 = [];
          try {
            staged2 = existsSync5(STAGED_DIR) ? readdirSync3(STAGED_DIR).filter((n) => existsSync5(join6(STAGED_DIR, n, "SKILL.md"))) : [];
          } catch {}
          const used = reg.skills.filter((s) => s.uses > 0);
          const idle = reg.skills.filter((s) => s.uses === 0 && s.state !== "archived");
          const archived = reg.skills.filter((s) => s.state === "archived");
          const L = ["\uD83D\uDCBE muscle-memory · skill lifecycle (creation → use → prune)"];
          L.push(`
\uD83C\uDF31 staged · 1-tap to graduate (${staged2.length})`);
          staged2.slice(0, 8).forEach((n) => L.push(`   · ${n}`));
          L.push(`
✅ active · earning context (${used.length})`);
          used.slice(0, 10).forEach((s) => L.push(`   · ${s.name} — ${s.uses} uses${s.pinned ? " \uD83D\uDCCC" : ""}`));
          L.push(`
\uD83D\uDCA4 idle · prune candidates (${idle.length})`);
          idle.slice(0, 10).forEach((s) => L.push(`   · ${s.name}${s.pinned ? " \uD83D\uDCCC pinned (protected)" : " — retires after 30d unused (reversible)"}`));
          if (archived.length) {
            L.push(`
\uD83D\uDDC4 retired · reversible quarantine (${archived.length})`);
            archived.slice(0, 6).forEach((s) => L.push(`   · ${s.name}${s.absorbedInto ? ` → absorbed into ${s.absorbedInto}` : ""}`));
          }
          return { type: "output", output: L.join(`
`) };
        }
        const rows = loadExperience();
        const byTool = {};
        for (const r of rows)
          byTool[r.tool] = (byTool[r.tool] || 0) + 1;
        const { candidates, templates, sequences } = detect(rows);
        const toolLine = Object.entries(byTool).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}:${n}`).join("  ");
        const cand = candidates.slice(0, 6).map((c) => `  [${c.maturity}] ${c.kind} ×${c.count}/${c.convs}conv${c.fixes ? ` (${c.fixes} fixes)` : ""}  ${c.key.slice(0, 90)}`).join(`
`);
        const mode = process.env.MM_REFLECT === "auto" ? "auto" : process.env.MM_REFLECT === "staged" ? "staged" : "off (set MM_REFLECT=staged to enable)";
        const events = loadUiEvents(8);
        const lastReview = events.length ? summarizeReflectActions(events) : "(no review yet)";
        let managed = 0, staged = 0;
        try {
          for (const d of scanDirs(ctx))
            for (const n of listSkillNames(d))
              if (isManaged(d, n))
                managed++;
        } catch {}
        try {
          staged = existsSync5(STAGED_DIR) ? readdirSync3(STAGED_DIR).filter((n) => existsSync5(join6(STAGED_DIR, n, "SKILL.md"))).length : 0;
        } catch {}
        const cov = (() => {
          try {
            const c = coverageMap(rows, scanDirs(ctx));
            return `${c.filter((x) => x.status === "covered").length} covered / ${c.filter((x) => x.status === "uncovered").length} uncovered / ${c.filter((x) => x.status === "over-covered").length} over-covered`;
          } catch {
            return "n/a";
          }
        })();
        const out = [
          `\uD83D\uDCBE muscle-memory · reflect ${mode}`,
          `last review: ${lastReview}`,
          `library: ${managed} managed · ${staged} staged · coverage ${cov}`,
          ``,
          `recent review events:`,
          events.slice(-5).map((e) => `  · ${e.summary}`).join(`
`) || `  (none yet — set MM_REFLECT=staged, work a few sessions)`,
          ...(() => {
            const feed = loadMeshFeed(4);
            return feed.length ? [``, `squad distillations (cross-agent):`, ...renderMeshFeed(feed).map((l) => `  ${l}`)] : [];
          })(),
          ``,
          `${rows.length} reps observed${toolLine ? ` · tools ${toolLine}` : ""}`,
          `mature candidates: ${candidates.length} (${templates.length} templates, ${sequences.length} sequences)`,
          cand || `  (none mature yet — need ≥${MM.MIN_COUNT}× across ≥${MM.MIN_CONVS} conversations)`,
          ``,
          `commands: /muscle-memory [lifecycle|staged|coverage|engram|events|squad]`
        ].join(`
`);
        return { type: "output", output: out };
      }
    }));
  }
  if (letta.capabilities?.tools) {
    const readParams = {
      type: "object",
      properties: {
        action: { type: "string", enum: ["candidates", "draft", "load", "list", "curate", "repairs", "antipatterns", "defenses", "defense_hits", "registry", "autopilot_plan", "reflect_plan", "coverage"], description: "read-only operation to perform" },
        name: { type: "string", description: "skill name — for load" },
        candidate_key: { type: "string", description: "candidate key or substring to draft; defaults to top mature candidate" },
        mode: { type: "string", enum: ["staged", "auto"], description: "autopilot mode preview — for autopilot_plan" }
      },
      required: ["action"],
      additionalProperties: false
    };
    const writeParams = {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create_from_candidate", "create", "patch", "edit_full", "write_file", "remove_file", "retire", "restore", "pin", "unpin", "autopilot_run", "reflect", "graduate"], description: "mutating operation to perform" },
        mode: { type: "string", enum: ["staged", "auto"], description: "autopilot mode — for autopilot_run (staged=draft+1-tap, auto=graduate-on-gate)" },
        name: { type: "string", description: "skill name (gerund, lowercase-hyphen) — for create/patch/retire" },
        description: { type: "string", description: "skill description incl. trigger phrases — for create" },
        body: { type: "string", description: "SKILL.md markdown body — for create" },
        old: { type: "string", description: "exact text to replace — for patch" },
        replacement: { type: "string", description: "replacement text — for patch" },
        candidate_key: { type: "string", description: "candidate key or substring to create from; defaults to top mature candidate" },
        reason: { type: "string", description: "reason for retirement/quarantine — for retire" },
        absorbed_into: { type: "string", description: "umbrella skill name this was merged into — for retire (consolidation vs prune)" },
        file_path: { type: "string", description: "support file path under references/templates/scripts/assets — for write_file/remove_file" },
        file_content: { type: "string", description: "support file content — for write_file" }
      },
      required: ["action"],
      additionalProperties: false
    };
    const readRun = async (ctx) => {
      const a = ctx?.args || {};
      const dirs = scanDirs(ctx);
      const findSkillDir = (name) => dirs.find((d) => existsSync5(join6(d, name, "SKILL.md")));
      try {
        if (a.action === "candidates") {
          const rows = loadExperience();
          const { candidates } = detect(rows);
          return candidates.slice(0, 10).map((c) => `[impact ${impactScore(c).score} | mat ${c.maturity}] ${c.kind} ×${c.count}/${c.convs}conv${c.fixes ? ` (${c.fixes}fix)` : ""}  ${c.key}`).join(`
`) || "(no mature candidates yet — keep working)";
        }
        if (a.action === "repairs") {
          const rs = detectRepairChains(loadExperience());
          return rs.slice(0, 10).map((r) => `×${r.count}/${r.convs}conv  FAIL[${r.trigger}] (${r.errClass}) → ${r.fixStep} → PASS`).join(`
`) || "(no repair chains observed yet)";
        }
        if (a.action === "antipatterns") {
          const aps = detectAntiPatterns(loadExperience());
          return aps.slice(0, 10).map((p) => `×${p.fails}fails/${p.convs}conv  AVOID[${p.step}] — ${p.errClass}`).join(`
`) || "(no recurring unrecovered failures observed)";
        }
        if (a.action === "defenses") {
          const ds = buildDefenses(loadExperience());
          return ds.slice(0, 12).map((d) => `[sev${d.severity} ${d.kind}] ${d.trigger} → ${d.errClass} ⇒ ${d.defense}`).join(`
`) || "(no defenses learned yet)";
        }
        if (a.action === "defense_hits") {
          const hits = [];
          if (existsSync5(DEFENSE_HITS))
            for (const l of readFileSync5(DEFENSE_HITS, "utf8").trim().split(`
`).slice(-20)) {
              if (l)
                try {
                  hits.push(JSON.parse(l));
                } catch {}
            }
          return hits.length ? hits.map((h) => `[sev${h.severity} ${h.kind}] ${h.step} → ${h.errClass} ⇒ ${h.defense}`).join(`
`) : "(no pre-action defense hits recorded)";
        }
        if (a.action === "registry") {
          const reg = buildRegistry(dirs);
          return reg.count ? `${reg.count} managed skills:
` + reg.skills.map((s) => `- ${s.name}: ${s.description}`).join(`
`) : "(registry empty)";
        }
        if (a.action === "autopilot_plan") {
          const rows = loadExperience();
          const plan = autopilotPlan({ rows, managed: managedView(dirs), dirsForDedup: dirs, config: { ...AUTOPILOT_DEFAULT, mode: a.mode === "auto" ? "auto" : "staged" } });
          const lines = plan.decisions.map((d) => d.op === "distill" ? `  DISTILL ${d.name} [${d.gate}] — ${d.reason}` : d.op === "refine" ? `  REFINE ${d.skill} — ${d.reason}` : `  RETIRE ${d.skill} — ${d.reason}`);
          return `autopilot mode=${plan.mode} budget=${plan.budget.used}/${plan.budget.limit}
${lines.join(`
`) || "  (no decisions)"}
skipped: ${plan.skipped.length}`;
        }
        if (a.action === "reflect_plan") {
          const ev = buildCrossConversationEvidence(loadExperience());
          const top = searchSkills([...dirs, STAGED_DIR], ev.digest, 3);
          const tgt = pickUpdateTarget(top, 18);
          const route = tgt ? `UPDATE-FIRST → "${tgt.name}" (score ${tgt.score}, ${tgt.matched} distinctive terms, dominant)` : "CREATE (no existing skill safely covers this — matches too weak/ambiguous/tied)";
          return `reflective review preview — ${ev.convs} sessions, ${ev.items} durable signals
routing: ${route}
top matches: ${top.map((t) => `${t.name}(s${t.score}/m${t.matched})`).join(", ") || "none"}

${ev.digest.slice(0, 700)}`;
        }
        if (a.action === "coverage") {
          const cov = coverageMap(loadExperience(), dirs);
          if (!cov.length)
            return "(no durable task-classes observed yet)";
          const icon = (s) => s === "covered" ? "✓" : s === "uncovered" ? "＋" : s === "over-covered" ? "⧉" : "✗";
          return cov.map((c) => `${icon(c.status)} [${c.status}] ${c.domain}${c.skill ? ` → ${c.skill}` : ""} (${c.signals} signals)`).join(`
`);
        }
        if (a.action === "list") {
          const managed = [];
          for (const d of dirs)
            for (const n of listSkillNames(d))
              if (isManaged(d, n))
                managed.push(`- ${n}: ${skillDesc(d, n)}`);
          return managed.length ? managed.join(`
`) : "(no muscle-memory-managed skills yet — use muscle_memory_skill_write action:create)";
        }
        if (a.action === "curate") {
          const rows = curateManagedSkills(ctx);
          if (!rows.length)
            return "(no muscle-memory-managed skills yet — create one first)";
          return rows.map((r) => `${r.verdict.toUpperCase()} uses=${r.uses} ${r.name} — ${r.reason}`).join(`
`);
        }
        if (a.action === "load") {
          if (!a.name)
            return { status: "error", content: "name required" };
          const d = findSkillDir(a.name);
          if (!d)
            return { status: "error", content: `no skill '${a.name}'` };
          return readSkill(d, a.name);
        }
        if (a.action === "draft") {
          const c = findCandidate(a.candidate_key);
          if (!c)
            return { status: "error", content: "no matching mature candidate — run action:candidates first or keep working" };
          const repair = repairForCandidate(c);
          const d = draftWithRepair(c, repair);
          const lint = lintSkillDraft(d, { needsPitfalls: !!c.fixes });
          return { candidate: c, ...d, repair: repair ?? null, lint, content: `---
name: ${d.name}
description: ${d.description}
---

${d.body}` };
        }
        return { status: "error", content: "unknown read action" };
      } catch (e) {
        return { status: "error", content: String(e?.message ?? e) };
      }
    };
    const writeRun = async (ctx) => {
      const a = ctx?.args || {};
      const dir = agentSkillsDir(ctx);
      const dirs = scanDirs(ctx);
      const findSkillDir = (name) => dirs.find((d) => existsSync5(join6(d, name, "SKILL.md")));
      try {
        if (a.action === "autopilot_run") {
          const cfg = { ...AUTOPILOT_DEFAULT, mode: a.mode === "auto" ? "auto" : "staged" };
          const r = await runAutopilot(ctx, cfg);
          const res = r.result || { graduated: [], staged: [], refined: [], retired: [] };
          return `autopilot ${cfg.mode}: graduated ${res.graduated.length} ${JSON.stringify(res.graduated)}, staged ${res.staged.length}, refined ${res.refined.length} ${JSON.stringify(res.refined)}, retired ${res.retired.length} ${JSON.stringify(res.retired)}. budget ${r.budget.used + res.graduated.length + res.staged.length}/${r.budget.limit}.`;
        }
        if (a.action === "reflect") {
          const r = await runReflectiveReview(ctx, { mode: a.mode === "auto" ? "auto" : "staged", semanticFn: semanticFnFor(ctx?.agent?.id) });
          if (r.action === "none" || r.action === "reject")
            return `reflect: ${r.action} — ${r.reason || ""}`;
          const graduated = !!r.wrote && !String(r.wrote).startsWith(STAGED_DIR);
          return `reflect: ${r.action} skill "${r.name}"${r.updateTarget ? ` (updated existing — anti-bloat)` : ""}${graduated ? " (graduated)" : ""} → ${r.wrote || "(write failed)"}`;
        }
        if (a.action === "graduate") {
          if (!a.name)
            return { status: "error", content: "name required" };
          const p = graduateStagedSkill(String(a.name), ctx);
          return `graduated '${slug(a.name)}' -> ${p}`;
        }
        if (a.action === "pin") {
          if (!a.name)
            return { status: "error", content: "name required" };
          setPinned(slug(a.name), true);
          return `pinned '${slug(a.name)}' — protected from auto-retire/consolidation (patches still allowed)`;
        }
        if (a.action === "unpin") {
          if (!a.name)
            return { status: "error", content: "name required" };
          setPinned(slug(a.name), false);
          return `unpinned '${slug(a.name)}'`;
        }
        if (a.action === "retire") {
          if (!a.name)
            return { status: "error", content: "name required" };
          const target = retireManagedSkill(slug(a.name), String(a.reason || "retired by muscle-memory"), ctx, a.absorbed_into ? slug(a.absorbed_into) : undefined);
          return `retired '${slug(a.name)}'${a.absorbed_into ? ` (absorbed into ${slug(a.absorbed_into)})` : ""} -> ${target} (reversible quarantine)`;
        }
        if (a.action === "create_from_candidate") {
          const c = findCandidate(a.candidate_key);
          if (!c)
            return { status: "error", content: "no matching mature candidate — run muscle_memory_skill_read action:candidates first or keep working" };
          const repair = repairForCandidate(c);
          const d = draftWithRepair(c, repair);
          const nm = slug(a.name || d.name);
          const retiredBlock = retiredSkillBlocker(nm, ctx);
          if (retiredBlock)
            return { status: "error", content: `retire-sticky blocked: ${retiredBlock}`, candidate: c };
          const desc = String(a.description || d.description);
          const dc = dedupCheck(nm, desc, createDedupeSurface(ctx));
          if (dc.dup)
            return { status: "error", content: `anti-bloat blocked: ${dc.reason}. Use action:patch on '${dc.name}' instead.`, candidate: c };
          const lint = lintSkillDraft({ name: nm, description: desc, body: d.body }, { needsPitfalls: !!c.fixes });
          if (!lint.ok)
            return { status: "error", content: `authoring-linter blocked: ${lint.issues.join("; ")}`, candidate: c };
          const secC = scanSkillContent(d.body);
          if (!secC.ok)
            return { status: "error", content: `security blocked: ${secC.issues.join("; ")}`, candidate: c };
          const prov = `
<!-- ${MM_TAG}: distilled ${new Date().toISOString().slice(0, 10)}; candidate=${c.kind}:${c.key}; reps=${c.count}; convs=${c.convs}; fixes=${c.fixes}; impact=${impactScore(c).score} -->
`;
          const content = `---
name: ${nm}
description: ${desc}
---

${d.body}${prov}
`;
          const p = writeSkill(dir, nm, content);
          return `created '${nm}' from candidate '${c.key}'${repair ? ` (w/ observed Pitfall: ${repair.errClass})` : ""} -> ${p}
Load with muscle_memory_skill_read action:load, then invoke the normal Skill tool with skill="${nm}". Dedup max overlap ${Math.round(dc.overlap * 100)}% (${dc.name || "none"}); lint OK.`;
        }
        if (a.action === "create") {
          if (!a.name || !a.description || !a.body)
            return { status: "error", content: "need name, description, body" };
          const nm = slug(a.name);
          const retiredBlock = retiredSkillBlocker(nm, ctx);
          if (retiredBlock)
            return { status: "error", content: `retire-sticky blocked: ${retiredBlock}` };
          const dc = dedupCheck(nm, a.description, createDedupeSurface(ctx));
          if (dc.dup)
            return { status: "error", content: `anti-bloat blocked: ${dc.reason}. Use action:patch on '${dc.name}' instead.` };
          const lint = lintSkillDraft({ name: nm, description: a.description, body: a.body });
          if (!lint.ok)
            return { status: "error", content: `authoring-linter blocked: ${lint.issues.join("; ")}` };
          const sec0 = scanSkillContent(a.body);
          if (!sec0.ok)
            return { status: "error", content: `security blocked: ${sec0.issues.join("; ")}` };
          const prov = `
<!-- ${MM_TAG}: distilled ${new Date().toISOString().slice(0, 10)} -->
`;
          const body = a.body.includes(MM_TAG) ? a.body : a.body + prov;
          const content = `---
name: ${nm}
description: ${a.description}
---

${body}
`;
          const p = writeSkill(dir, nm, content);
          return `created '${nm}' -> ${p}
Load with muscle_memory_skill_read action:load, then invoke the normal Skill tool with skill="${nm}" when you want to use it. Dedup max overlap ${Math.round(dc.overlap * 100)}% (${dc.name || "none"}).`;
        }
        if (a.action === "patch") {
          if (!a.name || a.old == null || a.replacement == null)
            return { status: "error", content: "need name, old, replacement" };
          const d = findSkillDir(a.name);
          if (!d)
            return { status: "error", content: `no skill '${a.name}'` };
          const t = readSkill(d, a.name);
          if (!t.includes(a.old))
            return { status: "error", content: "old text not found in skill" };
          const nt = t.replace(a.old, a.replacement);
          const secP = scanSkillContent(nt);
          if (!secP.ok)
            return { status: "error", content: `security blocked: ${secP.issues.join("; ")}` };
          writeSkill(d, a.name, nt);
          return `patched '${a.name}' in ${d}`;
        }
        if (a.action === "edit_full") {
          if (!a.name || !a.body)
            return { status: "error", content: "need name, body (full SKILL.md)" };
          const d = findSkillDir(a.name);
          if (!d)
            return { status: "error", content: `no skill '${a.name}'` };
          const desc = (a.body.match(/description:\s*(.+)/)?.[1] || a.description || "").trim();
          const lint = lintSkillDraft({ name: slug(a.name), description: desc, body: a.body });
          if (!lint.ok)
            return { status: "error", content: `linter blocked: ${lint.issues.join("; ")}` };
          const sec = scanSkillContent(a.body);
          if (!sec.ok)
            return { status: "error", content: `security blocked: ${sec.issues.join("; ")}` };
          writeSkill(d, a.name, a.body.includes(MM_TAG) ? a.body : a.body + `
<!-- ${MM_TAG}: edited ${new Date().toISOString().slice(0, 10)} -->
`);
          return `full-rewrote '${a.name}'`;
        }
        if (a.action === "write_file") {
          if (!a.name || !a.file_path || a.file_content == null)
            return { status: "error", content: "need name, file_path, file_content" };
          const full = writeSupportFile(slug(a.name), String(a.file_path), String(a.file_content), ctx);
          return `wrote support file ${a.file_path} -> ${full}`;
        }
        if (a.action === "remove_file") {
          if (!a.name || !a.file_path)
            return { status: "error", content: "need name, file_path" };
          const grave = removeSupportFile(slug(a.name), String(a.file_path), ctx);
          return `removed ${a.file_path} (reversible quarantine -> ${grave})`;
        }
        if (a.action === "restore") {
          if (!a.name)
            return { status: "error", content: "name required" };
          const p = restoreManagedSkill(slug(a.name), ctx);
          return `restored '${slug(a.name)}' -> ${p}`;
        }
        return { status: "error", content: "unknown write action" };
      } catch (e) {
        return { status: "error", content: String(e?.message ?? e) };
      }
    };
    const lifecycleParams = {
      type: "object",
      properties: {
        action: { type: "string", enum: ["reflect", "graduate", "publish", "prune"], description: "Safe no-approval lifecycle action" },
        mode: { type: "string", enum: ["staged", "auto"], description: "reflect mode; staged still auto-graduates trusted updates/high-confidence creates" },
        name: { type: "string", description: "staged skill name — for graduate" }
      },
      required: ["action"]
    };
    const lifecycleRun = async (ctx) => {
      const a = ctx?.args || {};
      try {
        if (a.action === "reflect") {
          const r = await runReflectiveReview(ctx, { mode: a.mode === "auto" ? "auto" : "staged", semanticFn: semanticFnFor(ctx?.agent?.id) });
          if (r.action === "none" || r.action === "reject")
            return `reflect: ${r.action} — ${r.reason || ""}`;
          const graduated = !!r.wrote && !String(r.wrote).startsWith(STAGED_DIR);
          return `reflect: ${r.action} skill "${r.name}"${r.updateTarget ? ` (updated existing — anti-bloat)` : ""}${graduated ? " (graduated)" : ""} → ${r.wrote || "(write failed)"}`;
        }
        if (a.action === "graduate") {
          if (!a.name)
            return { status: "error", content: "name required" };
          const p = graduateStagedSkill(String(a.name), ctx);
          return `graduated '${slug(a.name)}' -> ${p}`;
        }
        if (a.action === "publish") {
          if (!a.name)
            return { status: "error", content: "name required" };
          const p = publishSkillToCatalog(String(a.name), ctx);
          return `published '${slug(a.name)}' -> ${p}`;
        }
        if (a.action === "prune") {
          const r = runAutonomousPrune(ctx, { maxRetire: 1 });
          return `prune: retired ${r.retired.length} ${JSON.stringify(r.retired)}, flagged ${r.flagged.length}, kept ${r.kept.length}`;
        }
        return { status: "error", content: "unknown lifecycle action" };
      } catch (e) {
        return { status: "error", content: String(e?.message ?? e) };
      }
    };
    disposers.push(letta.tools.register({
      name: "muscle_memory_skill_read",
      description: "muscle-memory = self-improving skills distilled from your own work. Read-only inspection (no approval, no writes). START HERE with action:reflect_plan — it previews the class-level skill it would distill from your cross-session history + the update-first routing (which existing skill it would create or patch). Also: coverage (skill-gap map), candidates/registry/curate (what it has observed + manages), list/load (inspect a managed skill). Run before any write.",
      parameters: readParams,
      requiresApproval: false,
      async run(ctx) {
        return readRun(ctx);
      }
    }));
    disposers.push(letta.tools.register({
      name: "muscle_memory_skill_write",
      description: "muscle-memory writes (approval-gated, reversible). THE CORE LOOP: action:reflect distills a class-level skill from your cross-conversation work → update-first anti-bloat, security/lint-gated, staged by default. graduate promotes a staged skill to your active skill shelf. Plus create/patch/edit_full/retire/restore/pin lifecycle + write_file for support files. Preview first with reflect_plan (the read tool). For no-approval reflect/graduate/publish/prune, use muscle_memory_lifecycle_run.",
      parameters: writeParams,
      requiresApproval: true,
      async run(ctx) {
        return writeRun(ctx);
      }
    }));
    disposers.push(letta.tools.register({
      name: "muscle_memory_lifecycle_run",
      description: "muscle-memory autonomous lifecycle (no-approval, safe, reversible): reflect (distill a skill from your work), graduate (promote a staged skill → active shelf), publish (mirror a skill → shared Custom Skills catalog), prune (retire stale/unused skills). This is the full self-improvement loop. Broad/manual skill edits → muscle_memory_skill_write; preview → reflect_plan in muscle_memory_skill_read.",
      parameters: lifecycleParams,
      requiresApproval: false,
      async run(ctx) {
        return lifecycleRun(ctx);
      }
    }));
  }
  return () => {
    for (const d of disposers.reverse())
      d();
  };
}
export {
  preserveExistingFrontmatterMetadata,
  isSkillWorthy,
  isAmbiguousExistingRoute,
  draftWithRepair,
  detectRepairChains,
  detect,
  activate as default,
  compareSkillSections,
  __mm
};
