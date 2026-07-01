import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

const COMMAND_TIMEOUT_MS = 4_000;
const MAX_BUFFER = 256 * 1024;

function pickEnv(name) {
  const value = process.env[name];
  if (!value) return "(unset)";
  if (/TOKEN|KEY|SECRET|PASSWORD|AUTH/i.test(name)) return "(set, hidden)";
  return value;
}

function resolveMemoryDir(ctx, home) {
  const fromEnv = process.env.MEMORY_DIR;
  if (fromEnv) return { path: fromEnv, source: "MEMORY_DIR env" };

  const agentId = ctx?.agent?.id || ctx?.agent?.agentId || ctx?.agent?.agent_id;
  if (agentId) {
    const candidate = path.join(home, ".letta", "agents", String(agentId), "memory");
    if (fs.existsSync(candidate)) return { path: candidate, source: "ctx.agent.id fallback" };
  }

  const agentsRoot = path.join(home, ".letta", "agents");
  try {
    const candidates = fs.readdirSync(agentsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(agentsRoot, entry.name, "memory"))
      .filter((candidate) => fs.existsSync(candidate));

    if (candidates.length === 1) return { path: candidates[0], source: "single ~/.letta/agents/*/memory fallback" };
    if (candidates.length > 1) return { path: "", source: `ambiguous: ${candidates.length} memory repos found` };
  } catch {
    // Ignore; leave memory path unavailable.
  }

  return { path: "", source: "unavailable" };
}

function detectEnvironment(ctx) {
  const home = process.env.HOME || os.homedir() || "";
  const cwd = ctx?.cwd || process.cwd();
  const resolvedMemory = resolveMemoryDir(ctx, home);
  const memoryDir = resolvedMemory.path;
  const markers = [];

  if (home.startsWith("/Users/")) markers.push("Desktop/macOS home path");
  if (home === "/root") markers.push("Railway/Linux root home");
  if (cwd.startsWith("/home/bun/app")) markers.push("Railway app cwd");
  if (memoryDir.startsWith("/root/.letta/")) markers.push("Railway memory path");
  if (memoryDir.startsWith("/Users/")) markers.push("Desktop memory path");
  if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_ID) markers.push("Railway env vars present");

  let label = "Unknown / mixed";
  if (markers.some((m) => m.includes("Railway")) && !markers.some((m) => m.includes("Desktop"))) {
    label = "Railway / remote";
  } else if (markers.some((m) => m.includes("Desktop")) && !markers.some((m) => m.includes("Railway"))) {
    label = "Desktop / local Mac";
  }

  return { label, markers, home, cwd, memoryDir, memorySource: resolvedMemory.source };
}

async function runFile(file, args, cwd = process.cwd()) {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      cwd,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const message = stderr || stdout || error?.message || String(error);
    return { ok: false, stdout, stderr, message };
  }
}

async function runGit(args, cwd) {
  return runFile("git", args, cwd);
}

function redactRemoteUrl(url) {
  return String(url || "")
    .replace(/(https?:\/\/)([^/@]+)@/i, "$1[credential-hidden]@")
    .replace(/(token|key|auth|password)=([^&]+)/gi, "$1=[hidden]");
}

