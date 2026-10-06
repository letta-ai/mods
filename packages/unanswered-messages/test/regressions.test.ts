import { test, expect } from "bun:test";
import activate from "../mods/index";

function harness() {
  const handlers: Record<string, any> = {};
  let tool: any;
  const dispose = activate({ capabilities: { events: { turns: true, tools: true }, tools: true }, events: { on: (name, fn) => { handlers[name] = fn; return () => {}; } }, tools: { register: t => { tool = t; return () => {}; } } });
  return { dispose, emit: (name: string, data: any) => handlers[name](data), status: (id = "test") => JSON.parse(tool.run({ conversation: { id } })) };
}
const inbound = (id = "1", chat = "c") => ({ conversationId: "test", input: [{ role: "user", content: `<channel-notification source="signal" chat_id="${chat}" message_id="${id}">SECRET BODY</channel-notification>` }] });
const end = { conversationId: "test" };
test("long-running turns still receive one reminder", () => {
  const h = harness(), old = Date.now; let now = 1000;
  Date.now = () => now;
  try {
    h.emit("turn_start", inbound()); now += 3600000;
    expect(h.emit("turn_end", end).continue).toContain("unanswered-channel-messages");
    expect(h.emit("turn_end", end)).toBeUndefined();
    expect(h.status().outcomes.at(-1).status).toBe("dismissed-after-reminder");
  } finally { Date.now = old; h.dispose(); }
});
test("duplicate IDs do not recount or earn another reminder", () => {
  const h = harness();
  try {
    h.emit("turn_start", inbound()); h.emit("turn_start", inbound());
    expect(h.status().pending[0].count).toBe(1);
    h.emit("turn_end", end); h.emit("turn_start", inbound());
    expect(h.emit("turn_end", end)).toBeUndefined();
    h.emit("turn_start", inbound()); expect(h.emit("turn_end", end)).toBeUndefined();
    h.emit("turn_start", inbound("2")); expect(h.emit("turn_end", end).continue).toBeTruthy();
  } finally { h.dispose(); }
});
test("answered receipt is inspectable without bodies or cross-conversation exposure", () => {
  const h = harness();
  try {
    h.emit("turn_start", inbound());
    h.emit("tool_end", { conversationId: "test", toolName: "MessageChannel", status: "success", args: { action: "send", channel: "signal", chat_id: "c" } });
    expect(h.status().pending).toHaveLength(0);
    expect(h.status().outcomes.at(-1).status).toBe("answered");
    expect(JSON.stringify(h.status())).not.toContain("SECRET BODY");
    expect(h.status("other").outcomes).toHaveLength(0);
    h.emit("turn_start", inbound()); expect(h.status().pending).toHaveLength(0);
  } finally { h.dispose(); }
});
test("same ID in different routes remains distinct", () => {
  const h = harness();
  try { h.emit("turn_start", inbound()); h.emit("turn_start", inbound("1", "other")); expect(h.status().pending).toHaveLength(2); }
  finally { h.dispose(); }
});
test("idle expiration is visible, active messages are protected", () => {
  const h = harness(), old = Date.now; let now = 1000; Date.now = () => now;
  try {
    h.emit("turn_start", inbound()); h.emit("turn_end", end); now += 3600000;
    h.emit("turn_start", { conversationId: "test", input: [] });
    expect(h.status().pending).toHaveLength(0);
    expect(h.status().outcomes.at(-1).status).toBe("expired");
  } finally { Date.now = old; h.dispose(); }
});
