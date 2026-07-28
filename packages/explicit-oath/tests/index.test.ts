import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const execFile = mock();

mock.module("node:child_process", () => ({ execFile }));
mock.module("node:util", () => ({
  promisify: () => execFile,
}));

const { default: activate } = await import("../mods/index.ts");

function registerTool(capabilities = { tools: true }) {
  let tool: any;
  const dispose = mock();
  const register = mock((definition: any) => {
    tool = definition;
    return dispose;
  });
  const result = activate({ capabilities, tools: { register } });
  return { tool, register, dispose, result };
}

function context(args: Record<string, unknown> = {}) {
  return {
    args: {
      promise: "Report whether the deployment completed successfully",
      due_at: "in 20m",
      delivery_instructions: "Check deployment status and report the final state with evidence.",
      ...args,
    },
    agent: { id: "agent-test" },
    conversation: { id: "conversation-test" },
    cwd: "/workspace/project",
    signal: new AbortController().signal,
  };
}

function invocationArgs(): string[] {
  const call = execFile.mock.calls[0];
  expect(call?.[0]).toBe("letta");
  return call?.[1] as string[];
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

beforeEach(() => {
  execFile.mockReset();
  execFile.mockResolvedValue({
    stdout: '{"id":"schedule-test-123"}\n',
    stderr: "",
  });
});

afterEach(() => {
  delete process.env.AGENT_ID;
  delete process.env.LETTA_AGENT_ID;
  delete process.env.CONVERSATION_ID;
  delete process.env.LETTA_CONVERSATION_ID;
});

describe("explicit-oath mod", () => {
  test("does nothing without the tools capability", () => {
    const { register, result } = registerTool({ tools: false });

    expect(result).toBeUndefined();
    expect(register).not.toHaveBeenCalled();
  });

  test("registers one approval-gated schedule_oath tool", () => {
    const { tool, register, result, dispose } = registerTool();

    expect(register).toHaveBeenCalledTimes(1);
    expect(tool.name).toBe("schedule_oath");
    expect(tool.requiresApproval).toBe(true);
    expect(tool.parallelSafe).toBe(false);
    expect(tool.parameters.required).toEqual([
      "promise",
      "due_at",
      "delivery_instructions",
    ]);
    expect(result).toBe(dispose);
  });

  test("schedules the current agent and conversation", async () => {
    const { tool } = registerTool();
    const ctx = context();
    const result = await tool.run(ctx);

    expect(result).toBe(
      "Oath scheduled for in 20m (schedule schedule-test-123).",
    );
    expect(execFile).toHaveBeenCalledTimes(1);

    const args = invocationArgs();
    expect(args.slice(0, 2)).toEqual(["cron", "add"]);
    expect(valueAfter(args, "--agent")).toBe("agent-test");
    expect(valueAfter(args, "--conversation")).toBe("conversation-test");
    expect(valueAfter(args, "--at")).toBe("in 20m");
    expect(valueAfter(args, "--description")).toContain(
      "Report whether the deployment completed successfully",
    );
    expect(valueAfter(args, "--prompt")).toContain(
      "Check deployment status and report the final state with evidence.",
    );
    expect(valueAfter(args, "--prompt")).toContain(
      "Original working directory: /workspace/project",
    );

    const options = execFile.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(options.cwd).toBe("/workspace/project");
    expect(options.signal).toBe(ctx.signal);
  });

  test("passes optional runner and computer placement", async () => {
    const { tool } = registerTool();
    await tool.run(context({ runner: "cloud", computer: "device-test" }));

    const args = invocationArgs();
    expect(valueAfter(args, "--runner")).toBe("cloud");
    expect(valueAfter(args, "--computer")).toBe("device-test");
  });

  test("uses environment IDs when scoped IDs are unavailable", async () => {
    process.env.AGENT_ID = "agent-env";
    process.env.CONVERSATION_ID = "conversation-env";
    const { tool } = registerTool();
    const ctx = context();
    ctx.agent = {} as any;
    ctx.conversation = {} as any;

    await tool.run(ctx);

    const args = invocationArgs();
    expect(valueAfter(args, "--agent")).toBe("agent-env");
    expect(valueAfter(args, "--conversation")).toBe("conversation-env");
  });

  test("rejects missing required values before invoking the CLI", async () => {
    const { tool } = registerTool();
    const result = await tool.run(context({ promise: "  " }));

    expect(result).toEqual({
      status: "error",
      content: "promise, due_at, and delivery_instructions are required",
    });
    expect(execFile).not.toHaveBeenCalled();
  });

  test("rejects missing agent or conversation context", async () => {
    const { tool } = registerTool();
    const ctx = context();
    ctx.agent = {} as any;
    ctx.conversation = {} as any;
    const result = await tool.run(ctx);

    expect(result).toEqual({
      status: "error",
      content: "could not resolve the current agent or conversation",
    });
    expect(execFile).not.toHaveBeenCalled();
  });

  test("rejects a computer target with the local runner", async () => {
    const { tool } = registerTool();
    const result = await tool.run(
      context({ runner: "local", computer: "device-test" }),
    );

    expect(result).toEqual({
      status: "error",
      content: "computer can only be used with the cloud runner",
    });
    expect(execFile).not.toHaveBeenCalled();
  });

  test("returns a concise CLI error", async () => {
    execFile.mockRejectedValue({ stderr: "scheduler unavailable\n" });
    const { tool } = registerTool();
    const result = await tool.run(context());

    expect(result).toEqual({
      status: "error",
      content: "could not schedule oath: scheduler unavailable",
    });
  });

  test("handles valid CLI output without a schedule ID", async () => {
    execFile.mockResolvedValue({ stdout: "scheduled\n", stderr: "" });
    const { tool } = registerTool();
    const result = await tool.run(context());

    expect(result).toBe("Oath scheduled for in 20m.");
  });
});
