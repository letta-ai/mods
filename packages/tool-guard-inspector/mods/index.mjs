const MAX_AUDIT_ENTRIES = 50;

const READ_ONLY_TOOL_NAMES = new Set([
  "glob",
  "globgemini",
  "grep",
  "grepfiles",
  "list",
  "listdir",
  "listdirectory",
  "ls",
  "notebookread",
  "read",
  "readfile",
  "readfilegemini",
  "readlsp",
  "readmanyfiles",
  "search",
  "searchfilecontent",
  "searchfiles",
  "viewimage",
  "webfetch",
  "fetchwebpage",
  "websearch",
]);

const MUTATING_TOOL_NAMES = new Set([
  "applypatch",
  "edit",
  "multiedit",
  "notebookedit",
  "patch",
  "write",
  "writefile",
]);

const SHELL_TOOL_NAMES = new Set([
  "bash",
  "exec",
  "execcommand",
  "runcommand",
  "shell",
  "terminal",
]);

const DELEGATION_TOOL_NAMES = new Set(["agent", "task", "subagent"]);

const READ_ONLY_SHELL_PATTERNS = [
  /^(pwd|ls|cat|head|tail|wc)(\s|$)/,
  /^sed\s+-n\s+/,
  /^git\s+(status|diff|log|show|rev-parse|branch)(\s|$)/,
  /^rg\s+/,
  /^find\s+[^;|&<>`]*$/,
];

const DANGEROUS_SHELL_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*|--recursive|--force)\b/,
  /\b(git\s+(push|commit|reset|clean|rebase|merge)|gh\s+pr\s+merge)\b/,
  /\b(npm|pnpm|yarn|bun)\s+(install|add|remove|update|upgrade)\b/,
  /\b(curl|wget)\b.*\|\s*(sh|bash)\b/,
  /\bchmod\s+(\+x|[0-7]{3,4})\b/,
];

const MUTATING_SHELL_PATTERNS = [
  /\b(mv|cp|mkdir|touch|tee)\b/,
  /\b(git\s+(add|checkout|switch|restore|tag))\b/,
  /\b(pip|uv|poetry)\s+(install|add|remove|update)\b/,
];

const auditLog = [];

function normalizeName(value) {
  return String(value ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function nowIsoTime() {
  return new Date().toISOString();
}

function truncate(value, maxLength = 120) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function extractCommand(args) {
  if (!args || typeof args !== "object") return "";
  return String(args.command ?? args.cmd ?? args.input ?? args.script ?? "");
}

function summarizeArgs(args) {
  if (!args || typeof args !== "object") return "";
  const command = extractCommand(args);
  if (command.trim()) return `command=${truncate(command.trim(), 100)}`;

  const pathValue =
    args.file_path ??
    args.path ??
    args.notebook_path ??
    args.cwd ??
    args.workingDirectory;
  if (typeof pathValue === "string" && pathValue.trim()) {
    return `path=${truncate(pathValue.trim(), 100)}`;
  }

  const keys = Object.keys(args).slice(0, 6);
  return keys.length ? `args=${keys.join(",")}` : "";
}

function classifyShellCommand(command) {
  const trimmed = String(command ?? "").trim();

  if (!trimmed) {
    return {
      decision: "ask",
      category: "shell",
      reason: "empty shell command",
    };
  }

  if (DANGEROUS_SHELL_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return {
      decision: "deny",
      category: "shell",
      reason: "dangerous shell command pattern",
    };
  }

  if (/[|;&<>`\n]/.test(trimmed) || trimmed.includes("$(") || trimmed.includes("${")) {
    return {
      decision: "ask",
      category: "shell",
      reason: "chained, piped, redirected, or expanded shell command",
    };
  }

  if (READ_ONLY_SHELL_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return {
      decision: "allow",
      category: "shell",
      reason: "read-only shell command",
    };
  }

  if (MUTATING_SHELL_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return {
      decision: "ask",
      category: "shell",
      reason: "potentially mutating shell command",
    };
  }

  return {
    decision: "ask",
    category: "shell",
    reason: "unclassified shell command",
  };
}

function classifyToolCall(event) {
  const toolName = String(event?.toolName ?? "unknown");
  const normalized = normalizeName(toolName);
  const args = event?.args ?? {};

  if (READ_ONLY_TOOL_NAMES.has(normalized)) {
    return {
      toolName,
      decision: "allow",
      category: "read-only",
      reason: "read-only tool",
    };
  }

  if (SHELL_TOOL_NAMES.has(normalized)) {
    return {
      toolName,
      ...classifyShellCommand(extractCommand(args)),
    };
  }

  if (MUTATING_TOOL_NAMES.has(normalized)) {
    return {
      toolName,
      decision: "ask",
      category: "mutation",
      reason: "file mutation tool",
    };
  }

  if (DELEGATION_TOOL_NAMES.has(normalized)) {
    return {
      toolName,
      decision: "ask",
      category: "delegation",
      reason: "delegated agent or task",
    };
  }

  return {
    toolName,
    decision: "allow",
    category: "unknown",
    reason: "unclassified tool; observe only",
  };
}

