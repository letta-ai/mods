import { describe, expect, test } from "bun:test";
import activate from "../mods/index.ts";

function harness() {
  const handlers: Record<string, Array<(e: any) => any>> = {};
  const letta = {
    capabilities: { events: { turns: true, tools: true } },
    events: {
      on(name: string, fn: (e: any) => any) {
        (handlers[name] ??= []).push(fn);
        return () => {};
      },
    },
  };
  const dispose = activate(letta) as () => void;
  const emit = (name: string, event: any) => {
    for (const fn of handlers[name] ?? []) {
      const r = fn(event);
      if (r) return r;
    }
  };
  return { emit, dispose };
}

const inbound = (chatId: string, text = "hi") => ({
  conversationId: "conv-1",
  input: [
    {
      role: "user",
      content: `<channel-notification source="discord" chat_id="${chatId}" sender_id="u1" sender_name="Beth">\n${text}\n</channel-notification>`,
    },
  ],
});
const send = (chatId: string, action = "send", status = "success") => ({
  conversationId: "conv-1",
  toolName: "MessageChannel",
  args: { channel: "discord", action, chat_id: chatId, message: "hello" },
  status,
  output: "ok",
});
const end = { conversationId: "conv-1", stopReason: "end_turn" };
const note = (attrs: Record<string, string>) => ({
  conversationId: "conv-1",
  input: [
    {
      role: "user",
      content: `<channel-notification ${Object.entries({ sender_id: "u1", ...attrs })
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ")}>\nhi\n</channel-notification>`,
    },
  ],
});
const tool = (args: Record<string, unknown>) => ({
  conversationId: "conv-1",
  toolName: "MessageChannel",
  args,
  status: "success",
  output: "ok",
});

describe("unanswered channel messages", () => {
  test("no nudge when the agent replied", () => {
    const h = harness();
    h.emit("turn_start", inbound("123"));
    h.emit("tool_end", send("123"));
    expect(h.emit("turn_end", end)).toBeUndefined();
    h.dispose();
  });

  test("nudges once when a turn ends silently", () => {
    const h = harness();
    h.emit("turn_start", inbound("123"));
    const r = h.emit("turn_end", end);
    expect(r?.continue).toContain("<unanswered-channel-messages>");
    expect(r?.continue).toContain("discord chat 123 (from Beth)");
    h.dispose();
  });

  test("deliberate silence after the nudge ends the turn with no loop", () => {
    const h = harness();
    h.emit("turn_start", inbound("123"));
    const nudge = h.emit("turn_end", end);
    h.emit("turn_start", { conversationId: "conv-1", input: [{ role: "user", content: nudge.continue }] });
    expect(h.emit("turn_end", end)).toBeUndefined();
    expect(h.emit("turn_end", end)).toBeUndefined();
    h.dispose();
  });

  test("replying after the nudge clears it", () => {
    const h = harness();
    h.emit("turn_start", inbound("123"));
    h.emit("turn_end", end);
    h.emit("tool_end", send("123"));
    expect(h.emit("turn_end", end)).toBeUndefined();
    h.dispose();
  });

  test("reactions and failed sends don't count as a reply", () => {
    const h = harness();
    h.emit("turn_start", inbound("123"));
    h.emit("tool_end", send("123", "react"));
    h.emit("tool_end", send("123", "send", "error"));
    expect(h.emit("turn_end", end)?.continue).toBeDefined();
    h.dispose();
  });

  test("only unanswered chats are listed", () => {
    const h = harness();
    h.emit("turn_start", inbound("123"));
    h.emit("turn_start", inbound("456"));
    h.emit("tool_end", send("123"));
    const r = h.emit("turn_end", end);
    expect(r?.continue).toContain("chat 456");
    expect(r?.continue).not.toContain("chat 123");
    h.dispose();
  });

  test("new inbound messages earn a fresh reminder", () => {
    const h = harness();
    h.emit("turn_start", inbound("123"));
    h.emit("turn_end", end);
    h.emit("turn_end", end); // ignored, pending cleared
    h.emit("turn_start", inbound("123", "hello?"));
    expect(h.emit("turn_end", end)?.continue).toBeDefined();
    h.dispose();
  });

  test("replying in one Slack thread leaves another thread in the same channel pending", () => {
    const h = harness();
    h.emit("turn_start", note({ source: "slack", chat_id: "C1", thread_id: "t1", message_id: "t1" }));
    h.emit("turn_start", note({ source: "slack", chat_id: "C1", thread_id: "t2", message_id: "t2" }));
    h.emit("tool_end", tool({ channel: "slack", action: "send", chat_id: "C1", threadId: "t1" }));
    const r = h.emit("turn_end", end);
    expect(r?.continue).toContain("thread t2");
    expect(r?.continue).not.toContain("thread t1");
    h.dispose();
  });

  test("a Slack reply threaded on the inbound message_id clears that message", () => {
    const h = harness();
    h.emit("turn_start", note({ source: "slack", chat_id: "C1", message_id: "1700.1" }));
    h.emit("tool_end", tool({ channel: "slack", action: "send", chat_id: "C1", threadId: "1700.1" }));
    expect(h.emit("turn_end", end)).toBeUndefined();
    h.dispose();
  });

  test("two accounts sharing a chat id are tracked separately", () => {
    const h = harness();
    h.emit("turn_start", note({ source: "telegram", account_id: "a1", chat_id: "99" }));
    h.emit("turn_start", note({ source: "telegram", account_id: "a2", chat_id: "99" }));
    h.emit("tool_end", tool({ channel: "telegram", action: "send", chat_id: "99", accountId: "a1" }));
    const r = h.emit("turn_end", end);
    expect(r?.continue).toContain("account a2");
    expect(r?.continue).not.toContain("account a1");
    h.dispose();
  });

  test("an ambiguous send that omits the thread clears nothing", () => {
    const h = harness();
    h.emit("turn_start", note({ source: "slack", chat_id: "C1", thread_id: "t1" }));
    h.emit("turn_start", note({ source: "slack", chat_id: "C1", thread_id: "t2" }));
    h.emit("tool_end", tool({ channel: "slack", action: "send", chat_id: "C1" }));
    const r = h.emit("turn_end", end);
    expect(r?.continue).toContain("thread t1");
    expect(r?.continue).toContain("thread t2");
    h.dispose();
  });

  test("a proactive send to a target doesn't answer the inbound chat", () => {
    const h = harness();
    h.emit("turn_start", note({ source: "slack", chat_id: "C1" }));
    h.emit("tool_end", tool({ channel: "slack", action: "send", target: "#unrelated" }));
    expect(h.emit("turn_end", end)?.continue).toContain("slack chat C1");
    h.dispose();
  });

  test("ordinary turns without channel messages are untouched", () => {
    const h = harness();
    h.emit("turn_start", { conversationId: "conv-1", input: [{ role: "user", content: "just chatting" }] });
    expect(h.emit("turn_end", end)).toBeUndefined();
    h.dispose();
  });
});
