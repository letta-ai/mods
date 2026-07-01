import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function cleanSummary(summary: unknown): string | null {
  return typeof summary === "string" && summary.trim() ? summary.trim() : null;
}

function localBackendStorageDir(): string {
  return (
    process.env.LETTA_LOCAL_BACKEND_DIR ??
    join(homedir(), ".letta", "lc-local-backend")
  );
}

function encodePathSegment(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function summaryKey(
  conversationId: string | null | undefined,
  agentId: string | null | undefined,
): string | null {
  if (!conversationId) return null;
  return conversationId === "default"
    ? `default:${agentId ?? ""}`
    : conversationId;
}

function localConversationKey(
  conversationId: string,
  agentId: string | null | undefined,
): string | null {
  if (conversationId === "default") {
    return agentId ? `default:${agentId}` : null;
  }
  return `conversation:${conversationId}`;
}

function isLocalConversation(
  conversationId: string,
  agentId: string | null | undefined,
): boolean {
  return agentId?.startsWith("agent-local-") === true ||
    conversationId.startsWith("local-conv-") ||
    conversationId === "default";
}

function readLocalConversationSummary(
  conversationId: string,
  agentId: string | null | undefined,
): string | null | undefined {
  const key = localConversationKey(conversationId, agentId);
  if (!key) return undefined;

  const conversationPath = join(
    localBackendStorageDir(),
    "conversations",
    encodePathSegment(key),
    "conversation.json",
  );
  if (!existsSync(conversationPath)) return undefined;

  try {
    const conversation = JSON.parse(readFileSync(conversationPath, "utf8"));
    return cleanSummary(conversation?.summary);
  } catch {
    return undefined;
  }
}

export default function activate(letta: any) {
  if (!letta.capabilities.ui?.panels) return;

  let activeConversationId: string | null = process.env.CONVERSATION_ID ?? null;
  let activeAgentId: string | null =
    process.env.LETTA_AGENT_ID ?? process.env.AGENT_ID ?? null;
  const summariesByConversation = new Map<string, string>();

  const setSummary = (
    conversationId: string,
    agentId: string | null | undefined,
    summary: string | null,
  ) => {
    const key = summaryKey(conversationId, agentId);
    if (!key) return;
    if (summary) summariesByConversation.set(key, summary);
    else summariesByConversation.delete(key);
  };

  const panel = letta.ui.openPanel({
    id: "conversation-summary",
    order: 0,
    render({ width, sessionId, agent, model, row, chalk }: any) {
      const conversationId = sessionId ?? activeConversationId;
      const agentId = agent.id ?? activeAgentId;
      const key = summaryKey(conversationId, agentId);
      const summary = key ? summariesByConversation.get(key) : null;
      const left = summary ? chalk.hex("#8C8CF9")(summary) : "";
      const modelLabel = model.displayName ?? model.id ?? "unknown";
      const right = chalk.dim(`${agent.name ?? "Letta"} · ${modelLabel}`);

      return row(left, right, width);
    },
  });

  async function fetchConversationSummary(
    conversationId: string | null | undefined,
    agentId: string | null | undefined,
  ) {
    if (!conversationId) return;

    if (isLocalConversation(conversationId, agentId)) {
      const localSummary = readLocalConversationSummary(conversationId, agentId);
      if (localSummary !== undefined) {
        setSummary(conversationId, agentId, localSummary);
        if (conversationId === activeConversationId) panel.update();
        return;
      }
      if (agentId?.startsWith("agent-local-") || conversationId === "default") {
        setSummary(conversationId, agentId, null);
        if (conversationId === activeConversationId) panel.update();
        return;
      }
    }

    try {
      const conversation = await letta.client.conversations.retrieve(
        conversationId,
      );
      setSummary(conversationId, agentId, cleanSummary(conversation?.summary));
      if (conversationId === activeConversationId) panel.update();
    } catch {
      // Keep the previous cached title/fallback if the fetch fails.
    }
  }

  const disposers: Array<() => void> = [];

  if (letta.capabilities.events?.lifecycle) {
    disposers.push(
      letta.events.on("conversation_open", (event: any) => {
        activeConversationId = event.conversationId ?? null;
        activeAgentId = event.agentId ?? null;
        void fetchConversationSummary(activeConversationId, activeAgentId);
      }),
    );
  }

  void fetchConversationSummary(activeConversationId, activeAgentId);

  return () => {
    for (const dispose of disposers.reverse()) dispose();
    panel.close();
  };
}
