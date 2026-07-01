type PetKind = "cat" | "dog" | "bunny" | "blob";
type Mood =
  | "idle"
  | "working"
  | "thinking"
  | "writing"
  | "shell"
  | "reading"
  | "asking";

type PetState = {
  active: boolean;
  kind: PetKind;
  name: string;
  frame: number;
  mood: Mood;
  lastEventAt: number;
};

type Animation = {
  frames: string[][];
};

type Pet = {
  label: string;
  animations: Record<Mood, Animation>;
};

const BASE: Record<PetKind, string[][]> = {
  cat: [
    [" /\\_/\\", "( o.o )", " > ^ <"],
    [" /\\_/\\", "( -.- )", " > ^ <"],
  ],
  dog: [
    ["^..^      /", "/_/\\_____/", "   /\\   /\\", "  /  \\ /  \\"],
    ["^--^      /", "/_/\\_____/", "   /\\   /\\", "  /  \\ /  \\"],
    ["^..^      /", "/_/\\_____/", "   /\\   /\\", "  /  \\ /  \\"],
  ],
  bunny: [
    ["  //", " ('>", " /rr", "*\\))_"],
    ["  //", " ('-", " /rr", "*\\))_"],
    ["  //", " ('>", " /rr", "*\\))_"],
  ],
  blob: [
    ["  .--.", " ( oo )", "  '--'"],
    ["  .--.", " ( -- )", "  '--'"],
  ],
};

const PETS: Record<PetKind, Pet> = {
  cat: pet("cat", BASE.cat, ["  /\\_/\\", "=( o.o )=", "  > ^ <"]),
  dog: pet("dog", BASE.dog, ["^oo^  ___/", "/_/\\_/", "  /\\ /\\"]),
  bunny: pet("bunny", BASE.bunny, [" //", "('>", "/rr", "\\))_  *"]),
  blob: pet("blob", BASE.blob, [" .--.", "( oo )", " '--'~"]),
};

let state: PetState = {
  active: false,
  kind: "cat",
  name: "pixel",
  frame: 0,
  mood: "idle",
  lastEventAt: 0,
};

function pet(label: string, idle: string[][], walkFrame: string[]): Pet {
  return {
    label,
    animations: {
      idle: { frames: idle },
      working: {
        frames: [
          shift(walkFrame, 0),
          shift(walkFrame, 5),
          shift(walkFrame, 10),
          shift(walkFrame, 5),
        ],
      },
      thinking: {
        frames: idle.map((frame, i) => [`${" ".repeat(i)}?`, ...frame]),
      },
      shell: {
        frames: idle.map((frame, i) => [
          `${i % 2 === 0 ? "$" : ">"} ...`,
          ...frame,
        ]),
      },
      reading: {
        frames: idle.map((frame) => ["[==]", ...frame]),
      },
      writing: {
        frames: idle.map((frame, i) => [
          `${i % 2 === 0 ? "✎" : "✐"} scratch scratch`,
          ...frame,
        ]),
      },
      asking: {
        frames: idle.map((frame) => ["??", ...frame]),
      },
    },
  };
}

function shift(lines: string[], spaces: number): string[] {
  return lines.map((line) => `${" ".repeat(spaces)}${line}`);
}

function parseArgs(args: string): {
  action: string;
  kind?: PetKind;
  name?: string;
} {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.toLowerCase() || "start";
  const parsed: { action: string; kind?: PetKind; name?: string } = {
    action: first in PETS ? "start" : first,
  };

  if (first in PETS) parsed.kind = first as PetKind;

  for (const part of parts.slice(1)) {
    const [key, value] = part.split("=", 2);
    if (key === "kind" && value in PETS) parsed.kind = value as PetKind;
    if (key === "name" && value) parsed.name = value.slice(0, 24);
  }

  return parsed;
}

