import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_PATH = join(homedir(), ".letta", "mods", "aura-maxxing.state.json");
const MODS_DIR = join(homedir(), ".letta", "mods");
const KEY = "aura-maxxing";

type AuraState = {
  enabledConversations: Record<string, boolean>;
};

function readState(): AuraState {
  try {
    if (!existsSync(STATE_PATH)) return { enabledConversations: {} };
    const parsed = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    return parsed && typeof parsed === "object" && parsed.enabledConversations
      ? { enabledConversations: parsed.enabledConversations }
      : { enabledConversations: {} };
  } catch {
    return { enabledConversations: {} };
  }
}

function writeState(state: AuraState): void {
  mkdirSync(MODS_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function isEnabled(conversationId: string | undefined): boolean {
  if (!conversationId) return false;
  return !!readState().enabledConversations[conversationId];
}

function setEnabled(conversationId: string | undefined, enabled: boolean): void {
  if (!conversationId) return;
  const state = readState();
  if (enabled) state.enabledConversations[conversationId] = true;
  else delete state.enabledConversations[conversationId];
  writeState(state);
}

function reminder(): string {
  return `<system-reminder>
Aura mode is active.

Rules:
- lead with the point
- keep it tight unless depth is needed
- cut filler
- stay honest
- sound present, not performative
</system-reminder>`;
}

function extractUserText(input: Array<{ role: string; content: unknown }>): string {
  return input
    .filter((m) => m.role === "user")
    .map((m) => {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .filter((p): p is { type: "text"; text: string } => p?.type === "text")
          .map((p) => p.text)
          .join(" ");
      }
      return "";
    })
    .join(" ");
}

export default function activate(letta: any) {
  const disposers: Array<() => void> = [];

  if (letta.capabilities.commands) {
    disposers.push(
      letta.commands.register({
        id: "aura",
        description: "Enable or disable aura-maxxing guidance",
        args: "[off]",
        run(ctx: { args?: string; conversation?: { id?: string } }) {
          const conversationId = ctx.conversation?.id;
          if ((ctx.args ?? "").trim().toLowerCase() === "off") {
            setEnabled(conversationId, false);
            return { type: "output", output: "Aura mode off.", success: true };
          }
          setEnabled(conversationId, true);
          return { type: "prompt", content: reminder(), systemReminder: true };
        },
      }),
    );
  }

  if (letta.capabilities.tools) {
    disposers.push(
      letta.tools.register({
        name: "aura_maxxing",
        description: "Return the current aura-maxxing style target for this conversation.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        requiresApproval: false,
        parallelSafe: true,
        run(ctx: { conversation?: { id?: string } }) {
          const active = isEnabled(ctx.conversation?.id);
          return {
            type: "output",
            output: JSON.stringify({ active, style_target: "high-signal, concise, present, honest" }, null, 2),
            success: true,
          };
        },
      }),
    );
  }

  if (letta.capabilities?.events?.turns) {
    disposers.push(
      letta.events.on("turn_start", (event: { conversationId?: string; input: Array<{ role: string; content: unknown }> }) => {
        if (!isEnabled(event.conversationId)) return;
        const text = extractUserText(event.input || []);
        if (text.toLowerCase().includes("/aura off")) return;
        return { input: [{ role: "user", content: reminder() }, ...event.input] };
      }),
    );
  }

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
