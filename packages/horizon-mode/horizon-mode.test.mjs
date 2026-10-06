import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import activate, { pruneStateFiles } from "./mods/index.ts";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "letta-horizon-mode-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateDir = join(root, "state");
  const memoryDir = join(root, "memory");
  const repo = join(root, "repo");
  await mkdir(join(memoryDir, "reference", "task"), { recursive: true });
  await mkdir(repo);
  await writeFile(join(memoryDir, "reference", "MEMORY.md"), "# Reference index\n- [Task](task/MEMORY.md)\n");
  await writeFile(join(memoryDir, "reference", "task", "MEMORY.md"), "# Task memory\nMeasure the real objective.\n");
  const commit = await initRepository(repo, { "answer.txt": "first\n" });
  return { root, stateDir, memoryDir, repo, commit };
}

async function initRepository(repo, files) {
  execFileSync("git", ["init", "-q"], { cwd: repo });
  for (const [name, content] of Object.entries(files)) await writeFile(join(repo, name), content);
  execFileSync("git", ["add", ...Object.keys(files)], { cwd: repo });
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
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
}

async function storedState(f, conversationId) {
  return JSON.parse(await readFile(join(f.stateDir, `${conversationId}.json`), "utf8"));
}

function harness(capabilities = {
  tools: true,
  commands: true,
  events: { turns: true, tools: true },
}, activateMod = activate) {
  const tools = new Map();
  const commands = new Map();
  const events = new Map();
  const disposers = [];
  const dispose = activateMod({
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
  process.env.HORIZON_STATE_DIR = f.stateDir;
  process.env.HORIZON_MODE = "off";
  t.after(() => {
    delete process.env.HORIZON_STATE_DIR;
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
  process.env.HORIZON_STATE_DIR = f.stateDir;
  t.after(() => delete process.env.HORIZON_STATE_DIR);
  const h = harness({ tools: true, commands: true, events: { turns: false, tools: false } });
  t.after(h.dispose);

  assert.equal(h.tools.size, 0);
  assert.equal(h.commands.size, 0);
  assert.equal(h.events.size, 0);
});

test("injects reminders only while Horizon mode is active", async (t) => {
  const f = await fixture(t);
  process.env.HORIZON_STATE_DIR = f.stateDir;
  process.env.HORIZON_MODE = "off";
  t.after(() => {
    delete process.env.HORIZON_STATE_DIR;
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
  process.env.HORIZON_STATE_DIR = f.stateDir;
  delete process.env.HORIZON_MODE;
  process.env.HORIZON_TEST_REMAINING = "71000";
  t.after(() => {
    process.env.PATH = previousPath;
    delete process.env.HORIZON_STATE_DIR;
    delete process.env.HORIZON_TEST_REMAINING;
  });
  const h = harness();
  t.after(h.dispose);
  const ctx = context(f, "conv-auto");

  const transformed = await h.events.get("turn_start")({ input: [{ role: "user", content: "work" }] }, ctx);
  assert.match(reminderText(transformed.input), /19h 43m \(100%\)/);
  assert.match((await h.events.get("turn_end")({ stopReason: "end_turn" }, ctx)).continue, /Continue working/);

  process.env.HORIZON_TEST_REMAINING = "500";
  assert.equal(await h.events.get("turn_end")({ stopReason: "end_turn" }, ctx), undefined);
});

test("records clean checkpoints and continues after repeated submissions", async (t) => {
  const f = await fixture(t);
  process.env.HORIZON_STATE_DIR = f.stateDir;
  process.env.HORIZON_MODE = "on";
  t.after(() => {
    delete process.env.HORIZON_STATE_DIR;
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

  const stored = await storedState(f, "conv-submit");
  assert.equal(stored.submissions.length, 2);
  assert.equal(stored.submissions[0].commit, f.commit);
  assert.equal(stored.submissions[0].repository, f.repo);
  assert.equal(stored.submissions[1].commit, f.commit);
});

test("discovers a nested repository and accepts an explicit repository path", async (t) => {
  const f = await fixture(t);
  process.env.HORIZON_STATE_DIR = f.stateDir;
  process.env.HORIZON_MODE = "on";
  t.after(() => {
    delete process.env.HORIZON_STATE_DIR;
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
  process.env.HORIZON_STATE_DIR = f.stateDir;
  process.env.HORIZON_MODE = "on";
  process.env.HORIZON_CHECKPOINT_DIR = checkpointDir;
  t.after(() => {
    delete process.env.HORIZON_STATE_DIR;
    delete process.env.HORIZON_MODE;
    delete process.env.HORIZON_CHECKPOINT_DIR;
  });
  const h = harness();
  t.after(h.dispose);

  const result = await h.tools.get("submit").run({ ...context(f, "conv-bundle"), args: { commit: f.commit } });
  assert.match(result, /Verified external bundle:/);
  const bundle = (await storedState(f, "conv-bundle")).submissions[0].bundlePath;
  assert.ok(bundle.startsWith(checkpointDir));
  execFileSync("git", ["bundle", "verify", bundle], { cwd: f.repo });
  const manifest = JSON.parse(await readFile(`${bundle}.json`, "utf8"));
  assert.equal(manifest.repository, f.repo);
  assert.equal(manifest.commit, f.commit);
});

test("pauses after three turns without tool calls or a new checkpoint, whatever the wording", async (t) => {
  const f = await fixture(t);
  process.env.HORIZON_STATE_DIR = f.stateDir;
  process.env.HORIZON_MODE = "on";
  t.after(() => {
    delete process.env.HORIZON_STATE_DIR;
    delete process.env.HORIZON_MODE;
  });
  const h = harness();
  t.after(h.dispose);
  const ctx = context(f, "conv-stagnant");
  const turnStart = h.events.get("turn_start");
  const turnEnd = h.events.get("turn_end");
  const toolStart = h.events.get("tool_start");
  const submit = h.tools.get("submit");

  // A first checkpoint is progress; resubmitting the same commit is not.
  await turnStart({ input: [{ role: "user", content: "work" }] }, ctx);
  await toolStart({ toolName: "submit" }, ctx);
  await submit.run({ ...ctx, args: { commit: f.commit } });
  let result = await turnEnd({ stopReason: "end_turn", assistantMessage: "Submitted." }, ctx);
  assert.ok(result.continue);

  const messages = ["Task complete.", "All done — waiting on you.", "I resubmitted the same commit."];
  for (const [index, assistantMessage] of messages.entries()) {
    await turnStart({ input: [{ role: "user", content: result.continue }] }, ctx);
    if (index === 2) {
      await toolStart({ toolName: "submit" }, ctx);
      await submit.run({ ...ctx, args: { commit: f.commit } });
    }
    result = await turnEnd({ stopReason: "end_turn", assistantMessage }, ctx);
    if (index < 2) assert.ok(result.continue, `turn ${index + 1} should continue`);
  }
  assert.equal(result, undefined);
  assert.equal((await storedState(f, "conv-stagnant")).pausedForStagnation, true);

  // New user input restarts the count.
  await turnStart({ input: [{ role: "user", content: "keep going" }] }, ctx);
  assert.ok((await turnEnd({ stopReason: "end_turn", assistantMessage: "Done." }, ctx)).continue);
});

test("does not inject a second reminder into continuation turns", async (t) => {
  const f = await fixture(t);
  process.env.HORIZON_STATE_DIR = f.stateDir;
  process.env.HORIZON_MODE = "on";
  t.after(() => {
    delete process.env.HORIZON_STATE_DIR;
    delete process.env.HORIZON_MODE;
  });
  const h = harness();
  t.after(h.dispose);
  const ctx = context(f, "conv-continuation");

  await h.events.get("turn_start")({ input: [{ role: "user", content: "work" }] }, ctx);
  await h.events.get("tool_start")({ toolName: "exec_command" }, ctx);
  const { continue: text } = await h.events.get("turn_end")({ stopReason: "end_turn" }, ctx);
  const input = [{ type: "message", role: "user", content: text }];
  const result = await h.events.get("turn_start")({ input }, ctx);
  assert.equal(result, undefined);
  assert.equal(input[0].content, text);
  assert.equal(text.split("Horizon mode is active").length - 1, 1);
});

test("auto mode uses the first observed sandbox-timer value as the total budget", async (t) => {
  const f = await fixture(t);
  const bin = join(f.root, "bin");
  const timer = join(bin, "sandbox-timer");
  await mkdir(bin);
  await writeFile(timer, "#!/bin/sh\nprintf '%s\\n' \"${HORIZON_TEST_REMAINING}\"\n");
  await chmod(timer, 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  process.env.HORIZON_STATE_DIR = f.stateDir;
  delete process.env.HORIZON_MODE;
  delete process.env.TASK_BUDGET_SECS;
  process.env.HORIZON_TEST_REMAINING = "7200";
  t.after(() => {
    process.env.PATH = previousPath;
    delete process.env.HORIZON_STATE_DIR;
    delete process.env.HORIZON_TEST_REMAINING;
  });
  const h = harness();
  t.after(h.dispose);
  const ctx = context(f, "conv-budget");

  const first = await h.events.get("turn_start")({ input: [{ role: "user", content: "work" }] }, ctx);
  assert.match(reminderText(first.input), /Remaining task budget: 2h 0m \(100%\)/);
  assert.equal((await storedState(f, "conv-budget")).totalBudgetSecs, 7200);

  process.env.HORIZON_TEST_REMAINING = "3600";
  assert.match((await h.events.get("turn_end")({ stopReason: "end_turn" }, ctx)).continue, /1h 0m \(50%\)/);
});

test("productive tool use resets the stagnation breaker", async (t) => {
  const f = await fixture(t);
  process.env.HORIZON_STATE_DIR = f.stateDir;
  process.env.HORIZON_MODE = "on";
  t.after(() => {
    delete process.env.HORIZON_STATE_DIR;
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
  process.env.HORIZON_STATE_DIR = f.stateDir;
  process.env.HORIZON_MODE = "on";
  t.after(() => {
    delete process.env.HORIZON_STATE_DIR;
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

test("submit defaults to the workspace repository when nested repositories also match", async (t) => {
  const f = await fixture(t);
  process.env.HORIZON_STATE_DIR = f.stateDir;
  process.env.HORIZON_MODE = "on";
  t.after(() => {
    delete process.env.HORIZON_STATE_DIR;
    delete process.env.HORIZON_MODE;
  });
  const outer = join(f.root, "outer");
  await mkdir(join(outer, "inner"), { recursive: true });
  await initRepository(join(outer, "inner"), { "inner.txt": "inner\n" });
  const outerCommit = await initRepository(outer, { ".gitignore": "inner/\n" });
  const h = harness();
  t.after(h.dispose);
  const submit = h.tools.get("submit");

  const result = await submit.run({ ...context(f, "conv-head"), cwd: outer, args: { commit: "HEAD" } });
  assert.match(result, new RegExp(`recorded from ${outer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} at commit ${outerCommit.slice(0, 12)}`));

  // From a non-repository root, HEAD is still ambiguous across nested repositories.
  const ambiguous = await submit.run({ ...context(f, "conv-head"), cwd: f.root, args: { commit: "HEAD" } });
  assert.equal(ambiguous.status, "error");
  assert.match(ambiguous.content, /ambiguous/);
});

test("stores each conversation in its own file so separate processes do not clobber each other", async (t) => {
  const f = await fixture(t);
  process.env.HORIZON_STATE_DIR = f.stateDir;
  process.env.HORIZON_MODE = "on";
  t.after(() => {
    delete process.env.HORIZON_STATE_DIR;
    delete process.env.HORIZON_MODE;
  });
  // A second module instance stands in for a second Letta Code process.
  const { default: activateOther } = await import("./mods/index.ts?second-process");
  const first = harness();
  const second = harness(undefined, activateOther);
  t.after(first.dispose);
  t.after(second.dispose);

  await first.tools.get("submit").run({ ...context(f, "conv-a"), args: { commit: f.commit } });
  await second.tools.get("submit").run({ ...context(f, "conv-b"), args: { commit: f.commit } });
  await first.commands.get("horizon").run({ ...context(f, "conv-a"), args: "status" });
  await first.events.get("turn_start")({ input: [{ role: "user", content: "work" }] }, context(f, "conv-a"));

  assert.equal((await storedState(f, "conv-a")).submissionCount, 1);
  assert.equal((await storedState(f, "conv-b")).submissionCount, 1);
  assert.deepEqual((await readdir(f.stateDir)).sort(), ["conv-a.json", "conv-b.json"]);
});

test("caps submission history and prunes old conversation state", async (t) => {
  const f = await fixture(t);
  process.env.HORIZON_STATE_DIR = f.stateDir;
  process.env.HORIZON_MODE = "on";
  t.after(() => {
    delete process.env.HORIZON_STATE_DIR;
    delete process.env.HORIZON_MODE;
  });
  await mkdir(f.stateDir, { recursive: true });
  const old = Array.from({ length: 60 }, (_, index) => ({
    commit: f.commit,
    subject: `old ${index}`,
    repository: f.repo,
    recordedAt: new Date(0).toISOString(),
  }));
  await writeFile(join(f.stateDir, "conv-history.json"), JSON.stringify({ mode: "on", submissionCount: 60, submissions: old }));
  const h = harness();
  t.after(h.dispose);

  assert.match(await h.tools.get("submit").run({ ...context(f, "conv-history"), args: { commit: f.commit } }), /Submission #61/);
  const stored = await storedState(f, "conv-history");
  assert.equal(stored.submissions.length, 50);
  assert.equal(stored.submissions.at(-1).subject, "initial checkpoint");

  for (const [index, name] of ["conv-old.json", "conv-mid.json"].entries()) {
    await writeFile(join(f.stateDir, name), "{}");
    await utimes(join(f.stateDir, name), index + 1, index + 1);
  }
  pruneStateFiles(2);
  assert.deepEqual((await readdir(f.stateDir)).sort(), ["conv-history.json", "conv-mid.json"]);
});
