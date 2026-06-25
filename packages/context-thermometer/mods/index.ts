import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const DEFAULT_MAX_TOKENS = 128_000;
const BAR_WIDTH = 40;
const MAX_HISTORY = 24;
const MAX_FILE_BYTES = 100_000;
const SPARKLINE_BLOCKS = "\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588";
const CRITICAL_THRESHOLD = 90;

type ThermometerState = {
  active: boolean;
  maxTokens: number;
  inputTokens: number;
  outputTokens: number;
  peakInputTokens: number;
  peakTotalTokens: number;
  history: number[];
  lastUpdate: number;
};

let state: ThermometerState = {
  active: true,
  maxTokens: DEFAULT_MAX_TOKENS,
  inputTokens: 0,
  outputTokens: 0,
  peakInputTokens: 0,
  peakTotalTokens: 0,
  history: [],
  lastUpdate: 0,
};

let panel: { update: (opts: { content: string[] }) => void; close: () => void } | null = null;
let updatePanel = () => {};

function getMaxTokens(): number {
  const env = process.env.CONTEXT_THERMOMETER_MAX_TOKENS;
  if (env) {
    const n = Number.parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_MAX_TOKENS;
}

function candidateMemoryDirs(): string[] {
  const candidates: string[] = [];
  if (process.env.MEMORY_DIR) candidates.push(process.env.MEMORY_DIR);
  const agentId = process.env.AGENT_ID || "";
  const home = process.env.HOME || "";
  if (home && agentId) {
    candidates.push(path.join(home, ".letta", "lc-local-backend", "memfs", agentId, "memory"));
    candidates.push(path.join(home, ".letta", "agents", agentId, "memory"));
  }
  return candidates;
}

function findMemoryDir(): string | null {
  for (const candidate of candidateMemoryDirs()) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

function scanMarkdownDir(
  dir: string,
  root: string,
  out: { name: string; tokens: number }[],
): void {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      scanMarkdownDir(full, root, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      try {
        const stat = statSync(full);
        if (stat.size > MAX_FILE_BYTES) continue;
        const content = readFileSync(full, "utf8");
        const tokens = Math.ceil(content.length / 4);
        const rel = path.relative(root, full);
        out.push({ name: rel, tokens });
      } catch {
        // skip unreadable files
      }
    }
  }
}

function readMemoryBlocks(): { name: string; tokens: number }[] {
  const dir = findMemoryDir();
  if (!dir) return [];
  const blocks: { name: string; tokens: number }[] = [];
  const systemDir = path.join(dir, "system");
  if (existsSync(systemDir)) {
    scanMarkdownDir(systemDir, dir, blocks);
  }
  blocks.sort((a, b) => b.tokens - a.tokens);
  return blocks;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function pct(used: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

function renderBar(percentage: number): string {
  const filled = Math.round((percentage / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  return `\u2588`.repeat(filled) + `\u2591`.repeat(empty);
}

function renderSparkline(history: number[]): string {
  if (history.length < 2) return "";
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;
  return history
    .map((v) => {
      const idx = Math.min(7, Math.max(0, Math.floor(((v - min) / range) * 8)));
      return SPARKLINE_BLOCKS[idx];
    })
    .join("");
}

function statusLevel(percentage: number): { label: string; indicator: string } {
  if (percentage < 50) return { label: "COMFORTABLE", indicator: "\u25CF" };
  if (percentage < 75) return { label: "GETTING FULL", indicator: "\u25D0" };
  if (percentage < 90) return { label: "WARM", indicator: "\u25D1" };
  return { label: "CRITICAL", indicator: "\u25C9" };
}

function renderThermometer(
  s: ThermometerState,
  memoryBlocks: { name: string; tokens: number }[],
): string[] {
  const percentage = pct(s.inputTokens, s.maxTokens);
  const remaining = Math.max(0, s.maxTokens - s.inputTokens);
  const status = statusLevel(percentage);
  const totalMemoryTokens = memoryBlocks.reduce((sum, b) => sum + b.tokens, 0);

  const lines: string[] = [];
  lines.push(" \u{1F321}\uFE0F  Context Thermometer");
  lines.push("");
  lines.push(` ${renderBar(percentage)}  ${percentage}%`);
  lines.push("");

  if (s.inputTokens > 0) {
    lines.push(` Input:   ${formatTokens(s.inputTokens)} / ${formatTokens(s.maxTokens)} tokens`);
    lines.push(` Output:  ${formatTokens(s.outputTokens)} tokens`);
    if (s.peakInputTokens > s.inputTokens) {
      lines.push(
        ` Peak:    ${formatTokens(s.peakInputTokens)} tokens (${pct(s.peakInputTokens, s.maxTokens)}%)`,
      );
    }
  } else {
    lines.push(" Waiting for first turn...");
    lines.push(` Max:     ${formatTokens(s.maxTokens)} tokens`);
  }

  if (s.history.length >= 2) {
    lines.push("");
    lines.push(` Trend:   ${renderSparkline(s.history)}`);
  }

  if (memoryBlocks.length > 0) {
    lines.push("");
    lines.push(" Memory Blocks:");
    const maxBlockTokens = Math.max(...memoryBlocks.map((b) => b.tokens), 1);
    for (const block of memoryBlocks.slice(0, 8)) {
      const blockBar = "\u2593".repeat(
        Math.max(1, Math.round((block.tokens / maxBlockTokens) * 12)),
      );
      const name =
        block.name.length > 28
          ? `...${block.name.slice(-25)}`
          : block.name.padEnd(28);
      lines.push(`   ${name} ~${formatTokens(block.tokens).padStart(5)} ${blockBar}`);
    }
    if (memoryBlocks.length > 8) {
      lines.push(`   ... and ${memoryBlocks.length - 8} more`);
    }
    lines.push(`   ${"\u2500".repeat(40)}`);
    lines.push(
      `   ${"Total memory".padEnd(28)} ~${formatTokens(totalMemoryTokens).padStart(5)} tokens`,
    );
  }

  if (s.inputTokens > 0) {
    lines.push("");
    lines.push(
      ` ${status.indicator} ${status.label} \u2014 ${formatTokens(remaining)} tokens remaining`,
    );
  }

  return lines;
}

export default function activate(letta: any) {
  const disposers: Array<() => void> = [];

  state.maxTokens = getMaxTokens();

  const closePanel = () => {
    panel?.close();
    panel = null;
  };

  updatePanel = () => {
    if (!letta.capabilities.ui?.panels) return;
    if (!state.active) {
      closePanel();
      return;
    }
    const content = renderThermometer(state, readMemoryBlocks());
    if (!panel) {
      panel = letta.ui.openPanel({ id: "context-thermometer", order: 1_000, content });
    } else {
      panel.update({ content });
    }
  };

  // Show initial panel if capable
  if (letta.capabilities.ui?.panels) {
    updatePanel();
  }

  if (letta.capabilities.events?.turns) {
    disposers.push(
      letta.events.on("turn_start", (event: any, ctx: any) => {
        const inputTokens = Math.max(
          0,
          Math.floor(ctx?.contextWindow?.totalInputTokens ?? 0),
        );
        const outputTokens = Math.max(
          0,
          Math.floor(ctx?.contextWindow?.totalOutputTokens ?? 0),
        );

        if (inputTokens > 0 || outputTokens > 0) {
          state.inputTokens = inputTokens;
          state.outputTokens = outputTokens;
          state.peakInputTokens = Math.max(state.peakInputTokens, inputTokens);
          state.peakTotalTokens = Math.max(
            state.peakTotalTokens,
            inputTokens + outputTokens,
          );
          state.history = [...state.history, inputTokens].slice(-MAX_HISTORY);
          state.lastUpdate = Date.now();
        }

        // Auto-detect max tokens from context window info if available
        const ctxMax =
          ctx?.contextWindow?.maxTokens ?? ctx?.contextWindow?.contextWindow;
        if (typeof ctxMax === "number" && ctxMax > 0 && ctxMax !== state.maxTokens) {
          state.maxTokens = ctxMax;
        }

        updatePanel();

        // Critical warning injection
        if (state.active && pct(inputTokens, state.maxTokens) >= CRITICAL_THRESHOLD) {
          return {
            input: [
              {
                role: "user",
                content: `<system-reminder>Context window is at ${pct(inputTokens, state.maxTokens)}% capacity (${formatTokens(inputTokens)} / ${formatTokens(state.maxTokens)} tokens). Consider compacting the conversation or summarizing prior context to avoid losing important information.</system-reminder>`,
              },
              ...event.input,
            ],
          };
        }
      }),
    );
  }

  if (letta.capabilities.commands) {
    disposers.push(
      letta.commands.register({
        id: "context",
        description: "Toggle context thermometer panel or show stats",
        args: "[on|off|status|max <tokens>]",
        run(ctx: { args: string }) {
          const args = (ctx.args ?? "").trim().toLowerCase();

          if (args === "on") {
            state.active = true;
            updatePanel();
            return { type: "output" as const, output: "Context thermometer enabled." };
          }

          if (args === "off") {
            state.active = false;
            updatePanel();
            return { type: "output" as const, output: "Context thermometer disabled." };
          }

          if (args.startsWith("max ")) {
            const n = Number.parseInt(args.slice(4), 10);
            if (Number.isFinite(n) && n > 0) {
              state.maxTokens = n;
              updatePanel();
              return {
                type: "output" as const,
                output: `Max tokens set to ${formatTokens(n)}.`,
              };
            }
            return {
              type: "output" as const,
              output: "Usage: /context max <tokens>",
              success: false,
            };
          }

          if (args === "status" || (!state.active && args === "")) {
            const blocks = readMemoryBlocks();
            const lines = renderThermometer(state, blocks);
            return { type: "output" as const, output: lines.join("\n") };
          }

          // Toggle
          state.active = !state.active;
          updatePanel();
          return {
            type: "output" as const,
            output: state.active
              ? "Context thermometer enabled."
              : "Context thermometer disabled.",
          };
        },
      }),
    );
  }

  if (letta.capabilities.ui?.panels) {
    disposers.push(closePanel);
  }

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
