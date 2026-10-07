import { afterEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
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
const SENTINEL = "\nwriter-finished\n";
const tempDirectories: string[] = [];

function createBackgroundDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "letta-background-"));
  tempDirectories.push(directory);
  return directory;
}

function createOverflowFile(content: string): string {
  const projects = join(homedir(), ".letta", "projects");
  mkdirSync(projects, { recursive: true });
  const project = mkdtempSync(join(projects, "secrets-scrubber-test-"));
  tempDirectories.push(project);
  const directory = join(project, "agent-tools");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "bash-12345678-1234-4123-8123-123456789abc.txt");
  writeFileSync(path, content, { mode: 0o600 });
  return path;
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

  test("never rewrites a background output file through the exported scanner", () => {
    const directory = createBackgroundDirectory();
    const path = join(directory, "bash_1.log");
    const original = `before ${OPENAI_KEY} after`;
    writeFileSync(path, original, { mode: 0o600 });

    expect(isAllowedOutputPath(path)).toBe(true);
    expect(scrubOutputFile(path)).toBe("unchanged");
    expect(readFileSync(path, "utf8")).toBe(original);
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

  test("still redacts immutable overflow files", async () => {
    const path = createOverflowFile(`before ${OPENAI_KEY} after`);
    const harness = createHarness();
    const result = await harness.emit({
      args: {},
      output: `[Full output written to: ${path}]`,
      status: "success",
      toolName: "Bash",
    });

    expect(result).toBeUndefined();
    expect(readFileSync(path, "utf8")).toBe(
      "before [REDACTED: API Secret Key (sk-)] after",
    );
    expect(harness.diagnostics).toEqual([]);
  });

  test("fails closed for an immutable overflow symlink without changing its target", async () => {
    const path = createOverflowFile("placeholder");
    const outside = mkdtempSync(join(tmpdir(), "secret-scan-outside-"));
    tempDirectories.push(outside);
    const target = join(outside, "target.txt");
    writeFileSync(target, OPENAI_KEY, { mode: 0o600 });
    rmSync(path);
    symlinkSync(target, path);
    const harness = createHarness();
    const result = await harness.emit({
      args: {},
      output: `[Full output written to: ${path}]`,
      status: "success",
      toolName: "Bash",
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

  test.each([
    ["current Bash launch", "Bash", "Command is still running with task ID: bash_1"],
    ["legacy Bash launch", "Bash", "Command running in background with ID: bash_1"],
    ["Task breadcrumb", "Task", "Task running in background with task ID: bash_1"],
    ["Monitor breadcrumb", "Monitor", "Monitor started (task bash_1, persistent)"],
    ["Workflow breadcrumb", "Workflow", "Workflow launched in background. Task ID: bash_1"],
  ])("does not rewrite a mutable background log for %s", async (_name, toolName, launch) => {
    const directory = createBackgroundDirectory();
    const path = join(directory, "bash_1.log");
    const original = `first=${OPENAI_KEY}`;
    writeFileSync(path, original, { mode: 0o600 });
    const writer = openSync(path, "a");
    const harness = createHarness();

    try {
      const result = await harness.emit({
        args: { run_in_background: true },
        output: `${launch}\nOutput file: ${path}\nfirst=${OPENAI_KEY}`,
        status: "success",
        toolName,
      });
      appendFileSync(writer, SENTINEL);

      expect(result).toEqual({
        result: {
          status: "success",
          output: `${launch}\nOutput file: ${path}\nfirst=[REDACTED: API Secret Key (sk-)]`,
        },
      });
      expect(readFileSync(path, "utf8")).toBe(`${original}${SENTINEL}`);
      expect(harness.diagnostics).toEqual([]);
    } finally {
      closeSync(writer);
    }
  });
});
