/**
 * CruiseCode — evidence-first coding workflow mod for Letta Code.
 *
 * Commands:
 *   /code-cruise "task" | --verify-only | --resume | --handoff <file> | --from-ux <run-id>
 *   /code-plan [task]
 *   /code-check
 *   /code-status
 *   /code-report
 *
 * State:
 *   <cwd>/.letta/cruise-code/
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { execFile } from "node:child_process";

const MOD_ID = "cruise-code";
const MOD_NAME = "CruiseCode";
const SCHEMA_VERSION = 1;
const DEFAULT_CHECK_TIMEOUT_MS = 120_000;
const DEFAULT_DIFF_CAP_BYTES = 500_000;
const MAX_OUTPUT_BYTES = 800_000;
const PANEL_ID = "cruise-code";

const PHASE_LABELS = {
  draft: "Brief",
  planned: "Plan",
  active: "Build",
  checking: "Check",
  reviewing: "Review",
  blocked: "Blocked",
  closed: "Closed",
  cancelled: "Cancelled",
};

const VERDICT_LABELS = {
  unreviewed: "unreviewed",
  needs_work: "needs work",
  needs_evidence: "needs evidence",
  ready_with_caveats: "ready w/ caveats",
  verified: "verified",
};

const CHECK_DEFS = [
  { id: "typecheck", label: "Typecheck", evidence_type: "typecheck_output", required: true, names: ["typecheck", "type-check", "tsc"] },
  { id: "test", label: "Tests", evidence_type: "test_output", required: false, names: ["test", "test:unit", "unit"] },
  { id: "lint", label: "Lint", evidence_type: "lint_output", required: false, names: ["lint"] },
  { id: "build", label: "Build", evidence_type: "build_output", required: false, names: ["build"] },
];

const DEPENDENCY_FILES = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);

const RISK_KEYWORDS = ["auth", "login", "session", "token", "permission", "role", "security"];

let panelHandle = null;
let panelText = "";

// ── Utilities ────────────────────────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

function normalizeCwd(cwd) {
  return cwd || process.cwd();
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function readJson(path, fallback = null) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const e = new Error(`Could not read JSON: ${path}: ${error.message}`);
    e.cause = error;
    throw e;
  }
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function writeText(path, text) {
  ensureDir(dirname(path));
  writeFileSync(path, text ?? "", "utf8");
}

function truncateText(value, maxBytes = MAX_OUTPUT_BYTES) {
  const text = String(value ?? "");
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) return text;
  const buf = Buffer.from(text, "utf8").subarray(0, maxBytes);
  return `${buf.toString("utf8")}\n\n[truncated: original output was ${bytes} bytes]`;
}

function short(value, width) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= width) return text;
  if (width <= 1) return "…";
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

function pad(value, width) {
  const text = String(value ?? "");
  if (text.length >= width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
}

function quoteArgIfNeeded(value) {
  const text = String(value ?? "");
  if (!/\s/.test(text)) return text;
  return JSON.stringify(text);
}

function stripWrappingQuotes(value) {
  const text = String(value ?? "").trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function slugify(value) {
  const slug = String(value ?? "run")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "run";
}

function makeRunId(title) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${stamp}-${slugify(title)}`;
}

function relativePath(fromDir, target) {
  try {
    return relative(fromDir, target) || basename(target);
  } catch (_) {
    return target;
  }
}

function resolveInputPath(cwd, inputPath) {
  const cleaned = stripWrappingQuotes(inputPath);
  return isAbsolute(cleaned) ? cleaned : resolve(cwd, cleaned);
}

function isHelp(input) {
  const value = String(input ?? "").trim().toLowerCase();
  return !value || value === "help" || value === "-h" || value === "--help";
}

function execFileResult(command, args, options = {}) {
  return new Promise((resolveResult) => {
    const timeout = options.timeout ?? DEFAULT_CHECK_TIMEOUT_MS;
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        timeout,
        maxBuffer: options.maxBuffer ?? MAX_OUTPUT_BYTES,
        env: options.env ?? process.env,
      },
      (error, stdout, stderr) => {
        const timedOut = Boolean(error?.killed) && /timed out/i.test(String(error?.message ?? ""));
        resolveResult({
          command,
          args,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0,
          signal: error?.signal ?? null,
          errorMessage: error?.message ?? null,
          timedOut,
          ok: !error,
        });
      },
    );
  });
}

async function git(cwd, args, timeout = 30_000) {
  return execFileResult("git", args, { cwd, timeout, maxBuffer: MAX_OUTPUT_BYTES * 4 });
}

// ── Paths and state ──────────────────────────────────────────────────────────

function storageRoot(cwd) {
  return join(normalizeCwd(cwd), ".letta", "cruise-code");
}

function paths(cwd, runId = null) {
  const root = storageRoot(cwd);
  const p = {
    root,
    config: join(root, "config.json"),
    active: join(root, "active.json"),
    runs: join(root, "runs"),
  };
  if (runId) {
    p.runDir = join(p.runs, runId);
    p.run = join(p.runDir, "run.json");
    p.plan = join(p.runDir, "plan.json");
    p.ledger = join(p.runDir, "ledger.jsonl");
    p.evidenceDir = join(p.runDir, "evidence");
    p.evidenceIndex = join(p.evidenceDir, "index.json");
    p.report = join(p.runDir, "report.md");
    p.lessonCandidates = join(p.runDir, "lesson-candidates.json");
  }
  return p;
}

function defaultConfig() {
  return {
    schema_version: SCHEMA_VERSION,
    storage_dir: ".letta/cruise-code",
    checks: {
      auto_detect: true,
      required_by_default: ["typecheck"],
      optional_by_default: ["test", "lint", "build"],
      capture_git_diff: true,
      allow_no_checks: false,
    },
    risk_gates: {
      dependency_change: true,
      db_migration: true,
      large_deletion: true,
      large_changed_files: true,
      auth_security_keywords_raise_risk: true,
    },
    retention: {
      max_closed_runs: 20,
      max_age_days: 30,
      auto_delete: false,
    },
    panel: {
      enabled: true,
      max_lines: 8,
    },
  };
}

function ensureStorage(cwd) {
  const p = paths(cwd);
  ensureDir(p.runs);
  if (!existsSync(p.config)) writeJson(p.config, defaultConfig());
  return p;
}

function loadConfig(cwd) {
  const p = ensureStorage(cwd);
  const loaded = readJson(p.config, {});
  return { ...defaultConfig(), ...loaded, schema_version: loaded.schema_version ?? SCHEMA_VERSION };
}

function saveActive(cwd, runId) {
  const p = ensureStorage(cwd);
  writeJson(p.active, {
    schema_version: SCHEMA_VERSION,
    active_run_id: runId,
    updated_at: now(),
  });
}

function loadActiveId(cwd) {
  const p = ensureStorage(cwd);
  const active = readJson(p.active, null);
  return active?.active_run_id ?? null;
}

function loadRunById(cwd, runId) {
  if (!runId) return null;
  const p = paths(cwd, runId);
  return readJson(p.run, null);
}

function loadActiveRun(cwd) {
  const runId = loadActiveId(cwd);
  if (!runId) return null;
  return loadRunById(cwd, runId);
}

function saveRun(cwd, run) {
  run.updated_at = now();
  writeJson(paths(cwd, run.run_id).run, run);
}

function loadPlan(cwd, runId) {
  return readJson(paths(cwd, runId).plan, null);
}

function savePlan(cwd, runId, plan) {
  writeJson(paths(cwd, runId).plan, plan);
}

function loadEvidenceIndex(cwd, runId) {
  return readJson(paths(cwd, runId).evidenceIndex, { schema_version: SCHEMA_VERSION, items: [] });
}

function saveEvidenceIndex(cwd, runId, index) {
  writeJson(paths(cwd, runId).evidenceIndex, {
    schema_version: SCHEMA_VERSION,
    items: Array.isArray(index.items) ? index.items : [],
  });
}

function appendLedger(cwd, run, event, summary, data = {}) {
  const p = paths(cwd, run.run_id);
  ensureDir(p.runDir);
  const entry = {
    time: now(),
    event,
    actor: MOD_NAME,
    phase: run.phase,
    verdict: run.verdict,
    step_id: run.current_step_id ?? null,
    summary,
    data,
  };
  appendFileSync(p.ledger, `${JSON.stringify(entry)}\n`, "utf8");
}

function createBaseRun(cwd, { title, task, mode = "standard", source = { type: "manual" } }) {
  const runId = makeRunId(title || task || "CruiseCode run");
  const p = paths(cwd, runId);
  ensureDir(p.evidenceDir);

  const run = {
    schema_version: SCHEMA_VERSION,
    run_id: runId,
    title: title || task || "CruiseCode run",
    mode,
    phase: "draft",
    verdict: "unreviewed",
    current_step_id: null,
    brief: {
      task: task || title || "",
      summary: task || title || "",
      created_from: source.type ?? "manual",
    },
    source: {
      type: source.type ?? "manual",
      handoff_path: source.handoff_path ?? null,
      ux_run_id: source.ux_run_id ?? null,
      readiness: source.readiness ?? null,
    },
    workspace: {
      cwd,
      branch: null,
      base_commit: null,
      head_commit: null,
    },
    summary: {
      steps_total: 0,
      steps_done: 0,
      evidence_collected: 0,
      required_checks_passed: 0,
      required_checks_total: 0,
      risk: "unknown",
    },
    blockers: [],
    created_at: now(),
    updated_at: now(),
  };

  writeJson(p.run, run);
  writeJson(p.evidenceIndex, { schema_version: SCHEMA_VERSION, items: [] });
  writeText(p.ledger, "");
  saveActive(cwd, runId);
  appendLedger(cwd, run, "run_created", `Run created: ${run.title}`, { mode, source: run.source });
  return run;
}

// ── Handoff ─────────────────────────────────────────────────────────────────

function validateHandoff(handoff) {
  const missing = [];
  for (const key of ["readiness", "brief", "acceptance_criteria", "non_goals", "constraints", "open_questions"]) {
    if (!(key in handoff)) missing.push(key);
  }
  if (missing.length) {
    const error = new Error(`Handoff is missing required field(s): ${missing.join(", ")}`);
    error.kind = "user_error";
    throw error;
  }
  if (!Array.isArray(handoff.acceptance_criteria) || handoff.acceptance_criteria.length === 0) {
    const error = new Error("Handoff must include at least one acceptance criterion.");
    error.kind = "user_error";
    throw error;
  }
  if (!Array.isArray(handoff.open_questions)) {
    const error = new Error("Handoff open_questions must be an array, even when empty.");
    error.kind = "user_error";
    throw error;
  }
  return handoff;
}

function readHandoffFile(cwd, filePath) {
  const fullPath = resolveInputPath(cwd, filePath);
  if (!existsSync(fullPath)) {
    const error = new Error(`Handoff file not found: ${fullPath}`);
    error.kind = "user_error";
    throw error;
  }
  const handoff = readJson(fullPath, null);
  return { path: fullPath, handoff: validateHandoff(handoff) };
}

function resolveHandoffFromUx(cwd, uxRunId) {
  const fullPath = join(cwd, ".letta", "cruise-ux", "runs", uxRunId, "implementation-handoff.json");
  return readHandoffFile(cwd, fullPath);
}

function handoffTitle(handoff) {
  return handoff?.brief?.title || handoff?.brief?.approved_direction || "CruiseUX handoff";
}

function handoffTask(handoff) {
  const brief = handoff.brief ?? {};
  return [brief.problem, brief.approved_direction, brief.user_flow_summary].filter(Boolean).join(" ").trim() || handoffTitle(handoff);
}

function blockingQuestions(handoff) {
  return (handoff.open_questions || []).filter((q) => q?.blocking === true);
}

// ── Plan / checks ────────────────────────────────────────────────────────────

function detectPackageManager(cwd) {
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) return "bun";
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "package-lock.json"))) return "npm";
  if (existsSync(join(cwd, "package.json"))) return "npm";
  return null;
}

function readPackageJson(cwd) {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) return null;
  return readJson(path, null);
}

function detectScripts(pkg) {
  const scripts = pkg?.scripts ?? {};
  const detected = {};
  for (const def of CHECK_DEFS) {
    const name = def.names.find((candidate) => Object.prototype.hasOwnProperty.call(scripts, candidate));
    if (name) detected[def.id] = name;
  }
  return detected;
}

function buildCheckCommands(cwd) {
  const manager = detectPackageManager(cwd);
  const pkg = readPackageJson(cwd);
  if (!manager || !pkg) return [];
  const scripts = detectScripts(pkg);
  return CHECK_DEFS.filter((def) => scripts[def.id]).map((def) => {
    const script = scripts[def.id];
    return {
      id: def.id,
      label: def.label,
      command: `${manager} run ${script}`,
      command_bin: manager,
      command_args: ["run", script],
      script,
      required: def.required,
      timeout_ms: def.id === "test" ? 180_000 : DEFAULT_CHECK_TIMEOUT_MS,
      evidence_type: def.evidence_type,
    };
  });
}

function evidenceRequiredForChecks(checks) {
  const required = ["git_diff"];
  for (const check of checks || []) {
    if (check.required) required.push(check.evidence_type);
  }
  return required;
}

function buildPlanFromTask(task, checks = []) {
  const requiredEvidence = evidenceRequiredForChecks(checks);
  return {
    schema_version: SCHEMA_VERSION,
    goal: task,
    non_goals: [
      "Do not change unrelated behavior.",
      "Do not add dependencies unless explicitly approved.",
    ],
    constraints: ["Preserve existing behavior outside the task scope."],
    acceptance_criteria: [
      {
        id: "ac-001",
        text: `The requested task is implemented: ${task}`,
        source: "manual",
        ux_ref: null,
        status: "pending",
        evidence_required: requiredEvidence,
      },
    ],
    steps: [
      {
        id: "step-01",
        title: "Map the current implementation surface",
        kind: "map",
        status: "pending",
        risk: "low",
        acceptance_refs: ["ac-001"],
        done_when: ["Relevant files and behavior are identified."],
        evidence_required: ["code_references"],
      },
      {
        id: "step-02",
        title: "Implement the requested change",
        kind: "edit",
        status: "pending",
        risk: "medium",
        acceptance_refs: ["ac-001"],
        done_when: ["The requested behavior is implemented without unrelated changes."],
        evidence_required: ["git_diff"],
      },
      {
        id: "step-03",
        title: "Run checks and collect evidence",
        kind: "check",
        status: "pending",
        risk: "low",
        acceptance_refs: ["ac-001"],
        done_when: ["Configured checks have run and evidence is indexed."],
        evidence_required: requiredEvidence,
      },
      {
        id: "step-04",
        title: "Generate report",
        kind: "report",
        status: "pending",
        risk: "low",
        acceptance_refs: ["ac-001"],
        done_when: ["Final verdict and missing evidence are documented."],
        evidence_required: ["review_note"],
      },
    ],
    checks,
    manual_checks: [],
  };
}

function buildPlanFromHandoff(handoff, checks = []) {
  const producerRun = handoff?.producer?.run_id || "handoff";
  const criteria = handoff.acceptance_criteria.map((criterion, index) => {
    const id = `ac-${String(index + 1).padStart(3, "0")}`;
    return {
      id,
      text: criterion.text,
      source: `cruiseux:${producerRun}`,
      ux_ref: criterion.id ?? null,
      priority: criterion.priority ?? "must",
      type: criterion.type ?? "functional",
      status: "pending",
      evidence_required: criterion.evidence_required?.length ? criterion.evidence_required : evidenceRequiredForChecks(checks),
    };
  });
  return {
    schema_version: SCHEMA_VERSION,
    goal: handoffTitle(handoff),
    non_goals: Array.isArray(handoff.non_goals) ? handoff.non_goals : [],
    constraints: Array.isArray(handoff.constraints) ? handoff.constraints : [],
    acceptance_criteria: criteria,
    steps: [
      {
        id: "step-01",
        title: "Map UX handoff to implementation surface",
        kind: "map",
        status: "pending",
        risk: "low",
        acceptance_refs: criteria.map((c) => c.id),
        done_when: ["Relevant implementation files are identified."],
        evidence_required: ["code_references"],
      },
      {
        id: "step-02",
        title: "Implement handoff acceptance criteria",
        kind: "edit",
        status: "pending",
        risk: "medium",
        acceptance_refs: criteria.map((c) => c.id),
        done_when: ["Each UX acceptance criterion has implementation evidence or a documented blocker."],
        evidence_required: ["git_diff"],
      },
      {
        id: "step-03",
        title: "Run checks and collect evidence",
        kind: "check",
        status: "pending",
        risk: "low",
        acceptance_refs: criteria.map((c) => c.id),
        done_when: ["Configured checks have run and evidence is indexed."],
        evidence_required: evidenceRequiredForChecks(checks),
      },
    ],
    checks,
    manual_checks: Array.isArray(handoff.suggested_checks)
      ? handoff.suggested_checks.filter((c) => c?.type === "manual")
      : [],
  };
}

function updateRunSummaryFromPlan(run, plan, evidenceIndex = null) {
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  const checks = Array.isArray(plan?.checks) ? plan.checks : [];
  const required = checks.filter((c) => c.required);
  const items = evidenceIndex?.items ?? [];
  run.summary.steps_total = steps.length;
  run.summary.steps_done = steps.filter((s) => s.status === "done").length;
  run.summary.required_checks_total = required.length;
  run.summary.required_checks_passed = required.filter((check) =>
    items.some((item) => item.type === check.evidence_type && item.status === "passed"),
  ).length;
  run.summary.evidence_collected = items.filter((item) => ["collected", "passed", "failed"].includes(item.status)).length;
}

// ── Evidence and risk ────────────────────────────────────────────────────────

function upsertEvidence(index, item) {
  if (!Array.isArray(index.items)) index.items = [];
  const existing = index.items.findIndex((i) => i.id === item.id);
  const next = { ...item, updated_at: now() };
  if (existing >= 0) index.items[existing] = { ...index.items[existing], ...next };
  else index.items.push({ ...next, created_at: item.created_at ?? now() });
  return index;
}

function evidencePath(cwd, runId, fileName) {
  return join(paths(cwd, runId).evidenceDir, fileName);
}

async function collectGitEvidence(cwd, run) {
  const index = loadEvidenceIndex(cwd, run.run_id);
  const p = paths(cwd, run.run_id);
  ensureDir(p.evidenceDir);

  const status = await git(cwd, ["status", "--short"]);
  writeText(evidencePath(cwd, run.run_id, "git-status.txt"), status.ok ? status.stdout : `${status.stdout}\n${status.stderr}\n${status.errorMessage ?? ""}`.trim());
  upsertEvidence(index, {
    id: "ev-git-status",
    type: "git_status",
    path: "evidence/git-status.txt",
    status: status.ok ? "collected" : "missing",
    command: "git status --short",
    exit_code: status.exitCode,
  });

  const stat = await git(cwd, ["diff", "--stat"]);
  writeText(evidencePath(cwd, run.run_id, "git-diff-stat.txt"), stat.ok ? stat.stdout : `${stat.stdout}\n${stat.stderr}\n${stat.errorMessage ?? ""}`.trim());
  upsertEvidence(index, {
    id: "ev-git-diff-stat",
    type: "git_diff_stat",
    path: "evidence/git-diff-stat.txt",
    status: stat.ok ? "collected" : "missing",
    command: "git diff --stat",
    exit_code: stat.exitCode,
  });

  const diff = await git(cwd, ["diff"]);
  const diffText = diff.ok ? truncateText(diff.stdout, DEFAULT_DIFF_CAP_BYTES) : `${diff.stdout}\n${diff.stderr}\n${diff.errorMessage ?? ""}`.trim();
  writeText(evidencePath(cwd, run.run_id, "git-diff.patch"), diffText);
  upsertEvidence(index, {
    id: "ev-git-diff",
    type: "git_diff",
    path: "evidence/git-diff.patch",
    status: diff.ok && diff.stdout.trim() ? "collected" : "missing",
    command: "git diff",
    exit_code: diff.exitCode,
  });

  saveEvidenceIndex(cwd, run.run_id, index);
  appendLedger(cwd, run, "evidence_added", "Git evidence collected", {
    files: ["evidence/git-status.txt", "evidence/git-diff-stat.txt", "evidence/git-diff.patch"],
  });
  return index;
}

async function collectGitRisk(cwd) {
  const nameOnly = await git(cwd, ["diff", "--name-only"]);
  const numstat = await git(cwd, ["diff", "--numstat"]);
  const changedFiles = nameOnly.ok ? nameOnly.stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) : [];
  let deletedLines = 0;
  if (numstat.ok) {
    for (const line of numstat.stdout.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      const deleted = Number(parts[1]);
      if (Number.isFinite(deleted)) deletedLines += deleted;
    }
  }

  const gates = [];
  const signals = [];

  for (const file of changedFiles) {
    const base = basename(file);
    if (DEPENDENCY_FILES.has(base)) {
      gates.push({ id: "dependency_change", severity: "high", blocking: true, reason: `${file} changed` });
    }
    if (/\b(migrations?|db\/migrations|supabase\/migrations)\b/i.test(file) || file === "prisma/schema.prisma") {
      gates.push({ id: "db_migration", severity: "high", blocking: true, reason: `${file} changed` });
    }
    const lower = file.toLowerCase();
    if (RISK_KEYWORDS.some((keyword) => lower.includes(keyword))) {
      signals.push({ id: "auth_security_keyword", severity: "medium", blocking: false, reason: `${file} matched risk keyword` });
    }
  }

  if (changedFiles.length > 20) {
    gates.push({ id: "large_changed_files", severity: "high", blocking: true, reason: `${changedFiles.length} changed files` });
  }
  if (deletedLines > 500) {
    gates.push({ id: "large_deletion", severity: "high", blocking: true, reason: `${deletedLines} deleted lines` });
  }

  const level = gates.length ? "high" : signals.length ? "medium" : changedFiles.length ? "low" : "unknown";
  return { level, gates, signals, changedFiles, deletedLines };
}

function addBlockersFromRisk(cwd, run, risk) {
  const existing = new Set((run.blockers || []).filter((b) => b.status !== "resolved").map((b) => b.id));
  for (const gate of risk.gates || []) {
    const id = gate.id;
    if (!existing.has(id)) {
      const blocker = {
        id,
        status: "open",
        severity: gate.severity,
        reason: gate.reason,
        created_at: now(),
      };
      run.blockers = [...(run.blockers || []), blocker];
      appendLedger(cwd, run, "blocker_added", `Blocker added: ${gate.reason}`, { blocker });
      existing.add(id);
    }
  }
  run.summary.risk = risk.level;
}

function classifyFailure(result) {
  if (result.timedOut) return "timeout";
  if (result.errorMessage && /ENOENT|not found|no such file/i.test(result.errorMessage)) return "missing_command";
  if (result.errorMessage && /permission denied|EACCES/i.test(result.errorMessage)) return "permission_denied";
  if (result.exitCode !== 0) return "code_failure";
  return null;
}

async function runCheck(cwd, run, check) {
  appendLedger(cwd, run, "check_started", `${check.label} started`, { check_id: check.id, command: check.command });
  const result = await execFileResult(check.command_bin, check.command_args || [], {
    cwd,
    timeout: check.timeout_ms ?? DEFAULT_CHECK_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  const output = [
    `$ ${check.command}`,
    `exit_code: ${result.exitCode}`,
    result.signal ? `signal: ${result.signal}` : null,
    result.errorMessage ? `error: ${result.errorMessage}` : null,
    "",
    "--- stdout ---",
    result.stdout || "",
    "",
    "--- stderr ---",
    result.stderr || "",
  ].filter((line) => line !== null).join("\n");
  const fileName = `${check.id}.txt`;
  writeText(evidencePath(cwd, run.run_id, fileName), truncateText(output));

  const failureType = classifyFailure(result);
  const status = result.ok ? "passed" : "failed";
  const index = loadEvidenceIndex(cwd, run.run_id);
  upsertEvidence(index, {
    id: `ev-${check.id}`,
    type: check.evidence_type,
    path: `evidence/${fileName}`,
    status,
    command: check.command,
    exit_code: result.exitCode,
    failure_type: failureType,
  });
  saveEvidenceIndex(cwd, run.run_id, index);
  appendLedger(cwd, run, "check_finished", `${check.label} ${status}`, {
    check_id: check.id,
    status,
    exit_code: result.exitCode,
    failure_type: failureType,
    evidence_path: `evidence/${fileName}`,
  });
  return { check, result, status, failureType };
}

async function runAllChecks(cwd, run, plan) {
  const checks = Array.isArray(plan?.checks) ? plan.checks : [];
  const results = [];
  for (const check of checks) {
    results.push(await runCheck(cwd, run, check));
  }
  return results;
}

// ── Verdict ─────────────────────────────────────────────────────────────────

function unresolvedBlockers(run) {
  return (run.blockers || []).filter((blocker) => blocker.status !== "resolved");
}

function checkEvidenceItem(index, check) {
  return (index.items || []).find((item) => item.type === check.evidence_type);
}

function calculateVerdict(run, plan, evidenceIndex) {
  const blockers = unresolvedBlockers(run);
  if (blockers.length) {
    return { verdict: "needs_evidence", reason: `${blockers.length} blocker(s) require attention.` };
  }

  const checks = Array.isArray(plan?.checks) ? plan.checks : [];
  const required = checks.filter((check) => check.required);
  const items = evidenceIndex?.items || [];
  const anyFailed = checks.some((check) => checkEvidenceItem({ items }, check)?.status === "failed");
  if (anyFailed) return { verdict: "needs_work", reason: "One or more checks failed." };

  const missingRequired = required.filter((check) => checkEvidenceItem({ items }, check)?.status !== "passed");
  const gitDiff = items.find((item) => item.type === "git_diff");
  if (missingRequired.length) {
    return { verdict: "needs_evidence", reason: `Required check evidence missing: ${missingRequired.map((c) => c.id).join(", ")}.` };
  }
  if (!required.length) {
    return { verdict: "needs_evidence", reason: "No required executable checks were detected." };
  }
  if (!gitDiff || gitDiff.status !== "collected") {
    return { verdict: "needs_evidence", reason: "Git diff evidence is missing." };
  }

  const optional = checks.filter((check) => !check.required);
  const optionalMissing = optional.filter((check) => !checkEvidenceItem({ items }, check));
  const manualChecks = Array.isArray(plan?.manual_checks) ? plan.manual_checks : [];
  const requiredManualMissing = manualChecks.filter((check) => check.required);
  if (optionalMissing.length || requiredManualMissing.length) {
    return { verdict: "ready_with_caveats", reason: "Core required evidence exists; optional/manual checks remain." };
  }
  return { verdict: "verified", reason: "Required checks and evidence are present with no unresolved blockers." };
}

// ── UI / formatting ──────────────────────────────────────────────────────────

function proofSymbol(index, type) {
  const item = (index?.items || []).find((entry) => entry.type === type);
  if (!item) return "–";
  if (item.status === "passed") return "✓";
  if (item.status === "failed") return "×";
  if (item.status === "collected") return "◉";
  if (item.status === "missing") return "–";
  return "?";
}

function sourceLabel(run) {
  const source = run?.source || {};
  if (source.type === "cruiseux") return `CruiseUX · ${source.ux_run_id || "handoff"}`;
  if (source.type === "handoff") return `handoff · ${basename(source.handoff_path || "file")}`;
  if (source.type === "verify_only") return "verify-only · current diff";
  if (source.type === "resume") return "resume · previous run";
  return "manual";
}

function nextAction(run, plan, evidenceIndex) {
  if (!run) return "/code-cruise \"task\"";
  if (run.phase === "blocked") return "resolve blocker, then /code-check";
  if (run.phase === "draft") return "/code-plan";
  if (run.phase === "planned") return "implement, then /code-check";
  if (run.phase === "active") return "/code-check";
  if (run.phase === "checking") {
    if (run.verdict === "needs_work") return "fix failure, then /code-check";
    if (run.verdict === "needs_evidence") return "add evidence or run checks";
    return "/code-report";
  }
  if (run.phase === "closed") return "review report";
  return "/code-status";
}

function renderPanelLines(run, plan, evidenceIndex, width = 48) {
  const boxWidth = Math.max(36, Math.min(width || 48, 72));
  const inner = boxWidth - 2;
  const title = ` ${MOD_NAME} · ${short(run?.title || "new run", Math.max(10, inner - 16))} `;
  const top = `╭─${title}${"─".repeat(Math.max(0, inner - title.length - 1))}╮`;
  const bottom = `╰${"─".repeat(inner)}╯`;
  const stepsTotal = run?.summary?.steps_total ?? plan?.steps?.length ?? 0;
  const stepsDone = run?.summary?.steps_done ?? 0;
  const phase = `${PHASE_LABELS[run?.phase] || run?.phase || "Brief"} · step ${stepsDone}/${stepsTotal}`;
  const current = plan?.steps?.find((step) => step.id === run?.current_step_id) || plan?.steps?.find((step) => step.status === "active") || plan?.steps?.find((step) => step.status === "pending");
  const nowLine = current?.title || (run?.phase === "closed" ? "Report ready" : run?.phase === "planned" ? "Evidence Contract ready" : "Capture coding task");
  const proof = `diff ${proofSymbol(evidenceIndex, "git_diff")}  typecheck ${proofSymbol(evidenceIndex, "typecheck_output")}  test ${proofSymbol(evidenceIndex, "test_output")}`;
  const verdict = `${VERDICT_LABELS[run?.verdict] || run?.verdict || "unreviewed"} · risk ${run?.summary?.risk || "unknown"}`;
  const lines = [
    top,
    panelRow("Phase", phase, inner),
    panelRow("Now", nowLine, inner),
    panelRow("Proof", proof, inner),
    panelRow("Verdict", verdict, inner),
    panelRow("Next", nextAction(run, plan, evidenceIndex), inner),
    panelRow("Source", sourceLabel(run), inner),
    bottom,
  ];
  return lines;
}

function panelRow(label, value, innerWidth) {
  const content = `${pad(label, 7)} ${short(value, innerWidth - 9)}`;
  return `│ ${pad(content, innerWidth - 2)} │`;
}

function renderPanelText(run, plan, evidenceIndex, width = 48) {
  return renderPanelLines(run, plan, evidenceIndex, width).join("\n");
}

function updatePanel(letta, run, plan, evidenceIndex) {
  panelText = renderPanelText(run, plan, evidenceIndex, 54);
  if (!letta.capabilities?.ui?.panels) return;
  if (!panelHandle) {
    panelHandle = letta.ui.openPanel({
      id: PANEL_ID,
      order: 100,
      render() {
        return panelText.split("\n").slice(0, 8);
      },
    });
  } else {
    panelHandle.update();
  }
}

function formatStatus(cwd, run, plan, evidenceIndex) {
  if (!run) return "No active CruiseCode run. Start one with `/code-cruise \"task\"`.";
  const checks = plan?.checks || [];
  const blockers = unresolvedBlockers(run);
  const evidence = evidenceIndex?.items || [];
  const stepLines = (plan?.steps || []).map((step) => `${step.status === "done" ? "✓" : step.status === "active" ? "◉" : step.status === "blocked" ? "!" : "–"} ${step.id} ${step.title}`);
  const evidenceLines = evidence.length
    ? evidence.map((item) => `${item.status === "passed" ? "✓" : item.status === "failed" ? "×" : item.status === "collected" ? "◉" : "–"} ${item.type}: ${item.status}${item.path ? ` (${item.path})` : ""}`)
    : ["– no evidence collected"];
  const checkLines = checks.length
    ? checks.map((check) => `${check.required ? "required" : "optional"} ${check.id}: ${check.command}`)
    : ["– no checks detected"];
  return [
    "CruiseCode Status",
    "",
    "Run",
    `- ID: ${run.run_id}`,
    `- Title: ${run.title}`,
    `- CWD: ${cwd}`,
    `- Source: ${sourceLabel(run)}`,
    `- Phase: ${PHASE_LABELS[run.phase] || run.phase}`,
    `- Verdict: ${VERDICT_LABELS[run.verdict] || run.verdict}`,
    `- Risk: ${run.summary?.risk || "unknown"}`,
    "",
    "Progress",
    ...(stepLines.length ? stepLines : ["– no steps planned"]),
    "",
    "Checks",
    ...checkLines,
    "",
    "Evidence",
    ...evidenceLines,
    "",
    "Blockers",
    ...(blockers.length ? blockers.map((b) => `! ${b.id}: ${b.reason}`) : ["- none"]),
    "",
    "Next",
    nextAction(run, plan, evidenceIndex),
  ].join("\n");
}

function checkLabelFromEvidenceType(plan, evidenceType) {
  const check = (plan?.checks || []).find((item) => item.evidence_type === evidenceType);
  return check?.id || evidenceType.replace(/_output$/, "");
}

function buildLessonCandidates(cwd, run, plan, evidenceIndex, verdictResult) {
  const evidence = evidenceIndex?.items || [];
  const passedChecks = evidence.filter((item) => item.status === "passed" && String(item.type || "").endsWith("_output"));
  const failedChecks = evidence.filter((item) => item.status === "failed" && String(item.type || "").endsWith("_output"));
  const hasDiff = evidence.some((item) => item.type === "git_diff" && ["collected", "passed"].includes(item.status));
  const criteria = plan?.acceptance_criteria || [];
  const candidates = [];

  if (hasDiff && passedChecks.length) {
    candidates.push({
      id: "cc-lesson-verification-loop",
      title: "Evidence-first coding verification loop",
      status: verdictResult.verdict === "verified" ? "candidate" : "parked",
      suggested_owner: "muscle-memory",
      suggested_action: "update_existing_skill_first",
      evidence_chain: [
        "implementation produced a git diff",
        ...passedChecks.map((item) => `${checkLabelFromEvidenceType(plan, item.type)} check passed`),
        `CruiseCode verdict: ${verdictResult.verdict}`,
      ],
      reusable_scope: "Coding tasks where a git diff must be backed by executable checks before claiming completion.",
      not_a_skill_if: [
        "The lesson only repeats this project name, file path, or one-off task wording.",
        "No reusable verification procedure exists beyond the normal CruiseCode report.",
      ],
      redaction_notes: [
        "Remove local workspace paths from reports before sharing.",
        "Remove private project names, patient data, secrets, and company-specific identifiers.",
      ],
      source_artifacts: ["report.md", "evidence/index.json"],
      confidence: verdictResult.verdict === "verified" ? "medium" : "low",
    });
  }

  if ((run.source?.type === "handoff" || run.source?.type === "cruiseux") && criteria.length) {
    candidates.push({
      id: "cc-lesson-ux-handoff-to-evidence-contract",
      title: "CruiseUX handoff to CruiseCode evidence contract",
      status: hasDiff ? "candidate" : "parked",
      suggested_owner: "muscle-memory",
      suggested_action: "update_existing_skill_first",
      evidence_chain: [
        "CruiseUX implementation handoff was consumed",
        `${criteria.length} acceptance criterion/criteria were converted into implementation evidence requirements`,
        hasDiff ? "implementation evidence was collected" : "implementation evidence is still missing",
      ],
      reusable_scope: "UX-to-code handoffs where acceptance criteria need traceable implementation evidence.",
      not_a_skill_if: [
        "The handoff only contains project-specific product copy or private workflow names.",
        "Acceptance criteria were too vague to become reusable implementation checks.",
      ],
      redaction_notes: [
        "Keep UX reference IDs, but remove private research notes or healthcare/customer identifiers before sharing.",
      ],
      source_artifacts: ["plan.json", "report.md"],
      confidence: hasDiff ? "medium" : "low",
    });
  }

  if (failedChecks.length) {
    candidates.push({
      id: "cc-lesson-failed-check-triage",
      title: "Failed check triage from CruiseCode evidence",
      status: "parked",
      suggested_owner: "muscle-memory",
      suggested_action: "do_not_create_until_repaired_or_repeated",
      evidence_chain: failedChecks.map((item) => `${checkLabelFromEvidenceType(plan, item.type)} check failed (${item.failure_type || "unknown"})`),
      reusable_scope: "Potential debugging workflow only after a later source edit and passing rerun prove the repair path.",
      not_a_skill_if: [
        "The failure remains unresolved.",
        "The output only says a check failed without a durable repair mechanism.",
      ],
      redaction_notes: [
        "Do not copy raw logs with secrets, local paths, or private identifiers into a shared skill.",
      ],
      source_artifacts: failedChecks.map((item) => item.path).filter(Boolean),
      confidence: "low",
    });
  }

  return {
    schema_version: SCHEMA_VERSION,
    source: MOD_ID,
    run_id: run.run_id,
    generated_at: now(),
    boundary: "CruiseCode exports reusable lesson candidates only. muscle-memory owns distillation, deduplication, quality gates, sanitization, and publishing.",
    workspace: cwd,
    verdict: verdictResult.verdict,
    candidates,
  };
}

function lessonCandidateMarkdown(lessonExport) {
  const candidates = lessonExport?.candidates || [];
  if (!candidates.length) {
    return [
      "- none",
      "- Boundary: CruiseCode did not find a reusable lesson candidate. Do not create a skill from this run unless later repeated work provides stronger evidence.",
    ];
  }
  return candidates.flatMap((candidate, index) => [
    `### ${index + 1}. ${candidate.title}`,
    "",
    `- Status: ${candidate.status}`,
    `- Suggested owner: ${candidate.suggested_owner}`,
    `- Suggested action: ${candidate.suggested_action}`,
    `- Reusable scope: ${candidate.reusable_scope}`,
    "- Evidence chain:",
    ...(candidate.evidence_chain || []).map((item) => `  - ${item}`),
    "- Not a skill if:",
    ...(candidate.not_a_skill_if || []).map((item) => `  - ${item}`),
    "- Redaction notes:",
    ...(candidate.redaction_notes || []).map((item) => `  - ${item}`),
    `- Source artifacts: ${(candidate.source_artifacts || []).join(", ") || "none"}`,
    `- Confidence: ${candidate.confidence}`,
    "",
  ]);
}

function buildReportMarkdown(cwd, run, plan, evidenceIndex, verdictResult, lessonExport) {
  const blockers = unresolvedBlockers(run);
  const evidence = evidenceIndex?.items || [];
  const evidenceByType = new Map(evidence.map((item) => [item.type, item]));
  const criteriaLines = (plan?.acceptance_criteria || []).map((criterion) => {
    const evidenceLines = (criterion.evidence_required || []).map((type) => {
      const item = evidenceByType.get(type);
      return `  - ${type}: ${item ? item.status : "missing"}${item?.path ? ` (${item.path})` : ""}`;
    });
    return [`- ${criterion.id}: ${criterion.text}`, ...evidenceLines].join("\n");
  });
  const checkLines = (plan?.checks || []).map((check) => {
    const item = evidenceByType.get(check.evidence_type);
    return `- ${check.required ? "required" : "optional"} ${check.id}: ${item ? item.status : "missing"} — ${check.command}`;
  });
  return [
    `# CruiseCode Report: ${run.title}`,
    "",
    "## Summary",
    run.brief?.summary || run.brief?.task || run.title,
    "",
    "## Final Verdict",
    `- Phase: ${run.phase}`,
    `- Verdict: ${run.verdict}`,
    `- Reason: ${verdictResult.reason}`,
    "",
    "## Source",
    `- ${sourceLabel(run)}`,
    `- Workspace: ${cwd}`,
    "",
    "## Acceptance Criteria",
    ...(criteriaLines.length ? criteriaLines : ["- none"]),
    "",
    "## Evidence",
    ...(evidence.length ? evidence.map((item) => `- ${item.type}: ${item.status}${item.path ? ` — ${item.path}` : ""}`) : ["- none"]),
    "",
    "## Checks",
    ...(checkLines.length ? checkLines : ["- no checks detected"]),
    "",
    "## Blockers / Risks",
    ...(blockers.length ? blockers.map((b) => `- ${b.id}: ${b.reason}`) : ["- none"]),
    "",
    "## Missing Evidence",
    ...missingEvidenceLines(plan, evidenceIndex),
    "",
    "## Reusable Lesson Candidates",
    ...lessonCandidateMarkdown(lessonExport),
    "Boundary: CruiseCode records candidates only; muscle-memory should decide whether to distill, deduplicate, sanitize, or publish a skill.",
    "",
    "## Next Recommended Action",
    nextAction(run, plan, evidenceIndex),
    "",
    "## Run Metadata",
    `- Run ID: ${run.run_id}`,
    `- Created: ${run.created_at}`,
    `- Updated: ${run.updated_at}`,
    "",
    "## Next-session notes",
    "Use `/code-status` to reload the run state, or `/code-cruise --resume` to continue from the active run.",
    "",
  ].join("\n");
}

function missingEvidenceLines(plan, evidenceIndex) {
  const evidence = evidenceIndex?.items || [];
  const existing = new Set(evidence.filter((item) => ["collected", "passed"].includes(item.status)).map((item) => item.type));
  const missing = [];
  for (const criterion of plan?.acceptance_criteria || []) {
    for (const type of criterion.evidence_required || []) {
      if (!existing.has(type)) missing.push(`- ${criterion.id}: ${type}`);
    }
  }
  return missing.length ? missing : ["- none"];
}

// ── Command flows ────────────────────────────────────────────────────────────

async function initializeRunFromTask(cwd, task, mode = "standard", source = { type: "manual" }) {
  const checks = buildCheckCommands(cwd);
  const run = createBaseRun(cwd, { title: task, task, mode, source });
  const plan = buildPlanFromTask(task, checks);
  savePlan(cwd, run.run_id, plan);
  run.phase = "planned";
  updateRunSummaryFromPlan(run, plan, loadEvidenceIndex(cwd, run.run_id));
  saveRun(cwd, run);
  appendLedger(cwd, run, "plan_created", "Evidence Contract created", { checks: checks.map((c) => c.id) });
  return { run, plan, evidenceIndex: loadEvidenceIndex(cwd, run.run_id) };
}

async function initializeRunFromHandoff(cwd, handoffPath, handoff) {
  const checks = buildCheckCommands(cwd);
  const readiness = handoff.readiness?.status ?? "unknown";
  const producerRun = handoff.producer?.run_id ?? null;
  const sourceType = producerRun ? "cruiseux" : "handoff";
  const run = createBaseRun(cwd, {
    title: handoffTitle(handoff),
    task: handoffTask(handoff),
    mode: "handoff",
    source: {
      type: sourceType,
      handoff_path: handoffPath,
      ux_run_id: producerRun,
      readiness,
    },
  });
  const plan = buildPlanFromHandoff(handoff, checks);
  savePlan(cwd, run.run_id, plan);

  const blockers = blockingQuestions(handoff);
  if (!["implementation_ready", "prototype_ready"].includes(readiness)) {
    run.blockers.push({ id: "handoff_readiness", status: "open", severity: "high", reason: `Handoff readiness is ${readiness}`, created_at: now() });
  }
  for (const question of blockers) {
    run.blockers.push({ id: question.id || `open_question_${run.blockers.length + 1}`, status: "open", severity: "high", reason: question.question || "Blocking open question", created_at: now() });
  }

  run.phase = run.blockers.length ? "blocked" : "planned";
  updateRunSummaryFromPlan(run, plan, loadEvidenceIndex(cwd, run.run_id));
  saveRun(cwd, run);
  appendLedger(cwd, run, "plan_created", "Evidence Contract created from handoff", { handoff_path: handoffPath, readiness });
  for (const blocker of run.blockers) appendLedger(cwd, run, "blocker_added", `Blocker added: ${blocker.reason}`, { blocker });
  return { run, plan, evidenceIndex: loadEvidenceIndex(cwd, run.run_id) };
}

async function runCheckFlow(cwd, run, plan) {
  run.phase = "checking";
  saveRun(cwd, run);
  appendLedger(cwd, run, "phase_changed", "Phase changed to checking", { to: "checking" });

  let evidenceIndex = await collectGitEvidence(cwd, run);
  await runAllChecks(cwd, run, plan);
  evidenceIndex = loadEvidenceIndex(cwd, run.run_id);

  const risk = await collectGitRisk(cwd);
  addBlockersFromRisk(cwd, run, risk);
  const verdictResult = calculateVerdict(run, plan, evidenceIndex);
  run.verdict = verdictResult.verdict;
  if (unresolvedBlockers(run).length) run.phase = "blocked";
  updateRunSummaryFromPlan(run, plan, evidenceIndex);
  saveRun(cwd, run);
  return { run, plan, evidenceIndex, risk, verdictResult };
}

async function handleCodeCruise(letta, ctx) {
  const cwd = normalizeCwd(ctx.cwd);
  const input = String(ctx.args ?? "").trim();
  if (isHelp(input)) return output(helpText());

  ensureStorage(cwd);

  if (input === "--resume") {
    const run = loadActiveRun(cwd);
    if (!run) return output("No active CruiseCode run. Start one with `/code-cruise \"task\"`.");
    const plan = loadPlan(cwd, run.run_id);
    const evidenceIndex = loadEvidenceIndex(cwd, run.run_id);
    updatePanel(letta, run, plan, evidenceIndex);
    return output(`${panelText}\n\n${formatStatus(cwd, run, plan, evidenceIndex)}`);
  }

  if (input === "--verify-only") {
    const result = await initializeRunFromTask(cwd, "Verify current git changes", "verify_only", { type: "verify_only" });
    const checked = await runCheckFlow(cwd, result.run, result.plan);
    updatePanel(letta, checked.run, checked.plan, checked.evidenceIndex);
    return output(`${panelText}\n\n${checkSummary(cwd, checked)}`);
  }

  if (input.startsWith("--handoff ")) {
    const file = input.replace(/^--handoff\s+/, "").trim();
    const { path, handoff } = readHandoffFile(cwd, file);
    const result = await initializeRunFromHandoff(cwd, path, handoff);
    updatePanel(letta, result.run, result.plan, result.evidenceIndex);
    return output(`${panelText}\n\nCruiseCode run created from handoff.\nRun: ${result.run.run_id}\nNext: ${nextAction(result.run, result.plan, result.evidenceIndex)}`);
  }

  if (input.startsWith("--from-ux ")) {
    const uxRunId = input.replace(/^--from-ux\s+/, "").trim();
    const { path, handoff } = resolveHandoffFromUx(cwd, uxRunId);
    const result = await initializeRunFromHandoff(cwd, path, handoff);
    updatePanel(letta, result.run, result.plan, result.evidenceIndex);
    return output(`${panelText}\n\nCruiseCode run created from CruiseUX handoff.\nRun: ${result.run.run_id}\nNext: ${nextAction(result.run, result.plan, result.evidenceIndex)}`);
  }

  if (input.startsWith("--auto") || input.startsWith("--loop")) {
    return output("`--auto` and `--loop` are saved as future CruiseCode options, but they are intentionally not implemented in MVP.");
  }

  const task = stripWrappingQuotes(input);
  const result = await initializeRunFromTask(cwd, task);
  updatePanel(letta, result.run, result.plan, result.evidenceIndex);
  return output([
    panelText,
    "",
    "CruiseCode run created.",
    `Run: ${result.run.run_id}`,
    `Phase: ${result.run.phase}`,
    `Verdict: ${result.run.verdict}`,
    `Checks: ${result.plan.checks.length ? result.plan.checks.map((c) => `${c.id}${c.required ? "*" : ""}`).join(", ") : "none detected"}`,
    "",
    "Next:",
    nextAction(result.run, result.plan, result.evidenceIndex),
  ].join("\n"));
}

async function handleCodePlan(letta, ctx) {
  const cwd = normalizeCwd(ctx.cwd);
  ensureStorage(cwd);
  const input = String(ctx.args ?? "").trim();
  let run = loadActiveRun(cwd);
  if (!run) {
    if (!input || isHelp(input)) return output("No active CruiseCode run. Start one with `/code-cruise \"task\"`, or pass a task to `/code-plan <task>`.");
    const result = await initializeRunFromTask(cwd, stripWrappingQuotes(input));
    updatePanel(letta, result.run, result.plan, result.evidenceIndex);
    return output(`${panelText}\n\nEvidence Contract created.\nRun: ${result.run.run_id}`);
  }
  const task = input && !isHelp(input) ? stripWrappingQuotes(input) : run.brief?.task || run.title;
  const checks = buildCheckCommands(cwd);
  const plan = buildPlanFromTask(task, checks);
  savePlan(cwd, run.run_id, plan);
  run.phase = "planned";
  run.verdict = "unreviewed";
  run.brief.task = task;
  run.brief.summary = task;
  updateRunSummaryFromPlan(run, plan, loadEvidenceIndex(cwd, run.run_id));
  saveRun(cwd, run);
  appendLedger(cwd, run, "plan_created", "Evidence Contract created/updated", { checks: checks.map((c) => c.id) });
  const evidenceIndex = loadEvidenceIndex(cwd, run.run_id);
  updatePanel(letta, run, plan, evidenceIndex);
  return output(`${panelText}\n\nEvidence Contract ready.\nAcceptance criteria: ${plan.acceptance_criteria.length}\nSteps: ${plan.steps.length}\nChecks: ${plan.checks.length || "none detected"}`);
}

async function handleCodeCheck(letta, ctx) {
  const cwd = normalizeCwd(ctx.cwd);
  const run = loadActiveRun(cwd);
  if (!run) return output("No active CruiseCode run. Start one with `/code-cruise \"task\"`.");
  const plan = loadPlan(cwd, run.run_id);
  if (!plan) return output("Active run has no plan.json. Run `/code-plan` first.");
  const checked = await runCheckFlow(cwd, run, plan);
  updatePanel(letta, checked.run, checked.plan, checked.evidenceIndex);
  return output(`${panelText}\n\n${checkSummary(cwd, checked)}`);
}

function checkSummary(cwd, checked) {
  const items = checked.evidenceIndex?.items || [];
  const lines = items
    .filter((item) => ["typecheck_output", "test_output", "lint_output", "build_output", "git_diff"].includes(item.type))
    .map((item) => `${item.status === "passed" ? "✓" : item.status === "failed" ? "×" : item.status === "collected" ? "◉" : "–"} ${item.type}: ${item.status}`);
  return [
    "Checks/evidence completed.",
    "",
    "Evidence:",
    ...(lines.length ? lines : ["– no evidence collected"]),
    "",
    "Verdict:",
    `${checked.run.verdict} — ${checked.verdictResult.reason}`,
    "",
    "Next:",
    nextAction(checked.run, checked.plan, checked.evidenceIndex),
  ].join("\n");
}

async function handleCodeStatus(letta, ctx) {
  const cwd = normalizeCwd(ctx.cwd);
  const runIdArg = String(ctx.args ?? "").trim();
  const run = runIdArg && !isHelp(runIdArg) ? loadRunById(cwd, runIdArg) : loadActiveRun(cwd);
  if (!run) return output("No CruiseCode run found. Start one with `/code-cruise \"task\"`.");
  const plan = loadPlan(cwd, run.run_id);
  const evidenceIndex = loadEvidenceIndex(cwd, run.run_id);
  updatePanel(letta, run, plan, evidenceIndex);
  return output(`${panelText}\n\n${formatStatus(cwd, run, plan, evidenceIndex)}`);
}

async function handleCodeReport(letta, ctx) {
  const cwd = normalizeCwd(ctx.cwd);
  const run = loadActiveRun(cwd);
  if (!run) return output("No active CruiseCode run. Start one with `/code-cruise \"task\"`.");
  const plan = loadPlan(cwd, run.run_id);
  if (!plan) return output("Active run has no plan.json. Run `/code-plan` first.");
  const evidenceIndex = loadEvidenceIndex(cwd, run.run_id);
  const verdictResult = calculateVerdict(run, plan, evidenceIndex);
  run.verdict = verdictResult.verdict;
  if (!unresolvedBlockers(run).length) run.phase = "closed";
  updateRunSummaryFromPlan(run, plan, evidenceIndex);
  saveRun(cwd, run);
  const lessonExport = buildLessonCandidates(cwd, run, plan, evidenceIndex, verdictResult);
  writeJson(paths(cwd, run.run_id).lessonCandidates, lessonExport);
  const report = buildReportMarkdown(cwd, run, plan, evidenceIndex, verdictResult, lessonExport);
  writeText(paths(cwd, run.run_id).report, report);
  appendLedger(cwd, run, "report_created", "Report generated", {
    report_path: "report.md",
    lesson_candidates_path: "lesson-candidates.json",
    lesson_candidates: lessonExport.candidates.length,
    verdict: run.verdict,
  });
  updatePanel(letta, run, plan, evidenceIndex);
  const reportPath = paths(cwd, run.run_id).report;
  return output([
    panelText,
    "",
    "CruiseCode Report created.",
    `Status: ${run.verdict}`,
    `Report: ${reportPath}`,
    `Lesson candidates: ${paths(cwd, run.run_id).lessonCandidates}`,
    "",
    "Next:",
    nextAction(run, plan, evidenceIndex),
  ].join("\n"));
}

function output(text) {
  return { type: "output", output: text };
}

function helpText() {
  return [
    "CruiseCode — evidence-first coding workflow mod",
    "",
    "Commands:",
    "  /code-cruise \"task\"        Create a run and Evidence Contract",
    "  /code-cruise --verify-only   Verify current git diff with checks",
    "  /code-cruise --resume        Show active run",
    "  /code-cruise --handoff <file> Create a run from implementation-handoff.json",
    "  /code-plan [task]            Create/update the Evidence Contract",
    "  /code-check                  Collect git/check evidence",
    "  /code-status                 Show run status",
    "  /code-report                 Generate report.md",
    "",
    "State:",
    "  <cwd>/.letta/cruise-code/",
  ].join("\n");
}

function wrapHandler(letta, handler) {
  return async (ctx) => {
    try {
      return await handler(letta, ctx);
    } catch (error) {
      const message = error?.kind === "user_error"
        ? error.message
        : `CruiseCode error: ${error?.message || String(error)}`;
      return output(message);
    }
  };
}

// ── Mod registration ────────────────────────────────────────────────────────

export default function activate(letta) {
  const disposers = [];

  if (letta.capabilities?.commands) {
    const commands = [
      { id: "code-cruise", description: "Create, resume, or verify a CruiseCode evidence-first coding run", args: "\"task\"|--verify-only|--resume|--handoff <file>", run: handleCodeCruise },
      { id: "code-plan", description: "Create or update the active CruiseCode Evidence Contract", args: "[task]", run: handleCodePlan },
      { id: "code-check", description: "Collect git diff and configured check evidence for the active CruiseCode run", args: "", run: handleCodeCheck },
      { id: "code-status", description: "Show the active CruiseCode run status", args: "[run-id]", run: handleCodeStatus },
      { id: "code-report", description: "Generate the active CruiseCode verification report", args: "", run: handleCodeReport },
    ];

    for (const command of commands) {
      disposers.push(
        letta.commands.register({
          id: command.id,
          description: command.description,
          args: command.args,
          async run(ctx) {
            return wrapHandler(letta, command.run)(ctx);
          },
        }),
      );
    }
  }

  return () => {
    if (panelHandle) {
      panelHandle.close();
      panelHandle = null;
    }
    for (const dispose of disposers.reverse()) dispose();
  };
}
