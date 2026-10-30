import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface ModelProfile {
  contextWindow: number;
  maxOutputTokens?: number;
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
  sessionId?: string | null;
  conversation?: {
    id?: string | null;
    updateLlmConfig?: (options: Record<string, unknown>) => Promise<void>;
  };
  agent?: { id?: string | null };
}

/**
 * Minimal shape of the Letta SDK client, reached through `letta.client`.
 * Event contexts do not carry a client, so this is captured at activation.
 */
interface LettaClientLike {
  conversations: {
    retrieve: (conversationId: string) => Promise<Record<string, unknown>>;
    update: (conversationId: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
}

interface SwitchOptions {
  model: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  scope?: "conversation" | "agent";
}

type MaxOutputStatus =
  | { status: "written" | "unchanged"; value: number }
  | { status: "failed"; value: number; error: string }
  | { status: "not_applicable" };

const FILE_NAME = "model-profiles.json";

let reportWarning: (message: string) => void = () => {};

const CONVERSATION_REQUEST_TIMEOUT_MS = 5000;

/**
 * The SDK client, resolved at activation. Event handler contexts do not carry a
 * client, so this is the only way to read the conversation or write
 * `max_output_tokens`, which `updateLlmConfig` cannot express.
 *
 * In listener-hosted mods this value is a truthy lazy proxy whose calls throw, so
 * every read and write goes through the SDK-then-REST helpers below rather than
 * this value directly. A non-null `sdkClient` is NOT evidence that the SDK works.
 */
let sdkClient: LettaClientLike | null = null;
let resolveClient: (() => Promise<LettaClientLike>) | null = null;
let clientPromise: Promise<LettaClientLike> | null = null;

async function getConversationClient(): Promise<LettaClientLike> {
  if (!resolveClient) {
    if (sdkClient) return sdkClient;
    throw new Error("letta.getClient is not available in this Letta Code runtime");
  }
  clientPromise ??= resolveClient();
  return clientPromise;
}

async function withRequestTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, label: string): Promise<T> {
  const controller = new AbortController();
  let rejectTimeout: (reason: Error) => void = () => {};
  const timedOut = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const timeout = setTimeout(() => {
    const error = new Error(`${label} timed out after ${CONVERSATION_REQUEST_TIMEOUT_MS}ms`);
    error.name = "AbortError";
    controller.abort(error);
    rejectTimeout(error);
  }, CONVERSATION_REQUEST_TIMEOUT_MS);
  try {
    return await Promise.race([operation(controller.signal), timedOut]);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Listener-hosted mods get a `letta.client` that is a truthy lazy proxy over a stub
 * that throws, and `getClient` rejects the same way. The listener process does
 * carry LETTA_BASE_URL and LETTA_API_KEY in its environment, so authenticated REST
 * is the reliable path there. This is a constrained fallback, not a general HTTP
 * transport: the credential is sent only to that configured Letta origin.
 */
function restBaseUrl(): string | null {
  const raw = process.env.LETTA_BASE_URL || process.env.LETTA_API_BASE || "";
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed ? trimmed : null;
}

function restApiKey(): string | null {
  const key = (process.env.LETTA_API_KEY || "").trim();
  return key ? key : null;
}

async function restConversation(
  conversationId: string,
  init?: { method?: string; body?: Record<string, unknown>; signal?: AbortSignal },
): Promise<Record<string, unknown>> {
  const base = restBaseUrl();
  const key = restApiKey();
  if (!base || !key) {
    throw new Error("no REST fallback: LETTA_BASE_URL or LETTA_API_KEY is unset");
  }
  const response = await fetch(`${base}/v1/conversations/${encodeURIComponent(conversationId)}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: init?.signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${text.slice(0, 200)}`.trim());
  }
  return (await response.json()) as Record<string, unknown>;
}

/** Read a conversation, preferring the SDK and falling back to REST. */
async function retrieveConversation(conversationId: string): Promise<Record<string, unknown>> {
  return withRequestTimeout(async (signal) => {
    try {
      const client = await getConversationClient();
      return await client.conversations.retrieve(conversationId);
    } catch (sdkError) {
      try {
        return await restConversation(conversationId, { signal });
      } catch (restError) {
        throw new Error(`sdk: ${errorText(sdkError)}; rest: ${errorText(restError)}`);
      }
    }
  }, `read ${conversationId}`);
}

/** Patch a conversation, preferring the SDK and falling back to REST. */
async function updateConversation(conversationId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return withRequestTimeout(async (signal) => {
    try {
      const client = await getConversationClient();
      return await client.conversations.update(conversationId, body);
    } catch (sdkError) {
      try {
        return await restConversation(conversationId, { method: "PATCH", body, signal });
      } catch (restError) {
        throw new Error(`sdk: ${errorText(sdkError)}; rest: ${errorText(restError)}`);
      }
    }
  }, `update ${conversationId}`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The conversation an event or command refers to. The listener provides
 * `conversationId` on events; commands carry it on `ctx.conversation`.
 */
function conversationIdOf(event: unknown, ctx: ProfilesContext): string | null {
  const record = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
  for (const candidate of [record.conversationId, ctx.conversation?.id, ctx.sessionId]) {
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return null;
}

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

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
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
      ...(isPositiveNumber(profile.maxOutputTokens) ? { maxOutputTokens: Math.floor(profile.maxOutputTokens) } : {}),
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
  overrides: { contextWindow?: number; maxOutputTokens?: number; reasoningEffort?: ReasoningEffort; scope?: string },
): SwitchOptions & { handle: string; fromProfile: boolean } {
  const match = findProfile(state, query);
  const handle = match ? match.handle : query.trim();
  return {
    handle,
    fromProfile: Boolean(match),
    model: handle,
    contextWindow: overrides.contextWindow ?? match?.profile.contextWindow,
    maxOutputTokens: overrides.maxOutputTokens ?? match?.profile.maxOutputTokens,
    reasoningEffort: overrides.reasoningEffort ?? match?.profile.reasoningEffort,
    scope: overrides.scope === "agent" ? "agent" : "conversation",
  };
}

/** Read the output limit from either server representation. */
function currentMaxOutput(live: Record<string, unknown>): number | null {
  if (typeof live.max_tokens === "number") return live.max_tokens;
  const settings = live.model_settings && typeof live.model_settings === "object" && !Array.isArray(live.model_settings)
    ? live.model_settings as Record<string, unknown>
    : {};
  return typeof settings.max_output_tokens === "number" ? settings.max_output_tokens : null;
}

/** Apply the profile's max output limit without disturbing provider settings. */
async function applyMaxOutput(
  conversationId: string,
  live: Record<string, unknown>,
  wanted: number,
): Promise<void> {
  if (typeof live.max_tokens === "number") {
    // The server stores max_tokens on Kimi-like configurations and rebuilds
    // model_settings on update. Including max_output_tokens here would introduce
    // a second, conflicting output limit; leave that object entirely untouched.
    await updateConversation(conversationId, { max_tokens: wanted });
    return;
  }
  const current = (live.model_settings && typeof live.model_settings === "object" && !Array.isArray(live.model_settings)
    ? { ...(live.model_settings as Record<string, unknown>) }
    : {}) as Record<string, unknown>;
  current.max_output_tokens = wanted;
  await updateConversation(conversationId, { model_settings: current });
}

function readReasoningEffort(settings: Record<string, unknown>): ReasoningEffort | null {
  const reasoning = settings.reasoning && typeof settings.reasoning === "object" && !Array.isArray(settings.reasoning)
    ? settings.reasoning as Record<string, unknown>
    : {};
  for (const value of [reasoning.reasoning_effort, settings.effort, settings.reasoning_effort]) {
    if (isReasoningEffort(value)) return value;
  }
  return null;
}

/**
 * Switch model and apply the profile.
 *
 * `updateLlmConfig` carries model, context window and reasoning effort but cannot
 * express `max_output_tokens`, and it rebuilds `model_settings` from provider
 * defaults. So the max output limit is written separately, re-reading the live
 * settings first and merging rather than replacing them.
 */
async function applySwitch(ctx: ProfilesContext, options: SwitchOptions) {
  const updateLlmConfig = ctx.conversation?.updateLlmConfig;
  if (typeof updateLlmConfig !== "function") {
    throw new Error("ctx.conversation.updateLlmConfig is not available in this Letta Code runtime.");
  }
  const scope = options.scope === "agent" ? "agent" : "conversation";
  const payload: Record<string, unknown> = { model: options.model, scope };
  if (isPositiveNumber(options.contextWindow)) {
    payload.contextWindow = Math.floor(options.contextWindow);
  }
  if (options.reasoningEffort !== undefined) payload.reasoningEffort = options.reasoningEffort;
  await updateLlmConfig.call(ctx.conversation, payload);

  let maxOutput: MaxOutputStatus = { status: "not_applicable" };
  const wantMaxOutput = options.maxOutputTokens;
  const conversationId = ctx.conversation?.id ?? ctx.sessionId ?? null;
  if (scope === "conversation" && isPositiveNumber(wantMaxOutput) && conversationId) {
    const wanted = Math.floor(wantMaxOutput);
    try {
      const live = await retrieveConversation(conversationId);
      if (currentMaxOutput(live) === wanted) {
        maxOutput = { status: "unchanged", value: wanted };
      } else {
        await applyMaxOutput(conversationId, live, wanted);
        maxOutput = { status: "written", value: wanted };
      }
    } catch (error) {
      maxOutput = { status: "failed", value: wanted, error: errorText(error) };
      reportWarning(`model-profiles: switched model but could not set max output tokens: ${errorText(error)}`);
    }
  }

  return {
    model: options.model,
    context_window: (payload.contextWindow as number | undefined) ?? null,
    max_output_tokens: maxOutput.status === "written" ? maxOutput.value : null,
    max_output_status: maxOutput,
    reasoning_effort: options.reasoningEffort ?? null,
    scope,
    effective: "next turn",
  };
}

function describeSwitch(result: Awaited<ReturnType<typeof applySwitch>>, fromProfile: boolean): string {
  const maxOutput = result.max_output_status;
  const maxOutputText = maxOutput.status === "written" ? `${maxOutput.value.toLocaleString()} tokens`
    : maxOutput.status === "unchanged" ? `${maxOutput.value.toLocaleString()} tokens (already applied)`
    : maxOutput.status === "failed" ? `write failed (${maxOutput.error})`
    : "provider default";
  const parts = [
    `context: ${result.context_window ? `${result.context_window.toLocaleString()} tokens` : "provider default"}`,
    `max output: ${maxOutputText}`,
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
export function parseCommandArgs(argv: string[]): { sub: string; positional: string[]; scope: "conversation" | "agent"; maxOutputTokens?: number; error?: string } {
  const positional: string[] = [];
  let scope: "conversation" | "agent" = "conversation";
  let maxOutputTokens: number | undefined;
  let error: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--agent") scope = "agent";
    else if (token === "--conversation") scope = "conversation";
    else if (token === "--max-output" || token.startsWith("--max-output=")) {
      const value = token === "--max-output" ? argv[++i] : token.slice("--max-output=".length);
      const parsed = positiveInteger(value);
      if (parsed) maxOutputTokens = parsed;
      else error = `--max-output needs a positive integer, got "${value ?? ""}".`;
    } else if (token === "--scope" || token.startsWith("--scope=")) {
      const value = token === "--scope" ? argv[++i] : token.slice("--scope=".length);
      if (value === "agent" || value === "conversation") scope = value;
      else error = `Unknown scope "${value ?? ""}". Use conversation or agent.`;
    } else if (token.startsWith("--")) error = `Unknown flag "${token}".`;
    else positional.push(token);
  }
  const sub = (positional.shift() || "list").toLowerCase();
  // Only include the override when set, so the return shape stays stable for callers
  // and tests that compare the whole object.
  return { sub, positional, scope, ...(maxOutputTokens ? { maxOutputTokens } : {}), error };
}

/**
 * Apply a saved profile to the live conversation when the running values differ.
 *
 * `model_settings` is replaced wholesale by the API, not merged, so the patch must
 * carry the conversation's existing settings with only the profiled fields
 * overridden. Without that, the write drops provider_type / parallel_tool_calls.
 *
 * Reasoning effort goes through `updateLlmConfig`, not a direct settings patch:
 * the harness resolves the current model and builds the provider-specific shape
 * (`reasoning.reasoning_effort`, `effort`, or flat `reasoning_effort`).
 *
 * Returns a short description when a write happened, or null when nothing needed
 * to change — the common case, and the reason this is cheap to call on every turn.
 */
async function reconcileConversation(
  ctx: ProfilesContext,
  conversationId: string | null | undefined,
): Promise<string | null> {
  if (!conversationId) return null;

  const profileState = readProfiles(ctx);
  let live: Record<string, unknown>;
  try {
    live = await retrieveConversation(conversationId);
  } catch (error) {
    reportWarning(`model-profiles: could not read ${conversationId} to check its limits: ${errorText(error)}`);
    return null;
  }

  const handle = typeof live.model === "string" && live.model ? live.model : ctx.model?.id ?? null;
  const profile = findProfile(profileState, handle ?? "");
  if (!profile) return null;

  const settings = (live.model_settings && typeof live.model_settings === "object" && !Array.isArray(live.model_settings)
    ? { ...(live.model_settings as Record<string, unknown>) }
    : {}) as Record<string, unknown>;

  const liveMaxOutput = currentMaxOutput(live);
  const liveContextWindow = typeof live.context_window_limit === "number" ? live.context_window_limit : null;
  const liveReasoningEffort = readReasoningEffort(settings);

  const wantContextWindow = profile.profile.contextWindow;
  const wantMaxOutput = profile.profile.maxOutputTokens;
  const wantReasoningEffort = profile.profile.reasoningEffort;

  const needsContextWindow = wantContextWindow > 0 && liveContextWindow !== wantContextWindow;
  const needsMaxOutput = typeof wantMaxOutput === "number" && wantMaxOutput > 0 && liveMaxOutput !== wantMaxOutput;
  const needsReasoningEffort = isReasoningEffort(wantReasoningEffort) && liveReasoningEffort !== wantReasoningEffort;
  if (!needsContextWindow && !needsMaxOutput && !needsReasoningEffort) return null;

  const changed: string[] = [];
  const patch: Record<string, unknown> = {};
  const llmConfig: Record<string, unknown> = { scope: "conversation" };
  if (needsContextWindow) {
    patch.context_window_limit = wantContextWindow;
    llmConfig.contextWindow = wantContextWindow;
    changed.push(`context ${liveContextWindow ?? "?"} -> ${wantContextWindow}`);
  }
  if (needsMaxOutput) {
    changed.push(`max output ${liveMaxOutput ?? "?"} -> ${wantMaxOutput}`);
  }
  if (needsReasoningEffort) {
    llmConfig.reasoningEffort = wantReasoningEffort;
    changed.push(`reasoning ${liveReasoningEffort ?? "provider default"} -> ${wantReasoningEffort}`);
  }

  // One official mod-API call handles context and reasoning together. Passing no
  // model preserves the current model while rebuilding provider-specific settings.
  const updateLlmConfig = ctx.conversation?.updateLlmConfig;
  let llmConfigUpdated = false;
  if (typeof updateLlmConfig === "function" && Object.keys(llmConfig).length > 1) {
    try {
      await updateLlmConfig.call(ctx.conversation, llmConfig);
      llmConfigUpdated = true;
      if (needsContextWindow) delete patch.context_window_limit;
    } catch (error) {
      reportWarning(`model-profiles: could not apply ${profile.handle} to ${conversationId}: ${errorText(error)}`);
      return null;
    }
  } else if (needsReasoningEffort) {
    reportWarning(`model-profiles: could not apply ${profile.handle} reasoning effort to ${conversationId}: ctx.conversation.updateLlmConfig is not available in this Letta Code runtime.`);
    return null;
  }

  if (Object.keys(patch).length > 0 || needsMaxOutput) {
    try {
      if (Object.keys(patch).length > 0) await updateConversation(conversationId, patch);
      if (needsMaxOutput) {
        // updateLlmConfig may have replaced model_settings since the first read.
        // Refresh before constructing the replacement object for max_output_tokens.
        const maxOutputLive = llmConfigUpdated ? await retrieveConversation(conversationId) : live;
        await applyMaxOutput(conversationId, maxOutputLive, wantMaxOutput as number);
      }
    } catch (error) {
      reportWarning(`model-profiles: could not apply ${profile.handle} to ${conversationId}: ${errorText(error)}`);
      return null;
    }
  }
  return `${profile.handle}: ${changed.join(", ")}`;
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

  // `getClient` is the official mod-API entry point. `client` is its lazy-proxy
  // shorthand; keep both for older hosts. Neither is available in listener mods.
  sdkClient = (letta?.client as LettaClientLike | undefined) ?? null;
  resolveClient = typeof letta?.getClient === "function" ? () => letta.getClient() as Promise<LettaClientLike> : null;
  clientPromise = null;
  if (!sdkClient && !resolveClient && !(restBaseUrl() && restApiKey())) {
    reportWarning("model-profiles: no conversation transport (no mod client and no LETTA_BASE_URL/LETTA_API_KEY); limits will not be enforced.");
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
            max_output_tokens: { type: "number", description: "Optional. Preferred max output tokens, e.g. 32000. The provider's own ceiling still applies." },
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
          const maxOutputTokens = positiveInteger(ctx.args.max_output_tokens);
          if (ctx.args.max_output_tokens !== undefined && ctx.args.max_output_tokens !== null && !maxOutputTokens) {
            return jsonResult({ error: "max_output_tokens must be a positive integer." }, "error");
          }
          const reasoningEffort = ctx.args.reasoning_effort;
          if (reasoningEffort !== undefined && reasoningEffort !== null && !isReasoningEffort(reasoningEffort)) {
            return jsonResult({ error: `reasoning_effort must be one of: ${REASONING_EFFORTS.join(", ")}.` }, "error");
          }
          const label = typeof ctx.args.label === "string" ? ctx.args.label.trim() : "";
          const { state, path } = saveProfile(ctx, model, {
            contextWindow,
            ...(maxOutputTokens ? { maxOutputTokens } : {}),
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
            max_output_tokens: { type: "number", description: "Optional max output token override. Wins over the saved profile." },
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
            maxOutputTokens: positiveInteger(ctx.args.max_output_tokens),
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
      `  /model-profile set <model> <context-window> [${REASONING_EFFORTS.join("|")}] [--max-output <tokens>] [label...]`,
      "  /model-profile switch <model-or-label...> [--scope conversation|agent] [--max-output <tokens>]",
      "  /model-profile remove <model-or-label...>",
    ].join("\n");

    const handleCommand = async (ctx: ProfilesContext & { args: string; argv?: string[] }) => {
      const argv = Array.isArray(ctx.argv) ? ctx.argv : (ctx.args || "").trim().split(/\s+/).filter(Boolean);
      const { sub, positional, scope, maxOutputTokens, error } = parseCommandArgs(argv);
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
              const maxOutput = p.maxOutputTokens ? ` [max output: ${p.maxOutputTokens.toLocaleString()}]` : "";
              return `  - ${handle}${label}: ${p.contextWindow.toLocaleString()} tokens${maxOutput}${reasoning}`;
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
          ...(maxOutputTokens ? { maxOutputTokens } : {}),
          ...(reasoningEffort ? { reasoningEffort } : {}),
          ...(label ? { label } : {}),
        });
        const detail = `${contextWindow.toLocaleString()} tokens${maxOutputTokens ? ` [max output: ${maxOutputTokens.toLocaleString()}]` : ""}${reasoningEffort ? ` [${reasoningEffort}]` : ""}${label ? ` (${label})` : ""}`;
        return commandOutput(`Saved profile for ${model}: ${detail}\nStorage: ${path}`);
      }

      if (sub === "switch") {
        const query = positional.join(" ").trim();
        if (!query) return commandOutput(USAGE, false);
        const target = resolveSwitch(readProfiles(ctx), query, { scope, maxOutputTokens });
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

  // Enforce saved profiles on conversation start and before every turn. Without this a
  // profile only applies when something explicitly switches models, so a fresh
  // conversation inherits the catalog placeholders (128k context / 16k max output) and
  // a model changed through the UI silently reverts the conversation to those defaults.
  //
  // A per-conversation "already reconciled" set would be cheaper, but it cannot see a
  // later UI change: `ctx.model.id` resolves from the AGENT record in listener mode, not
  // from the conversation, so the only signal is the conversation record itself. Hence
  // one GET per turn, and a write only when the live values differ.
  const hooks = (letta as any)?.events;
  if (hooks && typeof hooks.on === "function" && letta?.capabilities?.events?.lifecycle) {
    disposers.push(
      hooks.on("conversation_open", async (event: unknown, ctx: ProfilesContext) => {
        const conversationId = conversationIdOf(event, ctx);
        if (!conversationId) return;
        const summary = await reconcileConversation(ctx, conversationId);
        if (summary) reportWarning(`model-profiles: applied profile on conversation open (${summary})`);
      }),
    );
  }

  if (hooks && typeof hooks.on === "function" && letta?.capabilities?.events?.turns) {
    disposers.push(
      hooks.on("turn_start", async (event: unknown, ctx: ProfilesContext) => {
        const conversationId = conversationIdOf(event, ctx);
        if (!conversationId) return;
        // The listener re-reads the conversation model after this handler resolves, so a
        // patch here takes effect on the turn that is about to run.
        const summary = await reconcileConversation(ctx, conversationId);
        if (summary) reportWarning(`model-profiles: applied profile on turn start (${summary})`);
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
    sdkClient = null;
    resolveClient = null;
    clientPromise = null;
  };
}
