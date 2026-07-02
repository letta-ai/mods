// Property-based tests for letta-hypa mod.
// Uses fast-check to verify invariants across the input space.
// Example-based tests in mod.test.ts serve as regression/documentation;
// these PBT tests verify properties that should hold for ALL inputs.

import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock setup (same as mod.test.ts) ---

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn() as unknown as (
    ...args: unknown[]
  ) => Promise<{ stdout: string; stderr: string }>,
}));

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));
vi.mock("node:util", () => ({
  promisify: (fn: unknown) => fn,
}));

import activate, {
  extractCommandParts,
  getLastRewrite,
  getModStats,
  hypaExec,
  hypaRewrite,
  type LettaModApi,
  resetRewriteState,
} from "../mods/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function execResult(stdout: string, stderr = ""): { stdout: string; stderr: string } {
  return { stdout, stderr };
}

function execError(stderr: string, code?: number, stdout?: string): Error {
  const err = new Error(stderr);
  if (code !== undefined) (err as unknown as { code: number }).code = code;
  (err as unknown as { stderr: string }).stderr = stderr;
  if (stdout !== undefined) (err as unknown as { stdout: string }).stdout = stdout;
  return err;
}

function makeLettaApi(overrides: Partial<LettaModApi> = {}): LettaModApi {
  return {
    capabilities: {
      tools: true,
      commands: true,
      events: { tools: true, lifecycle: false, turns: false },
      permissions: false,
      providers: false,
      ui: { panels: false, statusValues: false },
    },
    tools: { register: vi.fn(() => () => {}) },
    commands: { register: vi.fn(() => () => {}) },
    events: { on: vi.fn(() => () => {}) },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Generators (fast-check arbitraries)
// ---------------------------------------------------------------------------

const RECOGNIZED_OUTCOMES = ["Rewritten", "GenericWrapper", "Passthrough"] as const;
const UNRECOGNIZED_OUTCOMES = [
  "Unknown",
  "Error",
  "Pending",
  "",
  "rewritten",
  "passthrough",
] as const;

/** Any string that could be a shell command (including compound, unicode). */
const commandArb = fc.string({ maxLength: 200 });

/** Any non-empty string (for fields that require non-empty after trim). */
const nonEmptyStringArb = fc.string({ maxLength: 200 }).filter((s) => s.trim().length > 0);

/** Any recognized outcome. */
const outcomeArb = fc.constantFrom(...RECOGNIZED_OUTCOMES);

/** Any unrecognized outcome string. */
const unrecognizedOutcomeArb = fc.constantFrom(...UNRECOGNIZED_OUTCOMES);

/** A valid RewriteResult object with a recognized outcome. */
const rewriteResultArb = fc
  .tuple(commandArb, outcomeArb, commandArb)
  .map(([input, outcome, command]) => ({ input, outcome, command }));

/** Any tool name (including Bash, exec_command, and arbitrary others). */
const toolNameArb = fc.oneof(
  fc.constantFrom("Bash", "exec_command", "Read", "Write", "Edit", "Glob", "Grep"),
  fc.string({ maxLength: 30 }),
);

/** Any non-hypa, non-empty command string (doesn't start with "hypa" after trimming, and isn't just whitespace). */
const nonHypaCommandArb = fc
  .string({ maxLength: 200 })
  .filter(
    (s) =>
      s.trim().length > 0 &&
      !s.trimStart().startsWith("hypa") &&
      !s.includes("\n") &&
      !s.includes("<<"),
  );

/** Any hypa-prefixed command string. */
const hypaCommandArb = fc.string({ maxLength: 50 }).map((s) => `hypa ${s}`.trim());

/** Any valid hypa_read mode. */
const readModeArb = fc.constantFrom("smart", "full", "outline", "signatures", "pruned");

/** Any valid hypa_search scope. */
const searchScopeArb = fc.constantFrom("project", "session", "code", "docs");

/** Any valid hypa_search kind. */
const searchKindArb = fc.constantFrom("text", "regex", "symbol");

/** Any valid hypa_compress kind. */
const compressKindArb = fc.constantFrom("shell-output", "log", "code", "generic");

/** Any filesystem path (for cd prefix testing). */
const pathArb = fc.oneof(
  // Simple unquoted path
  fc.stringMatching(/[a-zA-Z0-9/_.-]{1,50}/),
  // Quoted path with spaces
  fc.stringMatching(/[a-zA-Z0-9/_.-]{1,30}/).map((s) => `"${s} with spaces"`),
);

/** A command with optional cd prefix and optional 2>&1 suffix. */
const wrappedCommandArb = fc
  .tuple(
    fc.oneof(
      fc.constant(""),
      pathArb.map((p) => `cd ${p} && `),
    ),
    nonHypaCommandArb,
    fc.oneof(fc.constant(""), fc.constant(" 2>&1")),
  )
  .map(([prefix, core, suffix]) => ({ prefix, core, suffix, full: `${prefix}${core}${suffix}` }))
  .filter(({ full }) => !full.includes("\n") && !full.includes("<<"));

/** A hypa-prefixed command with optional harness cd-prefix and redirect suffix. */
const wrappedHypaCommandArb = fc
  .tuple(
    fc.oneof(
      fc.constant(""),
      pathArb.map((p) => `cd ${p} && `),
    ),
    hypaCommandArb,
    fc.oneof(fc.constant(""), fc.constant(" 2>&1")),
  )
  .map(([prefix, core, suffix]) => `${prefix}${core}${suffix}`)
  .filter((command) => extractCommandParts(command).core.trimStart().startsWith("hypa"));

// ---------------------------------------------------------------------------
// Tests: hypaRewrite — recovery from success and error paths
// ---------------------------------------------------------------------------

describe("PBT: hypaRewrite recovery", () => {
  beforeEach(() => {
    vi.mocked(mockExecFile).mockReset();
    resetRewriteState();
  });

  it("recovers any recognized outcome from success path (exit 0)", async () => {
    await fc.assert(
      fc.asyncProperty(rewriteResultArb, async (expected) => {
        mockExecFile.mockResolvedValue(execResult(JSON.stringify(expected)));

        const result = await hypaRewrite(expected.input, "/tmp");

        expect(result).toEqual(expected);
        expect(getLastRewrite()?.outcome).toBe(expected.outcome);
        expect(getLastRewrite()?.error).toBeNull();
      }),
    );
  });

  it("recovers any recognized outcome from error path (non-zero exit with JSON on stdout)", async () => {
    await fc.assert(
      fc.asyncProperty(rewriteResultArb, async (expected) => {
        mockExecFile.mockRejectedValue(execError("Command failed", 1, JSON.stringify(expected)));

        const result = await hypaRewrite(expected.input, "/tmp");

        expect(result).toEqual(expected);
        expect(getLastRewrite()?.outcome).toBe(expected.outcome);
        expect(getLastRewrite()?.error).toBeNull();
      }),
    );
  });

  it("returns null for any unrecognized outcome in err.stdout", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .tuple(commandArb, unrecognizedOutcomeArb, commandArb)
          .map(([input, outcome, command]) => JSON.stringify({ input, outcome, command })),
        async (jsonStr) => {
          mockExecFile.mockRejectedValue(execError("Command failed", 1, jsonStr));

          const result = await hypaRewrite("test", "/tmp");

          expect(result).toBeNull();
          expect(getLastRewrite()?.outcome).toBe("Error");
        },
      ),
    );
  });

  it("returns null for any invalid JSON in err.stdout", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ maxLength: 100 }).filter((s) => {
          try {
            JSON.parse(s);
            return false;
          } catch {
            return true;
          }
        }),
        async (invalidJson) => {
          mockExecFile.mockRejectedValue(execError("Command failed", 1, invalidJson));

          const result = await hypaRewrite("test", "/tmp");

          expect(result).toBeNull();
          expect(getLastRewrite()?.outcome).toBe("Error");
        },
      ),
    );
  });

  it("returns null for any error without stdout", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 100 }), async (errorMsg) => {
        mockExecFile.mockRejectedValue(execError(errorMsg));

        const result = await hypaRewrite("test", "/tmp");

        expect(result).toBeNull();
        expect(getLastRewrite()?.outcome).toBe("Error");
        // Error message is recorded (may be empty string if execError msg was empty)
        expect(getLastRewrite()?.error).not.toBeNull();
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: hypaRewrite — mod stats tracking
// ---------------------------------------------------------------------------

describe("PBT: hypaRewrite stats tracking", () => {
  beforeEach(() => {
    vi.mocked(mockExecFile).mockReset();
    resetRewriteState();
  });

  it("increments rewrites counter for Rewritten and GenericWrapper outcomes", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom("Rewritten", "GenericWrapper"), async (outcome) => {
        resetRewriteState();
        mockExecFile.mockResolvedValue(
          execResult(JSON.stringify({ input: "cmd", outcome, command: "wrapped" })),
        );

        await hypaRewrite("cmd", "/tmp");

        expect(getModStats().rewrites).toBe(1);
        expect(getModStats().passthroughs).toBe(0);
        expect(getModStats().errors).toBe(0);
      }),
    );
  });

  it("increments passthroughs counter for Passthrough outcome", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant("Passthrough"), async (outcome) => {
        resetRewriteState();
        mockExecFile.mockResolvedValue(
          execResult(JSON.stringify({ input: "cmd", outcome, command: "cmd" })),
        );

        await hypaRewrite("cmd", "/tmp");

        expect(getModStats().rewrites).toBe(0);
        expect(getModStats().passthroughs).toBe(1);
        expect(getModStats().errors).toBe(0);
      }),
    );
  });

  it("increments errors counter for any error without recovery", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 50 }), async (errorMsg) => {
        resetRewriteState();
        mockExecFile.mockRejectedValue(execError(errorMsg));

        await hypaRewrite("cmd", "/tmp");

        expect(getModStats().errors).toBe(1);
        expect(getModStats().rewrites).toBe(0);
        expect(getModStats().passthroughs).toBe(0);
      }),
    );
  });

  it("does not increment errors when recovering from non-zero exit", async () => {
    await fc.assert(
      fc.asyncProperty(rewriteResultArb, async (expected) => {
        resetRewriteState();
        mockExecFile.mockRejectedValue(execError("Command failed", 1, JSON.stringify(expected)));

        await hypaRewrite(expected.input, "/tmp");

        expect(getModStats().errors).toBe(0);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: tool_start handler — routing and invariants
// ---------------------------------------------------------------------------

describe("PBT: tool_start handler routing", () => {
  let letta: LettaModApi;
  let dispose: (() => void) | undefined;
  let toolStartHandler: (
    event: { toolName: string; args: Record<string, unknown> },
    ctx: { cwd?: string },
  ) => Promise<{ args: Record<string, unknown> } | undefined>;

  beforeEach(() => {
    vi.mocked(mockExecFile).mockReset();
    resetRewriteState();
    letta = makeLettaApi();
    (letta.events?.on as ReturnType<typeof vi.fn>).mockImplementation(
      (_name: string, handler: typeof toolStartHandler) => {
        toolStartHandler = handler;
        return () => {};
      },
    );
    dispose = activate(letta);
  });

  afterEach(() => {
    dispose?.();
  });

  it("only Bash and exec_command trigger rewrite; all other tool names are ignored", async () => {
    await fc.assert(
      fc.asyncProperty(toolNameArb, nonHypaCommandArb, async (toolName, command) => {
        vi.mocked(mockExecFile).mockReset();
        mockExecFile.mockResolvedValue(
          execResult(
            JSON.stringify({ input: command, outcome: "Rewritten", command: `hypa ${command}` }),
          ),
        );

        const isShell = toolName === "Bash" || toolName === "exec_command";
        const commandKey = toolName === "exec_command" ? "cmd" : "command";
        const args = { [commandKey]: command };

        const result = await toolStartHandler({ toolName, args }, { cwd: "/tmp" });

        if (isShell) {
          expect(mockExecFile).toHaveBeenCalled();
          expect(result).toEqual({ args: { [commandKey]: `hypa ${command}` } });
        } else {
          expect(mockExecFile).not.toHaveBeenCalled();
          expect(result).toBeUndefined();
        }
      }),
    );
  });

  it("skips any command whose core starts with 'hypa'", async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(hypaCommandArb, wrappedHypaCommandArb), async (command) => {
        vi.mocked(mockExecFile).mockReset();
        vi.mocked(mockExecFile).mockImplementation(() => {
          throw new Error("should not be called");
        });

        const result = await toolStartHandler(
          { toolName: "Bash", args: { command } },
          { cwd: "/tmp" },
        );

        expect(result).toBeUndefined();
        expect(mockExecFile).not.toHaveBeenCalled();
      }),
    );
  });

  it("fails open (returns undefined) for any error from hypaRewrite", async () => {
    await fc.assert(
      fc.asyncProperty(
        nonHypaCommandArb,
        fc.string({ maxLength: 100 }),
        async (command, errorMsg) => {
          vi.mocked(mockExecFile).mockReset();
          mockExecFile.mockRejectedValue(execError(errorMsg));

          const result = await toolStartHandler(
            { toolName: "Bash", args: { command } },
            { cwd: "/tmp" },
          );

          expect(result).toBeUndefined();
        },
      ),
    );
  });

  it("returns undefined for any Passthrough outcome (no args modification)", async () => {
    await fc.assert(
      fc.asyncProperty(nonHypaCommandArb, async (command) => {
        vi.mocked(mockExecFile).mockReset();
        mockExecFile.mockResolvedValue(
          execResult(JSON.stringify({ input: command, outcome: "Passthrough", command })),
        );

        const result = await toolStartHandler(
          { toolName: "Bash", args: { command } },
          { cwd: "/tmp" },
        );

        expect(result).toBeUndefined();
      }),
    );
  });

  it("preserves all other args when rewriting (Bash)", async () => {
    await fc.assert(
      fc.asyncProperty(
        nonHypaCommandArb,
        fc.record({
          extra1: fc.string({ maxLength: 20 }),
          extra2: fc.integer(),
          extra3: fc.boolean(),
        }),
        async (command, extra) => {
          vi.mocked(mockExecFile).mockReset();
          const wrapped = `hypa ${command}`;
          mockExecFile.mockResolvedValue(
            execResult(JSON.stringify({ input: command, outcome: "Rewritten", command: wrapped })),
          );

          const result = await toolStartHandler(
            { toolName: "Bash", args: { command, ...extra } },
            { cwd: "/tmp" },
          );

          expect(result).toEqual({ args: { command: wrapped, ...extra } });
        },
      ),
    );
  });

  it("preserves all other args when rewriting (exec_command)", async () => {
    await fc.assert(
      fc.asyncProperty(
        nonHypaCommandArb,
        fc.record({
          timeout: fc.integer(),
          shell: fc.string({ maxLength: 10 }),
        }),
        async (command, extra) => {
          vi.mocked(mockExecFile).mockReset();
          const wrapped = `hypa ${command}`;
          mockExecFile.mockResolvedValue(
            execResult(JSON.stringify({ input: command, outcome: "Rewritten", command: wrapped })),
          );

          const result = await toolStartHandler(
            { toolName: "exec_command", args: { cmd: command, ...extra } },
            { cwd: "/tmp" },
          );

          expect(result).toEqual({ args: { cmd: wrapped, ...extra } });
        },
      ),
    );
  });

  it("recovers any recognized outcome from non-zero exit in handler", async () => {
    await fc.assert(
      fc.asyncProperty(nonHypaCommandArb, rewriteResultArb, async (command, expected) => {
        vi.mocked(mockExecFile).mockReset();
        mockExecFile.mockRejectedValue(execError("Command failed", 1, JSON.stringify(expected)));

        const result = await toolStartHandler(
          { toolName: "Bash", args: { command } },
          { cwd: "/tmp" },
        );

        if (expected.outcome === "Rewritten" || expected.outcome === "GenericWrapper") {
          expect(result).toEqual({ args: { command: expected.command } });
        } else {
          expect(result).toBeUndefined();
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: hypaExec — passthrough and error propagation
// ---------------------------------------------------------------------------

describe("PBT: hypaExec", () => {
  beforeEach(() => {
    vi.mocked(mockExecFile).mockReset();
  });

  it("returns stdout unchanged for any string output", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 1000 }), async (output) => {
        mockExecFile.mockResolvedValue(execResult(output));

        const result = await hypaExec(["read", "/tmp/test.txt"], "/tmp");

        expect(result).toBe(output);
      }),
    );
  });

  it("throws with stderr as message for any error with non-empty stderr", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ maxLength: 200 }).filter((s) => s.trim().length > 0),
        async (stderr) => {
          mockExecFile.mockRejectedValue(execError(stderr));

          // hypaExec trims stderr before throwing, so the thrown message is the trimmed version
          await expect(hypaExec(["read", "/nonexistent"], "/tmp")).rejects.toThrow(stderr.trim());
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: hypa_read — arg construction
// ---------------------------------------------------------------------------

describe("PBT: hypa_read arg construction", () => {
  let letta: LettaModApi;
  let dispose: (() => void) | undefined;
  let toolRun: (ctx: { cwd: string; args: Record<string, unknown> }) => Promise<unknown>;

  beforeEach(() => {
    vi.mocked(mockExecFile).mockReset();
    letta = makeLettaApi();
    (letta.tools?.register as ReturnType<typeof vi.fn>).mockImplementation(
      (tool: { name: string; run: typeof toolRun }) => {
        if (tool.name === "hypa_read") toolRun = tool.run;
        return () => {};
      },
    );
    dispose = activate(letta);
  });

  afterEach(() => {
    dispose?.();
  });

  it("constructs correct args for any non-empty path and mode", async () => {
    await fc.assert(
      fc.asyncProperty(nonEmptyStringArb, readModeArb, async (path, mode) => {
        let capturedArgs: unknown[] = [];
        mockExecFile.mockImplementation((_bin, args) => {
          capturedArgs = args as unknown[];
          return execResult("output");
        });

        await toolRun({ cwd: "/tmp", args: { path, mode } });

        // The tool trims the path before passing it to hypa
        const trimmedPath = path.trim();
        expect(capturedArgs).toContain("read");
        expect(capturedArgs).toContain(trimmedPath);
        expect(capturedArgs).toContain("--mode");
        expect(capturedArgs).toContain(mode);
      }),
    );
  });

  it("returns error for any empty or missing path", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.constant(""), fc.constant(undefined), fc.constant("   ")),
        async (path) => {
          const result = await toolRun({ cwd: "/tmp", args: { path } });
          expect(result).toEqual({ status: "error", content: "path is required" });
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: hypa_search — arg construction
// ---------------------------------------------------------------------------

describe("PBT: hypa_search arg construction", () => {
  let letta: LettaModApi;
  let dispose: (() => void) | undefined;
  let toolRun: (ctx: { cwd: string; args: Record<string, unknown> }) => Promise<unknown>;

  beforeEach(() => {
    vi.mocked(mockExecFile).mockReset();
    letta = makeLettaApi();
    (letta.tools?.register as ReturnType<typeof vi.fn>).mockImplementation(
      (tool: { name: string; run: typeof toolRun }) => {
        if (tool.name === "hypa_search") toolRun = tool.run;
        return () => {};
      },
    );
    dispose = activate(letta);
  });

  afterEach(() => {
    dispose?.();
  });

  it("constructs correct args for any non-empty query, scope, and kind", async () => {
    await fc.assert(
      fc.asyncProperty(
        nonEmptyStringArb,
        searchScopeArb,
        searchKindArb,
        async (query, scope, kind) => {
          let capturedArgs: unknown[] = [];
          mockExecFile.mockImplementation((_bin, args) => {
            capturedArgs = args as unknown[];
            return execResult("results");
          });

          await toolRun({ cwd: "/tmp", args: { query, scope, kind } });

          // The tool trims the query before passing it to hypa
          const trimmedQuery = query.trim();
          expect(capturedArgs).toContain("search");
          expect(capturedArgs).toContain(trimmedQuery);
          expect(capturedArgs).toContain("--scope");
          expect(capturedArgs).toContain(scope);
          expect(capturedArgs).toContain("--kind");
          expect(capturedArgs).toContain(kind);
        },
      ),
    );
  });

  it("returns error for any empty or missing query", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.constant(""), fc.constant(undefined), fc.constant("   ")),
        async (query) => {
          const result = await toolRun({ cwd: "/tmp", args: { query } });
          expect(result).toEqual({ status: "error", content: "query is required" });
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: hypa_compress — stdin passthrough
// ---------------------------------------------------------------------------

describe("PBT: hypa_compress stdin passthrough", () => {
  let letta: LettaModApi;
  let dispose: (() => void) | undefined;
  let toolRun: (ctx: { cwd: string; args: Record<string, unknown> }) => Promise<unknown>;

  beforeEach(() => {
    vi.mocked(mockExecFile).mockReset();
    letta = makeLettaApi();
    (letta.tools?.register as ReturnType<typeof vi.fn>).mockImplementation(
      (tool: { name: string; run: typeof toolRun }) => {
        if (tool.name === "hypa_compress") toolRun = tool.run;
        return () => {};
      },
    );
    dispose = activate(letta);
  });

  afterEach(() => {
    dispose?.();
  });

  it("passes any non-empty text as stdin input with correct kind", async () => {
    await fc.assert(
      fc.asyncProperty(nonEmptyStringArb, compressKindArb, async (text, kind) => {
        let capturedInput: string | undefined;
        let capturedArgs: unknown[] = [];
        mockExecFile.mockImplementation((_bin, args, opts) => {
          capturedArgs = args as unknown[];
          capturedInput = (opts as Record<string, unknown>).input as string;
          return execResult("compressed");
        });

        await toolRun({ cwd: "/tmp", args: { text, kind } });

        expect(capturedInput).toBe(text);
        expect(capturedArgs).toContain("compress");
        expect(capturedArgs).toContain("--kind");
        expect(capturedArgs).toContain(kind);
      }),
    );
  });

  it("returns error for any empty text", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(""), async (text) => {
        const result = await toolRun({ cwd: "/tmp", args: { text } });
        expect(result).toEqual({ status: "error", content: "text is required" });
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: session stats parsing
// ---------------------------------------------------------------------------

describe("PBT: /hypa command session stats parsing", () => {
  let letta: LettaModApi;
  let dispose: (() => void) | undefined;
  let commandRun: (ctx: { cwd: string; args: string }) => Promise<{ type: string; output: string }>;

  beforeEach(() => {
    vi.mocked(mockExecFile).mockReset();
    resetRewriteState();
    letta = makeLettaApi();
    (letta.commands?.register as ReturnType<typeof vi.fn>).mockImplementation(
      (cmd: { id: string; run: typeof commandRun }) => {
        if (cmd.id === "hypa") commandRun = cmd.run;
        return () => {};
      },
    );
    dispose = activate(letta);
  });

  afterEach(() => {
    dispose?.();
  });

  it("extracts tokens_saved and tool_calls for any valid session status output", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: 100000 }),
        fc.nat({ max: 100000 }),
        async (tokensSaved, toolCalls) => {
          mockExecFile.mockImplementation((_bin, args) => {
            if (args?.includes?.("session")) {
              return execResult(
                `id:           test-id\nproject_root: /tmp\ncreated_at:   2026-01-01T00:00:00Z\nupdated_at:   2026-01-01T00:00:00Z\ntool_calls:   ${toolCalls}\nfile_touches: 0\ntokens_saved: ${tokensSaved}\n`,
              );
            }
            return execResult("");
          });

          const result = await commandRun({ cwd: "/tmp", args: "" });

          expect(result.output).toContain(`Tokens saved: ${tokensSaved}`);
          expect(result.output).toContain(`Tool calls:   ${toolCalls}`);
        },
      ),
    );
  });

  it("omits session section for any session status error", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 100 }), async (errorMsg) => {
        mockExecFile.mockImplementation((_bin, args) => {
          if (args?.includes?.("session")) {
            return Promise.reject(execError(errorMsg));
          }
          return execResult("");
        });

        const result = await commandRun({ cwd: "/tmp", args: "" });

        expect(result.output).toContain("Mod stats (this session):");
        expect(result.output).not.toContain("Hypa session:");
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: extractCommandParts — round-trip and extraction properties
// ---------------------------------------------------------------------------

describe("PBT: extractCommandParts", () => {
  it("prefix + core + suffix reconstructs the original command", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 200 }), async (command) => {
        const parts = extractCommandParts(command);
        expect(parts.prefix + parts.core + parts.suffix).toBe(command);
      }),
    );
  });

  it("core does not start with 'cd ' when a cd prefix was extracted", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 200 }), async (command) => {
        const parts = extractCommandParts(command);
        if (parts.prefix) {
          expect(parts.core.startsWith("cd ")).toBe(false);
        }
      }),
    );
  });

  it("core does not end with '2>&1' when a suffix was extracted", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 200 }), async (command) => {
        const parts = extractCommandParts(command);
        if (parts.suffix) {
          expect(parts.core.endsWith("2>&1")).toBe(false);
        }
      }),
    );
  });

  it("returns empty prefix and suffix for bare commands without cd or redirect", async () => {
    await fc.assert(
      fc.asyncProperty(nonHypaCommandArb, async (command) => {
        // Ensure the command doesn't start with cd or end with 2>&1
        const noCd = command.trimStart().startsWith("cd ") ? `x ${command}` : command;
        const bare = noCd.endsWith("2>&1") ? noCd.slice(0, -4) : noCd;

        const parts = extractCommandParts(bare);
        expect(parts.prefix).toBe("");
        expect(parts.suffix).toBe("");
        expect(parts.core).toBe(bare);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: tool_start handler — cd/redirect stripping with reconstruction
// ---------------------------------------------------------------------------

describe("PBT: tool_start handler cd/redirect stripping", () => {
  let letta: LettaModApi;
  let dispose: (() => void) | undefined;
  let toolStartHandler: (
    event: { toolName: string; args: Record<string, unknown> },
    ctx: { cwd?: string },
  ) => Promise<{ args: Record<string, unknown> } | undefined>;

  beforeEach(() => {
    vi.mocked(mockExecFile).mockReset();
    resetRewriteState();
    letta = makeLettaApi();
    (letta.events?.on as ReturnType<typeof vi.fn>).mockImplementation(
      (_name: string, handler: typeof toolStartHandler) => {
        toolStartHandler = handler;
        return () => {};
      },
    );
    dispose = activate(letta);
  });

  afterEach(() => {
    dispose?.();
  });

  it("rewrites core and re-attaches prefix+suffix for any wrapped command", async () => {
    await fc.assert(
      fc.asyncProperty(wrappedCommandArb, async ({ full }) => {
        vi.mocked(mockExecFile).mockReset();

        // Use extractCommandParts to determine what the handler will actually send to hypa
        const parts = extractCommandParts(full);
        if (!parts.core.trim()) return; // skip empty core

        const wrapped = `hypa ${parts.core}`;
        mockExecFile.mockResolvedValue(
          execResult(
            JSON.stringify({
              input: parts.core,
              outcome: "Rewritten",
              command: wrapped,
            }),
          ),
        );

        const result = await toolStartHandler(
          { toolName: "Bash", args: { command: full } },
          { cwd: "/tmp" },
        );

        // The rewritten command should be prefix + wrapped + suffix
        expect(result).toBeDefined();
        const rewritten = (result?.args?.command as string) ?? "";
        expect(rewritten).toBe(`${parts.prefix}${wrapped}${parts.suffix}`);
      }),
    );
  });

  it("passes through original when core is Passthrough", async () => {
    await fc.assert(
      fc.asyncProperty(wrappedCommandArb, async ({ full, core }) => {
        vi.mocked(mockExecFile).mockReset();
        mockExecFile.mockResolvedValue(
          execResult(JSON.stringify({ input: core, outcome: "Passthrough", command: core })),
        );

        const result = await toolStartHandler(
          { toolName: "Bash", args: { command: full } },
          { cwd: "/tmp" },
        );

        // Passthrough — no modification
        expect(result).toBeUndefined();
      }),
    );
  });

  it("preserves other args when stripping cd/redirect", async () => {
    await fc.assert(
      fc.asyncProperty(
        wrappedCommandArb,
        fc.record({
          timeout: fc.integer({ min: 0, max: 60000 }),
          shell: fc.string({ maxLength: 10 }),
        }),
        async ({ full, core }, extra) => {
          vi.mocked(mockExecFile).mockReset();
          const wrapped = `hypa ${core}`;
          mockExecFile.mockResolvedValue(
            execResult(JSON.stringify({ input: core, outcome: "Rewritten", command: wrapped })),
          );

          const result = await toolStartHandler(
            { toolName: "Bash", args: { command: full, ...extra } },
            { cwd: "/tmp" },
          );

          expect(result).toBeDefined();
          // Other args preserved
          expect(result?.args?.timeout).toBe(extra.timeout);
          expect(result?.args?.shell).toBe(extra.shell);
        },
      ),
    );
  });
});
