import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface ModelProfile {
  contextWindow: number;
  reasoningEffort?: "low" | "medium" | "high" | "max" | null;
  label?: string;
  updatedAt?: string;
}

export interface ProfilesState {
  version: number;
  profiles: Record<string, ModelProfile>;
}

function getProfilesPath(ctx?: any): string {
  const memDir = ctx?.memfs?.memoryDir || process.env.MEMORY_DIR;
  if (memDir) {
    const modsDir = join(memDir, "mods");
    const inMods = join(modsDir, "model-profiles.json");
    const inRoot = join(memDir, "model-profiles.json");
    if (existsSync(inRoot) && !existsSync(inMods)) return inRoot;
    return inMods;
  }
  return join(homedir(), ".letta", "mods", "model-profiles.json");
}

function readProfiles(ctx?: any): ProfilesState {
  const filePath = getProfilesPath(ctx);
  try {
    if (existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath, "utf8"));
      if (data && typeof data === "object" && typeof data.profiles === "object") {
        return { version: typeof data.version === "number" ? data.version : 1, profiles: data.profiles };
      }
    }
  } catch {}
  return { version: 1, profiles: {} };
}

function writeProfiles(ctx: any, state: ProfilesState): string {
  const filePath = getProfilesPath(ctx);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
  return filePath;
}

function findProfile(state: ProfilesState, query: string): { handle: string; profile: ModelProfile } | null {
  const q = query.trim();
  if (!q) return null;
  if (state.profiles[q]) return { handle: q, profile: state.profiles[q] };
  const qLower = q.toLowerCase();
  for (const [handle, profile] of Object.entries(state.profiles)) {
    if (handle.toLowerCase() === qLower) return { handle, profile };
    if (profile.label && profile.label.toLowerCase() === qLower) return { handle, profile };
  }
  return null;
}

async function applyModelProfile(
  ctx: any,
  options: {
    model: string;
    contextWindow?: number;
    reasoningEffort?: "low" | "medium" | "high" | "max" | null;
    scope?: "conversation" | "agent";
  }
) {
  if (!ctx?.conversation?.updateLlmConfig) {
    throw new Error("ctx.conversation.updateLlmConfig is not available in the current Letta Code runtime.");
  }
  const scope: "conversation" | "agent" = options.scope === "agent" ? "agent" : "conversation";
  const payload: Record<string, any> = { model: options.model, scope };
  if (typeof options.contextWindow === "number" && Number.isFinite(options.contextWindow) && options.contextWindow > 0) {
    payload.contextWindow = Math.floor(options.contextWindow);
  }
  if (options.reasoningEffort !== undefined) {
    payload.reasoningEffort = options.reasoningEffort;
  }
  await ctx.conversation.updateLlmConfig(payload);
  return {
    model: options.model,
    context_window: payload.contextWindow,
    reasoning_effort: payload.reasoningEffort ?? null,
    scope,
    effective: "next turn",
  };
}

function jsonResult(obj: Record<string, unknown>) {
  return { status: "success", output: JSON.stringify(obj, null, 2) };
}

function commandOutput(output: string, success = true) {
  return { type: "output" as const, output, success };
}

const LIST_TOOL_DEF = {
  name: "list_model_profiles",
  description: "List saved model context profiles and current active model and context window.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
};

const SET_TOOL_DEF = {
  name: "set_model_profile",
  description: "Save or update a model profile with preferred context window limit and optional reasoning effort in MemFS.",
  parameters: {
    type: "object",
    properties: {
      model: { type: "string", description: "Canonical model handle (e.g. 'anthropic/claude-3-5-sonnet', 'xai/grok-4-6')." },
      context_window: { type: "number", description: "Preferred context window limit in tokens (e.g. 250000)." },
      reasoning_effort: { type: "string", enum: ["low", "medium", "high", "max"], description: "Optional reasoning effort tier." },
      label: { type: "string", description: "Optional human-readable label (e.g. 'Grok 4.6')." },
    },
    required: ["model", "context_window"],
    additionalProperties: false,
  },
};

const SWITCH_TOOL_DEF = {
  name: "switch_model_profile",
  description: "Switch the model and its context window atomically using a saved profile or explicit settings. Applies on next turn.",
  parameters: {
    type: "object",
    properties: {
      model: { type: "string", description: "Canonical model handle or profile label to switch to." },
      scope: { type: "string", enum: ["conversation", "agent"], description: "Scope: 'conversation' (default, overrides thread) or 'agent' (updates agent default)." },
      context_window: { type: "number", description: "Optional explicit context window override in tokens." },
      reasoning_effort: { type: "string", enum: ["low", "medium", "high", "max"], description: "Optional explicit reasoning effort override." },
    },
    required: ["model"],
    additionalProperties: false,
  },
};