function moodForTool(toolName: string): Mood {
  const normalized = toolName.toLowerCase();
  if (["bash", "exec_command", "write_stdin"].includes(normalized))
    return "shell";
  if (
    [
      "read",
      "glob",
      "grep",
      "ls",
      "webfetch",
      "fetch_webpage",
      "web_search",
    ].includes(normalized)
  )
    return "reading";
  if (
    ["edit", "write", "applypatch", "apply_patch", "multiedit"].includes(
      normalized,
    )
  )
    return "writing";
  if (["askuserquestion", "ask_user_question"].includes(normalized))
    return "asking";
  return "working";
}

function setMood(mood: Mood) {
  if (!state.active) return;
  state = {
    ...state,
    mood,
    frame: mood === state.mood ? state.frame : 0,
    lastEventAt: Date.now(),
  };
  updatePanel();
}

function renderLines(): string[] {
  if (!state.active) return [];
  const pet = PETS[state.kind];
  const animation = pet.animations[state.mood];
  const frame = animation.frames[state.frame % animation.frames.length];
  return [`${state.name} the ${pet.label}`, ...frame];
}

function rightPad(lines: string[]): string[] {
  return lines.map((line) => `${" ".repeat(150)}${line}`);
}

let panel: any = null;
let updatePanel = () => {};

export default function activate(letta: any) {
  const disposers: Array<() => void> = [];

  const closePanel = () => {
    panel?.close();
    panel = null;
  };

  updatePanel = () => {
    if (!letta.capabilities.ui.panels) return;
    if (!state.active) {
      closePanel();
      return;
    }

    if (!panel) {
      panel = letta.ui.openPanel({
        id: "pets",
        order: 10_000,
        render: () => rightPad(renderLines()),
      });
    } else {
      panel.update();
    }
  };

  const timer = setInterval(() => {
    if (!state.active) return;
    const idleAfterMs = state.mood === "asking" ? 30_000 : 4_000;
    const nextMood =
      Date.now() - state.lastEventAt > idleAfterMs ? "idle" : state.mood;
    state = { ...state, mood: nextMood, frame: state.frame + 1 };
    updatePanel();
  }, 700);
  disposers.push(() => clearInterval(timer));

  if (letta.capabilities.events.turns) {
    disposers.push(letta.events.on("turn_start", () => setMood("thinking")));
  }

  if (letta.capabilities.events.tools) {
    disposers.push(
      letta.events.on("tool_start", (event: { toolName: string }) =>
        setMood(moodForTool(event.toolName)),
      ),
    );
  }

  if (letta.capabilities.commands) {
    disposers.push(
      letta.commands.register({
        id: "pets",
        description: "Create or manage a small terminal pet",
        args: "[cat|dog|bunny|blob|stop|status] [name=<name>]",
        showInTranscript: false,
        run(ctx: { args: string }) {
          const parsed = parseArgs(ctx.args ?? "");

          if (parsed.action === "stop") {
            state = { ...state, active: false };
            updatePanel();
            return { type: "output", output: "Pet dismissed." };
          }

          if (parsed.action === "status") {
            return {
              type: "output",
              output: state.active
                ? renderLines().join("\n")
                : "No active pet. Try /pets cat name=Pixel",
            };
          }

          if (!["start", "create"].includes(parsed.action)) {
            return {
              type: "output",
              output:
                "Usage: /pets [cat|dog|bunny|blob|stop|status] [name=<name>]",
            };
          }

          state = {
            active: true,
            kind: parsed.kind ?? state.kind,
            name: parsed.name ?? state.name,
            frame: 0,
            mood: "idle",
            lastEventAt: Date.now(),
          };
          updatePanel();

          return {
            type: "output",
            output: `Created ${state.name} the ${PETS[state.kind].label}. Use /pets stop to dismiss.`,
          };
        },
      }),
    );
  }

  if (letta.capabilities.ui.panels) {
    disposers.push(closePanel);
  }

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
