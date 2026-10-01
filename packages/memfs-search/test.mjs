import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import activate, { __test } from "./mods/index.mjs";

const execFileAsync = promisify(execFile);
const originalEnv = { ...process.env };

test.afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

test("memory candidates prefer scoped MemFS and use a cross-platform home", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "memfs-search-"));
  const scoped = path.join(root, "scoped-memory");
  await mkdir(scoped);
  delete process.env.MEMORY_DIR;
  delete process.env.HOME;
  process.env.USERPROFILE = root;

  const candidates = __test.candidateMemoryDirs(
    {
      memfs: { memoryDir: scoped },
      agent: { id: "agent-test" },
    },
    { homeDir: root },
  );

  assert.equal(candidates[0].source, "ctx.memfs.memoryDir");
  assert.equal(candidates[0].path, scoped);
  assert.deepEqual(
    candidates.slice(1).map((candidate) => candidate.path),
    [
      path.join(root, ".letta", "lc-local-backend", "memfs", "agent-test", "memory"),
      path.join(root, ".letta", "agents", "agent-test", "memory"),
    ],
  );
  await rm(root, { recursive: true, force: true });
});

test("status reports available fields and every candidate without env values", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "memfs-search-status-"));
  const memory = path.join(root, "memory");
  await mkdir(memory);
  await writeFile(path.join(memory, "note.md"), "hello");
  delete process.env.MEMORY_DIR;
  delete process.env.AGENT_ID;
  delete process.env.HOME;
  process.env.USERPROFILE = root;

  let registration;
  activate({
    capabilities: { tools: true },
    tools: { register(value) { registration = value; } },
  });
  const output = await registration.run({
    args: { action: "status" },
    agent: { id: "agent-test" },
    memfs: { memoryDir: memory },
  });

  assert.match(output, /ctx\.memfs\.memoryDir: set/);
  assert.match(output, /ctx\.agent\.id: set/);
  assert.match(output, /env\.HOME: not set/);
  assert.match(output, /env\.USERPROFILE: set/);
  assert.match(output, /ctx\.memfs\.memoryDir: .*memory \(exists: yes\)/);
  assert.doesNotMatch(output, new RegExp(`USERPROFILE: ${root}`));
  assert.match(output, /markdown_files: 1/);
  await rm(root, { recursive: true, force: true });
});

test("QMD lookup uses PATH directly and prepends with the platform delimiter", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "memfs-search-bin-"));
  const executable = path.join(root, "qmd");
  await writeFile(executable, "#!/bin/sh\nexit 0\n");
  await chmod(executable, 0o755);

  const resolved = await __test.resolveExecutable("qmd", {
    platform: process.platform,
    env: { PATH: root },
  });
  assert.equal(resolved, executable);

  const env = __test.qmdEnv(root);
  assert.equal(env.PATH.split(path.delimiter)[0], root);
  await rm(root, { recursive: true, force: true });
});

test("Windows lookup prefers PowerShell shims and keeps command-shim args out of code", async () => {
  const names = __test.executableNames("qmd", "win32", {
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
  });
  assert.ok(names.indexOf("qmd.ps1") < names.indexOf("qmd.cmd"));

  const ps1 = __test.commandInvocation("C:\\bin\\qmd.ps1", ["query", "a&b"], {
    platform: "win32",
  });
  assert.equal(ps1.executable, "powershell.exe");
  assert.deepEqual(ps1.args.slice(-3), ["C:\\bin\\qmd.ps1", "query", "a&b"]);

  const root = await mkdtemp(path.join(tmpdir(), "memfs-search-powershell-"));
  const fakePowerShell = path.join(root, "powershell.exe");
  await writeFile(
    fakePowerShell,
    `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({ argv: process.argv.slice(2), path: process.env.LETTA_QMD_SHIM_PATH, args: JSON.parse(process.env.LETTA_QMD_SHIM_ARGS) }));\n`,
  );
  await chmod(fakePowerShell, 0o755);

  const cmd = __test.commandInvocation("C:\\bin\\qmd.cmd", ["query", "a&b"], {
    platform: "win32",
    powerShellExecutable: fakePowerShell,
  });
  const { stdout } = await execFileAsync(cmd.executable, cmd.args, {
    env: { ...process.env, ...cmd.env },
  });
  const child = JSON.parse(stdout);

  assert.equal(child.path, "C:\\bin\\qmd.cmd");
  assert.deepEqual(child.args, ["query", "a&b"]);
  assert.equal(child.argv.at(-1), cmd.args.at(-1));
  assert.ok(!child.argv.includes("C:\\bin\\qmd.cmd"));
  assert.ok(!child.argv.includes("a&b"));
  await rm(root, { recursive: true, force: true });
});
