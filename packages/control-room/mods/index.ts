import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MOD_ID = "control-room";
const STATE_PATH = path.join(homedir(), ".letta", "mods", "control-room.state.json");
const VERSION = 2;
const MODES = ["explore", "plan", "edit", "verify", "stuck", "handoff"];
const VSTATES = ["unknown", "checking", "claimed", "verified", "stale"];
const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_DIM = "\x1b[2m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_YELLOW = "\x1b[38;5;227m";
const ANSI_RED = "\x1b[31m";
const ANSI_GRAY = "\x1b[90m";
const ANSI_SOFT_BLUE = "\x1b[38;5;117m";
const ANSI_LAVENDER = "\x1b[38;5;183m";
const ANSI_PERIWINKLE = "\x1b[38;5;147m";
const ANSI_ROSE = "\x1b[38;5;217m";
const ANSI_PEACH = "\x1b[38;5;222m";
const ANSI_AQUA = "\x1b[38;5;159m";
function ansi(code, text) { return `${code}${text}${ANSI_RESET}`; }
function tag(text, code) { return ansi(`${ANSI_BOLD}${code}`, `[${text}]`); }
function sep() { return ansi(ANSI_GRAY, "|"); }
function labelColor(name) { return ({ goal: ANSI_SOFT_BLUE, mode: ANSI_LAVENDER, next: ANSI_PEACH, verified: ANSI_ROSE, approval: ANSI_PERIWINKLE, risk: ANSI_AQUA })[name] || ANSI_GRAY; }
function verificationColor(state) { return state === "verified" ? ANSI_GREEN : state === "claimed" || state === "checking" || state === "unknown" ? ANSI_YELLOW : state === "stale" ? ANSI_RED : ANSI_GRAY; }
function riskColor(level) { return level === "low" ? ANSI_GREEN : level === "medium" ? ANSI_YELLOW : ANSI_RED; }
function approvalLabel(mode) { return mode === "locked" ? "locked" : mode === "safe" ? "ask" : "auto"; }
function approvalColor(mode) { return mode === "locked" ? ANSI_RED : mode === "safe" ? ANSI_YELLOW : ANSI_GRAY; }
function now() { return new Date().toISOString(); }
function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
function str(v, fallback = "") { return String(v ?? fallback).trim(); }
function workspace(v) { return str(v, "global") || "global"; }
function latestWorkspaceKey(s) {
  const candidates = Object.entries(s.workspaces || {}).filter(([k]) => k !== "global");
  candidates.sort((a, b) => Date.parse(b[1]?.updatedAt || b[1]?.goal?.at || 0) - Date.parse(a[1]?.updatedAt || a[1]?.goal?.at || 0));
  return candidates[0]?.[0] || "global";
}
function canonicalKey(s, key) {
  key = workspace(key);
  if (key === "global") return latestWorkspaceKey(s);
  if (s.workspaces?.[key]) return key;
  const lower = key.toLowerCase();
  const candidates = Object.keys(s.workspaces || {})
    .filter(k => k !== "global")
    .map(k => ({ k, lower: k.toLowerCase() }))
    .filter(x => lower === x.lower || lower.startsWith(`${x.lower}\\`) || lower.startsWith(`${x.lower}/`));
  candidates.sort((a, b) => b.k.length - a.k.length);
  return candidates[0]?.k || key;
}
function field(value, source, note = "") { return { value: str(value), source, at: now(), ...(note ? { note } : {}) }; }
function fit(s, n) { s = str(s); return s.length <= n ? s : `${s.slice(0, Math.max(0, n - 3))}...`; }
function age(iso) {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso); if (!Number.isFinite(ms) || ms < 0) return iso;
  const m = Math.floor(ms / 60000); if (m < 1) return "just now"; if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}
