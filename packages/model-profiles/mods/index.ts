import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface ModelProfile {
  contextWindow: number;
  reasoningEffort?: ReasoningEffort;
  label?: string;
  updatedAt?: string;
}

export interface ProfilesState {
  version: number;
  profiles: Record<string, ModelProfile>;
}

interface ProfilesContext {
  memfs?: { enabled?: boolean; memoryDir?: string | null };
  model?: { id?: string | null; reasoningEffort?: string | null };
  contextWindow?: { size?: number | null };
  conversation?: { id?: string | null; updateLlmConfig?: (options: Record<string, unknown>) => Promise<void> };
  agent?: { id?: string | null };
}

interface SwitchOptions {
  model: string;
  contextWindow?: number;
  reasoningEffort?: ReasoningEffort;
  scope?: "conversation" | "agent";
}

const FILE_NAME = "model-profiles.json";

let reportWarning: (message: string) => void = () => {};

export function getProfilesPath(ctx?: ProfilesContext): string {
  const memDir = ctx?.memfs?.memoryDir || process.env.MEMORY_DIR;
  if (memDir) {
    const inMods = join(memDir, "mods", FILE_NAME);
    const inRoot = join(memDir, FILE_NAME);
    if (existsSync(inRoot) && !existsSync(inMods)) return inRoot;
    return inMods;
  }
  return join(homedir(), ".letta", "mods", FILE_NAME);
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value);
}

function isProfile(value: unknown): value is ModelProfile {
  if (!value || typeof value !== "object") return false;
  const contextWindow = (value as ModelProfile).contextWindow;
  return typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0;
}

function normalizeState(data: unknown): ProfilesState | null {
  if (!data || typeof data !== "object") return null;
  const raw = (data as Partial<ProfilesState>).profiles;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const profiles: Record<string, ModelProfile> = {};
  for (const [handle, profile] of Object.entries(raw)) {
    if (!isProfile(profile)) continue;
    profiles[handle] = {
      contextWindow: Math.floor(profile.contextWindow),
      ...(isReasoningEffort(profile.reasoningEffort) ? { reasoningEffort: profile.reasoningEffort } : {}),
      ...(typeof profile.label === "string" && profile.label.trim() ? { label: profile.label.trim() } : {}),
      ...(typeof profile.updatedAt === "string" ? { updatedAt: profile.updatedAt } : {}),
    };
  }
  const version = (data as Partial<ProfilesState>).version;
  return { version: typeof version === "number" ? version : 1, profiles };
}

/**
 * Read the profile file. A file that is not valid JSON, or has the wrong shape,
 * is moved aside to `<file>.corrupt-<timestamp>` instead of being silently
 * replaced, so a later write never destroys the user's data.
 */
export function readProfiles(ctx?: ProfilesContext): ProfilesState {
  const filePath = getProfilesPath(ctx);
  if (!existsSync(filePath)) return { version: 1, profiles: {} };
  let state: ProfilesState | null = null;
  try {
    state = normalizeState(JSON.parse(readFileSync(filePath, "utf8")));
  } catch {
    state = null;
  }
  if (state) return state;
  const backup = `${filePath}.corrupt-${Date.now()}`;
  try {
    renameSync(filePath, backup);
    reportWarning(`model-profiles: ${filePath} was unreadable and has been moved to ${backup}. Starting with no profiles.`);
  } catch {
    reportWarning(`model-profiles: ${filePath} is unreadable and could not be moved aside.`);
  }
  return { version: 1, profiles: {} };
}

export function writeProfiles(ctx: ProfilesContext | undefined, state: ProfilesState): string {
  const filePath = getProfilesPath(ctx);
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(temporary, filePath);
  return filePath;
}

