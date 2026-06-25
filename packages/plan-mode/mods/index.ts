import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const MODS_DIR = path.join(homedir(), ".letta", "mods");
const PLANS_DIR = path.join(homedir(), ".letta", "plans");
const STATE_PATH = path.join(MODS_DIR, "sample-plan-mode.state.json");
const GLOBAL_CONVERSATION_ID = "__global__";

const READ_ONLY_TOOL_NAMES = new Set([
  "glob",
  "globgemini",
  "grep",
  "grepfiles",
  "list",
  "listdir",
  "listdirectory",
  "ls",
  "notebookread",
  "read",
  "readfile",
  "readfilegemini",
  "readlsp",
  "readmanyfiles",
  "search",
  "searchfilecontent",
  "searchfiles",
  "skill",
  "taskoutput",
  "viewimage",
]);

const PLANNING_TOOL_NAMES = new Set([
  "askuserquestion",
  "enterplanmode",
  "exitplanmode",
  "sampleenterplanmode",
  "sampleexitplanmode",
  "todowrite",
  "updateplan",
  "writetodos",
]);

const READ_ONLY_SUBAGENT_TYPES = new Set(["recall"]);

function conversationKey(conversationId: string | null | undefined): string {
  return conversationId || GLOBAL_CONVERSATION_ID;
}

function normalizeName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function readState(): {
  sessions: Record<
    string,
    {
      conversationId: string;
      cwd: string;
      planFilePath: string;
      startedAt: number;
    }
  >;
} {
  try {
    if (!existsSync(STATE_PATH)) return { sessions: {} };
    const parsed = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    return parsed && typeof parsed === "object" && parsed.sessions
      ? { sessions: parsed.sessions }
      : { sessions: {} };
  } catch {
    return { sessions: {} };
  }
}