function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "unknown age";
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function statusSignals(statusText) {
  const lines = String(statusText || "").split("\n").filter(Boolean);
  const branchLine = lines.find((line) => line.startsWith("##")) || "";
  const dirtyLines = lines.filter((line) => !line.startsWith("##"));
  return {
    branchLine,
    dirty: dirtyLines.length > 0,
    ahead: /\[.*ahead/.test(branchLine),
    behind: /\[.*behind/.test(branchLine),
    diverged: /\[.*ahead.*behind|\[.*behind.*ahead/.test(branchLine),
  };
}

async function fetchHeadInfo(root) {
  const fetchHeadPath = await runGit(["rev-parse", "--git-path", "FETCH_HEAD"], root);
  if (!fetchHeadPath.ok || !fetchHeadPath.stdout) {
    return { found: false, text: "Last fetch: unavailable" };
  }

  const absolute = path.isAbsolute(fetchHeadPath.stdout)
    ? fetchHeadPath.stdout
    : path.join(root, fetchHeadPath.stdout);

  try {
    const stat = fs.statSync(absolute);
    const ageMs = Date.now() - stat.mtimeMs;
    return {
      found: true,
      path: absolute,
      mtimeMs: stat.mtimeMs,
      ageMs,
      text: `Last fetch: ${formatAge(ageMs)} (${new Date(stat.mtimeMs).toISOString()})`,
    };
  } catch {
    return {
      found: false,
      path: absolute,
      text: "Last fetch: none recorded locally; remote freshness unknown until git fetch runs",
    };
  }
}

async function gitSummary(label, dir) {
  if (!dir) {
    const text = [`## ${label}`, "Path: (unset)", "Status: not available"].join("\n");
    return { label, dir, isRepo: false, text, statusText: "", fetchInfo: { found: false } };
  }

  const top = await runGit(["rev-parse", "--show-toplevel"], dir);
  if (!top.ok) {
    const text = [`## ${label}`, `Path: ${dir}`, "Git: not a repository or unavailable", `Detail: ${top.message}`].join("\n");
    return { label, dir, isRepo: false, text, statusText: "", fetchInfo: { found: false } };
  }

  const root = top.stdout;
  const [branch, status, log, remote, fetchInfo] = await Promise.all([
    runGit(["branch", "--show-current"], root),
    runGit(["status", "--short", "--branch"], root),
    runGit(["log", "--oneline", "-5"], root),
    runGit(["remote", "get-url", "origin"], root),
    fetchHeadInfo(root),
  ]);

  const statusText = status.ok && status.stdout ? status.stdout : "(clean/unknown)";
  const signals = statusSignals(statusText);
  const lines = [`## ${label}`, `Path: ${dir}`, `Repo root: ${root}`];
  lines.push(`Branch: ${branch.ok && branch.stdout ? branch.stdout : "(detached or unknown)"}`);
  if (remote.ok && remote.stdout) lines.push(`Origin: ${redactRemoteUrl(remote.stdout)}`);
  lines.push(fetchInfo.text);
  lines.push("", "Status:", statusText);
  lines.push("", "Recent commits:", log.ok && log.stdout ? log.stdout : "(unavailable)");

  return {
    label,
    dir,
    root,
    isRepo: true,
    text: lines.join("\n"),
    statusText,
    fetchInfo,
    ...signals,
  };
}

function isExecutable(candidate) {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findPathExecutables(name) {
  const seen = new Set();
  const results = [];
  for (const part of String(process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(part, name);
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (fs.existsSync(candidate) && isExecutable(candidate)) results.push(candidate);
  }
  return results;
}

function readPackageVersion(packagePath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    return `${pkg.name || "package"}@${pkg.version || "unknown"}`;
  } catch {
    return "unavailable";
  }
}

function firstMeaningfulLine(result) {
  const combined = [result.stdout, result.stderr, result.message].filter(Boolean).join("\n");
  const line = combined.split("\n").map((s) => s.trim()).find(Boolean);
  return line || "(no version output)";
}

async function lettaRuntimeSummary() {
  const paths = findPathExecutables("letta").slice(0, 8);
  const versions = await Promise.all(paths.map(async (candidate) => {
    const result = await runFile(candidate, ["--version"]);
    const note = candidate.includes("/Applications/Letta.app/Contents/MacOS/letta")
      ? " (Desktop launcher; --version may report Electron/Node)"
      : "";
    return {
      path: candidate,
      version: firstMeaningfulLine(result) + note,
      ok: result.ok,
    };
  }));

  const desktopPackagePath = "/Applications/Letta.app/Contents/Resources/app.asar.unpacked/node_modules/@letta-ai/letta-code/package.json";
  const desktopPackage = fs.existsSync(desktopPackagePath)
    ? readPackageVersion(desktopPackagePath)
    : "unavailable";

  const selected = versions[0];
  const versionSet = new Set(versions.map((entry) => entry.version.replace(/ \(Desktop launcher.*$/, "")));
  const lines = ["## Letta runtime"];
  lines.push(`Node runtime: ${process.version}`);
  lines.push(`Selected CLI: ${selected ? selected.path : "(not found in PATH)"}`);
  lines.push(`Selected CLI version: ${selected ? selected.version : "unavailable"}`);
  lines.push(`Desktop bundled package: ${desktopPackage}`);
  if (versions.length > 1) {
    lines.push("", "Other letta executables in PATH:");
    for (const entry of versions.slice(1)) {
      lines.push(`- ${entry.path}: ${entry.version}`);
    }
  }

  return {
    text: lines.join("\n"),
    selected,
    versions,
    multipleVersions: versionSet.size > 1,
  };
}

function buildRecommendations(memoryGit, cwdGit, lettaRuntime) {
  const lines = ["## Compass recommendation"];

  if (!memoryGit.isRepo) {
    lines.push("- Memory repo unavailable or not a git repo; do not edit memory until oriented manually.");
  } else if (memoryGit.diverged) {
    lines.push("- Memory repo appears diverged; stop and reconcile before editing.");
  } else if (memoryGit.behind) {
    lines.push("- Memory repo is behind its local remote view; pull/rebase before memory edits.");
  } else if (memoryGit.dirty) {
    lines.push("- Memory repo has local changes; inspect before adding more edits.");
  } else if (!memoryGit.fetchInfo?.found) {
    lines.push("- Memory repo is clean, but remote freshness is unknown; run git fetch before memory-sensitive edits.");
  } else if (memoryGit.fetchInfo.ageMs > 30 * 60 * 1000) {
    lines.push(`- Memory repo is clean, but remote view was last fetched ${formatAge(memoryGit.fetchInfo.ageMs)}; fetch before memory-sensitive edits.`);
  } else {
    lines.push("- Memory repo is clean and recently fetched; safe to inspect or make a focused edit.");
  }

  if (!cwdGit.isRepo) {
    lines.push("- Current workspace is not a git repo; avoid repo-specific assumptions here.");
  } else if (cwdGit.dirty) {
    lines.push("- Current workspace has local changes; inspect before editing or committing.");
  } else {
    lines.push("- Current workspace git state looks clean from the local view.");
  }

  if (lettaRuntime.multipleVersions) {
    lines.push("- Multiple letta executables/versions are visible; use the selected CLI path/version above when debugging CLI behavior.");
  }

  return lines.join("\n");
}

async function buildCompass(ctx) {
  const cwd = ctx?.cwd || process.cwd();
  const env = detectEnvironment(ctx);
  const memoryDir = env.memoryDir || "";
  const permissionMode = ctx?.permissionMode || "(unknown)";
  const agent = ctx?.agent?.name || ctx?.agent?.id || "(unknown)";
  const model = ctx?.model?.id || ctx?.model?.name || "(unknown)";

  const [lettaRuntime, memoryGit, cwdGit] = await Promise.all([
    lettaRuntimeSummary(),
    gitSummary("Memory repo", memoryDir),
    gitSummary("Current workspace", cwd),
  ]);

  const header = [
    "# Environment Compass",
    "Read-only orientation. No fetch, pull, push, writes, or network calls.",
    "",
    `Detected environment: ${env.label}`,
    `Markers: ${env.markers.length ? env.markers.join("; ") : "none"}`,
    `Agent: ${agent}`,
    `Model: ${model}`,
    `Permission mode: ${permissionMode}`,
    `Platform: ${process.platform} ${process.arch}`,
    "",
    "## Key paths/env",
    `HOME: ${env.home || "(unset)"}`,
    `PWD/ctx.cwd: ${env.cwd}`,
    `Memory path: ${env.memoryDir || "(unset)"} (${env.memorySource})`,
    `LETTA_BASE_URL: ${pickEnv("LETTA_BASE_URL")}`,
    `LETTA_ENVIRONMENT: ${pickEnv("LETTA_ENVIRONMENT")}`,
    `RAILWAY_ENVIRONMENT: ${pickEnv("RAILWAY_ENVIRONMENT")}`,
    "",
    lettaRuntime.text,
    "",
    memoryGit.text,
    "",
    cwdGit.text,
    "",
    buildRecommendations(memoryGit, cwdGit, lettaRuntime),
  ];

  return header.join("\n");
}

export default function activate(letta) {
  const disposers = [];

  if (letta.capabilities.tools) {
    disposers.push(letta.tools.register({
      name: "environment_compass",
      description: "Read-only check of the current Letta environment, cwd, MEMORY_DIR, versions, and git status before memory-sensitive work.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      requiresApproval: false,
      parallelSafe: true,
      async run(ctx) {
        return buildCompass(ctx);
      },
    }));
  }

  if (letta.capabilities.commands) {
    disposers.push(letta.commands.register({
      id: "env-compass",
      description: "Show read-only environment, version, and memory git orientation.",
      async run(ctx) {
        return {
          type: "output",
          output: await buildCompass(ctx),
        };
      },
    }));
  }

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
