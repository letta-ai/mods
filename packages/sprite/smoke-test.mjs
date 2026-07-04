import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "sprite-smoke-"));
process.env.SPRITE_STATE_PATH = join(tempDir, "sprite.state.json");

const { default: activate } = await import("./mods/sprite.tsx");

const tools = new Map();
const commands = new Map();
const events = new Map();

const letta = {
  capabilities: {
    tools: true,
    commands: true,
    events: {
      lifecycle: true,
      tools: true,
      turns: true,
      llm: true,
      compact: true,
    },
    ui: { panels: false },
  },
  tools: {
    register(tool) {
      tools.set(tool.name, tool);
      return () => tools.delete(tool.name);
    },
  },
  commands: {
    register(command) {
      commands.set(command.id, command);
      return () => commands.delete(command.id);
    },
  },
  events: {
    on(name, handler) {
      const handlers = events.get(name) ?? [];
      handlers.push(handler);
      events.set(name, handlers);
      return () => events.set(name, (events.get(name) ?? []).filter((h) => h !== handler));
    },
  },
  ui: {
    openPanel() {
      throw new Error("headless smoke test must not open panels");
    },
  },
};

let dispose;
try {
  dispose = activate(letta);

  assert.equal(typeof dispose, "function", "activate should return a disposer");
  assert.ok(commands.has("sprite"), "sprite command should register without panels");

  for (const name of [
    "sprite_hatch",
    "sprite_name",
    "sprite_molt",
    "sprite_pet",
    "sprite_status",
    "sprite_set_voice",
  ]) {
    assert.ok(tools.has(name), `${name} should register without panels`);
  }

  const hatch = tools.get("sprite_hatch").run({
    args: { species: "duck" },
    agent: { id: "agent-smoke", name: "Smoke" },
  });
  assert.match(String(hatch), /egg appears|already here/);

  const status = tools.get("sprite_status").run({
    args: {},
    agent: { id: "agent-smoke", name: "Smoke" },
  });
  assert.match(String(status), /egg|duck|companion/i);
} finally {
  if (typeof dispose === "function") dispose();
  rmSync(tempDir, { recursive: true, force: true });
}

console.log("Sprite headless smoke test passed.");
