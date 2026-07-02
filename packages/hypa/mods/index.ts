// letta-hypa mod for Letta Code
// Integrates Hypa — a local context runtime for coding agents.
// Hypa reduces noisy tool output via deterministic, local compression.
// See https://pi.dev/packages/@hypabolic/pi-hypa for the Pi extension this is adapted from.

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Letta Code mod API types (minimal subset used by this mod)
// ---------------------------------------------------------------------------

export interface ToolStartEvent {
  agentId?: string | null;
  conversationId?: string | null;
  toolCallId?: string | null;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolStartResult {
  args: Record<string, unknown>;
}

export interface ModEventContext {
  cwd?: string;
  workingDirectory?: string;
  signal?: AbortSignal;
  context?: {
    cwd?: string;
    workspace?: {
      cwd?: string;
      currentDir?: string;
    };
  };
}

export type ToolStartHandler = (
  event: ToolStartEvent,
  ctx: ModEventContext,
) => Promise<ToolStartResult | undefined> | ToolStartResult | undefined;

export interface ToolRunContext {
  cwd: string;
  args: Record<string, unknown>;
  signal?: AbortSignal;
  conversation?: {
    getHistory(opts?: unknown): Promise<unknown[]>;
  };
}

export interface ToolRegistration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval?: boolean;
  approvalPolicy?: string;
  parallelSafe?: boolean;
  run(ctx: ToolRunContext): Promise<string | { status: string; content: string }>;
}

export interface CommandRunContext {
  cwd: string;
  args: string;
  agent?: { name?: string | null; id?: string | null };
}

export interface CommandResult {
  type: "output" | "prompt" | "handled";
  output?: string;
  content?: string;
  systemReminder?: boolean;
}

export interface CommandRegistration {
  id: string;
  description: string;
  args?: string;
  showInTranscript?: boolean;
  runWhenBusy?: boolean;
  run(ctx: CommandRunContext): CommandResult | Promise<CommandResult>;
}