export function findProfile(state: ProfilesState, query: string): { handle: string; profile: ModelProfile } | null {
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

function saveProfile(ctx: ProfilesContext | undefined, model: string, profile: Omit<ModelProfile, "updatedAt">) {
  const state = readProfiles(ctx);
  state.profiles[model] = { ...profile, updatedAt: new Date().toISOString() };
  return { state, path: writeProfiles(ctx, state) };
}

function removeProfile(ctx: ProfilesContext | undefined, query: string) {
  const state = readProfiles(ctx);
  const match = findProfile(state, query);
  if (!match) return null;
  delete state.profiles[match.handle];
  return { handle: match.handle, path: writeProfiles(ctx, state) };
}

/**
 * Resolve a model handle or label to a switch payload. Explicit overrides win
 * over the saved profile. Without a saved profile the model is switched with
 * provider defaults for anything not overridden.
 */
function resolveSwitch(
  state: ProfilesState,
  query: string,
  overrides: { contextWindow?: number; reasoningEffort?: ReasoningEffort; scope?: string },
): SwitchOptions & { handle: string; fromProfile: boolean } {
  const match = findProfile(state, query);
  const handle = match ? match.handle : query.trim();
  return {
    handle,
    fromProfile: Boolean(match),
    model: handle,
    contextWindow: overrides.contextWindow ?? match?.profile.contextWindow,
    reasoningEffort: overrides.reasoningEffort ?? match?.profile.reasoningEffort,
    scope: overrides.scope === "agent" ? "agent" : "conversation",
  };
}

async function applySwitch(ctx: ProfilesContext, options: SwitchOptions) {
  const updateLlmConfig = ctx.conversation?.updateLlmConfig;
  if (typeof updateLlmConfig !== "function") {
    throw new Error("ctx.conversation.updateLlmConfig is not available in this Letta Code runtime.");
  }
  const scope = options.scope === "agent" ? "agent" : "conversation";
  const payload: Record<string, unknown> = { model: options.model, scope };
  if (typeof options.contextWindow === "number" && Number.isFinite(options.contextWindow) && options.contextWindow > 0) {
    payload.contextWindow = Math.floor(options.contextWindow);
  }
  if (options.reasoningEffort !== undefined) payload.reasoningEffort = options.reasoningEffort;
  await updateLlmConfig.call(ctx.conversation, payload);
  return {
    model: options.model,
    context_window: (payload.contextWindow as number | undefined) ?? null,
    reasoning_effort: options.reasoningEffort ?? null,
    scope,
    effective: "next turn",
  };
}

function describeSwitch(result: Awaited<ReturnType<typeof applySwitch>>, fromProfile: boolean): string {
  const parts = [
    `context: ${result.context_window ? `${result.context_window.toLocaleString()} tokens` : "provider default"}`,
    ...(result.reasoning_effort ? [`reasoning: ${result.reasoning_effort}`] : []),
    `scope: ${result.scope}`,
  ];
  const note = fromProfile ? "" : " No saved profile matched, so unspecified settings use provider defaults.";
  return `Switched model to ${result.model} (${parts.join(", ")}). Takes effect on the next turn.${note}`;
}

function positiveInteger(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/**
 * Parse `/model-profile` arguments. Flags (`--scope agent`, `--scope=agent`,
 * `--agent`, `--conversation`) may appear anywhere; everything else is
 * positional so multi-word labels survive.
 */
export function parseCommandArgs(argv: string[]): { sub: string; positional: string[]; scope: "conversation" | "agent"; error?: string } {
  const positional: string[] = [];
  let scope: "conversation" | "agent" = "conversation";
  let error: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--agent") scope = "agent";
    else if (token === "--conversation") scope = "conversation";
    else if (token === "--scope" || token.startsWith("--scope=")) {
      const value = token === "--scope" ? argv[++i] : token.slice("--scope=".length);
      if (value === "agent" || value === "conversation") scope = value;
      else error = `Unknown scope "${value ?? ""}". Use conversation or agent.`;
    } else if (token.startsWith("--")) error = `Unknown flag "${token}".`;
    else positional.push(token);
  }
  const sub = (positional.shift() || "list").toLowerCase();
  return { sub, positional, scope, error };
}

function commandOutput(output: string, success = true) {
  return { type: "output" as const, output, success };
}

function jsonResult(obj: Record<string, unknown>, status: "success" | "error" = "success") {
  return { status, output: JSON.stringify(obj, null, 2) };
}

const REASONING_DESCRIPTION = `Reasoning effort tier: ${REASONING_EFFORTS.join(", ")}.`;

export default function activate(letta: any) {
  const disposers: Array<() => void> = [];
  if (typeof letta?.diagnostics?.report === "function") {
    reportWarning = (message) => letta.diagnostics.report({ message, severity: "warning" });
  }

  if (letta.capabilities.tools) {
    disposers.push(
      letta.tools.register({
        name: "list_model_profiles",
        description: "List saved model profiles (context window and reasoning effort per model) and the current active model settings.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        requiresApproval: false,
        parallelSafe: true,
        run(ctx: ProfilesContext) {
          const state = readProfiles(ctx);
          return jsonResult({
            storage_path: getProfilesPath(ctx),
            current: {
              model: ctx.model?.id ?? null,
              context_window: ctx.contextWindow?.size ?? null,
              reasoning_effort: ctx.model?.reasoningEffort ?? null,
              conversation_id: ctx.conversation?.id ?? null,
              agent_id: ctx.agent?.id ?? null,
            },
            profiles: state.profiles,
          });
        },
      }),
    );

    disposers.push(
      letta.tools.register({
        name: "set_model_profile",
        description: "Save or update a model profile: the preferred context window limit and optional reasoning effort to apply whenever that model is switched to.",
        parameters: {
          type: "object",
          properties: {
            model: { type: "string", description: "Model handle, e.g. 'anthropic/claude-opus-4-8' or 'xai/grok-4-6'." },
            context_window: { type: "number", description: "Preferred context window limit in tokens, e.g. 250000." },
            reasoning_effort: { type: "string", enum: [...REASONING_EFFORTS], description: `Optional. ${REASONING_DESCRIPTION}` },
            label: { type: "string", description: "Optional human-readable alias, e.g. 'Grok 4.6'. Can be used in place of the handle when switching." },
          },
          required: ["model", "context_window"],
          additionalProperties: false,
        },
        requiresApproval: false,
        parallelSafe: false,
        run(ctx: ProfilesContext & { args: Record<string, unknown> }) {
          const model = typeof ctx.args.model === "string" ? ctx.args.model.trim() : "";
          if (!model) return jsonResult({ error: "model must not be empty." }, "error");
          const contextWindow = positiveInteger(ctx.args.context_window);
          if (!contextWindow) return jsonResult({ error: "context_window must be a positive integer." }, "error");
          const reasoningEffort = ctx.args.reasoning_effort;
          if (reasoningEffort !== undefined && reasoningEffort !== null && !isReasoningEffort(reasoningEffort)) {
            return jsonResult({ error: `reasoning_effort must be one of: ${REASONING_EFFORTS.join(", ")}.` }, "error");
          }
          const label = typeof ctx.args.label === "string" ? ctx.args.label.trim() : "";
          const { state, path } = saveProfile(ctx, model, {
            contextWindow,
            ...(isReasoningEffort(reasoningEffort) ? { reasoningEffort } : {}),
            ...(label ? { label } : {}),
          });
          return jsonResult({ message: `Saved profile for ${model}.`, storage_path: path, profile: state.profiles[model] });
        },
      }),
    );

    disposers.push(
      letta.tools.register({
        name: "switch_model_profile",
        description: "Switch the conversation (or agent default) to a model and apply its saved context window and reasoning effort in one update. Takes effect on the next turn.",
        parameters: {
          type: "object",
          properties: {
            model: { type: "string", description: "Model handle or saved profile label to switch to." },
            scope: { type: "string", enum: ["conversation", "agent"], description: "'conversation' (default) changes only this thread; 'agent' changes the agent default." },
            context_window: { type: "number", description: "Optional context window override in tokens. Wins over the saved profile." },
            reasoning_effort: { type: "string", enum: [...REASONING_EFFORTS], description: `Optional override. ${REASONING_DESCRIPTION}` },
          },
          required: ["model"],
          additionalProperties: false,
        },
        requiresApproval: false,
        parallelSafe: false,
        async run(ctx: ProfilesContext & { args: Record<string, unknown> }) {
          const query = typeof ctx.args.model === "string" ? ctx.args.model.trim() : "";
          if (!query) return jsonResult({ error: "model must not be empty." }, "error");
          if (ctx.args.reasoning_effort !== undefined && !isReasoningEffort(ctx.args.reasoning_effort)) {
            return jsonResult({ error: `reasoning_effort must be one of: ${REASONING_EFFORTS.join(", ")}.` }, "error");
          }
          const target = resolveSwitch(readProfiles(ctx), query, {
            contextWindow: positiveInteger(ctx.args.context_window),
            reasoningEffort: ctx.args.reasoning_effort as ReasoningEffort | undefined,
            scope: typeof ctx.args.scope === "string" ? ctx.args.scope : undefined,
          });
          try {
            const applied = await applySwitch(ctx, target);
            return jsonResult({ message: describeSwitch(applied, target.fromProfile), applied });
          } catch (error) {
            return jsonResult({ error: `Failed to switch model: ${error instanceof Error ? error.message : String(error)}` }, "error");
          }
        },
      }),
    );

    disposers.push(
      letta.tools.register({
        name: "delete_model_profile",
        description: "Remove a saved model profile.",
        parameters: {
          type: "object",
          properties: { model: { type: "string", description: "Model handle or label of the profile to remove." } },
          required: ["model"],
          additionalProperties: false,
        },
        requiresApproval: false,
        parallelSafe: false,
        run(ctx: ProfilesContext & { args: Record<string, unknown> }) {
          const query = typeof ctx.args.model === "string" ? ctx.args.model.trim() : "";
          if (!query) return jsonResult({ error: "model must not be empty." }, "error");
          const removed = removeProfile(ctx, query);
          if (!removed) return jsonResult({ error: `Profile "${query}" not found.` }, "error");
          return jsonResult({ message: `Deleted profile for ${removed.handle}.`, storage_path: removed.path });
        },
      }),
    );
  }

  if (letta.capabilities.commands) {
    const USAGE = [
      "Usage:",
      "  /model-profile list",
      `  /model-profile set <model> <context-window> [${REASONING_EFFORTS.join("|")}] [label...]`,
      "  /model-profile switch <model-or-label...> [--scope conversation|agent]",
      "  /model-profile remove <model-or-label...>",
    ].join("\n");

    const handleCommand = async (ctx: ProfilesContext & { args: string; argv?: string[] }) => {
      const argv = Array.isArray(ctx.argv) ? ctx.argv : (ctx.args || "").trim().split(/\s+/).filter(Boolean);
      const { sub, positional, scope, error } = parseCommandArgs(argv);
      if (error) return commandOutput(`${error}\n${USAGE}`, false);

      if (sub === "list") {
        const state = readProfiles(ctx);
        const size = ctx.contextWindow?.size;
        const contextText = typeof size === "number" && size > 0 ? `${size.toLocaleString()} tokens` : "unknown";
        const reasoningText = ctx.model?.reasoningEffort ? `, reasoning: ${ctx.model.reasoningEffort}` : "";
        const current = `${ctx.model?.id || "unknown"} (context: ${contextText}${reasoningText})`;
        const entries = Object.entries(state.profiles);
        const rows = entries.length === 0
          ? ["  (no profiles saved yet)"]
          : entries.map(([handle, p]) => {
              const label = p.label ? ` (${p.label})` : "";
              const reasoning = p.reasoningEffort ? ` [reasoning: ${p.reasoningEffort}]` : "";
              return `  - ${handle}${label}: ${p.contextWindow.toLocaleString()} tokens${reasoning}`;
            });
        return commandOutput([
          `Model profiles (${getProfilesPath(ctx)})`,
          `Current: ${current}`,
          "Saved profiles:",
          ...rows,
          "",
          USAGE,
        ].join("\n"));
      }

      if (sub === "set") {
        const [model, rawWindow, ...rest] = positional;
        const contextWindow = positiveInteger(rawWindow);
        if (!model || !contextWindow) return commandOutput(USAGE, false);
        const first = rest[0]?.toLowerCase();
        const reasoningEffort = isReasoningEffort(first) ? first : undefined;
        const label = (reasoningEffort ? rest.slice(1) : rest).join(" ").trim();
        const { path } = saveProfile(ctx, model, {
          contextWindow,
          ...(reasoningEffort ? { reasoningEffort } : {}),
          ...(label ? { label } : {}),
        });
        const detail = `${contextWindow.toLocaleString()} tokens${reasoningEffort ? ` [${reasoningEffort}]` : ""}${label ? ` (${label})` : ""}`;
        return commandOutput(`Saved profile for ${model}: ${detail}\nStorage: ${path}`);
      }

      if (sub === "switch") {
        const query = positional.join(" ").trim();
        if (!query) return commandOutput(USAGE, false);
        const target = resolveSwitch(readProfiles(ctx), query, { scope });
        try {
          const applied = await applySwitch(ctx, target);
          return commandOutput(describeSwitch(applied, target.fromProfile));
        } catch (err) {
          return commandOutput(`Failed to switch model: ${err instanceof Error ? err.message : String(err)}`, false);
        }
      }

      if (sub === "remove" || sub === "delete") {
        const query = positional.join(" ").trim();
        if (!query) return commandOutput(USAGE, false);
        const removed = removeProfile(ctx, query);
        if (!removed) return commandOutput(`Profile "${query}" not found.`, false);
        return commandOutput(`Removed profile for ${removed.handle}.\nStorage: ${removed.path}`);
      }

      return commandOutput(`Unknown subcommand "${sub}".\n${USAGE}`, false);
    };

    disposers.push(
      letta.commands.register({
        id: "model-profile",
        description: "Manage per-model context window and reasoning profiles",
        args: "[list|set|switch|remove]",
        run: handleCommand,
      }),
    );
  }

  return () => {
    disposers.reverse().forEach((dispose) => {
      try {
        dispose();
      } catch {}
    });
    reportWarning = () => {};
  };
}
