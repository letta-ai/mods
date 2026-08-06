import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const STATE_PATH = join(
  homedir(),
  ".letta",
  "mods",
  "codex-plan-failover.state.json",
);
const REFRESH_TTL_MS = 30_000;

interface UsageState {
  fetchedAt: number;
  limitReached: boolean;
  resetsAt: number | null;
  usedPercent: number | null;
}

interface FailoverState {
  enabled: boolean;
  providerNames: string[];
  usage: Record<string, UsageState>;
}

interface ProviderRecord {
  name?: string;
  provider_type?: string;
  provider_category?: string | null;
}

interface UsageResponse {
  limitReached?: boolean | null;
  fetchedAt?: string;
  primary?: {
    usedPercent?: number | null;
    resetsAt?: number | null;
  } | null;
}

const DEFAULT_STATE: FailoverState = {
  enabled: true,
  providerNames: [],
  usage: {},
};

function normalizeProviderNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => /^[A-Za-z0-9._-]+$/.test(item)),
    ),
  ];
}

function readState(): FailoverState {
  try {
    const raw = JSON.parse(
      readFileSync(STATE_PATH, "utf8"),
    ) as Partial<FailoverState>;
    return {
      enabled: raw.enabled !== false,
      providerNames: normalizeProviderNames(raw.providerNames),
      usage: raw.usage && typeof raw.usage === "object" ? raw.usage : {},
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function writeState(state: FailoverState): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  const temporaryPath = `${STATE_PATH}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporaryPath, STATE_PATH);
}

function splitModelHandle(
  model: string | null,
): { provider: string; model: string } | null {
  if (!model) return null;
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) return null;
  return {
    provider: model.slice(0, slash),
    model: model.slice(slash + 1),
  };
}

async function resolveModelHandle(
  letta: any,
  conversationId: string,
  fallback: string | null,
): Promise<string | null> {
  try {
    const client = await letta.getClient();
    const conversation = (await client.conversations.retrieve(
      conversationId,
    )) as { model?: string | null };
    return conversation.model ?? fallback;
  } catch {
    return fallback;
  }
}

function activeLimitReached(
  usage: UsageState | undefined,
  now = Date.now(),
): boolean {
  if (!usage?.limitReached) return false;
  if (usage.resetsAt === null) return true;
  return usage.resetsAt * 1000 > now;
}

function remainingPercent(usage: UsageState | undefined): number {
  if (!usage || activeLimitReached(usage)) return -1;
  return usage.usedPercent === null ? 0 : 100 - usage.usedPercent;
}

function chooseProvider(
  state: FailoverState,
  currentProvider: string,
): string | null {
  const candidates = state.providerNames
    .filter((name) => name !== currentProvider)
    .filter((name) => !activeLimitReached(state.usage[name]))
    .sort(
      (left, right) =>
        remainingPercent(state.usage[right]) -
        remainingPercent(state.usage[left]),
    );
  return candidates[0] ?? null;
}

async function refreshUsage(
  letta: any,
  state: FailoverState,
): Promise<FailoverState> {
  const newestFetch = Math.max(
    0,
    ...Object.values(state.usage).map((entry) => entry.fetchedAt || 0),
  );
  if (Date.now() - newestFetch < REFRESH_TTL_MS) return state;

  const client = await letta.getClient();
  const providers = (await client.get("/v1/providers")) as ProviderRecord[];
  const discovered = normalizeProviderNames(
    providers
      .filter((provider) => provider.provider_type === "chatgpt_oauth")
      .filter((provider) => provider.provider_category !== "base")
      .map((provider) => provider.name),
  );
  const providerNames =
    discovered.length > 0 ? discovered : state.providerNames;

  const results = await Promise.allSettled(
    providerNames.map(async (providerName) => {
      const response = (await client.get(
        "/v1/providers/chatgpt-usage",
        { query: { provider_name: providerName } },
      )) as UsageResponse;
      return {
        providerName,
        usage: {
          fetchedAt: response.fetchedAt
            ? Date.parse(response.fetchedAt)
            : Date.now(),
          limitReached: response.limitReached === true,
          resetsAt: response.primary?.resetsAt ?? null,
          usedPercent: response.primary?.usedPercent ?? null,
        } satisfies UsageState,
      };
    }),
  );

  const usage = { ...state.usage };
  for (const result of results) {
    if (result.status === "fulfilled") {
      usage[result.value.providerName] = result.value.usage;
    }
  }

  const refreshed = { ...state, providerNames, usage };
  writeState(refreshed);
  return refreshed;
}

function formatStatus(state: FailoverState): string {
  const lines = [
    `Codex plan failover: ${state.enabled ? "on" : "off"}`,
  ];
  if (state.providerNames.length === 0) {
    lines.push("No ChatGPT OAuth plans discovered. Run /codex-failover refresh.");
  }
  for (const name of state.providerNames) {
    const usage = state.usage[name];
    if (!usage) {
      lines.push(`- ${name}: unknown`);
      continue;
    }
    const left =
      usage.usedPercent === null
        ? "unknown"
        : `${Math.max(0, 100 - usage.usedPercent)}% left`;
    lines.push(
      `- ${name}: ${activeLimitReached(usage) ? "limit reached" : left}`,
    );
  }
  return lines.join("\n");
}

export default function activate(letta: any) {
  const disposers: Array<() => void> = [];
  let noticePanel: { close(): void; update(): void } | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  let noticeText = "";

  function showSwapNotice(text: string): void {
    if (!letta.capabilities.ui.panels) return;
    noticeText = text;
    if (!noticePanel) {
      noticePanel = letta.ui.openPanel({
        id: "codex-plan-failover-notice",
        order: 100,
        render: () => noticeText,
      });
    }
    noticePanel.update();
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      noticeText = "";
      noticePanel?.update();
      noticeTimer = null;
    }, 10_000);
  }

  if (letta.capabilities.events.turns) {
    disposers.push(
      letta.events.on("turn_start", async (event: any, ctx: any) => {
        const conversationId = event.conversationId ?? ctx.conversation.id;
        if (!conversationId) return;

        const model = splitModelHandle(
          await resolveModelHandle(letta, conversationId, ctx.model.id),
        );
        let state = readState();
        if (!state.enabled || !model) return;

        try {
          state = await refreshUsage(letta, state);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (
            !message.includes("letta.client is not available in listener mods")
          ) {
            letta.diagnostics.report({
              message: `Codex plan usage refresh failed: ${message}`,
              severity: "warning",
            });
          }
        }

        if (!state.providerNames.includes(model.provider)) return;
        if (!activeLimitReached(state.usage[model.provider])) return;

        const nextProvider = chooseProvider(state, model.provider);
        if (!nextProvider) return;

        const nextModel = `${nextProvider}/${model.model}`;
        await ctx.conversation.updateLlmConfig({
          model: nextModel,
          scope: "conversation",
        });
        const displayName = String(ctx.model.displayName ?? model.model).replace(
          /\s+\(ChatGPT\)$/,
          "",
        );
        const reasoning = ctx.model.reasoningEffort
          ? ` (${ctx.model.reasoningEffort} reasoning)`
          : "";
        showSwapNotice(`Switched to ${displayName} (${nextProvider})${reasoning}`);
      }),
    );
  }

  if (letta.capabilities.commands) {
    disposers.push(
      letta.commands.register({
        id: "codex-failover",
        description: "Show or configure automatic Codex OAuth plan failover",
        args: "[status|refresh|on|off|plans <name,...>]",
        async run(ctx: any) {
          const input = ctx.args.trim();
          let state = readState();

          if (!input || input === "status") {
            return { type: "output", output: formatStatus(state) };
          }
          if (input === "on" || input === "off") {
            state.enabled = input === "on";
            writeState(state);
            return {
              type: "output",
              output: `Codex plan failover ${input}.`,
            };
          }
          if (input === "refresh") {
            try {
              state = await refreshUsage(letta, { ...state, usage: {} });
              return { type: "output", output: formatStatus(state) };
            } catch (error) {
              return {
                type: "output",
                output: `Could not refresh plans on this surface: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              };
            }
          }
          if (input.startsWith("plans ")) {
            const providerNames = normalizeProviderNames(
              input.slice("plans ".length).split(","),
            );
            if (providerNames.length === 0) {
              return {
                type: "output",
                output:
                  "Provide comma-separated ChatGPT OAuth provider names.",
              };
            }
            state.providerNames = providerNames;
            state.usage = Object.fromEntries(
              Object.entries(state.usage).filter(([name]) =>
                providerNames.includes(name),
              ),
            );
            writeState(state);
            return { type: "output", output: formatStatus(state) };
          }
          return {
            type: "output",
            output:
              "Usage: /codex-failover [status|refresh|on|off|plans name,...]",
          };
        },
      }),
    );
  }

  return () => {
    if (noticeTimer) clearTimeout(noticeTimer);
    noticePanel?.close();
    for (const dispose of disposers.reverse()) dispose();
  };
}
