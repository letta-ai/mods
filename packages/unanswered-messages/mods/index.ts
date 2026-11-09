// Unanswered channel messages: a gentle end-of-turn reminder.
//
// Channel messages (Discord, Telegram, Slack, ...) reach the agent as
// <channel-notification> blocks, and the agent answers by calling the
// MessageChannel tool. Some models end a turn without calling it, so the
// person on the other side gets silence. This mod remembers which chats sent
// messages during a turn, forgets them once the agent sends to that chat, and,
// if a turn ends with any still unanswered, queues one short follow-up turn
// asking the agent to check. Staying silent remains a valid choice: each chat
// gets at most one reminder per batch of inbound messages, then is dropped.

const MARKER = "<unanswered-channel-messages>";
const STALE_AFTER_MS = 30 * 60 * 1000;
const SEND_ACTIONS = new Set(["send", "send-rich", "upload-file"]);
const NOTIFICATION_RE = /<channel-notification\s+([^>]*)>/g;
const ATTR_RE = /([a-zA-Z_]+)="([^"]*)"/g;

type Pending = {
  channel: string;
  accountId: string | null;
  chatId: string;
  threadId: string | null;
  messageIds: Set<string>;
  sender: string | null;
  count: number;
  seenAt: number;
  reminded: boolean;
};
type Outcome = { status: string; at: number; channel: string; accountId: string | null; chatId: string; threadId: string | null; messageIds: string[] };
type ConversationState = { pending: Map<string, Pending>; seen: Map<string, number>; outcomes: Outcome[] };

const states = new Map<string, ConversationState>();

function stateFor(conversationId: string | null): ConversationState {
  const key = conversationId ?? "__default__";
  let state = states.get(key);
  if (!state) {
    state = { pending: new Map(), seen: new Map(), outcomes: [] };
    states.set(key, state);
  }
  return state;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
    .join("\n");
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(ATTR_RE)) attrs[match[1]] = match[2];
  return attrs;
}

// Runs only at turn_start, before the new turn's messages are added. Turns in a
// conversation run one at a time, so nothing here belongs to a running turn,
// even when the previous turn errored and never emitted turn_end.
function dropStale(state: ConversationState, now: number): void {
  for (const [key, entry] of state.pending) {
    if (now - entry.seenAt > STALE_AFTER_MS) {
      record(state, entry, "expired");
      state.pending.delete(key);
    }
  }
}

function record(state: ConversationState, p: Pending, status: string): void {
  state.outcomes.push({ status, at: Date.now(), channel: p.channel, accountId: p.accountId, chatId: p.chatId, threadId: p.threadId, messageIds: [...p.messageIds] });
  if (state.outcomes.length > 128) state.outcomes.shift();
}