function migrateField(v, fallback, source) {
  if (v && typeof v === "object" && "value" in v) return { value: str(v.value, fallback), source: str(v.source, source) || source, at: v.at || v.updatedAt || now(), ...(v.note ? { note: String(v.note) } : {}), ...(v.via ? { via: String(v.via) } : {}) };
  return { value: str(v, fallback), source, at: now() };
}
function migrateVerification(v) {
  const r = obj(v); let state = str(r.state, "unknown").toLowerCase(); if (state === "needed") state = "stale"; if (!VSTATES.includes(state)) state = "unknown";
  return { state, source: str(r.source, "unknown") || "unknown", note: str(r.note, state === "unknown" ? "No verification recorded yet." : ""), evidence: str(r.evidence), staleReason: str(r.staleReason), at: r.at || r.updatedAt || null };
}
function migrateRoom(v) {
  const r = obj(v), h = obj(r.harness), c = obj(h.counters || r.counters), ui = obj(r.ui), lock = obj(r.lock);
  return {
    createdAt: r.createdAt || now(), updatedAt: r.updatedAt || now(), active: r.active !== false,
    goal: migrateField(r.goal, "", r.goal && typeof r.goal !== "object" && r.goal ? "human" : "unknown"),
    mode: migrateField(r.mode, "explore", r.mode && typeof r.mode !== "object" ? "agent" : "unknown"),
    next: migrateField(r.next, "", r.next && typeof r.next !== "object" ? "agent" : "unknown"),
    verification: migrateVerification(r.verification),
    lock: { mode: ["off", "safe", "locked"].includes(lock.mode) ? lock.mode : "off", source: str(lock.source, "human"), at: lock.at || null, note: str(lock.note) },
    ui: { expanded: Boolean(ui.expanded) },
    lastCheckpoint: r.lastCheckpoint || { at: r.lastCheckpointAt || null, note: r.lastCheckpointNote || "", source: r.lastCheckpointAt ? "human" : "unknown" },
    harness: {
      counters: { userTurns: Number(c.userTurns || 0), toolStarts: Number(c.toolStarts || 0), toolEnds: Number(c.toolEnds || 0), changeSignals: Number(c.changeSignals || 0), verificationSignals: Number(c.verificationSignals || 0), compactSignals: Number(c.compactSignals || 0), llmSignals: Number(c.llmSignals || 0) },
      lastTool: h.lastTool || r.lastTool || null,
      recentTools: Array.isArray(h.recentTools) ? h.recentTools : Array.isArray(r.recentTools) ? r.recentTools : [],
      pendingTools: obj(h.pendingTools), lastChangeAt: h.lastChangeAt || r.lastChangeAt || null, lastVerificationSignalAt: h.lastVerificationSignalAt || r.lastVerificationSignalAt || null,
      lastUserTurnAt: h.lastUserTurnAt || r.lastUserTurnAt || null, lastOpenedAt: h.lastOpenedAt || r.lastOpenedAt || null, openReason: h.openReason || r.openReason || null,
      lastToolEndAt: h.lastToolEndAt || null, lastCompactAt: h.lastCompactAt || null, lastLlmAt: h.lastLlmAt || null, crReminderPending: Boolean(h.crReminderPending), lastCrReminderAt: h.lastCrReminderAt || null,
    },
  };
}
function loadState() {
  try {
    if (!existsSync(STATE_PATH)) return { version: VERSION, workspaces: {} };
    const s = JSON.parse(readFileSync(STATE_PATH, "utf8")); if (!s || typeof s !== "object") return { version: VERSION, workspaces: {} };
    s.workspaces = obj(s.workspaces); if (s.conversations) { s.workspaces = { ...s.conversations, ...s.workspaces }; delete s.conversations; }
    for (const k of Object.keys(s.workspaces)) s.workspaces[k] = migrateRoom(s.workspaces[k]);
    s.version = VERSION; return s;
  } catch { return { version: VERSION, workspaces: {} }; }
}
function saveState(s) { mkdirSync(path.dirname(STATE_PATH), { recursive: true }); writeFileSync(STATE_PATH, `${JSON.stringify(s, null, 2)}\n`, "utf8"); }
function getRoom(s, key) { key = workspace(key); s.workspaces[key] = migrateRoom(s.workspaces[key] || {}); return s.workspaces[key]; }
function touch(r) { r.updatedAt = now(); }
function keyCommand(ctx) { return workspace(ctx?.cwd || ctx?.workingDirectory || ctx?.workspace?.cwd || ctx?.conversation?.id || ctx?.sessionId); }
function keyTool(ctx) { return workspace(ctx?.cwd || ctx?.workingDirectory || ctx?.workspace?.cwd || ctx?.conversation?.id); }
function keyEvent(ev, ctx) { return workspace(ctx?.cwd || ctx?.workingDirectory || ctx?.workspace?.cwd || ctx?.conversation?.id || ev?.conversationId); }
function keyPerm(ev) { return workspace(ev?.cwd || ev?.workingDirectory || ev?.conversationId); }
function risk(r) {
  const c = r.harness.counters;
  if (!r.goal.value) return { level: "medium", reason: "no pinned human goal" };
  if (r.mode.value === "stuck") return { level: "high", reason: "mode is stuck" };
  if (r.verification.state === "stale" && c.changeSignals >= 3) return { level: "high", reason: "multiple changes since verification" };
  if (r.verification.state === "stale") return { level: "medium", reason: "verification stale" };
  return { level: "low", reason: "goal and state look coherent" };
}
function shouldRemind(r) {
  if (r.active === false) return false;
  if (!str(r.goal.value) || !str(r.next.value)) return true;
  if (["stuck", "handoff"].includes(r.mode.value)) return true;
  if (["stale", "checking", "unknown"].includes(r.verification.state)) return true;
  const lastAction = Math.max(Date.parse(r.harness.lastChangeAt || 0), Date.parse(r.harness.lastVerificationSignalAt || 0));
  const lastReminder = Date.parse(r.harness.lastCrReminderAt || 0);
  return Number.isFinite(lastAction) && lastAction > lastReminder;
}function vlabel(r) { return r.verification.state || "unknown"; }
function panelLine(s, key, cols = 100) {
  key = canonicalKey(s, key);
  const r = getRoom(s, key), base = path.basename(key || "global"), rr = risk(r), vv = vlabel(r), approval = approvalLabel(r.lock.mode);
  if (r.active === false) return `${ansi(ANSI_BOLD, "CR")} ${tag("off", ANSI_GRAY)} ${ansi(ANSI_DIM, "paused")} ${sep()} ${ansi(ANSI_DIM, "/cr on to resume")} ${sep()} ${ansi(ANSI_DIM, fit(base, 18))}`;
  const width = Math.max(70, Number(cols || 100));
  const goalWidth = width < 100 ? 18 : 26;
  const nextWidth = width < 100 ? 18 : 26;
  const title = ansi(ANSI_BOLD, "CR");
  return `${title} ${tag("goal", labelColor("goal"))} ${fit(r.goal.value || "no goal", goalWidth)} ${sep()} ${tag("mode", labelColor("mode"))} ${r.mode.value || "explore"} ${sep()} ${tag("next", labelColor("next"))} ${fit(r.next.value || "no next", nextWidth)} ${sep()} ${tag("approval", labelColor("approval"))} ${approval} ${sep()} ${tag("verified", labelColor("verified"))} ${ansi(verificationColor(vv), vv)} ${sep()} ${tag("risk", labelColor("risk"))} ${ansi(riskColor(rr.level), rr.level)} ${sep()} ${ansi(ANSI_DIM, fit(base, 18))}`;
}
function panelPatch(s, key = "global") {
  return { id: MOD_ID, order: 0, render(ctx) { const k = workspace(ctx?.cwd || ctx?.workingDirectory || ctx?.workspace?.cwd || ctx?.conversation?.id || ctx?.sessionId); return panelLine(s, k, ctx?.width); } };
}
async function gitSummary(cwd) {
  if (!cwd) return { changed: [], lines: ["Git: cwd unavailable"] };
  try {
    const inside = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, windowsHide: true, timeout: 3000 });
    if (!String(inside.stdout).includes("true")) return { changed: [], lines: ["Git: not a repository"] };
    const [branch, status] = await Promise.all([execFileAsync("git", ["branch", "--show-current"], { cwd, windowsHide: true, timeout: 3000 }).catch(() => ({ stdout: "" })), execFileAsync("git", ["status", "--short"], { cwd, windowsHide: true, timeout: 3000, maxBuffer: 131072 }).catch(() => ({ stdout: "" }))]);
    const changed = String(status.stdout || "").trim().split(/\r?\n/).filter(Boolean);
    return { changed, lines: [`Git: ${String(branch.stdout || "detached").trim() || "detached"}`, `Changed files: ${changed.length}`, ...changed.slice(0, 12).map(x => `  ${x}`)] };
  } catch { return { changed: [], lines: ["Git: not a repository or git unavailable"] }; }
}
function classifyTool(name, args) {
  const lower = String(name || "").toLowerCase(), cmdText = String(args?.command ?? args?.cmd ?? args?.input ?? ""), cmd = cmdText.toLowerCase(), p = String(args?.path ?? args?.file_path ?? args?.filePath ?? args?.notebook_path ?? "");
  if (lower.startsWith("control_room")) return { kind: "control", detail: name };
  if (["edit", "write", "multiedit", "applypatch", "apply_patch", "memory_apply_patch"].some(x => lower.includes(x))) return { kind: "change", detail: p || name };
  if (lower.includes("bash") || lower.includes("shell") || lower.includes("exec_command")) {
    if (/\b(test|pytest|vitest|jest|playwright|tsc|lint|check|cargo test|go test|npm test|bun test|pnpm test|yarn test)\b/.test(cmd)) return { kind: "verify", detail: cmd.slice(0, 140) || name };
    if (/\b(git status|git diff|git log|pwd|ls|dir|Get-ChildItem|Select-String|cat|type)\b/i.test(cmdText)) return { kind: "read", detail: cmd.slice(0, 140) || name };
    return { kind: "shell", detail: cmd.slice(0, 140) || name };
  }
  if (["read", "glob", "grep", "ls", "viewimage", "conversation_search", "archival_memory_search", "control_room_status"].some(x => lower.includes(x))) return { kind: "read", detail: p || name };
  return { kind: "tool", detail: p || name };
}
function setVerification(r, state, note, evidence, source) {
  state = str(state, "unknown").toLowerCase(); if (!VSTATES.includes(state)) state = "unknown"; if (source === "agent" && state === "verified") state = "claimed";
  r.verification = { state, source, note: str(note, state === "claimed" ? "Agent claims verification based on evidence." : ""), evidence: str(evidence), staleReason: "", at: now() }; touch(r);
}
function stale(r, reason, at) {
  if (["verified", "claimed", "checking"].includes(r.verification.state)) r.verification = { state: "stale", source: "harness", note: "Observed change after last verification.", evidence: r.verification.evidence || "", staleReason: reason, at };
}
function noteTool(r, phase, ev) {
  const at = now(), seen = classifyTool(ev?.toolName, ev?.args), c = r.harness.counters;
  const tool = { name: String(ev?.toolName || "unknown"), kind: seen.kind, detail: seen.detail, phase, status: ev?.status ? String(ev.status) : undefined, at };
  if (phase === "start") c.toolStarts += 1; else c.toolEnds += 1;
  r.harness.lastTool = tool; r.harness.recentTools = [tool, ...r.harness.recentTools].slice(0, 10);
  if (ev?.toolCallId && phase === "start") r.harness.pendingTools[ev.toolCallId] = tool;
  if (ev?.toolCallId && phase === "end") delete r.harness.pendingTools[ev.toolCallId];
  if (phase === "end") r.harness.lastToolEndAt = at;
  if (seen.kind === "change" || seen.kind === "shell") { c.changeSignals += 1; r.harness.lastChangeAt = at; stale(r, `${tool.name}${tool.detail ? `: ${tool.detail}` : ""}`, at); }
  if (seen.kind === "verify") { c.verificationSignals += 1; r.harness.lastVerificationSignalAt = at; r.verification = { state: "checking", source: "harness", note: "Verification command observed; mark verified after reading the result.", evidence: tool.detail, staleReason: "", at }; }
  touch(r);
}
function checkpoint(r, note, source) { r.lastCheckpoint = { at: now(), note: str(note), source }; touch(r); }
function statusText(r, key) {
  const rr = risk(r);
  return [`Control Room: ${r.active === false ? "off" : "on"}`, `Goal: ${r.goal.value || "(none)"} [${r.goal.source}]`, `Mode: ${r.mode.value || "explore"} [${r.mode.source}]`, `Next: ${r.next.value || "(none)"} [${r.next.source}]`, `Verification: ${r.verification.state} [${r.verification.source}] - ${r.verification.note || "none"}`, `Approval: ${approvalLabel(r.lock.mode)}`, `Drift risk: ${rr.level} (${rr.reason})`, `Workspace: ${key}`].join("\n");
}
async function detailText(ctx, s, key) {
  const r = getRoom(s, key), g = await gitSummary(ctx?.cwd || ctx?.workingDirectory), rr = risk(r);
  const recent = r.harness.recentTools.slice(0, 8).map(t => `  ${t.kind}: ${t.name}${t.status ? `/${t.status}` : ""}${t.detail ? ` - ${t.detail}` : ""} (${age(t.at)})`);
  return ["Control Room v2", "===============", panelLine(s, key, 120), "", `Status: ${r.active === false ? "off" : "on"}`, `Goal: ${r.goal.value || "(none)"}`, `Goal source: ${r.goal.source}${r.goal.via ? ` via ${r.goal.via}` : ""} (${age(r.goal.at)})`, `Mode: ${r.mode.value} [${r.mode.source}] (${age(r.mode.at)})`, `Next: ${r.next.value || "(none)"} [${r.next.source}] (${age(r.next.at)})`, "", `Verification: ${r.verification.state} [${r.verification.source}] (${age(r.verification.at)})`, `Verification note: ${r.verification.note || "none"}`, `Evidence: ${r.verification.evidence || "none"}`, `Stale reason: ${r.verification.staleReason || "none"}`, "", `Approval: ${approvalLabel(r.lock.mode)}${r.lock.note ? ` - ${r.lock.note}` : ""}`, `Checkpoint: ${r.lastCheckpoint.note || "none"} (${age(r.lastCheckpoint.at)})`, `Drift risk: ${rr.level} (${rr.reason})`, "", ...g.lines, "", "Harness facts:", `  user turns: ${r.harness.counters.userTurns}`, `  tool starts: ${r.harness.counters.toolStarts}`, `  tool ends: ${r.harness.counters.toolEnds}`, `  changes: ${r.harness.counters.changeSignals}`, `  verification signals: ${r.harness.counters.verificationSignals}`, `  compact signals: ${r.harness.counters.compactSignals}`, `  llm signals: ${r.harness.counters.llmSignals}`, "", "Recent tool signals:", ...(recent.length ? recent : ["  none recorded"]), "", `State path: ${STATE_PATH}`].join("\n");
}
function helpText() { return ["Control Room commands:", "  /cr                         show compact status", "  /cr detail                  show provenance and harness facts", "  /cr on|off                  enable/disable cockpit reminders", "  /cr goal <text>|clear       set/clear human-owned goal", "  /cr mode <mode>             explore|plan|edit|verify|stuck|handoff", "  /cr next <step>|clear       set/clear next step", "  /cr verified [note]         human confirms current state is verified", "  /cr verify <what>           mark what still needs verification", "  /cr needs <what>            same as /cr verify", "  /cr claim [note]            provisional verification claim", "  /cr checkpoint [note]       record checkpoint", "  /cr lock|safe|unlock        set agent update approval: locked|ask|auto", "  /cr expand|collapse         toggle expanded panel", "  /cr glyphs                  show glyph/color compatibility test", "  /cr reset                   reset workspace state"].join("\n"); }
function glyphTestText() {
  const red = "\x1b[31mred\x1b[0m", green = "\x1b[32mgreen\x1b[0m", cyan = "\x1b[36mcyan\x1b[0m", magenta = "\x1b[35mmagenta\x1b[0m";
  return [
    "Control Room glyph/color test",
    "=============================",
    "If a symbol renders as a box, we should not use it in the cockpit.",
    "If the color line shows raw escape codes, we should not use ANSI colors there.",
    "",
    "ASCII safe:      CR goal: Build | > edit: test | verify: stale | risk low",
    "Bracket words:   CR [goal] Build | [next] test | [verify] stale",
    "Punctuation:     CR * Build | > edit: test | ! stale | risk low",
    "Arrows/dots:     CR › Build · ▸ edit: test · ? stale",
    "Shapes:          CR ♦ Build | ▶ edit: test | ● stale | ▲ risk",
    "Math-ish:        CR ◇ Build | → edit: test | ≈ stale | △ risk",
    "Check/cross:     CR ✓ verified | ! stale | ? unknown | × blocked",
    "Gear-ish:        CR ⚙ verify | ⚠ stale | ⏱ age | 🔒 locked",
    "",
    `ANSI color test: ${green} goal ${cyan} next ${magenta} verify ${red} stale`,
  ].join("\n");
}
function parseArgs(args) { const raw = str(args); if (!raw) return { sub: "show", rest: "" }; const [sub, ...tail] = raw.split(/\s+/); return { sub: sub.toLowerCase(), rest: tail.join(" ").trim() }; }
async function runCommand(ctx, s, commit) {
  const key = keyCommand(ctx), r = getRoom(s, key), { sub, rest } = parseArgs(ctx.args);
  if (["show", "status", "view"].includes(sub)) return { type: "output", output: statusText(r, key) };
  if (["help", "?"].includes(sub)) return { type: "output", output: helpText() };
  if (["glyph", "glyphs", "style"].includes(sub)) return { type: "output", output: glyphTestText() };
  if (["detail", "why"].includes(sub)) return { type: "output", output: await detailText(ctx, s, key) };
  if (sub === "reset") { s.workspaces[key] = migrateRoom({}); checkpoint(s.workspaces[key], "State reset.", "human"); commit(ctx); return { type: "output", output: "Control Room state reset for this workspace." }; }
  if (["on", "off"].includes(sub)) { r.active = sub === "on"; checkpoint(r, `Control Room ${r.active ? "on" : "off"}.`, "human"); commit(ctx); return { type: "output", output: `Control Room ${r.active ? "on" : "off"}` }; }
  if (sub === "goal") {
    if (!rest) return { type: "output", output: `Current goal: ${r.goal.value || "(none pinned)"}` };
    r.goal = field(rest.toLowerCase() === "clear" ? "" : rest, "human", rest.toLowerCase() === "clear" ? "goal cleared" : "set by /cr goal");
    setVerification(r, "unknown", "Goal changed; previous verification no longer applies.", "", "human"); checkpoint(r, rest.toLowerCase() === "clear" ? "Goal cleared." : "Goal changed.", "human"); commit(ctx);
    return { type: "output", output: rest.toLowerCase() === "clear" ? "Control Room goal cleared." : `Control Room goal pinned: ${rest}` };
  }
  if (sub === "mode") { const mode = rest.toLowerCase(); if (!mode) return { type: "output", output: `Current mode: ${r.mode.value}\nModes: ${MODES.join(", ")}` }; if (!MODES.includes(mode)) return { type: "output", success: false, output: `Unknown mode '${mode}'. Use: ${MODES.join(", ")}` }; r.mode = field(mode, "human", "set by /cr mode"); checkpoint(r, `Mode set to ${mode}.`, "human"); commit(ctx); return { type: "output", output: `Control Room mode: ${mode}` }; }
  if (sub === "next") { if (!rest) return { type: "output", output: `Current next step: ${r.next.value || "(none)"}` }; r.next = field(rest.toLowerCase() === "clear" ? "" : rest, "human", "set by /cr next"); checkpoint(r, rest.toLowerCase() === "clear" ? "Next step cleared." : "Next step updated.", "human"); commit(ctx); return { type: "output", output: rest.toLowerCase() === "clear" ? "Control Room next step cleared." : `Next step recorded: ${rest}` }; }
  if (["verify", "needs", "needs-verify", "check", "todo-verify"].includes(sub)) { const note = rest || "Needs verification."; r.mode = field("verify", "human", "verification needed"); r.next = field(note, "human", "set by /cr needs"); setVerification(r, "checking", `Needs verification: ${note}`, "", "human"); checkpoint(r, `Needs verification: ${note}`, "human"); commit(ctx); return { type: "output", output: `Marked as needing verification: ${note}` }; }
  if (["verified", "accept", "accepted"].includes(sub)) { const note = rest || "Human marked current state verified."; setVerification(r, "verified", note, "", "human"); checkpoint(r, note, "human"); commit(ctx); return { type: "output", output: `Verification recorded: ${note}` }; }
  if (["claim", "claimed"].includes(sub)) { const note = rest || "Verification claimed, but not human-verified."; setVerification(r, "claimed", note, "", "agent"); checkpoint(r, note, "agent"); commit(ctx); return { type: "output", output: `Verification claim recorded: ${note}` }; }
  if (sub === "checkpoint") { checkpoint(r, rest || "Checkpoint recorded.", "human"); commit(ctx); return { type: "output", output: `Checkpoint: ${rest || "Checkpoint recorded."}` }; }
  if (["lock", "locked", "safe", "safemode", "unlock", "unlocked"].includes(sub)) { const mode = ["unlock", "unlocked"].includes(sub) ? "off" : ["lock", "locked"].includes(sub) ? "locked" : "safe"; r.lock = { mode, source: "human", at: now(), note: mode === "locked" ? "Agent state updates denied." : mode === "safe" ? "Agent state updates ask first." : "Agent updates unlocked." }; checkpoint(r, `Approval mode: ${approvalLabel(mode)}.`, "human"); commit(ctx); return { type: "output", output: `Control Room approval mode: ${approvalLabel(mode)}` }; }
  if (["expand", "expanded"].includes(sub)) { r.ui.expanded = true; touch(r); commit(ctx); return { type: "output", output: "Control Room panel expanded." }; }
  if (["collapse", "collapsed"].includes(sub)) { r.ui.expanded = false; touch(r); commit(ctx); return { type: "output", output: "Control Room panel collapsed." }; }
  return { type: "output", success: false, output: `Unknown Control Room subcommand '${sub}'.\n\n${helpText()}` };
}
function safeOn(letta, disposers, name, handler) { try { disposers.push(letta.events.on(name, handler)); return true; } catch { return false; } }
export default function activate(letta) {
  const disposers = [], state = loadState();
  let panel = null;
  const refresh = () => { if (!panel) return; try { panel.update(); } catch {} };
  const commit = (ctx) => { saveState(state); refresh(ctx); };

  if (letta.capabilities?.ui?.panels) {
    panel = letta.ui.openPanel(panelPatch(state));
    disposers.push(() => panel?.close?.());
  }
  if (letta.capabilities?.events?.lifecycle) {
    safeOn(letta, disposers, "conversation_open", (ev, ctx) => { const r = getRoom(state, keyEvent(ev, ctx)); r.harness.lastOpenedAt = now(); r.harness.openReason = ev.reason || "open"; touch(r); commit(ctx); });
    safeOn(letta, disposers, "conversation_close", (ev, ctx) => { const r = getRoom(state, keyEvent(ev, ctx)); r.harness.lastClosedAt = now(); r.harness.closeReason = ev.reason || "close"; touch(r); commit(ctx); });
  }
  if (letta.capabilities?.events?.turns) {
    safeOn(letta, disposers, "turn_start", (ev, ctx) => { const r = getRoom(state, keyEvent(ev, ctx)); r.harness.counters.userTurns += 1; r.harness.lastUserTurnAt = now(); touch(r); commit(ctx); });
    safeOn(letta, disposers, "turn_end", (ev, ctx) => {
      const r = getRoom(state, keyEvent(ev, ctx));
      r.harness.lastTurnEndAt = now();
      if (r.harness.crReminderPending) {
        r.harness.crReminderPending = false;
      } else if (ev?.stopReason !== "tool_use" && shouldRemind(r)) {
        r.harness.crReminderPending = true;
        r.harness.lastCrReminderAt = now();
        ev.continue = "Control Room checkpoint: state may need an update. If needed, call `control_room_update` or `control_room_propose_goal`; otherwise continue normally.";
      }
      touch(r); commit(ctx);
    });
  }
  if (letta.capabilities?.events?.tools) {
    safeOn(letta, disposers, "tool_start", (ev, ctx) => { const r = getRoom(state, keyEvent(ev, ctx)); noteTool(r, "start", ev); commit(ctx); });
    safeOn(letta, disposers, "tool_end", (ev, ctx) => { const r = getRoom(state, keyEvent(ev, ctx)); noteTool(r, "end", ev); commit(ctx); });
  }
  if (letta.capabilities?.events?.compact) {
    safeOn(letta, disposers, "compact_start", (ev, ctx) => { const r = getRoom(state, keyEvent(ev, ctx)); r.harness.counters.compactSignals += 1; r.harness.lastCompactAt = now(); r.harness.lastCompactPhase = "start"; touch(r); commit(ctx); });
    safeOn(letta, disposers, "compact_end", (ev, ctx) => { const r = getRoom(state, keyEvent(ev, ctx)); r.harness.counters.compactSignals += 1; r.harness.lastCompactAt = now(); r.harness.lastCompactPhase = "end"; touch(r); commit(ctx); });
  }
  if (letta.capabilities?.events?.llm) {
    safeOn(letta, disposers, "llm_start", (ev, ctx) => { const r = getRoom(state, keyEvent(ev, ctx)); r.harness.counters.llmSignals += 1; r.harness.lastLlmAt = now(); r.harness.lastLlmPhase = "start"; touch(r); commit(ctx); });
    safeOn(letta, disposers, "llm_end", (ev, ctx) => { const r = getRoom(state, keyEvent(ev, ctx)); r.harness.counters.llmSignals += 1; r.harness.lastLlmAt = now(); r.harness.lastLlmPhase = "end"; touch(r); commit(ctx); });
  }

  if (letta.capabilities?.permissions) {
    disposers.push(letta.permissions.register({
      id: "control-room-lock",
      description: "Protect Control Room agent-updated state when locked or safe mode is enabled.",
      check(ev) {
        if (ev.toolName !== "control_room_update") return undefined;
        const r = getRoom(state, canonicalKey(state, keyPerm(ev)));
        if (r.lock.mode === "locked") return { decision: "deny", reason: "Control Room is locked. Use /cr unlock or /cr safe to permit agent updates." };
        if (r.lock.mode === "safe") return ev.phase === "execution"
          ? { decision: "allow", reason: "Control Room approval mode is ask: execution allowed after approval." }
          : { decision: "ask", reason: "Control Room approval mode is ask: approve before agent state updates." };
        return undefined;
      },
    }));
  }

  if (letta.capabilities?.tools) {
    disposers.push(letta.tools.register({
      name: "control_room_status",
      description: "Read the current Control Room goal, mode, next step, verification state, lock state, and drift heuristic for this workspace.",
      parameters: { type: "object", properties: {}, additionalProperties: false }, approvalPolicy: "auto", parallelSafe: true,
      async run(ctx) { const key = canonicalKey(state, keyTool(ctx)), r = getRoom(state, key), g = await gitSummary(ctx?.cwd || ctx?.workingDirectory); return [statusText(r, key), `Changed files: ${g.changed.length}`, `Recent tool: ${r.harness.lastTool?.name || "none"}`, `State path: ${STATE_PATH}`].join("\n"); },
    }));
    disposers.push(letta.tools.register({
      name: "control_room_update",
      description: "Update Control Room agent-owned progress fields: mode, next step, checkpoint, or agent verification claim. Do not use this to set the human goal; use control_room_propose_goal for goal changes.",
      parameters: { type: "object", properties: { mode: { type: "string", enum: MODES, description: "Current work mode." }, next: { type: "string", description: "Short next step. Empty string clears it." }, verificationState: { type: "string", enum: ["unknown", "checking", "claimed", "stale"], description: "Agent/harness-grade verification state." }, verificationNote: { type: "string", description: "Short verification note." }, evidence: { type: "string", description: "Command/test/file evidence." }, checkpoint: { type: "string", description: "Optional checkpoint note." } }, additionalProperties: false },
      approvalPolicy: "auto", parallelSafe: false,
      run(ctx) {
        const key = canonicalKey(state, keyTool(ctx)), r = getRoom(state, key), a = obj(ctx.args), changed = [];
        if (a.mode !== undefined) { const m = str(a.mode).toLowerCase(); if (!MODES.includes(m)) return { status: "error", content: `Unknown mode '${m}'.` }; r.mode = field(m, "agent", "set by control_room_update"); changed.push(`mode=${m}`); }
        if (a.next !== undefined) { r.next = field(a.next, "agent", "set by control_room_update"); changed.push("next"); }
        if (a.verificationState !== undefined || a.verificationNote !== undefined || a.evidence !== undefined) { setVerification(r, a.verificationState || "claimed", a.verificationNote || "Agent updated verification state.", a.evidence || "", "agent"); changed.push(`verification=${r.verification.state}`); }
        if (a.checkpoint !== undefined) { checkpoint(r, a.checkpoint || "Agent checkpoint.", "agent"); changed.push("checkpoint"); }
        if (!changed.length) return { status: "error", content: "No Control Room fields supplied." };
        touch(r); commit(ctx); return `Control Room updated: ${changed.join(", ")}.`;
      },
    }));
    disposers.push(letta.tools.register({
      name: "control_room_propose_goal",
      description: "Propose replacing the human-owned Control Room goal. This always asks the human for approval; only call when the current goal should truly change.",
      parameters: { type: "object", properties: { goal: { type: "string", description: "Proposed new Control Room goal." }, reason: { type: "string", description: "Why the goal should change." } }, required: ["goal"], additionalProperties: false },
      approvalPolicy: "alwaysAsk", parallelSafe: false,
      run(ctx) {
        const key = canonicalKey(state, keyTool(ctx)), r = getRoom(state, key), goal = str(ctx.args?.goal), reason = str(ctx.args?.reason);
        if (!goal) return { status: "error", content: "goal is required." };
        r.goal = { value: goal, source: "human", via: "approved-agent-proposal", at: now(), ...(reason ? { note: reason } : {}) };
        setVerification(r, "unknown", "Goal changed through approved agent proposal; previous verification no longer applies.", "", "human"); checkpoint(r, reason || "Approved agent goal proposal.", "human"); commit(ctx);
        return `Approved Control Room goal: ${goal}`;
      },
    }));
  }

  if (letta.capabilities?.commands) {
    const command = { id: "control-room", description: "Show or update the Control Room cockpit for this workspace.", args: "[detail|on|off|goal|mode|next|verify|claim|checkpoint|lock|safe|unlock|expand|collapse|reset] [...text]", runWhenBusy: true, run: (ctx) => runCommand(ctx, state, commit) };
    disposers.push(letta.commands.register(command));
    disposers.push(letta.commands.register({ ...command, id: "cr", description: "Short alias for /control-room." }));
  }
  return () => { for (const dispose of disposers.reverse()) dispose(); };
}























