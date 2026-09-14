import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import activate from "./mods/index.ts";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "letta-horizon-mode-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const statePath = join(root, "state.json");
  const memoryDir = join(root, "memory");
  const repo = join(root, "repo");
  await mkdir(join(memoryDir, "reference", "task"), { recursive: true });
  await mkdir(repo);
  await writeFile(join(memoryDir, "reference", "MEMORY.md"), "# Reference index\n- [Task](task/MEMORY.md)\n");
  await writeFile(join(memoryDir, "reference", "task", "MEMORY.md"), "# Task memory\nMeasure the real objective.\n");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  await writeFile(join(repo, "answer.txt"), "first\n");
  execFileSync("git", ["add", "answer.txt"], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "initial checkpoint"], {
    cwd: repo,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Horizon Test",
      GIT_AUTHOR_EMAIL: "horizon@example.com",
      GIT_COMMITTER_NAME: "Horizon Test",
      GIT_COMMITTER_EMAIL: "horizon@example.com",
    },
  });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  return { root, statePath, memoryDir, repo, commit };
}

function harness(capabilities = {
  tools: true,
  commands: true,
  events: { turns: true, tools: true },
}) {
  const tools = new Map();
  const commands = new Map();
  const events = new Map();
  const disposers = [];
  const dispose = activate({
    capabilities,
    tools: {
      register(definition) {
        tools.set(definition.name, definition);
        const unregister = () => tools.delete(definition.name);
        disposers.push(unregister);
        return unregister;
      },
    },
    commands: {
      register(definition) {
        commands.set(definition.id, definition);
        const unregister = () => commands.delete(definition.id);
        disposers.push(unregister);
        return unregister;
      },
    },
    events: {
      on(name, handler) {
        events.set(name, handler);
        const unregister = () => events.delete(name);
        disposers.push(unregister);
        return unregister;
      },
    },
  });
  return { tools, commands, events, dispose, disposers };
}

function context(f, conversationId, args = {}) {
  return {
    cwd: f.repo,
    args,
    agent: { id: "agent-horizon" },
    conversation: { id: conversationId },
    memfs: { enabled: true, memoryDir: f.memoryDir },
  };
}

function reminderText(input) {
  const content = input[0].content;
  return Array.isArray(content) ? content.map((part) => part.text ?? "").join("\n") : String(content);
}

test("registers the Horizon command, tools, and continuation events", async (t) => {
  const f = await fixture(t);
  process.env.HORIZON_STATE_PATH = f.statePath;
  process.env.HORIZON_MODE = "off";
  t.after(() => {
    delete process.env.HORIZON_STATE_PATH;
    delete process.env.HORIZON_MODE;
  });

  const h = harness();
  assert.deepEqual([...h.tools.keys()], ["submit"]);
  assert.deepEqual([...h.commands.keys()], ["horizon"]);
  assert.deepEqual([...h.events.keys()].sort(), ["tool_start", "turn_end", "turn_start"]);

  h.dispose();
  assert.equal(h.tools.size, 0);
  assert.equal(h.commands.size, 0);
  assert.equal(h.events.size, 0);
});

test("does not advertise continuation controls on hosts without turn events", async (t) => {
  const f = await fixture(t);
  process.env.HORIZON_STATE_PATH = f.statePath;
  t.after(() => delete process.env.HORIZON_STATE_PATH);
  const h = harness({ tools: true, commands: true, events: { turns: false, tools: false } });
  t.after(h.dispose);

  assert.equal(h.tools.size, 0);
  assert.equal(h.commands.size, 0);
  assert.equal(h.events.size, 0);
});

test("injects reminders only while Horizon mode is active", async (t) => {
  const f = await fixture(t);
  process.env.HORIZON_STATE_PATH = f.statePath;
  process.env.HORIZON_MODE = "off";
  t.after(() => {
    delete process.env.HORIZON_STATE_PATH;
    delete process.env.HORIZON_MODE;
  });
  const h = harness();
  t.after(h.dispose);
  const ctx = context(f, "conv-reminder");

  const inactive = [{ role: "user", content: "work" }];
  await h.events.get("turn_start")({ input: inactive }, ctx);
  assert.equal(inactive[0].content, "work");

  delete process.env.HORIZON_MODE;
  await h.commands.get("horizon").run({ ...ctx, args: "on" });
  const active = [{ role: "user", content: "work" }];
  const transformed = await h.events.get("turn_start")({ input: active }, ctx);
  assert.match(reminderText(transformed.input), /Horizon mode is active/);
  assert.match(reminderText(transformed.input), /\/tmp\/horizon\/PROGRESS\.md/);
  assert.match(reminderText(transformed.input), /work$/);
});

