// Tests for letta-hypa mod.
// Mocks execFile/execFileSync to test behaviour without calling the real hypa binary.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock execFile and execFileSync ---
// The mod imports both from node:child_process. We mock the module so we can
// control the output of hypa CLI calls. vi.hoisted ensures the mock is
// available when vi.mock's factory runs.

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

// Import after mocks are set up.
import activate, {
  extractCommandParts,
  getLastRewrite,
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

/** Simulate hypa exiting non-zero but with valid JSON on stdout (the Passthrough bug). */
function mockRejectWithStdout(stdout: string, code = 1) {
  mockExecFile.mockRejectedValue(execError("Command failed", code, stdout));
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

function mockResolve(stdout: string, stderr = "") {
  mockExecFile.mockResolvedValue(execResult(stdout, stderr));
}

function mockReject(stderr: string, code?: number) {
  mockExecFile.mockRejectedValue(execError(stderr, code));
}

function mockImplementation(
  fn: (
    ...args: unknown[]
  ) => Promise<{ stdout: string; stderr: string }> | { stdout: string; stderr: string },
) {
  mockExecFile.mockImplementation(fn as unknown as typeof mockExecFile);
}

// ---------------------------------------------------------------------------
// Tests: hypaRewrite (async)
// ---------------------------------------------------------------------------

describe("hypaRewrite", () => {
  beforeEach(() => {
    vi.mocked(mockExecFile).mockReset();
    resetRewriteState();
  });

  it("returns Rewritten result with wrapped command", async () => {
    mockResolve(
      JSON.stringify({
        input: "git status",
        outcome: "Rewritten",
        command: "hypa git status",
      }),
    );

    const result = await hypaRewrite("git status", "/tmp");
    expect(result).toEqual({
      input: "git status",
      outcome: "Rewritten",
      command: "hypa git status",
    });
  });

  it("returns GenericWrapper result", async () => {
    mockResolve(
      JSON.stringify({
        input: "ls -la",
        outcome: "GenericWrapper",
        command: 'hypa -c "ls -la"',
      }),
    );

    const result = await hypaRewrite("ls -la", "/tmp");
    expect(result).toEqual({
      input: "ls -la",
      outcome: "GenericWrapper",
      command: 'hypa -c "ls -la"',
    });
  });

  it("returns Passthrough result (command unchanged)", async () => {
    mockResolve(
      JSON.stringify({
        input: "docker build .",
        outcome: "Passthrough",
        command: "docker build .",
      }),
    );

    const result = await hypaRewrite("docker build .", "/tmp");
    expect(result).toEqual({
      input: "docker build .",
      outcome: "Passthrough",
      command: "docker build .",
    });
  });

  it("returns null on exec error and records error in lastRewrite", async () => {
    mockReject("command not found");

    const result = await hypaRewrite("go test ./...", "/tmp");
    expect(result).toBeNull();
    const record = getLastRewrite();
    expect(record).not.toBeNull();
    expect(record?.outcome).toBe("Error");
    expect(record?.error).toBeTruthy();
  });

  // --- Recovery from non-zero exit with valid JSON on stdout ---
  // Hypa exits non-zero for Passthrough outcomes but still emits valid JSON
  // on stdout.  The mod must recover the result instead of treating it as an
  // error.

  it("recovers Passthrough from err.stdout on non-zero exit", async () => {
    mockRejectWithStdout(
      JSON.stringify({
        input: "cd /tmp && npm run ci 2>&1",
        outcome: "Passthrough",
        command: "cd /tmp && npm run ci 2>&1",
      }),
    );

    const result = await hypaRewrite("cd /tmp && npm run ci 2>&1", "/tmp");
    expect(result).toEqual({
      input: "cd /tmp && npm run ci 2>&1",
      outcome: "Passthrough",
      command: "cd /tmp && npm run ci 2>&1",
    });
    // Should NOT be recorded as an error
    const record = getLastRewrite();
    expect(record?.outcome).toBe("Passthrough");
    expect(record?.error).toBeNull();
  });

  it("recovers Rewritten from err.stdout on non-zero exit", async () => {
    mockRejectWithStdout(
      JSON.stringify({
        input: "git status",
        outcome: "Rewritten",
        command: "hypa git status",
      }),
    );

    const result = await hypaRewrite("git status", "/tmp");
    expect(result).toEqual({
      input: "git status",
      outcome: "Rewritten",
      command: "hypa git status",
    });
    expect(getLastRewrite()?.error).toBeNull();
  });

  it("recovers GenericWrapper from err.stdout on non-zero exit", async () => {
    mockRejectWithStdout(
      JSON.stringify({
        input: "ls -la",
        outcome: "GenericWrapper",
        command: 'hypa -c "ls -la"',
      }),
    );

    const result = await hypaRewrite("ls -la", "/tmp");
    expect(result).toEqual({
      input: "ls -la",
      outcome: "GenericWrapper",
      command: 'hypa -c "ls -la"',
    });
    expect(getLastRewrite()?.error).toBeNull();
  });

  it("returns null when err.stdout has invalid JSON", async () => {
    mockRejectWithStdout("not valid json");

    const result = await hypaRewrite("echo hello", "/tmp");
    expect(result).toBeNull();
    expect(getLastRewrite()?.outcome).toBe("Error");
  });

  it("returns null when err.stdout has unrecognized outcome", async () => {
    mockRejectWithStdout(JSON.stringify({ input: "test", outcome: "Unknown", command: "test" }));

    const result = await hypaRewrite("test", "/tmp");
    expect(result).toBeNull();
    expect(getLastRewrite()?.outcome).toBe("Error");
  });

  it("returns null when error has no stdout property", async () => {
    mockReject("command not found");

    const result = await hypaRewrite("go test", "/tmp");
    expect(result).toBeNull();
    expect(getLastRewrite()?.outcome).toBe("Error");
  });

  it("returns null on JSON parse error", async () => {
    mockResolve("not valid json");

    const result = await hypaRewrite("echo hello", "/tmp");
    expect(result).toBeNull();
    expect(getLastRewrite()?.outcome).toBe("Error");
  });

  it("stores last rewrite record for diagnostics", async () => {
    mockResolve(
      JSON.stringify({
        input: "npm install",
        outcome: "GenericWrapper",
        command: 'hypa -c "npm install"',
      }),
    );

    await hypaRewrite("npm install", "/tmp");
    const record = getLastRewrite();
    expect(record).toEqual({
      input: "npm install",
      outcome: "GenericWrapper",
      command: 'hypa -c "npm install"',
      error: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: hypaExec
// ---------------------------------------------------------------------------

describe("hypaExec", () => {
  beforeEach(() => {
    vi.mocked(mockExecFile).mockReset();
  });

  it("returns stdout on success", async () => {
    mockResolve("file contents here");

    const output = await hypaExec(["read", "/tmp/test.txt", "--mode", "smart"], "/tmp");
    expect(output).toBe("file contents here");
  });

  it("passes input option for stdin", async () => {
    let capturedOptions: Record<string, unknown> = {};
    mockImplementation((_bin, _args, opts) => {
      capturedOptions = opts as Record<string, unknown>;
      return execResult("compressed output");
    });

    const output = await hypaExec(["compress", "--kind", "generic"], "/tmp", {
      input: "some text",
    });
    expect(output).toBe("compressed output");
    expect(capturedOptions.input).toBe("some text");
  });

  it("throws with stderr message on error", async () => {
    mockReject("file not found");

    await expect(hypaExec(["read", "/nonexistent"], "/tmp")).rejects.toThrow("file not found");
  });

  it("uses custom timeout when provided", async () => {
    let capturedOptions: Record<string, unknown> = {};
    mockImplementation((_bin, _args, opts) => {
      capturedOptions = opts as Record<string, unknown>;
      return execResult("ok");
    });

    await hypaExec(["mcp", "list"], "/tmp", { timeoutMs: 15000 });
    expect(capturedOptions.timeout).toBe(15000);
  });
});

// ---------------------------------------------------------------------------
// Tests: extractCommandParts
// ---------------------------------------------------------------------------

describe("extractCommandParts", () => {
  it("extracts cd prefix and 2>&1 suffix", () => {
    const parts = extractCommandParts("cd /tmp && npm run ci 2>&1");
    expect(parts).toEqual({
      prefix: "cd /tmp && ",
      core: "npm run ci",
      suffix: " 2>&1",
    });
  });

  it("extracts only cd prefix when no redirect", () => {
    const parts = extractCommandParts("cd /tmp && npm run ci");
    expect(parts).toEqual({
      prefix: "cd /tmp && ",
      core: "npm run ci",
      suffix: "",
    });
  });

  it("extracts only 2>&1 suffix when no cd prefix", () => {
    const parts = extractCommandParts("npm run ci 2>&1");
    expect(parts).toEqual({
      prefix: "",
      core: "npm run ci",
      suffix: " 2>&1",
    });
  });

  it("returns command as core when no cd or redirect", () => {
    const parts = extractCommandParts("npm run ci");
    expect(parts).toEqual({
      prefix: "",
      core: "npm run ci",
      suffix: "",
    });
  });

  it("handles double-quoted paths with spaces", () => {
    const parts = extractCommandParts('cd "/path with spaces" && git status');
    expect(parts.prefix).toBe('cd "/path with spaces" && ');
    expect(parts.core).toBe("git status");
  });

  it("handles single-quoted paths with spaces", () => {
    const parts = extractCommandParts("cd '/path with spaces' && git status");
    expect(parts.prefix).toBe("cd '/path with spaces' && ");
    expect(parts.core).toBe("git status");
  });

  it("does not match cd without &&", () => {
    const parts = extractCommandParts("cd /tmp");
    expect(parts.prefix).toBe("");
    expect(parts.core).toBe("cd /tmp");
  });

  it("handles compound commands after cd prefix", () => {
    const parts = extractCommandParts("cd /tmp && cmd1 && cmd2 2>&1");
    expect(parts.prefix).toBe("cd /tmp && ");
    expect(parts.core).toBe("cmd1 && cmd2");
    expect(parts.suffix).toBe(" 2>&1");
  });
});

// ---------------------------------------------------------------------------
// Tests: activate
// ---------------------------------------------------------------------------

describe("activate", () => {
  let letta: LettaModApi;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    vi.mocked(mockExecFile).mockReset();
    resetRewriteState();
    letta = makeLettaApi();
    dispose = undefined;
  });

  afterEach(() => {
    dispose?.();
  });

  it("registers tool_start event handler, /hypa command, and tools", () => {
    dispose = activate(letta);
    expect(letta.events?.on).toHaveBeenCalledWith("tool_start", expect.any(Function));
    expect(letta.commands?.register).toHaveBeenCalledWith(expect.objectContaining({ id: "hypa" }));
    expect(letta.tools?.register).toHaveBeenCalledWith(
      expect.objectContaining({ name: "hypa_read" }),
    );
    expect(letta.tools?.register).toHaveBeenCalledWith(
      expect.objectContaining({ name: "hypa_search" }),
    );
    expect(letta.tools?.register).toHaveBeenCalledWith(
      expect.objectContaining({ name: "hypa_compress" }),
    );
  });

  it("does not register MCP proxy tool when disabled", () => {
    dispose = activate(letta);
    const registerCalls = (letta.tools?.register as ReturnType<typeof vi.fn>).mock.calls;
    const mcpProxy = registerCalls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === "hypa_mcp_proxy",
    );
    expect(mcpProxy).toBeUndefined();
  });

  it("registers MCP proxy tool when HYPA_LETTA_ENABLE_MCP_PROXY=1", () => {
    process.env.HYPA_LETTA_ENABLE_MCP_PROXY = "1";
    dispose = activate(letta);
    const registerCalls = (letta.tools?.register as ReturnType<typeof vi.fn>).mock.calls;
    const mcpProxy = registerCalls.find(
      (call: unknown[]) => (call[0] as { name: string }).name === "hypa_mcp_proxy",
    );
    expect(mcpProxy).toBeDefined();
    delete process.env.HYPA_LETTA_ENABLE_MCP_PROXY;
  });

  it("returns a disposer that cleans up", () => {
    const disposer = activate(letta);
    expect(typeof disposer).toBe("function");
    disposer();
    expect(getLastRewrite()).toBeNull();
  });

  it("skips registration when capabilities are missing", () => {
    const minimal: LettaModApi = { capabilities: {} };
    dispose = activate(minimal);
    expect(typeof dispose).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Tests: tool_start handler (synchronous)
// ---------------------------------------------------------------------------

describe("tool_start handler", () => {
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

  it("rewrites Bash command when outcome is Rewritten", async () => {
    mockResolve(
      JSON.stringify({
        input: "git status",
        outcome: "Rewritten",
        command: "hypa git status",
      }),
    );

    const result = await toolStartHandler(
      { toolName: "Bash", args: { command: "git status" } },
      { cwd: "/tmp" },
    );
    expect(result).toEqual({ args: { command: "hypa git status" } });
  });

  it("rewrites Bash command when outcome is GenericWrapper", async () => {
    mockResolve(
      JSON.stringify({
        input: "ls -la",
        outcome: "GenericWrapper",
        command: 'hypa -c "ls -la"',
      }),
    );

    const result = await toolStartHandler(
      { toolName: "Bash", args: { command: "ls -la" } },
      { cwd: "/tmp" },
    );
    expect(result).toEqual({ args: { command: 'hypa -c "ls -la"' } });
  });

  it("does not rewrite when outcome is Passthrough", async () => {
    mockResolve(
      JSON.stringify({
        input: "docker build .",
        outcome: "Passthrough",
        command: "docker build .",
      }),
    );

    const result = await toolStartHandler(
      { toolName: "Bash", args: { command: "docker build ." } },
      { cwd: "/tmp" },
    );
    expect(result).toBeUndefined();
  });

  it("fails open (returns void) on exec error", async () => {
    mockReject("not found");

    const result = await toolStartHandler(
      { toolName: "Bash", args: { command: "go test ./..." } },
      { cwd: "/tmp" },
    );
    expect(result).toBeUndefined();
  });

  it("skips commands already starting with hypa", async () => {
    vi.mocked(mockExecFile).mockImplementation(() => {
      throw new Error("should not be called");
    });

    const result = await toolStartHandler(
      { toolName: "Bash", args: { command: "hypa doctor" } },
      { cwd: "/tmp" },
    );
    expect(result).toBeUndefined();
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("skips hypa commands after stripping cd prefix and redirect suffix", async () => {
    vi.mocked(mockExecFile).mockImplementation(() => {
      throw new Error("should not be called");
    });

    const result = await toolStartHandler(
      { toolName: "Bash", args: { command: "cd /tmp && hypa git status 2>&1" } },
      { cwd: "/tmp" },
    );
    expect(result).toBeUndefined();
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("skips heredoc commands because generic wrapping changes shell semantics", async () => {
    vi.mocked(mockExecFile).mockImplementation(() => {
      throw new Error("should not be called");
    });

    const result = await toolStartHandler(
      { toolName: "Bash", args: { command: "node <<'NODE'\nconsole.log('hi')\nNODE" } },
      { cwd: "/tmp" },
    );
    expect(result).toBeUndefined();
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("skips multi-line shell scripts because generic wrapping can change semantics", async () => {
    vi.mocked(mockExecFile).mockImplementation(() => {
      throw new Error("should not be called");
    });

    const result = await toolStartHandler(
      { toolName: "Bash", args: { command: "echo one\necho two" } },
      { cwd: "/tmp" },
    );
    expect(result).toBeUndefined();
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("ignores non-Bash tool calls", async () => {
    const result = await toolStartHandler(
      { toolName: "Read", args: { file_path: "/tmp/test.txt" } },
      { cwd: "/tmp" },
    );
    expect(result).toBeUndefined();
  });

  it("ignores empty command", async () => {
    const result = await toolStartHandler({ toolName: "Bash", args: {} }, { cwd: "/tmp" });
    expect(result).toBeUndefined();
  });

  // --- exec_command tool support ---
  // Some model harnesses (Letta Auto, GLM) expose the shell tool as
  // exec_command with a `cmd` arg key instead of Bash with `command`.

  it("rewrites exec_command using cmd arg key", async () => {
    mockResolve(
      JSON.stringify({
        input: "git status",
        outcome: "Rewritten",
        command: "hypa git status",
      }),
    );

    const result = await toolStartHandler(
      { toolName: "exec_command", args: { cmd: "git status" } },
      { cwd: "/tmp" },
    );
    expect(result).toEqual({ args: { cmd: "hypa git status" } });
  });

  it("does not rewrite exec_command on Passthrough", async () => {
    mockResolve(
      JSON.stringify({
        input: "docker build .",
        outcome: "Passthrough",
        command: "docker build .",
      }),
    );

    const result = await toolStartHandler(
      { toolName: "exec_command", args: { cmd: "docker build ." } },
      { cwd: "/tmp" },
    );
    expect(result).toBeUndefined();
  });

  it("fails open on exec_command error", async () => {
    mockReject("not found");

    const result = await toolStartHandler(
      { toolName: "exec_command", args: { cmd: "go test ./..." } },
      { cwd: "/tmp" },
    );
    expect(result).toBeUndefined();
  });

  it("recovers Passthrough from non-zero exit for exec_command", async () => {
    mockRejectWithStdout(
      JSON.stringify({
        input: "cd /tmp && npm run ci 2>&1",
        outcome: "Passthrough",
        command: "cd /tmp && npm run ci 2>&1",
      }),
    );

    const result = await toolStartHandler(
      { toolName: "exec_command", args: { cmd: "cd /tmp && npm run ci 2>&1" } },
      { cwd: "/tmp" },
    );
    // Passthrough → no rewrite, command runs as-is
    expect(result).toBeUndefined();
  });

  it("recovers Rewritten from non-zero exit for Bash", async () => {
    mockRejectWithStdout(
      JSON.stringify({
        input: "git status",
        outcome: "Rewritten",
        command: "hypa git status",
      }),
    );

    const result = await toolStartHandler(
      { toolName: "Bash", args: { command: "git status" } },
      { cwd: "/tmp" },
    );
    expect(result).toEqual({ args: { command: "hypa git status" } });
  });

  // --- cd prefix and 2>&1 suffix stripping ---
  // The harness prepends "cd <workdir> &&" and appends "2>&1" to commands,
  // which prevents Hypa's reducers from matching. The handler strips these,
  // sends the core to hypa rewrite, and re-attaches them after.

  it("strips cd prefix and 2>&1 suffix, rewrites core, re-attaches both", async () => {
    mockResolve(
      JSON.stringify({
        input: "npm run ci",
        outcome: "GenericWrapper",
        command: 'hypa -c "npm run ci"',
      }),
    );

    const result = await toolStartHandler(
      { toolName: "Bash", args: { command: "cd /tmp && npm run ci 2>&1" } },
      { cwd: "/tmp" },
    );
    expect(result).toEqual({
      args: { command: 'cd /tmp && hypa -c "npm run ci" 2>&1' },
    });
  });

  it("strips only cd prefix when no redirect", async () => {
    mockResolve(
      JSON.stringify({
        input: "git status",
        outcome: "Rewritten",
        command: "hypa git status",
      }),
    );

    const result = await toolStartHandler(
      { toolName: "Bash", args: { command: "cd /tmp && git status" } },
      { cwd: "/tmp" },
    );
    expect(result).toEqual({ args: { command: "cd /tmp && hypa git status" } });
  });

  it("strips only 2>&1 suffix when no cd prefix", async () => {
    mockResolve(
      JSON.stringify({
        input: "npm run ci",
        outcome: "GenericWrapper",
        command: 'hypa -c "npm run ci"',
      }),
    );

    const result = await toolStartHandler(
      { toolName: "Bash", args: { command: "npm run ci 2>&1" } },
      { cwd: "/tmp" },
    );
    expect(result).toEqual({
      args: { command: 'hypa -c "npm run ci" 2>&1' },
    });
  });

  it("passes through original when core is Passthrough", async () => {
    mockResolve(
      JSON.stringify({
        input: "docker build .",
        outcome: "Passthrough",
        command: "docker build .",
      }),
    );

    const result = await toolStartHandler(
      { toolName: "Bash", args: { command: "cd /tmp && docker build . 2>&1" } },
      { cwd: "/tmp" },
    );
    expect(result).toBeUndefined();
  });

  it("preserves other args when stripping cd/redirect", async () => {
    mockResolve(
      JSON.stringify({
        input: "git status",
        outcome: "Rewritten",
        command: "hypa git status",
      }),
    );

    const result = await toolStartHandler(
      {
        toolName: "Bash",
        args: { command: "cd /tmp && git status 2>&1", timeout: 5000 },
      },
      { cwd: "/tmp" },
    );
    expect(result).toEqual({
      args: { command: "cd /tmp && hypa git status 2>&1", timeout: 5000 },
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: /hypa command
// ---------------------------------------------------------------------------

describe("/hypa command", () => {
  let letta: LettaModApi;
  let dispose: (() => void) | undefined;
  let commandRun: (ctx: {
    cwd: string;
    args: string;
  }) => Promise<{ type: string; output: string }> | { type: string; output: string };

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

  it("shows diagnostics with no rewrites yet", async () => {
    // fetchHypaSessionStats calls hypaExec which calls mockExecFile.
    // Mock it to return empty session status so it doesn't interfere.
    mockImplementation((_bin, args) => {
      if (args?.includes?.("session")) return execResult("tokens_saved: 0\ntool_calls: 0\n");
      return execResult("");
    });

    const result = await commandRun({ cwd: "/tmp", args: "" });
    expect(result.type).toBe("output");
    expect(result.output).toContain("Hypa integration for Letta Code");
    expect(result.output).toContain("no rewrites yet");
  });

  it("shows install guidance when the hypa binary is missing", async () => {
    mockImplementation((_bin, args) => {
      if (args?.includes?.("-lc")) return Promise.reject(execError("not found"));
      return execResult("");
    });

    const result = await commandRun({ cwd: "/tmp", args: "" });
    expect(result.type).toBe("output");
    expect(result.output).toContain("Available:   no");
    expect(result.output).toContain("https://github.com/Hypabolic/Hypa");
    expect(result.output).not.toContain("Hypa session:");
  });

  it("shows last rewrite after a rewrite occurs", async () => {
    mockImplementation((_bin, args) => {
      if (args?.includes?.("rewrite")) {
        return execResult(
          JSON.stringify({
            input: "git status",
            outcome: "Rewritten",
            command: "hypa git status",
          }),
        );
      }
      if (args?.includes?.("session")) return execResult("tokens_saved: 0\ntool_calls: 0\n");
      return execResult("");
    });

    await hypaRewrite("git status", "/tmp");

    const result = await commandRun({ cwd: "/tmp", args: "" });
    expect(result.output).toContain("git status");
    expect(result.output).toContain("Rewritten");
    expect(result.output).toContain("hypa git status");
  });

  it("shows error in diagnostics after a failed rewrite", async () => {
    mockImplementation((_bin, args) => {
      if (args?.includes?.("rewrite")) {
        return Promise.reject(execError("binary not found"));
      }
      if (args?.includes?.("session")) return execResult("tokens_saved: 0\ntool_calls: 0\n");
      return execResult("");
    });

    await hypaRewrite("go test ./...", "/tmp");

    const result = await commandRun({ cwd: "/tmp", args: "" });
    expect(result.output).toContain("Error");
    expect(result.output).toContain("binary not found");
  });

  it("shows mod stats and hypa session stats", async () => {
    mockImplementation((_bin, args) => {
      if (args?.includes?.("rewrite")) {
        return execResult(
          JSON.stringify({
            input: "git status",
            outcome: "Rewritten",
            command: "hypa git status",
          }),
        );
      }
      if (args?.includes?.("session")) {
        return execResult("tokens_saved: 1337\ntool_calls: 42\n");
      }
      return execResult("");
    });

    await hypaRewrite("git status", "/tmp");

    const result = await commandRun({ cwd: "/tmp", args: "" });
    // Mod stats
    expect(result.output).toContain("Mod stats (this session):");
    expect(result.output).toContain("Rewrites:     1");
    expect(result.output).toContain("Passthroughs: 0");
    // Hypa session stats
    expect(result.output).toContain("Hypa session:");
    expect(result.output).toContain("Tokens saved: 1337");
    expect(result.output).toContain("Tool calls:   42");
  });

  it("prefers command metrics over stale session counters", async () => {
    mockImplementation((bin, args) => {
      if (bin === "sqlite3") {
        return execResult("91|1724\n");
      }
      if (args?.includes?.("session")) {
        return execResult(
          "id:           session-1\nproject_root: /tmp\ntool_calls:   0\ntokens_saved: 0\n",
        );
      }
      return execResult("");
    });

    const result = await commandRun({ cwd: "/tmp", args: "" });

    expect(result.output).toContain("Hypa session:");
    expect(result.output).toContain("Tool calls:   91");
    expect(result.output).toContain("Tokens saved: 1724");
    expect(result.output).toContain("Source:       command metrics");
  });

  it("handles fetchHypaSessionStats failure gracefully", async () => {
    mockImplementation((_bin, args) => {
      if (args?.includes?.("session")) {
        return Promise.reject(execError("connection refused"));
      }
      return execResult("");
    });

    const result = await commandRun({ cwd: "/tmp", args: "" });
    // Should still show mod stats even if session stats fail
    expect(result.output).toContain("Mod stats (this session):");
    // Should NOT show Hypa session section
    expect(result.output).not.toContain("Hypa session:");
  });
});

// ---------------------------------------------------------------------------
// Tests: hypa_read tool
// ---------------------------------------------------------------------------

describe("hypa_read tool", () => {
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

  it("reads a file with default smart mode", async () => {
    let capturedArgs: unknown[] = [];
    mockImplementation((_bin, args) => {
      capturedArgs = args as unknown[];
      return execResult("compressed file contents");
    });

    const result = await toolRun({ cwd: "/tmp", args: { path: "/tmp/test.txt" } });
    expect(result).toBe("compressed file contents");
    expect(capturedArgs).toContain("read");
    expect(capturedArgs).toContain("/tmp/test.txt");
    expect(capturedArgs).toContain("--mode");
    expect(capturedArgs).toContain("smart");
  });

  it("uses custom mode when provided", async () => {
    let capturedArgs: unknown[] = [];
    mockImplementation((_bin, args) => {
      capturedArgs = args as unknown[];
      return execResult("outline output");
    });

    const result = await toolRun({ cwd: "/tmp", args: { path: "/tmp/test.txt", mode: "outline" } });
    expect(result).toBe("outline output");
    expect(capturedArgs).toContain("outline");
  });

  it("returns error when path is missing", async () => {
    const result = await toolRun({ cwd: "/tmp", args: {} });
    expect(result).toEqual({ status: "error", content: "path is required" });
  });

  it("returns error on exec failure", async () => {
    mockReject("file not found");

    const result = await toolRun({ cwd: "/tmp", args: { path: "/nonexistent" } });
    expect(result).toEqual({ status: "error", content: "file not found" });
  });
});

// ---------------------------------------------------------------------------
// Tests: hypa_search tool
// ---------------------------------------------------------------------------

describe("hypa_search tool", () => {
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

  it("searches with query", async () => {
    let capturedArgs: unknown[] = [];
    mockImplementation((_bin, args) => {
      capturedArgs = args as unknown[];
      return execResult("search results");
    });

    const result = await toolRun({ cwd: "/tmp", args: { query: "auth handler" } });
    expect(result).toBe("search results");
    expect(capturedArgs).toContain("search");
    expect(capturedArgs).toContain("auth handler");
  });

  it("passes scope and kind options", async () => {
    let capturedArgs: unknown[] = [];
    mockImplementation((_bin, args) => {
      capturedArgs = args as unknown[];
      return execResult("results");
    });

    const result = await toolRun({
      cwd: "/tmp",
      args: { query: "test", scope: "code", kind: "symbol" },
    });
    expect(result).toBe("results");
    expect(capturedArgs).toContain("--scope");
    expect(capturedArgs).toContain("code");
    expect(capturedArgs).toContain("--kind");
    expect(capturedArgs).toContain("symbol");
  });

  it("returns error when query is missing", async () => {
    const result = await toolRun({ cwd: "/tmp", args: {} });
    expect(result).toEqual({ status: "error", content: "query is required" });
  });

  it("returns No matches on empty output", async () => {
    mockResolve("");

    const result = await toolRun({ cwd: "/tmp", args: { query: "nonexistent" } });
    expect(result).toBe("No matches.");
  });
});

// ---------------------------------------------------------------------------
// Tests: hypa_compress tool
// ---------------------------------------------------------------------------

describe("hypa_compress tool", () => {
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

  it("compresses text via stdin", async () => {
    let capturedInput: string | undefined;
    let capturedArgs: unknown[] = [];
    mockImplementation((_bin, args, opts) => {
      capturedArgs = args as unknown[];
      capturedInput = (opts as Record<string, unknown>).input as string;
      return execResult("compressed text");
    });

    const result = await toolRun({ cwd: "/tmp", args: { text: "long log output here" } });
    expect(result).toBe("compressed text");
    expect(capturedInput).toBe("long log output here");
    expect(capturedArgs).toContain("compress");
    expect(capturedArgs).toContain("--kind");
    expect(capturedArgs).toContain("generic");
  });

  it("uses custom kind when provided", async () => {
    let capturedArgs: unknown[] = [];
    mockImplementation((_bin, args) => {
      capturedArgs = args as unknown[];
      return execResult("compressed");
    });

    const result = await toolRun({
      cwd: "/tmp",
      args: { text: "output", kind: "shell-output" },
    });
    expect(result).toBe("compressed");
    expect(capturedArgs).toContain("shell-output");
  });

  it("returns error when text is missing", async () => {
    const result = await toolRun({ cwd: "/tmp", args: {} });
    expect(result).toEqual({ status: "error", content: "text is required" });
  });
});

// ---------------------------------------------------------------------------
// Tests: hypa_mcp_proxy tool
// ---------------------------------------------------------------------------

describe("hypa_mcp_proxy tool", () => {
  let letta: LettaModApi;
  let dispose: (() => void) | undefined;
  let toolRun: (ctx: { cwd: string; args: Record<string, unknown> }) => Promise<unknown>;
  let registeredTool: { requiresApproval?: boolean; parallelSafe?: boolean } | undefined;

  beforeEach(() => {
    vi.mocked(mockExecFile).mockReset();
    process.env.HYPA_LETTA_ENABLE_MCP_PROXY = "1";
    letta = makeLettaApi();
    (letta.tools?.register as ReturnType<typeof vi.fn>).mockImplementation(
      (tool: {
        name: string;
        run: typeof toolRun;
        requiresApproval?: boolean;
        parallelSafe?: boolean;
      }) => {
        if (tool.name === "hypa_mcp_proxy") {
          toolRun = tool.run;
          registeredTool = tool;
        }
        return () => {};
      },
    );
    dispose = activate(letta);
  });

  afterEach(() => {
    dispose?.();
    delete process.env.HYPA_LETTA_ENABLE_MCP_PROXY;
  });

  it("requires approval and is not parallel-safe because invoke can be side-effectful", () => {
    expect(registeredTool?.requiresApproval).toBe(true);
    expect(registeredTool?.parallelSafe).toBe(false);
  });

  it("lists servers", async () => {
    let capturedArgs: unknown[] = [];
    mockImplementation((_bin, args) => {
      capturedArgs = args as unknown[];
      return execResult("server1\nserver2");
    });

    const result = await toolRun({ cwd: "/tmp", args: { action: "list" } });
    expect(result).toBe("server1\nserver2");
    expect(capturedArgs).toEqual(["mcp", "list"]);
  });

  it("searches for tools", async () => {
    let capturedArgs: unknown[] = [];
    mockImplementation((_bin, args) => {
      capturedArgs = args as unknown[];
      return execResult("github-pr tool");
    });

    const result = await toolRun({ cwd: "/tmp", args: { action: "search", query: "github" } });
    expect(result).toBe("github-pr tool");
    expect(capturedArgs).toContain("mcp");
    expect(capturedArgs).toContain("search");
    expect(capturedArgs).toContain("--query");
    expect(capturedArgs).toContain("github");
  });

  it("returns error when query missing for search action", async () => {
    const result = await toolRun({ cwd: "/tmp", args: { action: "search" } });
    expect(result).toEqual({ status: "error", content: "query is required for 'search'" });
  });

  it("invokes a tool on a server", async () => {
    let capturedArgs: unknown[] = [];
    mockImplementation((_bin, args) => {
      capturedArgs = args as unknown[];
      return execResult("repo list");
    });

    const result = await toolRun({
      cwd: "/tmp",
      args: { action: "invoke", server: "my-server", tool: "list_repos" },
    });
    expect(result).toBe("repo list");
    expect(capturedArgs).toContain("mcp");
    expect(capturedArgs).toContain("invoke");
    expect(capturedArgs).toContain("--server");
    expect(capturedArgs).toContain("my-server");
    expect(capturedArgs).toContain("--tool");
    expect(capturedArgs).toContain("list_repos");
  });

  it("returns error when server missing for invoke", async () => {
    const result = await toolRun({ cwd: "/tmp", args: { action: "invoke", tool: "test" } });
    expect(result).toEqual({
      status: "error",
      content: "server and tool are required for 'invoke'",
    });
  });

  it("returns error for unknown action", async () => {
    const result = await toolRun({ cwd: "/tmp", args: { action: "unknown" } });
    expect(result).toEqual({ status: "error", content: "Unknown action: unknown" });
  });
});