function routeKey(channel: string, accountId: string | null, chatId: string, threadId: string | null): string {
  return [channel, accountId ?? "", chatId, threadId ?? ""].join("\u0000");
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Which pending routes a successful send answered. A send names its route by
// channel + chat_id, optionally narrowed by accountId and threadId. When the
// runtime fills in omitted fields itself, only a single matching route can be
// cleared with confidence; if several remain, leave them for the reminder.
// A proactive send to a `target` (no chat_id) isn't a reply to anything inbound.
function answeredRoutes(state: ConversationState, args: Record<string, unknown>): string[] {
  const channel = nonEmpty(args.channel);
  const chatId = nonEmpty(args.chat_id);
  if (!channel || !chatId) return [];
  const accountId = nonEmpty(args.accountId);
  const threadId = nonEmpty(args.threadId);

  const matches = [...state.pending.entries()].filter(([, p]) => {
    if (p.channel !== channel || p.chatId !== chatId) return false;
    if (accountId && p.accountId !== accountId) return false;
    // Slack replies in a thread rooted at the inbound message use its message_id.
    if (threadId && p.threadId !== threadId && !p.messageIds.has(threadId)) return false;
    return true;
  });
  return matches.length === 1 ? [matches[0][0]] : [];
}

function describe(pending: Pending[]): string {
  return pending
    .map((p) => {
      const where = [
        `${p.channel} chat ${p.chatId}`,
        p.threadId ? `thread ${p.threadId}` : null,
        p.accountId ? `account ${p.accountId}` : null,
      ]
        .filter(Boolean)
        .join(", ");
      return `- ${where}${p.sender ? ` (from ${p.sender})` : ""}: ${p.count} message${p.count === 1 ? "" : "s"}`;
    })
    .join("\n");
}

export default function activate(letta) {
  if (!letta.capabilities.events.turns || !letta.capabilities.events.tools) return;

  const disposers = [];

  if (letta.capabilities.tools) {
    disposers.push(letta.tools.register({
      name: "unanswered_messages_status",
      description: "Inspect this conversation's pending channel replies and recent outcomes. Read-only, no message bodies; state resets on reload. Dedup retains up to 4096 message IDs for 24 hours.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      requiresApproval: false,
      parallelSafe: true,
      run(ctx) {
        const state = states.get(ctx.conversation.id ?? "__default__");
        return JSON.stringify({ pending: state ? [...state.pending.values()].map(p => ({ channel: p.channel, accountId: p.accountId, chatId: p.chatId, threadId: p.threadId, messageIds: [...p.messageIds], count: p.count, reminded: p.reminded })) : [], outcomes: state?.outcomes ?? [] });
      },
    }));
  }

  disposers.push(
    letta.events.on("turn_start", (event) => {
      const text = (event.input ?? [])
        .filter((item) => item && item.type !== "approval" && item.role === "user")
        .map((item) => textOf(item.content))
        .join("\n");
      // No early return for our own reminder turn: the listener can merge it
      // with channel messages that queued up during the previous turn, and
      // those must still be tracked. The reminder text has no notifications.

      const now = Date.now();
      const state = stateFor(event.conversationId);
      dropStale(state, now);
      for (const [id, at] of state.seen) if (now - at > 24 * 60 * 60 * 1000) state.seen.delete(id);

      for (const match of text.matchAll(NOTIFICATION_RE)) {
        const attrs = parseAttrs(match[1]);
        if (!attrs.source || !attrs.chat_id) continue;
        const accountId = attrs.account_id || null;
        const threadId = attrs.thread_id || null;
        const key = routeKey(attrs.source, accountId, attrs.chat_id, threadId);
        if (attrs.message_id) {
          const identity = JSON.stringify([key, attrs.message_id]);
          if (state.seen.has(identity)) continue;
          state.seen.set(identity, now);
          if (state.seen.size > 4096) state.seen.delete(state.seen.keys().next().value!);
        }
        const existing = state.pending.get(key);
        const messageIds = existing?.messageIds ?? new Set<string>();
        if (attrs.message_id) messageIds.add(attrs.message_id);
        state.pending.set(key, {
          channel: attrs.source,
          accountId,
          chatId: attrs.chat_id,
          threadId,
          messageIds,
          sender: attrs.sender_name ?? existing?.sender ?? null,
          count: (existing?.count ?? 0) + 1,
          seenAt: now,
          reminded: false, // a new message earns its chat one fresh reminder
        });
        record(state, state.pending.get(key)!, "pending");
      }
    }),
  );

  disposers.push(
    letta.events.on("tool_end", (event) => {
      if (event.status !== "success") return;
      if (event.toolName !== "MessageChannel" && event.toolName !== "message_channel") return;
      const args = event.args ?? {};
      if (!SEND_ACTIONS.has(String(args.action))) return;

      const state = stateFor(event.conversationId);
      for (const key of answeredRoutes(state, args)) {
        record(state, state.pending.get(key)!, "answered");
        state.pending.delete(key);
      }
    }),
  );

  disposers.push(
    letta.events.on("turn_end", (event) => {
      const state = stateFor(event.conversationId);
      const due: Pending[] = [];
      for (const [key, p] of state.pending) {
        if (p.reminded) {
          // Already reminded once for these messages: respect the decision.
          record(state, p, "dismissed-after-reminder");
          state.pending.delete(key);
        } else {
          due.push(p);
        }
      }
      if (due.length === 0) return;

      for (const p of due) {
        p.reminded = true;
        record(state, p, "reminded");
      }
      return {
        continue: [
          MARKER,
          "This turn ended without a MessageChannel send to some chats that messaged you:",
          describe(due),
          "If a reply is owed, send it with MessageChannel now. If staying silent was intentional, just end the turn; you won't be reminded again about these messages.",
          "</unanswered-channel-messages>",
        ].join("\n"),
      };
    }),
  );

  return () => {
    for (const dispose of disposers.reverse()) dispose();
    states.clear();
  };
}
