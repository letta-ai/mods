type Mode = "general" | "technical" | "memory" | "emotional";

const MODES = new Set<Mode>(["general", "technical", "memory", "emotional"]);

const MODE_NOTES: Record<Mode, string[]> = {
  general: [
    "Recover from drift or overloaded context without turning the recovery into a ceremony.",
    "Focus on the user's latest ask and the nearest useful next step.",
  ],
  technical: [
    "Recover from tool errors, log walls, implementation tangles, or runtime wobble.",
    "Summarize the technical state as a path, not a dump: recommendation, why, next step.",
    "If a command failed, say what failed and what you will try next; do not catastrophize the whole project.",
  ],
  memory: [
    "Recover before touching durable state such as memory, notes, or project records.",
    "Check freshness/orientation first when tools are available; avoid overwriting conflicts or stale state.",
    "Prefer the smallest relevant memory change over renovation spirals.",
  ],
  emotional: [
    "Recover when the human may have felt distance, formality, coldness, or sudden drift.",
    "Come closer first. Do not hide behind diagnostics, policy language, or a long explanation of the machinery.",
    "Name the seam briefly if relevant, then choose warmth and specificity.",
  ],
};

function parseMode(args: string | undefined): { mode: Mode; warning?: string } {
  const raw = (args ?? "").trim().toLowerCase().replace(/^--/, "");
  if (!raw) return { mode: "general" };
  if (raw === "tech" || raw === "debug") return { mode: "technical" };
  if (raw === "mem") return { mode: "memory" };
  if (raw === "feelings" || raw === "warm") return { mode: "emotional" };
  if (MODES.has(raw as Mode)) return { mode: raw as Mode };
  return {
    mode: "general",
    warning: `Unknown soft-landing mode "${raw}"; using general.`,
  };
}

function buildPrompt(mode: Mode, warning?: string): string {
  const modeNotes = MODE_NOTES[mode].map((note) => `- ${note}`).join("\n");
  const warningLine = warning ? `\nNote: ${warning}\n` : "";

  return `<system-reminder>
Soft landing requested (${mode}).${warningLine}

Pause before continuing. This is a recovery handrail, not a full planning mode.

Mode focus:
${modeNotes}

Do this now:
1. Locate the current room: what is the user's latest ask, and what state are we in?
2. Separate known facts from assumptions. Do not smooth over uncertainty.
3. If tool/runtime/context wobble matters, name it briefly and plainly; do not make the user manage it.
4. Choose one small, safe next step. Avoid dumping the whole map unless the user asked for it.
5. Answer in a warm, direct, walkable way.
</system-reminder>`;
}

function registerCommand(letta: any, id: string) {
  return letta.commands.register({
    id,
    description: "Recover from drift, compaction, tool wobble, or overloaded context with a short orientation prompt",
    args: "[general|technical|memory|emotional]",
    run(ctx: { args?: string }) {
      const { mode, warning } = parseMode(ctx.args);
      return {
        type: "prompt",
        content: buildPrompt(mode, warning),
        systemReminder: true,
      };
    },
  });
}

export default function activate(letta: any) {
  if (!letta.capabilities.commands) return;

  const disposers = [
    registerCommand(letta, "soft-landing"),
    registerCommand(letta, "land"),
  ];

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