export interface LettaModApi {
  capabilities?: {
    tools?: boolean;
    commands?: boolean;
    events?: {
      lifecycle?: boolean;
      tools?: boolean;
      turns?: boolean;
    };
    permissions?: boolean;
    providers?: boolean;
    ui?: {
      panels?: boolean;
      statusValues?: boolean;
    };
  };
  tools?: {
    register(tool: ToolRegistration): () => void;
  };
  commands?: {
    register(cmd: CommandRegistration): () => void;
  };
  events?: {
    on(name: "tool_start", handler: ToolStartHandler): () => void;
    on(name: string, handler: (...args: unknown[]) => unknown): () => void;
  };
  diagnostics?: {
    report(opts: { message: string; severity?: "error" | "warning" }): void;
  };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getHypaBin(): string {
  return process.env.HYPA_BIN || "hypa";
}

function getRewriteTimeoutMs(): number {
  return Number.parseInt(process.env.HYPA_LETTA_REWRITE_TIMEOUT_MS || "5000", 10);
}

function getMcpProxyEnabled(): boolean {
  return process.env.HYPA_LETTA_ENABLE_MCP_PROXY === "1";
}

function getMcpProxyTimeoutMs(): number {
  return Number.parseInt(process.env.HYPA_LETTA_MCP_PROXY_TIMEOUT_MS || "10000", 10);
}

async function isHypaInstalled(execFn: typeof execFileAsync = execFileAsync): Promise<boolean> {
  const bin = getHypaBin();
  try {
    await execFn("sh", ["-lc", 'command -v "$1" >/dev/null 2>&1', "sh", bin], {
      timeout: 3000,
      maxBuffer: 16 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

function reportHypaMissing(letta: LettaModApi): void {
  letta.diagnostics?.report({
    severity: "warning",
    message:
      `@letta-ai/hypa: Hypa binary '${getHypaBin()}' was not found. ` +
      "Install Hypa from https://github.com/Hypabolic/Hypa or set HYPA_BIN. " +
      "Shell commands will run unchanged until Hypa is available.",
  });
}

// ---------------------------------------------------------------------------
// Rewrite state (module-level for diagnostics)
// ---------------------------------------------------------------------------

export interface RewriteRecord {
  input: string;
  outcome: string;
  command: string | null;
  error: string | null;
}

export interface ModStats {
  rewrites: number;
  passthroughs: number;
  errors: number;
  tokensSaved: number;
}

let lastRewrite: RewriteRecord | null = null;
const observedToolStartNames = new Set<string>();
const modStats: ModStats = { rewrites: 0, passthroughs: 0, errors: 0, tokensSaved: 0 };

export function getLastRewrite(): RewriteRecord | null {
  return lastRewrite;
}

export function getModStats(): ModStats {
  return { ...modStats };
}

export function resetRewriteState(): void {
  lastRewrite = null;
  observedToolStartNames.clear();
  modStats.rewrites = 0;
  modStats.passthroughs = 0;
  modStats.errors = 0;
  modStats.tokensSaved = 0;
}

function trackRewrite(result: RewriteResult): void {
  if (result.outcome === "Rewritten" || result.outcome === "GenericWrapper") {
    modStats.rewrites++;
  } else if (result.outcome === "Passthrough") {
    modStats.passthroughs++;
  }
}

// ---------------------------------------------------------------------------
// Hypa CLI helpers
// ---------------------------------------------------------------------------

export interface RewriteResult {
  input: string;
  outcome: string;
  command: string;
}

export async function hypaRewrite(
  command: string,
  cwd: string,
  execFn: typeof execFileAsync = execFileAsync,
): Promise<RewriteResult | null> {
  const bin = getHypaBin();
  const timeoutMs = getRewriteTimeoutMs();
  try {
    const { stdout } = await execFn(bin, ["rewrite", command, "--json"], {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    const result = JSON.parse(stdout) as RewriteResult;
    lastRewrite = { ...result, error: null };
    trackRewrite(result);
    return result;
  } catch (error) {
    // Hypa may exit non-zero for Passthrough outcomes while still emitting
    // valid JSON on stdout.  Attempt to recover the result before treating
    // this as a real error.
    const maybeStdout =
      error && typeof error === "object" && "stdout" in error
        ? String((error as { stdout?: unknown }).stdout ?? "")
        : "";
    if (maybeStdout) {
      try {
        const result = JSON.parse(maybeStdout) as RewriteResult;
        if (
          result.outcome === "Passthrough" ||
          result.outcome === "Rewritten" ||
          result.outcome === "GenericWrapper"
        ) {
          lastRewrite = { ...result, error: null };
          trackRewrite(result);
          return result;
        }
      } catch {
        // stdout wasn't valid JSON — fall through to real error handling
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    lastRewrite = { input: command, outcome: "Error", command: null, error: message };
    modStats.errors++;
    return null;
  }
}

export async function hypaExec(
  args: string[],
  cwd: string,
  options?: { timeoutMs?: number; input?: string },
  execFn: typeof execFileAsync = execFileAsync,
): Promise<string> {
  const bin = getHypaBin();
  const timeoutMs = options?.timeoutMs ?? 30_000;
  try {
    const execOptions: Parameters<typeof execFn>[2] = {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    };
    if (options?.input !== undefined) {
      (execOptions as { input?: string }).input = options.input;
    }
    const { stdout } = await execFn(bin, args, execOptions);
    return typeof stdout === "string" ? stdout : stdout.toString("utf8");
  } catch (error) {
    if (error && typeof error === "object" && "stderr" in error) {
      const stderr = String((error as { stderr?: string }).stderr ?? "").trim();
      if (stderr) throw new Error(stderr);
    }
    throw error;
  }
}

interface SessionStats {
  sessionId: string | null;
  tokensSaved: number | null;
  toolCalls: number | null;
  commandTokensSaved: number | null;
  commandToolCalls: number | null;
}

function parseSessionStat(output: string, key: string): number | null {
  const match = output.match(new RegExp(`^${key}:\\s*(\\d+)`, "m"));
  return match ? Number.parseInt(match[1], 10) : null;
}

function parseSessionId(output: string): string | null {
  const match = output.match(/^id:\s*([^\s]+)/m);
  if (!match) return null;

  // Session IDs are currently UUIDs. Keep this slightly broader for forward
  // compatibility, but reject anything that could affect the SQLite query.
  return /^[A-Za-z0-9_-]+$/.test(match[1]) ? match[1] : null;
}

async function fetchHypaCommandMetrics(
  sessionId: string,
): Promise<{ toolCalls: number; tokensSaved: number } | null> {
  const dbPath = process.env.HYPA_DB || `${homedir()}/.hypa/hypa.db`;
  const sql =
    "SELECT COUNT(*), COALESCE(SUM(original_tokens - compressed_tokens), 0) " +
    `FROM command_metrics WHERE session_id = '${sessionId}';`;

  try {
    const { stdout } = await execFileAsync("sqlite3", [dbPath, sql], {
      timeout: 3000,
      maxBuffer: 64 * 1024,
      encoding: "utf8",
    });
    const [toolCalls, tokensSaved] = String(stdout).trim().split("|").map(Number);
    if (!Number.isFinite(toolCalls) || !Number.isFinite(tokensSaved)) return null;

    return { toolCalls, tokensSaved };
  } catch {
    return null;
  }
}

async function fetchHypaSessionStats(): Promise<SessionStats | null> {
  try {
    const output = await hypaExec(["session", "status"], process.cwd(), {
      timeoutMs: 3000,
    });
    const sessionId = parseSessionId(output);
    const commandMetrics = sessionId ? await fetchHypaCommandMetrics(sessionId) : null;

    return {
      sessionId,
      tokensSaved: parseSessionStat(output, "tokens_saved"),
      toolCalls: parseSessionStat(output, "tool_calls"),
      commandTokensSaved: commandMetrics?.tokensSaved ?? null,
      commandToolCalls: commandMetrics?.toolCalls ?? null,
    };
  } catch {
    return null;
  }
}

async function renderHypaDiagnostics(): Promise<string> {
  const bin = getHypaBin();
  const mcpProxy = getMcpProxyEnabled();
  const installed = await isHypaInstalled();
  const lines = [
    "Hypa integration for Letta Code",
    "",
    `Binary:      ${bin}`,
    `Available:   ${installed ? "yes" : "no"}`,
    `MCP proxy:   ${mcpProxy ? "enabled" : "disabled"}`,
  ];
  if (!installed) {
    lines.push("Install:     https://github.com/Hypabolic/Hypa");
  }
  lines.push("");
  lines.push("Last rewrite:");
  if (lastRewrite) {
    lines.push(`  Input:    ${lastRewrite.input}`);
    lines.push(`  Outcome:  ${lastRewrite.outcome}`);
    if (lastRewrite.command) {
      lines.push(`  Command:  ${lastRewrite.command}`);
    }
    if (lastRewrite.error) {
      lines.push(`  Error:    ${lastRewrite.error}`);
    }
  } else {
    lines.push("  (no rewrites yet)");
  }

  // Mod-level stats (this session)
  lines.push("");
  lines.push("Mod stats (this session):");
  lines.push(`  Rewrites:     ${modStats.rewrites}`);
  lines.push(`  Passthroughs: ${modStats.passthroughs}`);
  lines.push(`  Errors:       ${modStats.errors}`);

  // Hypa session stats (global, from hypa session status)
  const session = installed ? await fetchHypaSessionStats() : null;
  if (session) {
    lines.push("");
    lines.push("Hypa session:");
    const toolCalls = session.commandToolCalls ?? session.toolCalls;
    const tokensSaved = session.commandTokensSaved ?? session.tokensSaved;
    if (toolCalls !== null) {
      lines.push(`  Tool calls:   ${toolCalls}`);
    }
    if (tokensSaved !== null) {
      lines.push(`  Tokens saved: ${tokensSaved}`);
    }
    if (session.commandToolCalls !== null || session.commandTokensSaved !== null) {
      lines.push("  Source:       command metrics");
    }
  }

  lines.push("");
  lines.push("Observed tool_start names:");
  if (observedToolStartNames.size > 0) {
    for (const name of [...observedToolStartNames].sort()) {
      lines.push(`  - ${name}`);
    }
  } else {
    lines.push("  (none yet)");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isHypaCommand(command: string): boolean {
  return command.trimStart().startsWith("hypa");
}

function isComplexShellCommand(command: string): boolean {
  // `hypa -c "..."` is not safe for multi-line scripts or here-documents: the
  // shell redirection belongs to the outer command, not the quoted inner one.
  // Leave these untouched rather than risking semantic changes.
  return command.includes("\n") || command.includes("<<");
}

export interface CommandParts {
  /** The leading "cd <dir> && " prefix, or "" if none. */
  prefix: string;
  /** The core command to send to hypa rewrite. */
  core: string;
  /** The trailing " 2>&1" redirect (or similar), or "" if none. */
  suffix: string;
}

/**
 * Extract the cd-prefix and redirect-suffix from a command so the core can be
 * sent to `hypa rewrite` without the wrapper noise that prevents reducers from
 * matching.
 *
 * The Bash tool generates commands like:
 *   cd /path/to/repo && npm run ci 2>&1
 *
 * The `cd <dir> &&` prefix and `2>&1` suffix break Hypa's reducer pattern
 * matching.  We strip them, send the core to Hypa, and re-attach them after
 * the rewrite.
 */
export function extractCommandParts(command: string): CommandParts {
  let prefix = "";
  let suffix = "";
  let core = command;

  // Extract leading "cd <dir> && " prefix.
  // Handles unquoted, double-quoted, and single-quoted paths.
  const cdMatch = core.match(/^cd\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+)\s*&&\s*/);
  if (cdMatch) {
    prefix = cdMatch[0];
    core = core.slice(prefix.length);
  }

  // Extract trailing "2>&1" redirect.
  const redirectMatch = core.match(/\s*2>&1\s*$/);
  if (redirectMatch) {
    suffix = redirectMatch[0];
    core = core.slice(0, core.length - suffix.length);
  }

  return { prefix, core, suffix };
}

function resolveCwd(ctx: ModEventContext): string {
  return (
    ctx.cwd ??
    ctx.workingDirectory ??
    ctx.context?.cwd ??
    ctx.context?.workspace?.currentDir ??
    ctx.context?.workspace?.cwd ??
    process.cwd()
  );
}

// ---------------------------------------------------------------------------
// Mod activation
// ---------------------------------------------------------------------------

export default function activate(letta: LettaModApi): () => void {
  const disposers: (() => void)[] = [];

  const canRegisterToolStart = Boolean(letta.capabilities?.events?.tools && letta.events);
  const canRegisterCommands = Boolean(letta.capabilities?.commands && letta.commands);
  const canRegisterTools = Boolean(letta.capabilities?.tools && letta.tools);

  // Pre-flight dependency check. Missing Hypa is non-fatal: shell commands
  // continue unchanged, but the user gets an actionable diagnostics warning.
  if (letta.diagnostics?.report) {
    void isHypaInstalled().then((installed) => {
      if (!installed) reportHypaMissing(letta);
    });
  }

  // 1. Shell rewrite interception via tool_start event.
  //    Intercepts Bash and exec_command tool calls and rewrites the command
  //    through `hypa rewrite --json`. When Hypa returns Rewritten or
  //    GenericWrapper, the command is replaced with the hypa-wrapped version
  //    so output is compressed in place. Passthrough and errors fail open.
  //
  //    Different model harnesses expose shell tools under different names and
  //    arg keys:
  //      - Bash:        { command: string }   (e.g. Claude-style harness)
  //      - exec_command: { cmd: string }       (e.g. Letta Auto / GLM harness)
  if (canRegisterToolStart && letta.events) {
    disposers.push(
      letta.events.on("tool_start", async (event, ctx) => {
        if (!observedToolStartNames.has(event.toolName)) {
          observedToolStartNames.add(event.toolName);
          letta.diagnostics?.report({
            severity: "warning",
            message: `letta-hypa observed tool_start toolName=${event.toolName}`,
          });
        }

        // Determine which arg key holds the command for this tool.
        const isBash = event.toolName === "Bash";
        const isExecCommand = event.toolName === "exec_command";
        if (!isBash && !isExecCommand) return;

        const commandKey = isExecCommand ? "cmd" : "command";
        const command = String(event.args?.[commandKey] ?? "");
        if (!command) return;

        // Skip multi-line scripts and here-documents; generic wrapping can
        // change their shell semantics.
        if (isComplexShellCommand(command)) return;

        const cwd = resolveCwd(ctx);

        // Strip cd-prefix and 2>&1-suffix so Hypa's reducers can match the
        // core command.  The harness prepends "cd <workdir> &&" and appends
        // "2>&1" to most commands, which prevents reducers from matching.
        const { prefix, core, suffix } = extractCommandParts(command);
        if (!core.trim()) return; // nothing to rewrite after stripping

        // Skip commands already starting with hypa after removing harness
        // wrappers, otherwise `cd <workdir> && hypa ... 2>&1` can be wrapped
        // again as `hypa -c "hypa ..."`.
        if (isHypaCommand(core)) return;

        const result = await hypaRewrite(core, cwd);
        if (!result) return; // Error — fail open, pass through original.

        if (result.outcome === "Rewritten" || result.outcome === "GenericWrapper") {
          const rewritten = prefix + result.command + suffix;
          return { args: { ...event.args, [commandKey]: rewritten } };
        }
        // Passthrough or unknown — leave command as-is.
      }),
    );
  }

  // 2. /hypa diagnostics command.
  if (canRegisterCommands && letta.commands) {
    disposers.push(
      letta.commands.register({
        id: "hypa",
        description:
          "Show Hypa integration diagnostics (binary, rewrite status, MCP proxy, stats).",
        async run() {
          return { type: "output" as const, output: await renderHypaDiagnostics() };
        },
      }),
    );
  }

  // 3. CLI-backed tools.
  if (canRegisterTools && letta.tools) {
    disposers.push(
      letta.tools.register({
        name: "hypa_diagnostics",
        description:
          "Show Hypa integration diagnostics. Use this in environments where the /hypa slash command is not available.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        requiresApproval: false,
        parallelSafe: true,
        async run() {
          return await renderHypaDiagnostics();
        },
      }),
    );

    // hypa_read — context-aware file reading.
    disposers.push(
      letta.tools.register({
        name: "hypa_read",
        description:
          "Read a file with context-aware compression via Hypa. " +
          "Use when reading large files and you want compressed or structured output. " +
          "Modes: smart (default), full, outline, signatures, pruned.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to read" },
            mode: {
              type: "string",
              description: "Read mode: smart, full, outline, signatures, pruned",
              enum: ["smart", "full", "outline", "signatures", "pruned"],
            },
            max_tokens: { type: "number", description: "Maximum tokens to return" },
          },
          required: ["path"],
          additionalProperties: false,
        },
        requiresApproval: false,
        parallelSafe: true,
        async run(ctx) {
          const path = String(ctx.args.path ?? "").trim();
          if (!path) return { status: "error", content: "path is required" };
          const mode = String(ctx.args.mode ?? "smart");
          const args = ["read", path, "--mode", mode];
          if (ctx.args.max_tokens) {
            args.push("--max-tokens", String(ctx.args.max_tokens));
          }
          try {
            const output = await hypaExec(args, ctx.cwd);
            return output || "(empty)";
          } catch (error) {
            return {
              status: "error",
              content: error instanceof Error ? error.message : String(error),
            };
          }
        },
      }),
    );

    // hypa_search — search files, symbols, and indexed context.
    disposers.push(
      letta.tools.register({
        name: "hypa_search",
        description:
          "Search files, symbols, and indexed context using Hypa. " +
          "Use for semantic code search across the project.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            scope: {
              type: "string",
              description: "Search scope: project, session, code, docs",
              enum: ["project", "session", "code", "docs"],
            },
            kind: {
              type: "string",
              description: "Search kind: text, regex, symbol",
              enum: ["text", "regex", "symbol"],
            },
            max: { type: "number", description: "Maximum number of results" },
          },
          required: ["query"],
          additionalProperties: false,
        },
        requiresApproval: false,
        parallelSafe: true,
        async run(ctx) {
          const query = String(ctx.args.query ?? "").trim();
          if (!query) return { status: "error", content: "query is required" };
          const args = ["search", query];
          if (ctx.args.scope) args.push("--scope", String(ctx.args.scope));
          if (ctx.args.kind) args.push("--kind", String(ctx.args.kind));
          if (ctx.args.max) args.push("--max", String(ctx.args.max));
          try {
            const output = await hypaExec(args, ctx.cwd);
            return output || "No matches.";
          } catch (error) {
            return {
              status: "error",
              content: error instanceof Error ? error.message : String(error),
            };
          }
        },
      }),
    );

    // hypa_compress — compress explicit text.
    disposers.push(
      letta.tools.register({
        name: "hypa_compress",
        description:
          "Compress text using Hypa's deterministic reducers. " +
          "Use when you have large text output (logs, shell output, code) " +
          "that needs compression before adding to context.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to compress" },
            kind: {
              type: "string",
              description: "Output kind: shell-output, log, code, generic",
              enum: ["shell-output", "log", "code", "generic"],
            },
            max_tokens: { type: "number", description: "Maximum output tokens" },
          },
          required: ["text"],
          additionalProperties: false,
        },
        requiresApproval: false,
        parallelSafe: true,
        async run(ctx) {
          const text = String(ctx.args.text ?? "");
          if (!text) return { status: "error", content: "text is required" };
          const kind = String(ctx.args.kind ?? "generic");
          const args = ["compress", "--kind", kind];
          if (ctx.args.max_tokens) {
            args.push("--max-tokens", String(ctx.args.max_tokens));
          }
          try {
            const output = await hypaExec(args, ctx.cwd, { input: text });
            return output || "(empty)";
          } catch (error) {
            return {
              status: "error",
              content: error instanceof Error ? error.message : String(error),
            };
          }
        },
      }),
    );

    // 4. Optional MCP proxy tool.
    if (getMcpProxyEnabled()) {
      disposers.push(
        letta.tools.register({
          name: "hypa_mcp_proxy",
          description:
            "Interact with upstream MCP servers configured in Hypa. " +
            "Actions: list, search, schema, invoke, auth_check. " +
            "Use this instead of adding individual MCP server tools to context.",
          parameters: {
            type: "object",
            properties: {
              action: {
                type: "string",
                description: "Action: list, search, schema, invoke, auth_check",
                enum: ["list", "search", "schema", "invoke", "auth_check"],
              },
              query: { type: "string", description: "Search query (for 'search' action)" },
              server: {
                type: "string",
                description: "Server name (for 'schema', 'invoke', 'auth_check')",
              },
              tool: { type: "string", description: "Tool name (for 'invoke')" },
              arguments: {
                type: "object",
                description: "Tool arguments (for 'invoke')",
                additionalProperties: true,
              },
            },
            required: ["action"],
            additionalProperties: false,
          },
          requiresApproval: true,
          parallelSafe: false,
          async run(ctx) {
            const action = String(ctx.args.action ?? "");
            const timeoutMs = getMcpProxyTimeoutMs();
            try {
              switch (action) {
                case "list": {
                  const output = await hypaExec(["mcp", "list"], ctx.cwd, { timeoutMs });
                  return output || "No servers configured.";
                }
                case "search": {
                  const query = String(ctx.args.query ?? "");
                  if (!query) return { status: "error", content: "query is required for 'search'" };
                  const output = await hypaExec(["mcp", "search", "--query", query], ctx.cwd, {
                    timeoutMs,
                  });
                  return output || "No matches.";
                }
                case "schema": {
                  const server = String(ctx.args.server ?? "");
                  if (!server)
                    return { status: "error", content: "server is required for 'schema'" };
                  const args = ["mcp", "schema"];
                  if (server) args.push("--server", server);
                  const output = await hypaExec(args, ctx.cwd, { timeoutMs });
                  return output || "(empty)";
                }
                case "invoke": {
                  const server = String(ctx.args.server ?? "");
                  const tool = String(ctx.args.tool ?? "");
                  if (!server || !tool) {
                    return {
                      status: "error",
                      content: "server and tool are required for 'invoke'",
                    };
                  }
                  const invokeArgs = ["mcp", "invoke", "--server", server, "--tool", tool];
                  if (ctx.args.arguments) {
                    invokeArgs.push("--arguments", JSON.stringify(ctx.args.arguments));
                  }
                  const output = await hypaExec(invokeArgs, ctx.cwd, { timeoutMs });
                  return output || "(empty)";
                }
                case "auth_check": {
                  const server = String(ctx.args.server ?? "");
                  if (!server)
                    return { status: "error", content: "server is required for 'auth_check'" };
                  const output = await hypaExec(
                    ["mcp", "auth", "check", "--server", server],
                    ctx.cwd,
                    {
                      timeoutMs,
                    },
                  );
                  return output || "(empty)";
                }
                default:
                  return { status: "error", content: `Unknown action: ${action}` };
              }
            } catch (error) {
              return {
                status: "error",
                content: error instanceof Error ? error.message : String(error),
              };
            }
          },
        }),
      );
    }
  }

  return () => {
    for (const dispose of disposers.reverse()) dispose();
    lastRewrite = null;
  };
}