function pushAudit(event, result) {
  auditLog.push({
    at: nowIsoTime(),
    conversationId: String(event?.conversationId ?? "__global__"),
    toolName: result.toolName,
    decision: result.decision,
    category: result.category,
    reason: result.reason,
    summary: summarizeArgs(event?.args),
  });

  while (auditLog.length > MAX_AUDIT_ENTRIES) auditLog.shift();
}

function iconForDecision(decision) {
  if (decision === "allow") return "✓";
  if (decision === "ask") return "⚠";
  if (decision === "deny") return "✗";
  return "·";
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString(undefined, { hour12: false });
}

function entriesForConversation(conversationId, includeAll) {
  if (includeAll || !conversationId) return auditLog;
  return auditLog.filter((entry) => entry.conversationId === conversationId);
}

function renderStats(entries) {
  const stats = entries.reduce(
    (acc, entry) => {
      acc[entry.decision] = (acc[entry.decision] ?? 0) + 1;
      return acc;
    },
    { allow: 0, ask: 0, deny: 0 },
  );

  return `allowed: ${stats.allow ?? 0} | asked: ${stats.ask ?? 0} | denied: ${stats.deny ?? 0}`;
}

function renderAuditLog({ conversationId, includeAll = false, limit = 12 } = {}) {
  const entries = entriesForConversation(conversationId, includeAll).slice(-limit).reverse();

  if (entries.length === 0) {
    return [
      "Tool Guard Inspector",
      "",
      "No tool permission checks have been recorded yet.",
      "Run a tool call, then use /tool-guard again.",
    ].join("\n");
  }

  const lines = [
    "Tool Guard Inspector",
    "",
    "Recent permission decisions:",
    ...entries.map((entry) => {
      const detail = entry.summary ? ` | ${entry.summary}` : "";
      return `${iconForDecision(entry.decision)} ${formatTime(entry.at)}  ${entry.toolName}  ${entry.decision}  ${entry.reason}${detail}`;
    }),
    "",
    `Stats: ${renderStats(entriesForConversation(conversationId, includeAll))}`,
  ];

  if (!includeAll) {
    lines.push("Scope: current conversation. Use /tool-guard all to include all in-memory entries.");
  }

  return lines.join("\n");
}

function parseCommandArgs(args) {
  const parts = String(args ?? "").trim().split(/\s+/).filter(Boolean);
  const includeAll = parts.includes("all");
  const clear = parts.includes("clear");
  const numericLimit = parts.map((part) => Number.parseInt(part, 10)).find((value) => Number.isFinite(value));
  const limit = numericLimit && numericLimit > 0 ? Math.min(numericLimit, MAX_AUDIT_ENTRIES) : 12;
  return { includeAll, clear, limit };
}

function clearEntries(conversationId, includeAll) {
  if (includeAll || !conversationId) {
    const count = auditLog.length;
    auditLog.length = 0;
    return count;
  }

  let removed = 0;
  for (let i = auditLog.length - 1; i >= 0; i -= 1) {
    if (auditLog[i].conversationId === conversationId) {
      auditLog.splice(i, 1);
      removed += 1;
    }
  }
  return removed;
}

export default function activate(letta) {
  const disposers = [];

  if (letta.capabilities?.permissions) {
    disposers.push(
      letta.permissions.register({
        id: "tool-guard-inspector",
        description:
          "Classify selected tool calls as allow/ask/deny and keep an in-session audit log.",
        check(event) {
          const result = classifyToolCall(event);
          pushAudit(event, result);
          return {
            decision: result.decision,
            reason: result.reason,
          };
        },
      }),
    );
  }

  if (letta.capabilities?.commands) {
    disposers.push(
      letta.commands.register({
        id: "tool-guard",
        description: "Show recent tool permission decisions recorded by Tool Guard Inspector",
        args: "[all] [clear] [limit]",
        showInTranscript: false,
        run(ctx) {
          const { includeAll, clear, limit } = parseCommandArgs(ctx.args);
          const conversationId = String(ctx.conversation?.id ?? "__global__");

          if (clear) {
            const removed = clearEntries(conversationId, includeAll);
            return {
              type: "output",
              output: `Tool Guard Inspector cleared ${removed} audit entr${removed === 1 ? "y" : "ies"}.`,
            };
          }

          return {
            type: "output",
            output: renderAuditLog({ conversationId, includeAll, limit }),
          };
        },
      }),
    );
  }

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
