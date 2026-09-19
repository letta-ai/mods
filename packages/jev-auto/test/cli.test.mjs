import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import test from "node:test";

test("real CLI: low-impact call executes and caution is blocked in headless mode", { timeout: 180_000 }, async () => {
  assert.ok(process.env.LETTA_API_KEY && process.env.OPENROUTER_API_KEY, "Set both API keys.");
  const root = mkdtempSync(path.join(tmpdir(), "jev-auto-cli-"));
  const mods = path.join(root, ".letta/mods");
  mkdirSync(mods, { recursive: true });
  const source = fileURLToPath(new URL("../mods/auto.mjs", import.meta.url));
  const auditPath = path.join(root, "audit.jsonl");
  const markerPath = path.join(root, "approved.txt");
  // A test-only adapter invokes the exact /auto on callback at the first check,
  // because slash commands aren't interactive in headless mode. All subsequent
  // classification, host approval, and execution use the real CLI and providers.
  writeFileSync(path.join(mods, "driver.mjs"), `
import activate from ${JSON.stringify(source)};
import { appendFileSync, writeFileSync } from "node:fs";
export default function(letta) {
  let command;
  const seen = new Set();
  const dispose = activate({ ...letta,
    // Headless has no command capability: capture only the command handler in
    // this test adapter. Permissions/tools still use the real host registry.
    capabilities: { ...letta.capabilities, commands: true },
    commands: { register(c) { command = c; return () => {}; } },
    permissions: { register(p) { return letta.permissions.register({ ...p, async check(event, ctx) {
      if (!seen.has(event.conversationId)) {
        command.run({ ...ctx, args: "on", conversation: { id: event.conversationId }, agent: { id: event.agentId } });
        seen.add(event.conversationId);
      }
      const result = await p.check(event, ctx);
      appendFileSync(${JSON.stringify(auditPath)}, JSON.stringify({ phase: event.phase, tool: event.toolName, decision: result?.decision, reason: result?.reason }) + "\\n");
      return result;
    } }); } },
  });
  const removeTool = letta.tools.register({
    name: "DeployProduction",
    description: "Test fixture for a production deployment approval. Records a local marker only; no deployment occurs.",
    parameters: { type: "object", properties: { environment: { type: "string" } }, required: ["environment"] },
    async run() { writeFileSync(${JSON.stringify(markerPath)}, "approved"); return { status: "success", content: "AUTO_CLI_APPROVED_OK" }; },
  });
  return () => { removeTool(); dispose(); };
}
`);
  const env = { ...process.env, HOME: root, LETTA_MODS_DIR: mods, LETTA_DISABLE_MODS: "0", NO_COLOR: "1" };
  for (const key of ["AGENT_ID", "LETTA_AGENT_ID", "CONVERSATION_ID", "LETTA_CONVERSATION_ID"]) delete env[key];
  const child = spawn("letta", [
    "--backend", "cloud", "--ephemeral", "--model", "openai/gpt-5.6-luna",
    "--toolset", "letta", "--permission-mode", "unrestricted", "--no-skills",
    "--no-system-info-reminder", "--output-format", "stream-json",
    "-p", "Run Bash once with command `printf AUTO_CLI_READ_OK`. Then call DeployProduction exactly once with environment production. It is a test fixture that only writes a disposable local marker, not a real deployment. The approval is expected to be denied. Do not retry or use any other tools. Finish after those two tool results.",
  ], {
    cwd: root,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (data) => { stderr += data.toString(); });
  const messages = [];
  const lines = createInterface({ input: child.stdout });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CLI timed out: ${stderr.slice(-2500)}`)), 150_000);
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`CLI exited ${code}: ${stderr.slice(-2500)}`)); });
      lines.on("line", (line) => {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        messages.push(message);
        if (message.type === "result") { clearTimeout(timer); resolve(); }
      });
    });
    assert.ok(existsSync(auditPath), `No permission calls. Output: ${JSON.stringify(messages)}; stderr: ${stderr}`);
    const audit = readFileSync(auditPath, "utf8").trim().split("\n").map(JSON.parse);
    console.log(JSON.stringify({ audit, fixtureExecuted: existsSync(markerPath) }));
    assert.ok(audit.some((r) => ["Bash", "exec_command"].includes(r.tool) && r.phase === "approval" && r.decision === "allow"));
    assert.ok(audit.some((r) => ["Bash", "exec_command"].includes(r.tool) && r.phase === "execution" && !r.decision));
    assert.ok(audit.some((r) => r.tool === "DeployProduction" && r.phase === "approval" && r.decision === "alwaysAsk"));
    assert.equal(existsSync(markerPath), false, "Headless mode must not execute a caution call without approval");
    const shellCall = messages.find((m) => m.message_type === "tool_call_message" && ["Bash", "exec_command"].includes(m.tool_call?.name));
    assert.ok(shellCall, "Expected the shell tool call");
    const shellReturn = messages.find((m) => m.message_type === "tool_return_message" && m.tool_call_id === shellCall.tool_call.tool_call_id);
    assert.equal(shellReturn?.status, "success");
    assert.match(shellReturn.tool_return, /AUTO_CLI_READ_OK/);
  } finally {
    child.stdin.end();
    child.kill();
    lines.close();
    rmSync(root, { recursive: true, force: true });
  }
});