test("auto mode follows sandbox-timer and stops inside the reserve", async (t) => {
  const f = await fixture(t);
  const bin = join(f.root, "bin");
  const timer = join(bin, "sandbox-timer");
  await mkdir(bin);
  await writeFile(timer, "#!/bin/sh\nprintf '%s\\n' \"${HORIZON_TEST_REMAINING}\"\n");
  await chmod(timer, 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  process.env.HORIZON_STATE_PATH = f.statePath;
  delete process.env.HORIZON_MODE;
  process.env.HORIZON_TEST_REMAINING = "71000";
  t.after(() => {
    process.env.PATH = previousPath;
    delete process.env.HORIZON_STATE_PATH;
    delete process.env.HORIZON_TEST_REMAINING;
  });
  const h = harness();
  t.after(h.dispose);
  const ctx = context(f, "conv-auto");

  const transformed = await h.events.get("turn_start")({ input: [{ role: "user", content: "work" }] }, ctx);
  assert.match(reminderText(transformed.input), /19h 43m/);
  assert.match((await h.events.get("turn_end")({ stopReason: "end_turn" }, ctx)).continue, /Continue working/);

  process.env.HORIZON_TEST_REMAINING = "500";
  assert.equal(await h.events.get("turn_end")({ stopReason: "end_turn" }, ctx), undefined);
});

test("records clean checkpoints and continues after repeated submissions", async (t) => {
  const f = await fixture(t);
  process.env.HORIZON_STATE_PATH = f.statePath;
  process.env.HORIZON_MODE = "on";
  t.after(() => {
    delete process.env.HORIZON_STATE_PATH;
    delete process.env.HORIZON_MODE;
  });
  const h = harness();
  t.after(h.dispose);
  const ctx = context(f, "conv-submit");
  const turnStart = h.events.get("turn_start");
  const turnEnd = h.events.get("turn_end");
  const submit = h.tools.get("submit");

  await turnStart({ input: [{ role: "user", content: "optimize" }] }, ctx);
  const first = await submit.run({ ...ctx, args: { commit: f.commit } });
  assert.match(first, /Submission #1 recorded/);
  assert.match(first, /Update \/tmp\/horizon\/PROGRESS\.md/);
  assert.match(first, /nonterminal/);
  assert.match((await turnEnd({ stopReason: "end_turn" }, ctx)).continue, /Continue working autonomously/);

  await turnStart({ input: [{ role: "user", content: "continue" }] }, ctx);
  const second = await submit.run({ ...ctx, args: { commit: f.commit } });
  assert.match(second, /Submission #2 recorded/);
  assert.match((await turnEnd({ stopReason: "end_turn" }, ctx)).continue, /Checkpointing is nonterminal/);

  const stored = JSON.parse(await readFile(f.statePath, "utf8"));
  assert.equal(stored.conversations["conv-submit"].submissions.length, 2);
  assert.equal(stored.conversations["conv-submit"].submissions[0].commit, f.commit);
  assert.equal(stored.conversations["conv-submit"].submissions[0].repository, f.repo);
  assert.equal(stored.conversations["conv-submit"].submissions[1].commit, f.commit);
});

test("discovers a nested repository and accepts an explicit repository path", async (t) => {
  const f = await fixture(t);
  process.env.HORIZON_STATE_PATH = f.statePath;
  process.env.HORIZON_MODE = "on";
  t.after(() => {
    delete process.env.HORIZON_STATE_PATH;
    delete process.env.HORIZON_MODE;
  });
  const h = harness();
  t.after(h.dispose);
  const submit = h.tools.get("submit");
  const outer = { ...context(f, "conv-nested"), cwd: f.root };

  const discovered = await submit.run({ ...outer, args: { commit: f.commit } });
  assert.match(discovered, new RegExp(`recorded from ${f.repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  const explicit = await submit.run({ ...outer, args: { commit: f.commit, repository: "repo" } });
  assert.match(explicit, /Submission #2 recorded/);
});

test("exports and verifies a checkpoint bundle when configured", async (t) => {
  const f = await fixture(t);
  const checkpointDir = join(f.root, "durable-checkpoints");
  process.env.HORIZON_STATE_PATH = f.statePath;
  process.env.HORIZON_MODE = "on";
  process.env.HORIZON_CHECKPOINT_DIR = checkpointDir;
  t.after(() => {
    delete process.env.HORIZON_STATE_PATH;
    delete process.env.HORIZON_MODE;
    delete process.env.HORIZON_CHECKPOINT_DIR;
  });
  const h = harness();
  t.after(h.dispose);

  const result = await h.tools.get("submit").run({ ...context(f, "conv-bundle"), args: { commit: f.commit } });
  assert.match(result, /Verified external bundle:/);
  const stored = JSON.parse(await readFile(f.statePath, "utf8"));
  const bundle = stored.conversations["conv-bundle"].submissions[0].bundlePath;
  assert.ok(bundle.startsWith(checkpointDir));
  execFileSync("git", ["bundle", "verify", bundle], { cwd: f.repo });
  const manifest = JSON.parse(await readFile(`${bundle}.json`, "utf8"));
  assert.equal(manifest.repository, f.repo);
  assert.equal(manifest.commit, f.commit);
});

test("pauses after three identical completion-only turns", async (t) => {
  const f = await fixture(t);
  process.env.HORIZON_STATE_PATH = f.statePath;
  process.env.HORIZON_MODE = "on";
  t.after(() => {
    delete process.env.HORIZON_STATE_PATH;
    delete process.env.HORIZON_MODE;
  });
  const h = harness();
  t.after(h.dispose);
  const ctx = context(f, "conv-stagnant");
  const turnStart = h.events.get("turn_start");
  const turnEnd = h.events.get("turn_end");
  const event = { stopReason: "end_turn", assistantMessage: "Task complete. Latest clean checkpoint: abc123." };

  await turnStart({ input: [{ role: "user", content: "work" }] }, ctx);
  assert.ok((await turnEnd(event, ctx)).continue);
  await turnStart({ input: [{ role: "user", content: "continue" }] }, ctx);
  assert.ok((await turnEnd(event, ctx)).continue);
  await turnStart({ input: [{ role: "user", content: "continue" }] }, ctx);
  assert.equal(await turnEnd(event, ctx), undefined);

  const stored = JSON.parse(await readFile(f.statePath, "utf8"));
  assert.equal(stored.conversations["conv-stagnant"].pausedForStagnation, true);
});

test("productive tool use resets the stagnation breaker", async (t) => {
  const f = await fixture(t);
  process.env.HORIZON_STATE_PATH = f.statePath;
  process.env.HORIZON_MODE = "on";
  t.after(() => {
    delete process.env.HORIZON_STATE_PATH;
    delete process.env.HORIZON_MODE;
  });
  const h = harness();
  t.after(h.dispose);
  const ctx = context(f, "conv-productive");
  const event = { stopReason: "end_turn", assistantMessage: "Task complete." };

  for (let turn = 0; turn < 4; turn += 1) {
    await h.events.get("turn_start")({ input: [{ role: "user", content: "continue" }] }, ctx);
    await h.events.get("tool_start")({ toolName: "exec_command" }, ctx);
    assert.ok((await h.events.get("turn_end")(event, ctx)).continue);
  }
});

test("rejects dirty checkpoints", async (t) => {
  const f = await fixture(t);
  process.env.HORIZON_STATE_PATH = f.statePath;
  process.env.HORIZON_MODE = "on";
  t.after(() => {
    delete process.env.HORIZON_STATE_PATH;
    delete process.env.HORIZON_MODE;
  });
  const h = harness();
  t.after(h.dispose);
  const ctx = context(f, "conv-cancel");
  const turnStart = h.events.get("turn_start");
  const submit = h.tools.get("submit");

  await writeFile(join(f.repo, "answer.txt"), "dirty\n");
  await turnStart({ input: [{ role: "user", content: "work" }] }, ctx);
  assert.equal((await submit.run({ ...ctx, args: { commit: f.commit } })).status, "error");
  execFileSync("git", ["checkout", "--", "answer.txt"], { cwd: f.repo });

  const result = await submit.run({ ...ctx, args: { commit: f.commit } });
  assert.match(result, /Submission #1 recorded/);
});
