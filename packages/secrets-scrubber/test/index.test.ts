import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import activate, {
  extractOutputPaths,
  isAllowedOutputPath,
  type LettaModApi,
  scrubOutputFile,
  scrubText,
  type ToolEndEvent,
} from "../mods/index.ts";

const OPENAI_KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJ";
const DATABASE_URL = "postgresql://user:password@example.com:5432/db";
const tempDirectories: string[] = [];

function createBackgroundDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "letta-background-"));
  tempDirectories.push(directory);
  return directory;
}

function createHarness(): {
  diagnostics: string[];
  emit(event: ToolEndEvent): Promise<unknown>;
} {
  let handler: ((event: ToolEndEvent) => Promise<unknown> | unknown) | undefined;
  const diagnostics: string[] = [];
  const letta: LettaModApi = {
    capabilities: { events: { tools: true } },
    diagnostics: {
      report(input) {
        diagnostics.push(input.message);
      },
    },
    events: {
      on(_name, nextHandler) {
        handler = nextHandler;
        return () => {
          handler = undefined;
        };
      },
    },
  };
  activate(letta);
  return {
    diagnostics,
    async emit(event) {
      if (!handler) throw new Error("tool_end handler was not registered");
      return handler(event);
    },
  };
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("inline output scrubbing", () => {
  test("redacts multiple secret types and preserves surrounding text", () => {
    const input = `openai=${OPENAI_KEY}\ndatabase=${DATABASE_URL}\nkeep=this`;
    const result = scrubText(input);

    expect(result.changed).toBe(true);
    expect(result.output).not.toContain(OPENAI_KEY);
    expect(result.output).not.toContain(DATABASE_URL);
    expect(result.output).toContain("[REDACTED: API Secret Key (sk-)]");
    expect(result.output).toContain("[REDACTED: Database Connection String]");
    expect(result.output).toContain("keep=this");
  });

  test("redacts contextual passwords, generic keys, and authorization headers", () => {
    const input = [
      'password: "hunter2"',
      "OPENAI_API_KEY=unstructured-but-sensitive-value",
      "Authorization: Basic dXNlcjpwYXNzd29yZA==",
      "Proxy-Authorization: token opaque-session-credential",
    ].join("\n");

    const result = scrubText(input);

    expect(result.changed).toBe(true);
    expect(result.output).toBe(
      [
        'password: "[REDACTED: Credential]"',
        "OPENAI_API_KEY=[REDACTED: Credential]",
        "Authorization: Basic [REDACTED: Authorization]",
        "Proxy-Authorization: token [REDACTED: Authorization]",
      ].join("\n"),
    );
  });

  test("does not redact its own replacement markers again", () => {
    const input = "password=[REDACTED: Credential]";
    expect(scrubText(input)).toEqual({ changed: false, output: input });
  });

  test("returns an event replacement while preserving the tool status", async () => {
    const harness = createHarness();
    const result = await harness.emit({
      args: {},
      output: `request failed with ${OPENAI_KEY}`,
      status: "error",
      toolName: "Bash",
    });

    expect(result).toEqual({
      result: {
        status: "error",
        output: "request failed with [REDACTED: API Secret Key (sk-)]",
      },
    });
    expect(harness.diagnostics).toEqual([]);
  });

  test("does not replace clean output", async () => {
    const harness = createHarness();
    expect(
      await harness.emit({
        args: {},
        output: "build completed successfully",
        status: "success",
        toolName: "Bash",
      }),
    ).toBeUndefined();
  });
});

describe("referenced output file scrubbing", () => {
  test("extracts only exact tool breadcrumb lines", () => {
    expect(
      extractOutputPaths(
        "summary\n[Full output written to: /tmp/example.txt]\nOutput file: /tmp/task.log",
      ),
    ).toEqual(["/tmp/example.txt", "/tmp/task.log"]);
    expect(extractOutputPaths("the Output file: /tmp/not-a-breadcrumb is inline")).toEqual([]);
  });

  test("rewrites an allowed background output file", () => {
    const directory = createBackgroundDirectory();
    const path = join(directory, "bash_1.log");
    writeFileSync(path, `before ${OPENAI_KEY} after`, { mode: 0o600 });

    expect(isAllowedOutputPath(path)).toBe(true);
    expect(scrubOutputFile(path)).toBe("changed");
    expect(readFileSync(path, "utf8")).toBe(
      "before [REDACTED: API Secret Key (sk-)] after",
    );
  });

  test("rejects unexpected names, directories, and symlinks", () => {
    const directory = createBackgroundDirectory();
    const outside = mkdtempSync(join(tmpdir(), "secret-scan-outside-"));
    tempDirectories.push(outside);
    const target = join(outside, "target.log");
    const symlink = join(directory, "bash_2.log");
    writeFileSync(target, OPENAI_KEY, { mode: 0o600 });
    symlinkSync(target, symlink);

    expect(isAllowedOutputPath(join(directory, "arbitrary.log"))).toBe(false);
    expect(isAllowedOutputPath(join(outside, "bash_1.log"))).toBe(false);
    expect(scrubOutputFile(symlink)).toBe("rejected");
    expect(readFileSync(target, "utf8")).toBe(OPENAI_KEY);
  });

  test("withholds a breadcrumb when an allowed path is a symlink", async () => {
    const directory = createBackgroundDirectory();
    const outside = mkdtempSync(join(tmpdir(), "secret-scan-outside-"));
    tempDirectories.push(outside);
    const target = join(outside, "target.log");
    const symlink = join(directory, "bash_3.log");
    writeFileSync(target, OPENAI_KEY, { mode: 0o600 });
    symlinkSync(target, symlink);
    const harness = createHarness();

    expect(
      await harness.emit({
        args: { run_in_background: true },
        output: `Command running in background with ID: bash_3\nOutput file: ${symlink}`,
        status: "success",
        toolName: "Bash",
      }),
    ).toBeUndefined();

    const result = await harness.emit({
      args: { task_id: "bash_3" },
      output: JSON.stringify({ message: "done", status: "completed" }),
      status: "success",
      toolName: "TaskOutput",
    });

    expect(result).toEqual({
      result: {
        status: "success",
        output:
          "[Tool output withheld because the secrets scrubber could not inspect it safely.]",
      },
    });
    expect(harness.diagnostics).toHaveLength(1);
    expect(readFileSync(target, "utf8")).toBe(OPENAI_KEY);
  });

  test("tracks a running background file and scrubs it after completion", async () => {
    const directory = createBackgroundDirectory();
    const path = join(directory, "task_1.log");
    writeFileSync(path, `first=${OPENAI_KEY}`, { mode: 0o600 });
    const harness = createHarness();

    await harness.emit({
      args: { run_in_background: true },
      output: `Task running in background with task ID: task_1\nOutput file: ${path}`,
      status: "success",
      toolName: "Agent",
    });
    expect(readFileSync(path, "utf8")).toContain(OPENAI_KEY);

    const runningOutput = JSON.stringify({
      message: `first=${OPENAI_KEY}`,
      status: "running",
    });
    const runningResult = await harness.emit({
      args: { task_id: "task_1" },
      output: runningOutput,
      status: "success",
      toolName: "TaskOutput",
    });
    expect(runningResult).toEqual({
      result: {
        status: "success",
        output: JSON.stringify({
          message: "first=[REDACTED: API Secret Key (sk-)]",
          status: "running",
        }),
      },
    });
    expect(readFileSync(path, "utf8")).toContain(OPENAI_KEY);

    writeFileSync(path, `later=${DATABASE_URL}`, { mode: 0o600 });
    const output = JSON.stringify({
      message: `later=${DATABASE_URL}`,
      status: "completed",
    });
    const result = await harness.emit({
      args: { task_id: "task_1" },
      output,
      status: "success",
      toolName: "TaskOutput",
    });

    expect(readFileSync(path, "utf8")).not.toContain(DATABASE_URL);
    expect(result).toEqual({
      result: {
        status: "success",
        output: JSON.stringify({
          message: "later=[REDACTED: Database Connection String]",
          status: "completed",
        }),
      },
    });
  });
});
