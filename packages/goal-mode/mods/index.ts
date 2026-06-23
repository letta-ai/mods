import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MODS_DIR = join(homedir(), ".letta", "mods");
const STATE_PATH = join(MODS_DIR, "goal-mode.state.json");
const GLOBAL_CONVERSATION_ID = "__global__";
const MAX_GOAL_OBJECTIVE_CHARS = 4000;

type GoalStatus = "active" | "paused" | "complete" | "blocked" | "budget_limited";

type Goal = {
  objective: string;
  status: GoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  activeTimeSeconds: number;
  activeStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type GoalState = { goals: Record<string, Goal> };

function nowIso(): string {
  return new Date().toISOString();
}

function conversationKey(conversationId: string | null | undefined): string {
  return conversationId || GLOBAL_CONVERSATION_ID;
}

function readState(): GoalState {
  try {
    if (!existsSync(STATE_PATH)) return { goals: {} };
    const parsed = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    return parsed?.goals ? { goals: parsed.goals } : { goals: {} };
  } catch {
    return { goals: {} };
  }
}

function writeState(state: GoalState): void {
  mkdirSync(MODS_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function getGoal(conversationId: string | null | undefined): Goal | null {
  return readState().goals[conversationKey(conversationId)] ?? null;
}

function setGoal(conversationId: string | null | undefined, goal: Goal): Goal {
  const state = readState();
  state.goals[conversationKey(conversationId)] = { ...goal, updatedAt: nowIso() };
  writeState(state);
  return state.goals[conversationKey(conversationId)];
}

function clearGoal(conversationId: string | null | undefined): void {
  const state = readState();
  delete state.goals[conversationKey(conversationId)];
  writeState(state);
}

function updateUsage(goal: Goal, ctx: { contextWindow?: { totalInputTokens?: number | null; totalOutputTokens?: number | null } }): Goal {
  const observedTokens = Math.max(
    0,
    Math.floor((ctx.contextWindow?.totalInputTokens ?? 0) + (ctx.contextWindow?.totalOutputTokens ?? 0)),
  );
  return { ...goal, tokensUsed: Math.max(goal.tokensUsed ?? 0, observedTokens) };
}

function stopActiveClock(goal: Goal): Goal {
  if (!goal.activeStartedAt) return goal;
  const started = Date.parse(goal.activeStartedAt);
  const elapsed = Number.isNaN(started) ? 0 : Math.max(0, Math.floor((Date.now() - started) / 1000));
  return {
    ...goal,
    activeStartedAt: null,
    activeTimeSeconds: (goal.activeTimeSeconds ?? 0) + elapsed,
  };
}

function startActiveClock(goal: Goal): Goal {
  return {
    ...goal,
    activeStartedAt: goal.activeStartedAt ?? nowIso(),
  };
}

function validateGoalObjective(objective: string): string | null {
  if (!objective.trim()) return "Goal objective must not be empty.";
  if (objective.length > MAX_GOAL_OBJECTIVE_CHARS) {
    return `Goal objective is too long: ${objective.length} characters. Limit: ${MAX_GOAL_OBJECTIVE_CHARS} characters.`;
  }
  return null;
}

function parseGoalArgs(input: string): { objective: string; tokenBudget: number | null; replace: boolean; error?: string } {
  let rest = input.trim();
  let tokenBudget: number | null = null;
  let replace = false;

  const budgetMatch = rest.match(/--token-budget\s+(\d+)/);
  if (budgetMatch?.[1]) {
    tokenBudget = Number.parseInt(budgetMatch[1], 10);
    if (!Number.isFinite(tokenBudget) || tokenBudget <= 0) {
      return { objective: "", tokenBudget: null, replace, error: "Token budget must be a positive integer." };
    }
    rest = rest.replace(/--token-budget\s+\d+\s*/, "");
  }

  if (/--replace\b/.test(rest)) {
    replace = true;
    rest = rest.replace(/--replace\b\s*/, "");
  }

  return { objective: rest.trim().replace(/^["']|["']$/g, ""), tokenBudget, replace };
}

function formatGoalElapsedSeconds(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  if (safeSeconds < 60) return `${safeSeconds}s`;
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h ${remainingMinutes}m`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

function liveElapsedSeconds(goal: Goal): number {
  if (goal.status !== "active" || !goal.activeStartedAt) return goal.activeTimeSeconds ?? 0;
  const started = Date.parse(goal.activeStartedAt);
  const live = Number.isNaN(started) ? 0 : Math.max(0, Math.floor((Date.now() - started) / 1000));
  return (goal.activeTimeSeconds ?? 0) + live;
}

function formatGoalSummary(goal: Goal): string {
  const budget = goal.tokenBudget ? ` of ${goal.tokenBudget}` : "";
  return `Status: ${goal.status}\nObjective: ${goal.objective}\nUsage: ${goal.tokensUsed ?? 0}${budget} tokens, ${formatGoalElapsedSeconds(liveElapsedSeconds(goal))}`;
}

function remainingTokens(goal: Goal): number | null {
  return goal.tokenBudget != null ? Math.max(0, goal.tokenBudget - (goal.tokensUsed ?? 0)) : null;
}

function jsonResult(result: Record<string, unknown>) {
  return { status: "success", output: JSON.stringify(result, null, 2) };
}

function createGoalRecord(objective: string, tokenBudget: number | null): Goal {
  const now = nowIso();
  return {
    objective,
    status: "active",
    tokenBudget,
    tokensUsed: 0,
    activeTimeSeconds: 0,
    activeStartedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function buildGoalReminder(goal: Goal): string {
  return `<system-reminder>
The user has set a goal for this conversation.

Goal status: ${goal.status}
Goal objective: ${goal.objective}
Token budget: ${goal.tokenBudget ?? "none"}
Observed tokens used: ${goal.tokensUsed ?? 0}
Tokens remaining: ${remainingTokens(goal) ?? "unbounded"}
Time spent pursuing goal: ${formatGoalElapsedSeconds(liveElapsedSeconds(goal))}

Keep this goal in mind when choosing next steps. Avoid repeating work that is already done.

Before deciding that the goal is achieved, perform a completion audit against the actual current state:
- Restate the objective as concrete deliverables or success criteria.
- Map every explicit requirement to concrete evidence.
- Inspect relevant files, command output, test results, PR state, or other real evidence.
- Treat uncertainty as not achieved; continue working or verify further.
- If the same blocker recurs and you are at an impasse, call update_goal or UpdateGoal with status "blocked".

Only mark the goal complete when the objective has actually been achieved and no required work remains. If achieved, call update_goal or UpdateGoal with status "complete" and include <goal_status>complete</goal_status> in the response.
</system-reminder>`;
}

function buildGoalStartPrompt(goal: Goal): string {
  return `${buildGoalReminder(goal)}

Begin working toward the goal. Choose the next concrete action and continue until the goal is complete, blocked, paused, or cleared.`;
}

function createGoalForConversation(conversationId: string | null | undefined, objective: string, tokenBudget: number | null, replace = false): Goal {
  const existing = getGoal(conversationId);
  if (existing && !replace) {
    throw new Error("A goal already exists. Run /goal --replace <objective> to replace it, or /goal clear first.");
  }
  return setGoal(conversationId, createGoalRecord(objective, tokenBudget));
}

function updateGoalStatus(conversationId: string | null | undefined, status: GoalStatus, ctx: { contextWindow?: { totalInputTokens?: number | null; totalOutputTokens?: number | null } }): Goal {
  const existing = getGoal(conversationId);
  if (!existing) throw new Error("No active goal exists for this conversation.");
  let next = updateUsage(existing, ctx);
  if (status === "active") next = startActiveClock(next);
  else next = stopActiveClock(next);
  next = { ...next, status };
  return setGoal(conversationId, next);
}

function commandOutput(output: string, success = true) {
  return { type: "output" as const, output, success };
}

function registerGoalTool(letta, name: string, description: string, parameters: Record<string, unknown>, run) {
  return letta.tools.register({
    name,
    description,
    parameters,
    requiresApproval: false,
    parallelSafe: false,
    run,
  });
}

const GET_GOAL_PARAMETERS = { type: "object", properties: {}, additionalProperties: false };
const CREATE_GOAL_PARAMETERS = {
  type: "object",
  properties: {
    objective: { type: "string", description: "The concrete objective to pursue." },
    token_budget: { type: "integer", description: "Optional positive token budget for the new goal." },
  },
  required: ["objective"],
  additionalProperties: false,
};
const UPDATE_GOAL_PARAMETERS = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["complete", "blocked"],
      description: "Set to complete only when achieved, or blocked only when repeated blockers prevent progress.",
    },
  },
  required: ["status"],
  additionalProperties: false,
};

const GET_GOAL_DESCRIPTION = "Get the current goal for this conversation, including status, budget, usage, and remaining token budget.";
const CREATE_GOAL_DESCRIPTION = `Create a goal only when explicitly requested by the user or system/developer instructions; do not infer goals from ordinary tasks.

Set token_budget only when an explicit token budget is requested. Fails if a goal exists unless the user explicitly requested replacement through /goal --replace.`;
const UPDATE_GOAL_DESCRIPTION = `Update the existing goal.

Use this tool only to mark the goal achieved or blocked. Set status to complete only when the objective has actually been achieved and no required work remains. Set status to blocked only after a repeated blocking condition leaves the agent at an impasse.`;

export default function activate(letta) {
  const disposers = [];

  if (letta.capabilities.commands) {
    disposers.push(
      letta.commands.register({
        id: "goal",
        description: "Manage goal: /goal [status|pause|resume|complete|clear|disable|--replace|--token-budget N <objective>]",
        args: "[status|pause|resume|complete|clear|disable|--replace|--token-budget N <objective>]",
        override: true,
        run(ctx) {
          const args = ctx.args.trim();
          const existing = getGoal(ctx.conversation.id);
          const normalized = args.toLowerCase();

          if (!args || normalized === "status" || normalized === "show") {
            return commandOutput(existing ? formatGoalSummary(updateUsage(existing, ctx)) : "No goal is set for this conversation.");
          }
          if (normalized === "clear" || normalized === "disable") {
            clearGoal(ctx.conversation.id);
            return commandOutput("Goal cleared.");
          }
          if (normalized === "pause") {
            return commandOutput(formatGoalSummary(updateGoalStatus(ctx.conversation.id, "paused", ctx)));
          }
          if (normalized === "resume") {
            return commandOutput(formatGoalSummary(updateGoalStatus(ctx.conversation.id, "active", ctx)));
          }
          if (normalized === "complete") {
            return commandOutput(formatGoalSummary(updateGoalStatus(ctx.conversation.id, "complete", ctx)));
          }

          const parsed = parseGoalArgs(args);
          if (parsed.error) return commandOutput(parsed.error, false);
          const objectiveError = validateGoalObjective(parsed.objective);
          if (objectiveError) return commandOutput(objectiveError, false);

          try {
            const goal = createGoalForConversation(ctx.conversation.id, parsed.objective, parsed.tokenBudget, parsed.replace);
            return { type: "prompt", systemReminder: true, content: buildGoalStartPrompt(goal) };
          } catch (error) {
            return commandOutput(error instanceof Error ? error.message : String(error), false);
          }
        },
      }),
    );
  }

  if (letta.capabilities.tools) {
    const getGoalRun = (ctx) => {
      const goal = getGoal(ctx.conversation.id);
      return jsonResult({ goal: goal ? updateUsage(goal, ctx) : null, remaining_tokens: goal ? remainingTokens(goal) : null });
    };
    const createGoalRun = (ctx) => {
      const objective = typeof ctx.args.objective === "string" ? ctx.args.objective.trim() : "";
      const objectiveError = validateGoalObjective(objective);
      if (objectiveError) throw new Error(objectiveError);
      const tokenBudget = typeof ctx.args.token_budget === "number" && Number.isFinite(ctx.args.token_budget) ? Math.floor(ctx.args.token_budget) : null;
      if (tokenBudget !== null && tokenBudget <= 0) throw new Error("token_budget must be a positive integer");
      const goal = createGoalForConversation(ctx.conversation.id, objective, tokenBudget, false);
      return jsonResult({ goal, remaining_tokens: remainingTokens(goal) });
    };
    const updateGoalRun = (ctx) => {
      if (ctx.args.status !== "complete" && ctx.args.status !== "blocked") {
        throw new Error('the goal update tool can only use status "complete" or "blocked".');
      }
      const goal = updateGoalStatus(ctx.conversation.id, ctx.args.status, ctx);
      return jsonResult({
        goal,
        remaining_tokens: remainingTokens(goal),
        completion_budget_report:
          ctx.args.status === "complete" && goal.tokenBudget
            ? `Goal achieved. Report final budget usage to the user: tokens used: ${goal.tokensUsed} of ${goal.tokenBudget}; time used: ${goal.activeTimeSeconds} seconds.`
            : null,
      });
    };

    for (const name of ["get_goal", "GetGoal"]) {
      disposers.push(registerGoalTool(letta, name, GET_GOAL_DESCRIPTION, GET_GOAL_PARAMETERS, getGoalRun));
    }
    for (const name of ["create_goal", "CreateGoal"]) {
      disposers.push(registerGoalTool(letta, name, CREATE_GOAL_DESCRIPTION, CREATE_GOAL_PARAMETERS, createGoalRun));
    }
    for (const name of ["update_goal", "UpdateGoal"]) {
      disposers.push(registerGoalTool(letta, name, UPDATE_GOAL_DESCRIPTION, UPDATE_GOAL_PARAMETERS, updateGoalRun));
    }
  }

  if (letta.capabilities.events.turns) {
    disposers.push(
      letta.events.on("turn_start", (event, ctx) => {
        const goal = getGoal(event.conversationId);
        if (!goal || goal.status !== "active") return;
        const updatedGoal = setGoal(event.conversationId, updateUsage(goal, ctx));
        return {
          input: [{ role: "user", content: buildGoalReminder(updatedGoal) }, ...event.input],
        };
      }),
    );
  }

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