const DELETE_TOOL_DEF = {
  name: "delete_model_profile",
  description: "Remove a saved model profile from MemFS.",
  parameters: {
    type: "object",
    properties: {
      model: { type: "string", description: "Canonical model handle or label of profile to remove." },
    },
    required: ["model"],
    additionalProperties: false,
  },
};

export default function activate(letta: any) {
  const disposers: Array<() => void> = [];

  if (letta.capabilities.tools) {
    const listRun = (ctx: any) => {
      const state = readProfiles(ctx);
      const filePath = getProfilesPath(ctx);
      return jsonResult({
        status: "success",
        storage_path: filePath,
        current: {
          model: ctx?.model?.id ?? null,
          context_window: ctx?.contextWindow?.size ?? null,
          reasoning_effort: ctx?.model?.reasoningEffort ?? null,
          conversation_id: ctx?.conversation?.id ?? null,
          agent_id: ctx?.agent?.id ?? null,
        },
        profiles: state.profiles,
      });
    };

    const setRun = (ctx: any) => {
      const model = typeof ctx.args.model === "string" ? ctx.args.model.trim() : "";
      if (!model) throw new Error("model must not be empty.");
      const contextWindow = typeof ctx.args.context_window === "number" ? Math.floor(ctx.args.context_window) : 0;
      if (contextWindow <= 0) throw new Error("context_window must be a positive integer.");
      const reasoningEffort = ctx.args.reasoning_effort || null;
      const label = typeof ctx.args.label === "string" ? ctx.args.label.trim() : undefined;

      const state = readProfiles(ctx);
      state.profiles[model] = {
        contextWindow,
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(label ? { label } : {}),
        updatedAt: new Date().toISOString(),
      };
      const savedPath = writeProfiles(ctx, state);
      return jsonResult({
        status: "success",
        message: `Saved profile for ${model}`,
        storage_path: savedPath,
        profile: state.profiles[model],
      });
    };

    const switchRun = async (ctx: any) => {
      const modelArg = typeof ctx.args.model === "string" ? ctx.args.model.trim() : "";
      if (!modelArg) throw new Error("model must not be empty.");
      const state = readProfiles(ctx);
      const match = findProfile(state, modelArg);

      const targetHandle = match ? match.handle : modelArg;
      const targetProfile = match ? match.profile : undefined;

      let targetContextWindow = typeof ctx.args.context_window === "number" ? Math.floor(ctx.args.context_window) : targetProfile?.contextWindow;
      let targetReasoning = ctx.args.reasoning_effort !== undefined ? ctx.args.reasoning_effort : targetProfile?.reasoningEffort;

      // If no profile exists and no context_window is provided, targetContextWindow is undefined
      // and updateLlmConfig switches the model cleanly using backend defaults.

      const scope = ctx.args.scope === "agent" ? "agent" : "conversation";
      const result = await applyModelProfile(ctx, {
        model: targetHandle,
        contextWindow: targetContextWindow,
        reasoningEffort: targetReasoning,
        scope,
      });

      return jsonResult({
        status: "success",
        message: `Switched model to ${targetHandle} (context: ${result.contextWindow ?? "default"}, scope: ${scope}). Takes effect on next turn.`,
        applied: result,
      });
    };

    const deleteRun = (ctx: any) => {
      const modelArg = typeof ctx.args.model === "string" ? ctx.args.model.trim() : "";
      if (!modelArg) throw new Error("model must not be empty.");
      const state = readProfiles(ctx);
      const match = findProfile(state, modelArg);
      if (!match) throw new Error(`Profile "${modelArg}" not found.`);
      delete state.profiles[match.handle];
      const savedPath = writeProfiles(ctx, state);
      return jsonResult({
        status: "success",
        message: `Deleted profile for ${match.handle}`,
        storage_path: savedPath,
      });
    };

    const registerTool = (name: string, def: any, run: any) => {
      return letta.tools.register({
        name,
        description: def.description,
        parameters: def.parameters,
        requiresApproval: false,
        parallelSafe: true,
        run,
      });
    };

    for (const name of ["list_model_profiles", "ListModelProfiles"]) {
      disposers.push(registerTool(name, LIST_TOOL_DEF, listRun));
    }
    for (const name of ["set_model_profile", "SetModelProfile"]) {
      disposers.push(registerTool(name, SET_TOOL_DEF, setRun));
    }
    for (const name of ["switch_model_profile", "SwitchModelProfile"]) {
      disposers.push(registerTool(name, SWITCH_TOOL_DEF, switchRun));
    }
    for (const name of ["delete_model_profile", "DeleteModelProfile"]) {
      disposers.push(registerTool(name, DELETE_TOOL_DEF, deleteRun));
    }
  }

  if (letta.capabilities.commands) {
    const handleCommand = async (ctx: any) => {
      const rawArgs = (ctx.args || "").trim();
      const parts = rawArgs.split(/\s+/).filter(Boolean);
      const sub = (parts[0] || "list").toLowerCase();
      if (sub === "list" || parts.length === 0) {
        const state = readProfiles(ctx);
        const filePath = getProfilesPath(ctx);
        const curModel = ctx?.model?.id || "unknown";
        const curCtx = ctx?.contextWindow?.size ? `${ctx.contextWindow.size} tokens` : "unknown";
        const curEffort = ctx?.model?.reasoningEffort ? `, reasoning: ${ctx.model.reasoningEffort}` : "";
        const entries = Object.entries(state.profiles);
        const profileList = entries.length === 0
          ? "  (no profiles saved yet)"
          : entries.map(([h, p]: [string, any]) => `  - ${h}${p.label ? ` (${p.label})` : ""}: ${p.contextWindow.toLocaleString()} tokens${p.reasoningEffort ? ` [reasoning: ${p.reasoningEffort}]` : ""}`).join("\n");

        const msg = [
          `Model Context Profiles (${filePath}):`,
          `Current active model: ${curModel} (context: ${curCtx}${curEffort})`,
          `Saved profiles:`,
          profileList,
          `\nUsage:`,
          `  /model-profile set <model> <context-window> [reasoning] [label]`,
          `  /model-profile switch <model-or-label> [--scope conversation|agent]`,
          `  /model-profile remove <model-or-label>`,
        ].join("\n");
        return commandOutput(msg);
      }

      if (sub === "set") {
        const model = parts[1];
        const ctxWin = Number.parseInt(parts[2], 10);
        if (!model || !Number.isFinite(ctxWin) || ctxWin <= 0) {
          return commandOutput("Usage: /model-profile set <model-handle> <context-window-tokens> [reasoning] [label]", false);
        }
        const reasoning = ["low", "medium", "high", "max"].includes(parts[3]?.toLowerCase()) ? parts[3].toLowerCase() : undefined;
        const label = reasoning ? parts.slice(4).join(" ") : parts.slice(3).join(" ");
        const state = readProfiles(ctx);
        state.profiles[model] = {
          contextWindow: ctxWin,
          ...(reasoning ? { reasoningEffort: reasoning as any } : {}),
          ...(label ? { label } : {}),
          updatedAt: new Date().toISOString(),
        };
        const savedPath = writeProfiles(ctx, state);
        return commandOutput(`Saved profile for ${model}: ${ctxWin.toLocaleString()} tokens${reasoning ? ` [${reasoning}]` : ""}${label ? ` (${label})` : ""}\nStorage: ${savedPath}`);
      }

      if (sub === "switch") {
        const modelArg = parts[1];
        if (!modelArg) {
          return commandOutput("Usage: /model-profile switch <model-or-label> [--scope conversation|agent]", false);
        }
        const isAgentScope = rawArgs.includes("--scope agent") || rawArgs.includes("--agent");
        const scope = isAgentScope ? "agent" : "conversation";
        const state = readProfiles(ctx);
        const match = findProfile(state, modelArg);
        const targetHandle = match ? match.handle : modelArg;
        const targetProfile = match ? match.profile : undefined;
        if (!targetProfile) {
          const avail = Object.keys(state.profiles).join(", ");
          return commandOutput(`No profile found for "${modelArg}". Available: ${avail || "none"}\nor save one first: /model-profile set ${modelArg} <context-tokens>`, false);
        }
        try {
          const result = await applyModelProfile(ctx, {
            model: targetHandle,
            contextWindow: targetProfile.contextWindow,
            reasoningEffort: targetProfile.reasoningEffort,
            scope,
          });
          return commandOutput(`Switched model to ${result.model} with context limit ${result.context_window?.toLocaleString()} tokens (scope: ${scope}). Applies on your next message.`);
        } catch (err: any) {
          return commandOutput(`Failed to switch model: ${err?.message || String(err)}`, false);
        }
      }

      if (sub === "remove" || sub === "delete") {
        const modelArg = parts[1];
        if (!modelArg) return commandOutput("Usage: /model-profile remove <model-or-label>", false);
        const state = readProfiles(ctx);
        const match = findProfile(state, modelArg);
        if (!match) return commandOutput(`Profile "${modelArg}" not found.`, false);
        delete state.profiles[match.handle];
        const savedPath = writeProfiles(ctx, state);
        return commandOutput(`Removed profile for ${match.handle}. Saved to ${savedPath}`);
      }

      return commandOutput("Unknown command. Usage: /model-profile [list|set|switch|remove]", false);
    };

    disposers.push(
      letta.commands.register({
        id: "model-profile",
        description: "Manage per-model context window and reasoning profiles: /model-profile [list|set|switch|remove]",
        args: "[list|set|switch|remove]",
        override: true,
        run: handleCommand,
      })
    );

    disposers.push(
      letta.commands.register({
        id: "model-profiles",
        description: "Alias for /model-profile",
        args: "[list|set|switch|remove]",
        override: true,
        run: handleCommand,
      })
    );
  }

  return () => {
    disposers.reverse().forEach((dispose) => {
      try {
        dispose();
      } catch {}
    });
  };
}