function writeState(state: ReturnType<typeof readState>): void {
  mkdirSync(MODS_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function getSession(conversationId: string | null | undefined) {
  return readState().sessions[conversationKey(conversationId)] ?? null;
}

function setSession(
  conversationId: string | null | undefined,
  session: NonNullable<ReturnType<typeof getSession>>,
): void {
  const state = readState();
  state.sessions[conversationKey(conversationId)] = session;
  writeState(state);
}

function clearSession(conversationId: string | null | undefined): void {
  const state = readState();
  delete state.sessions[conversationKey(conversationId)];
  writeState(state);
}

function createPlanFilePath(): string {
  mkdirSync(PLANS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = randomUUID().slice(0, 8);
  return path.join(PLANS_DIR, `sample-${timestamp}-${suffix}.md`);
}

function activatePlanMode(conversationId: string | null | undefined, cwd: string) {
  const session = {
    conversationId: conversationKey(conversationId),
    cwd,
    planFilePath: createPlanFilePath(),
    startedAt: Date.now(),
  };
  setSession(conversationId, session);
  return session;
}

function toRelativePatchPath(cwd: string, planFilePath: string): string {
  return path.relative(cwd, planFilePath).replaceAll(path.sep, "/");
}

function buildEnterPlanModeMessage(
  session: NonNullable<ReturnType<typeof getSession>>,
  cwd: string,
): string {
  const relativePatchPath = toRelativePatchPath(cwd, session.planFilePath);
  return `Entered sample plan mode. Focus on exploring the codebase and designing an implementation approach before making changes.

In sample plan mode:
1. Use direct read-only tools for exploration.
2. Do not edit files, change configuration, install packages, commit, push, or run mutating commands.
3. Write the implementation plan to the plan file.
4. Read the plan file and present the full current plan text to the user for approval.
5. After the user approves, call sample_exit_plan_mode.

Plan file path: ${session.planFilePath}
If using ApplyPatch, use this relative patch path: ${relativePatchPath}`;
}

function buildActiveReminder(
  session: NonNullable<ReturnType<typeof getSession>>,
  cwd: string,
): string {
  const relativePatchPath = toRelativePatchPath(cwd, session.planFilePath);
  return `<system-reminder>
Sample plan mode is active. Do not execute the implementation yet. You may use read-only tools for exploration and may write only to the active plan file or another markdown file under ~/.letta/plans/.

Active plan file: ${session.planFilePath}
If using ApplyPatch, use this relative patch path: ${relativePatchPath}

When the plan is complete, read the plan file and present the full current plan text to the user for approval. If the user approves, call sample_exit_plan_mode before making any implementation changes.
</system-reminder>`;
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);
  return Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function resolveToolPath(value: unknown, cwd: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return path.resolve(cwd, value);
}

function isPlanMarkdownPath(absolutePath: string): boolean {
  return isPathInside(PLANS_DIR, absolutePath) && path.extname(absolutePath) === ".md";
}

function getToolPathArgs(args: Record<string, unknown>): string[] {
  return [args.file_path, args.path, args.notebook_path].filter(
    (value): value is string => typeof value === "string",
  );
}

function getPatchTargets(input: string): string[] {
  const targets: string[] = [];
  for (const line of input.split("\n")) {
    const match = line.match(/^\*\*\* (?:Add File|Update File|Delete File|Move to):\s+(.+)$/);
    if (match?.[1]) targets.push(match[1].trim());
  }
  return targets;
}

function isPlanFileWrite(toolName: string, args: Record<string, unknown>, cwd: string): boolean {
  const normalized = normalizeName(toolName);
  if (normalized === "applypatch") {
    const input = typeof args.input === "string" ? args.input : "";
    const targets = getPatchTargets(input);
    return (
      targets.length > 0 &&
      targets.every((target) => {
        const resolved = resolveToolPath(target, cwd);
        return resolved !== null && isPlanMarkdownPath(resolved);
      })
    );
  }

  if (!["write", "edit", "multiedit", "notebookedit"].includes(normalized)) {
    return false;
  }

  const pathArgs = getToolPathArgs(args);
  return (
    pathArgs.length > 0 &&
    pathArgs.every((pathArg) => {
      const resolved = resolveToolPath(pathArg, cwd);
      return resolved !== null && isPlanMarkdownPath(resolved);
    })
  );
}

function isConservativeReadOnlyShell(command: string): boolean {
  const trimmed = command.trim();
  // The allowlist below only validates the leading command, so reject anything
  // that can chain, pipe, redirect, or expand into another command first.
  // Otherwise a safe prefix like `ls` smuggles in `; rm -rf foo` or `| sh`.
  if (/[|;&<>`\n]/.test(trimmed) || trimmed.includes("$(") || trimmed.includes("${")) {
    return false;
  }
  return (
    /^(pwd|ls|cat|head|tail|wc)(\s|$)/.test(trimmed) ||
    /^sed\s+-n\s+/.test(trimmed) ||
    /^git\s+(status|diff|log|show|rev-parse|branch)(\s|$)/.test(trimmed) ||
    /^rg\s+/.test(trimmed) ||
    /^find\s+[^;|&]*\s+(-maxdepth\s+\d+\s+)?(-type\s+[fd]\s+)?(-name\s+[^;|&]+\s*)?$/.test(trimmed)
  );
}

function isReadOnlyTool(toolName: string, args: Record<string, unknown>): boolean {
  const normalized = normalizeName(toolName);
  if (READ_ONLY_TOOL_NAMES.has(normalized)) return true;
  if (normalized === "bash" || normalized === "execcommand") {
    const command = String(args.command ?? args.cmd ?? "");
    return isConservativeReadOnlyShell(command);
  }
  return false;
}

function isPlanningTool(toolName: string): boolean {
  return PLANNING_TOOL_NAMES.has(normalizeName(toolName));
}

function isAllowedReadOnlySubagent(args: Record<string, unknown>): boolean {
  const subagentType = args.subagent_type;
  return typeof subagentType === "string" && READ_ONLY_SUBAGENT_TYPES.has(normalizeName(subagentType));
}

export default function activate(letta) {
  const disposers = [];

  if (letta.capabilities.commands) {
    disposers.push(
      letta.commands.register({
        id: "sample-plan",
        description: "Enter sample plan mode",
        run(ctx) {
          const session = activatePlanMode(ctx.conversation.id, ctx.cwd);
          return {
            type: "prompt",
            systemReminder: true,
            content: buildEnterPlanModeMessage(session, ctx.cwd),
          };
        },
      }),
    );
  }

  if (letta.capabilities.tools) {
    disposers.push(
      letta.tools.register({
        name: "sample_enter_plan_mode",
        description:
          "Enter sample plan mode before a non-trivial task that needs read-only exploration and user approval before implementation.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        requiresApproval: true,
        parallelSafe: false,
        run(ctx) {
          const session = activatePlanMode(ctx.conversation.id, ctx.cwd);
          return buildEnterPlanModeMessage(session, ctx.cwd);
        },
      }),
    );

    disposers.push(
      letta.tools.register({
        name: "sample_exit_plan_mode",
        description:
          "Exit sample plan mode only after the plan file has been written, the full current plan text has been presented to the user, and the user has approved it.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        approvalPolicy: "alwaysAsk",
        parallelSafe: false,
        run(ctx) {
          const session = getSession(ctx.conversation.id);
          if (!session) {
            return { status: "error", content: "Sample plan mode is not active for this conversation." };
          }
          if (!existsSync(session.planFilePath) || statSync(session.planFilePath).size === 0) {
            return {
              status: "error",
              content: `Write the plan before exiting sample plan mode. Plan file: ${session.planFilePath}`,
            };
          }
          clearSession(ctx.conversation.id);
          return "Sample plan mode exited. The user has approved the plan, so implementation can begin.";
        },
      }),
    );
  }

  if (letta.capabilities.events.turns) {
    disposers.push(
      letta.events.on("turn_start", (event, ctx) => {
        const session = getSession(event.conversationId);
        if (!session) return;
        return {
          input: [
            { role: "user", content: buildActiveReminder(session, ctx.cwd) },
            ...event.input,
          ],
        };
      }),
    );
  }

  if (letta.capabilities.permissions) {
    disposers.push(
      letta.permissions.register({
        id: "sample-plan-mode",
        description:
          "Allow read-only tools and writes only to ~/.letta/plans/*.md while sample plan mode is active.",
        check(event) {
          const session = getSession(event.conversationId);
          if (!session) return;

          const toolName = String(event.toolName);
          const args = event.args ?? {};
          const cwd = event.workingDirectory || event.cwd || session.cwd;

          if (isReadOnlyTool(toolName, args)) return { decision: "allow" };
          if (isPlanningTool(toolName)) return { decision: "allow", reason: "planning" };
          if ((normalizeName(toolName) === "agent" || normalizeName(toolName) === "task") && isAllowedReadOnlySubagent(args)) {
            return { decision: "allow", reason: "read-only subagent" };
          }
          if (isPlanFileWrite(toolName, args, cwd)) {
            return { decision: "allow", reason: "plan file" };
          }

          return {
            decision: "deny",
            reason:
              `Sample plan mode is active. Use read-only tools, planning tools, or writes only to markdown files under ${PLANS_DIR}. ` +
              `Active plan file: ${session.planFilePath}. Call sample_exit_plan_mode only after the user approves the full plan.`,
          };
        },
      }),
    );
  }

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
