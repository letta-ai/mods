import assert from "node:assert/strict";
import test from "node:test";
import activate from "../mods/auto.mjs";
import { host, invocation } from "./host.mjs";

test("unsupported hosts do not register anything", () => {
  assert.equal(activate({ capabilities: { permissions: false, commands: true } }), undefined);
  assert.equal(activate({ capabilities: { permissions: true, commands: false } }), undefined);
});

test("auto footer opens only when enabled, adapts to width, and closes on exit", () => {
  const original = process.env.OPENROUTER_API_KEY;
  const panels = [];
  const app = host({ openPanel(options) {
    const panel = { ...options, closed: false, close() { this.closed = true; } };
    panels.push(panel);
    return panel;
  } });
  try {
    process.env.OPENROUTER_API_KEY = "not-a-credential";
    assert.equal(panels.length, 0);
    app.run("on");
    const panel = panels[0];
    assert.equal(panel.order, 0);
    const ctx = { width: 100, agent: { id: "agent-1", name: "Agent" }, model: { displayName: "Model" },
      chalk: { cyan: (s) => s, dim: (s) => s }, row: (left, right) => `${left} ${right}` };
    assert.match(panel.render(ctx), /⏵⏵ auto mode on.*\/auto off to exit.*Agent · Model/);
    assert.equal(panel.render({ ...ctx, agent: { id: "other" } }), "");
    assert.doesNotMatch(panel.render({ ...ctx, width: 30 }), /exit|Model/);
    app.run("off");
    assert.ok(panel.closed);
    app.run("on");
    app.close({ agentId: "agent-1", conversationId: "conversation-1" });
    assert.ok(panels[1].closed);
    app.run("on");
    app.dispose();
    assert.ok(panels[2].closed);
  } finally {
    if (original === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = original;
  }
});

test("default off, scoped enable/disable, validation, close and stale execution", async () => {
  const original = process.env.OPENROUTER_API_KEY;
  const app = host();
  try {
    delete process.env.OPENROUTER_API_KEY;
    assert.match(app.run("on").output, /Set OPENROUTER_API_KEY/);
    assert.match(app.run("").output, /off/);
    assert.equal(await app.check(invocation()), undefined);
    // Only enables the command; no valid-input approval request is made until
    // this marker is removed below. No network request uses this value.
    process.env.OPENROUTER_API_KEY = "not-a-credential";
    assert.match(app.run("on").output, /Auto mode on/);
    assert.match(app.run("status", "conversation-2").output, /off/);
    assert.equal(await app.check(invocation({ conversationId: "conversation-2" })), undefined);
    assert.equal(await app.check(invocation({ agentId: "agent-2" })), undefined);
    assert.match(app.run("invalid").output, /Usage/);
    for (const args of [{ value: NaN }, { value: new Date() }, { value: undefined }, { value: "x".repeat(65536) }]) {
      assert.equal((await app.check(invocation({ args }))).decision, "alwaysAsk");
    }
    assert.equal((await app.check(invocation({ toolCallId: null }))).decision, "alwaysAsk");
    assert.equal((await app.check(invocation({ phase: "execution" }))).decision, "deny");
    delete process.env.OPENROUTER_API_KEY;
    const call = invocation();
    assert.equal((await app.check(call)).decision, "alwaysAsk");
    // Host owns human approval; don't re-block its unchanged approved call.
    assert.equal(await app.check({ ...call, phase: "execution" }), undefined);
    assert.equal((await app.check({ ...call, phase: "execution" })).decision, "deny");
    await app.check(call);
    assert.equal((await app.check({ ...call, args: { command: "rm -rf /tmp/example" }, phase: "execution" })).decision, "deny");
    await app.check(call);
    assert.equal((await app.check({ ...call, cwd: "/other", phase: "execution" })).decision, "deny");
    await app.check({ ...call, toolName: "Agent" });
    assert.equal(await app.check({ ...call, toolName: "Task", phase: "execution" }), undefined);
    app.close({ agentId: call.agentId, conversationId: call.conversationId });
    assert.match(app.run("status").output, /off/);
    assert.match(app.run("off").output, /normal permission/);
  } finally {
    app.dispose();
    if (original === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = original;
  }
});
