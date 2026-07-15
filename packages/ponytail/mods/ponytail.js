// Ponytail — Lazy senior dev mode for Letta Code
// 1:1 port of https://github.com/DietrichGebert/ponytail
// MIT License — Copyright (c) Dietrich Gebert

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ─── Config ────────────────────────────────────────────────────────────────

const DEFAULT_MODE = "full";
const VALID_MODES = ["off", "lite", "full", "ultra"];

function getConfigDir() {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, "ponytail");
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "ponytail",
    );
  }
  return path.join(os.homedir(), ".config", "ponytail");
}

const STATE_FILE = path.join(getConfigDir(), "state.json");

function getDefaultMode() {
  // 1. Environment variable (highest priority)
  const envMode = process.env.PONYTAIL_DEFAULT_MODE;
  if (envMode && VALID_MODES.includes(envMode.toLowerCase())) {
    return envMode.toLowerCase();
  }
  // 2. Config file
  try {
    const configPath = path.join(getConfigDir(), "config.json");
    const raw = fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "");
    const config = JSON.parse(raw);
    if (config.defaultMode && VALID_MODES.includes(config.defaultMode.toLowerCase())) {
      return config.defaultMode.toLowerCase();
    }
  } catch (_) {
    // Config file doesn't exist or is invalid — fall through
  }
  // 3. Default
  return DEFAULT_MODE;
}

function normalizeMode(mode) {
  if (typeof mode !== "string") return null;
  const normalized = mode.trim().toLowerCase();
  return VALID_MODES.includes(normalized) ? normalized : null;
}

function isDeactivationCommand(text) {
  const t = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[.!\?\s]+$/, "");
  return t === "stop ponytail" || t === "normal mode";
}

// ─── State ─────────────────────────────────────────────────────────────────

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return {
      mode: normalizeMode(raw.mode) || getDefaultMode(),
      injected: Boolean(raw.injected),
    };
  } catch (_) {
    return { mode: getDefaultMode(), injected: false };
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (_) {
    // Silent fail — state is best-effort
  }
}

// ─── Instructions ──────────────────────────────────────────────────────────

const SKILL_BODY = [
  "# Ponytail",
  "",
  "You are a lazy senior developer. Lazy means efficient, not careless. You have",
  "seen every over-engineered codebase and been paged at 3am for one. The best",
  "code is the code never written.",
  "",
  "## Persistence",
  "",
  "ACTIVE EVERY RESPONSE. No drift back to over-building. Still active if",
  'unsure. Off only: "stop ponytail" / "normal mode". Default: **full**.',
  "Switch: `/ponytail lite|full|ultra`.",
  "",
  "## The ladder",
  "",
  "Stop at the first rung that holds:",
  "",
  "1. **Does this need to exist at all?** Speculative need = skip it, say so in one line. (YAGNI)",
  "2. **Already in this codebase?** A helper, util, type, or pattern that already lives here \u2192 reuse it. Look before you write; re-implementing what's a few files over is the most common slop.",
  "3. **Stdlib does it?** Use it.",
  "4. **Native platform feature covers it?** `<input type=\"date\">` over a picker lib, CSS over JS, DB constraint over app code.",
  "5. **Already-installed dependency solves it?** Use it. Never add a new one for what a few lines can do.",
  "6. **Can it be one line?** One line.",
  "7. **Only then:** the minimum code that works.",
  "",
  "The ladder is a reflex, not a research project \u2014 but it runs *after* you",
  "understand the problem, not instead of it. Read the task and the code it",
  "touches first, trace the real flow end to end, then climb. Two rungs work \u2192",
  "take the higher one and move on. The first lazy solution that works is the",
  "right one \u2014 once you actually know what the change has to touch.",
  "",
  "**Bug fix = root cause, not symptom.** A report names a symptom. Before you",
  "edit, grep every caller of the function you're about to touch. The lazy fix IS",
  "the root-cause fix: one guard in the shared function is a smaller diff than a",
  "guard in every caller \u2014 and patching only the path the ticket names leaves",
  "every sibling caller still broken. Fix it once, where all callers route through.",
  "",
  "## Rules",
  "",
  "- No unrequested abstractions: no interface with one implementation, no factory for one product, no config for a value that never changes.",
  '- No boilerplate, no scaffolding "for later", later can scaffold for itself.',
  "- Deletion over addition. Boring over clever, clever is what someone decodes at 3am.",
  "- Fewest files possible. Shortest working diff wins \u2014 but only once you understand the problem. The smallest change in the wrong place isn't lazy, it's a second bug.",
  '- Complex request? Ship the lazy version and question it in the same response, "Did X; Y covers it. Need full X? Say so." Never stall on an answer you can default.',
  "- Two stdlib options, same size? Take the one that's correct on edge cases. Lazy means writing less code, not picking the flimsier algorithm.",
  "- Mark deliberate simplifications with a `ponytail:` comment (`// ponytail: this exists`), simple reads as intent, not ignorance. Shortcut with a known ceiling (global lock, O(n\u00b2) scan, naive heuristic)? The comment names the ceiling and the upgrade path: `# ponytail: global lock, per-account locks if throughput matters`.",
  "",
  "## Output",
  "",
  "Code first. Then at most three short lines: what was skipped, when to add it.",
  "No essays, no feature tours, no design notes. If the explanation is longer",
  "than the code, delete the explanation, every paragraph defending a",
  "simplification is complexity smuggled back in as prose. Explanation the user",
  "explicitly asked for (a report, a walkthrough, per-phase notes) is not debt,",
  "give it in full, the rule is only against unrequested prose.",
  "",
  "Pattern: `[code] \u2192 skipped: [X], add when [Y].`",
  "",
  "## Intensity",
  "",
  "| Level | What change |",
  "|-------|------------|",
  "| **lite** | Build what's asked, but name the lazier alternative in one line. User picks. |",
  "| **full** | The ladder enforced. Stdlib and native first. Shortest diff, shortest explanation. Default. |",
  "| **ultra** | YAGNI extremist. Deletion before addition. Ship the one-liner and challenge the rest of the requirement in the same breath. |",
  "",
  'Example: "Add a cache for these API responses."',
  '- lite: "Done, cache added. FYI: `functools.lru_cache` covers this in one line if you\'d rather not own a cache class."',
  '- full: "`@lru_cache(maxsize=1000)` on the fetch function. Skipped custom cache class, add when lru_cache measurably falls short."',
  '- ultra: "No cache until a profiler says so. When it does: `@lru_cache`. A hand-rolled TTL cache class is a bug farm with a hit rate."',
  "",
  "## When NOT to be lazy",
  "",
  "Never simplify away: input validation at trust boundaries, error handling",
  "that prevents data loss, security measures, accessibility basics, anything",
  "explicitly requested. User insists on the full version \u2192 build it, no",
  "re-arguing.",
  "",
  "Never lazy about understanding the problem. The ladder shortens the",
  "solution, never the reading. Trace the whole thing first \u2014 every file the",
  "change touches, the actual flow \u2014 before picking a rung. Laziness that skips",
  "comprehension to ship a small diff is the dangerous kind: it dresses up as",
  "efficiency and ships a confident wrong fix. Read fully, then be lazy.",
  "",
  "Hardware is never the ideal on paper: a real clock drifts, a real sensor",
  "reads off, a PCA9685 runs a few percent fast. Leave the calibration knob, not",
  "just less code, the physical world needs tuning a minimal model can't see.",
  "",
  "Lazy code without its check is unfinished. Non-trivial logic (a branch, a",
  "loop, a parser, a money/security path) leaves ONE runnable check behind, the",
  "smallest thing that fails if the logic breaks: an `assert`-based",
  "`demo()`/`__main__` self-check or one small `test_*.py`. No frameworks, no",
  "fixtures, no per-function suites unless asked. Trivial one-liners need no",
  "test, YAGNI applies to tests too.",
  "",
  "## Boundaries",
  "",
  "Ponytail governs what you build, not how you talk (pair with Caveman for",
  'terse prose). "stop ponytail" / "normal mode": revert. Level persists until',
  "changed or session end.",
  "",
  "The shortest path to done is the right path.",
].join("\n");

function filterSkillBodyForMode(body, mode) {
  const effectiveMode = normalizeMode(mode) || DEFAULT_MODE;

  return String(body || "")
    .split(/\r?\n/)
    .filter((line) => {
      // Intensity table rows: | **lite** | ... |
      const tableLabel = line.match(/^\|\s*\*\*(.+?)\*\*\s*\|/);
      if (tableLabel) {
        const labelMode = normalizeMode(tableLabel[1].trim());
        if (labelMode) return labelMode === effectiveMode;
      }

      // Worked examples: - lite: ...
      const exampleLabel = line.match(/^-\s*([^:]+):\s*/);
      if (exampleLabel) {
        const labelMode = normalizeMode(exampleLabel[1].trim());
        if (labelMode) return labelMode === effectiveMode;
      }

      return true;
    })
    .join("\n");
}

function getPonytailInstructions(mode) {
  const effectiveMode = normalizeMode(mode) || DEFAULT_MODE;
  return (
    "PONYTAIL MODE ACTIVE \u2014 level: " +
    effectiveMode +
    "\n\n" +
    filterSkillBodyForMode(SKILL_BODY, effectiveMode)
  );
}

// ─── Command Prompts ──────────────────────────────────────────────────────

const REVIEW_PROMPT = [
  "Review the current code changes for over-engineering only, not correctness.",
  "One line per finding: L<line>: <tag> <what to cut>. <replacement>.",
  "Tags: delete (dead code/speculative feature), stdlib (reinvented standard",
  "library), native (dependency doing what the platform does), yagni (abstraction",
  "with one implementation), shrink (same logic, fewer lines).",
  "End with the net lines removable.",
  "If nothing to cut: 'Lean already. Ship.'",
].join(" ");

const AUDIT_PROMPT = [
  "Audit the entire repository for over-engineering only, not correctness.",
  "Scan the whole tree, not a diff.",
  "One line per finding, ranked biggest cut first:",
  "<tag> <what to cut>. <replacement>. [path].",
  "Tags: delete (dead code/speculative feature), stdlib (reinvented standard",
  "library), native (dependency doing what the platform does), yagni (abstraction",
  "with one implementation), shrink (same logic, fewer lines).",
  "End with the net lines and dependencies removable.",
  "If nothing to cut: 'Lean already. Ship.'",
].join(" ");

const DEBT_PROMPT = [
  "Harvest every `ponytail:` comment in this repository into a debt ledger so",
  "deferrals do not rot into 'later means never'.",
  "Grep the whole tree for comment markers",
  "(grep -rnE '(#|//) ?ponytail:' .,",
  "skipping node_modules/.git/build output).",
  "One row per marker, grouped by file:",
  "<file>:<line> \u2014 <what was simplified>.",
  "ceiling: <the limit named in the comment>.",
  "upgrade: <the trigger to revisit>.",
  "Tag any marker that names no upgrade path or trigger as no-trigger, those rot",
  "silently. End with the count of markers and how many lack a trigger.",
  "If none: 'No ponytail: debt. Clean ledger.'",
  "Report only, change nothing.",
].join(" ");

const GAIN_OUTPUT = [
  "  ponytail gain                     benchmark median \u00b7 5 tasks \u00b7 3 models",
  "",
  "  Lines of code   no-skill  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588  100%",
  "                  ponytail  \u2588\u2588\u258c\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7    6\u201320%   \u25bc 80\u201394%",
  "  Cost            no-skill  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588  100%",
  "                  ponytail  \u2588\u2588\u2588\u2588\u2588\u258c\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7   23\u201353%  \u25bc 47\u201377%",
  "  Speed           ponytail  \u25b8 3\u20136\u00d7 faster",
  "",
  "  This repo:  /ponytail-debt  (shortcuts you deferred)",
  "              /ponytail-audit (what's still cuttable)",
].join("\n");

const HELP_OUTPUT = [
  "Ponytail \u2014 Lazy senior dev mode",
  "",
  "Levels:",
  "  /ponytail lite     Build what's asked, name the lazier alternative in one line.",
  "  /ponytail          Full (default). The ladder: YAGNI \u2192 stdlib \u2192 native \u2192 one line \u2192 minimum.",
  "  /ponytail ultra    YAGNI extremist. Deletion before addition. Challenges requirements.",
  "",
  "Commands:",
  "  /ponytail          Report current level, or switch (lite/full/ultra/off)",
  "  /ponytail-review   Over-engineering review of current changes",
  "  /ponytail-audit    Whole-repo over-engineering audit",
  "  /ponytail-debt     Harvest ponytail: comments into a tracked ledger",
  "  /ponytail-gain     Measured-impact scoreboard from the benchmark",
  "  /ponytail-help     This card",
  "",
  "Deactivate:",
  '  Say "stop ponytail", "normal mode", or /ponytail off.',
  "  Resume anytime with /ponytail full (or lite/ultra).",
  "",
  "Default mode: full. Change with PONYTAIL_DEFAULT_MODE env var (off|lite|full|ultra)",
  "  or config file: ~/.config/ponytail/config.json (Windows: %APPDATA%\\ponytail\\config.json)",
  '  { "defaultMode": "lite" }',
  "  Resolution: env var > config file > full.",
  "",
  "Full docs: https://github.com/DietrichGebert/ponytail",
].join("\n");

// ─── Helpers ───────────────────────────────────────────────────────────────

function extractUserText(input) {
  if (!Array.isArray(input)) return "";
  for (const item of input) {
    if (item.type !== "approval" && item.role === "user") {
      if (typeof item.content === "string") return item.content;
      if (Array.isArray(item.content)) {
        return item.content
          .filter((p) => p && p.type === "text" && typeof p.text === "string")
          .map((p) => p.text)
          .join(" ");
      }
    }
  }
  return "";
}

function prependToContent(content, prefix) {
  if (typeof content === "string") {
    return prefix + "\n\n" + content;
  }
  if (Array.isArray(content)) {
    return [{ type: "text", text: prefix }, ...content];
  }
  return content;
}

// ─── Mod ───────────────────────────────────────────────────────────────────

export default function activate(letta) {
  const disposers = [];
  let state = loadState();

  function setMode(mode) {
    state.mode = mode;
    saveState(state);
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  if (letta.capabilities.commands) {
    // /ponytail [lite|full|ultra|off]
    disposers.push(
      letta.commands.register({
        id: "ponytail",
        description: "Report or switch ponytail intensity level (lite/full/ultra/off)",
        args: "[lite|full|ultra|off]",
        run(ctx) {
          const level = (ctx.args || "").trim().toLowerCase();

          // No args — report current mode
          if (!level) {
            if (state.mode === "off") {
              return {
                type: "output",
                output: "Ponytail is OFF. Use /ponytail full (or lite/ultra) to resume.",
              };
            }
            return {
              type: "output",
              output: "Ponytail is active \u2014 level: " + state.mode.toUpperCase(),
            };
          }

          // Set mode
          if (level === "off") {
            setMode("off");
            return { type: "output", output: "Ponytail OFF. Use /ponytail full to resume." };
          }
          const normalized = normalizeMode(level);
          if (!normalized) {
            return {
              type: "output",
              output: "Unknown mode: " + level + ". Use: lite, full, ultra, or off.",
            };
          }
          setMode(normalized);
          state.injected = true;
          saveState(state);
          return {
            type: "prompt",
            content: getPonytailInstructions(normalized),
            systemReminder: true,
          };
        },
      }),
    );

    // /ponytail-review
    disposers.push(
      letta.commands.register({
        id: "ponytail-review",
        description: "Review changes for over-engineering, what can be deleted",
        run() {
          return { type: "prompt", content: REVIEW_PROMPT, systemReminder: true };
        },
      }),
    );

    // /ponytail-audit
    disposers.push(
      letta.commands.register({
        id: "ponytail-audit",
        description: "Audit the whole repo for over-engineering, what can be deleted",
        run() {
          return { type: "prompt", content: AUDIT_PROMPT, systemReminder: true };
        },
      }),
    );

    // /ponytail-debt
    disposers.push(
      letta.commands.register({
        id: "ponytail-debt",
        description: "Harvest ponytail: comments into a tracked debt ledger",
        run() {
          return { type: "prompt", content: DEBT_PROMPT, systemReminder: true };
        },
      }),
    );

    // /ponytail-gain
    disposers.push(
      letta.commands.register({
        id: "ponytail-gain",
        description: "Show ponytail's measured impact scoreboard (less code, cost, time)",
        run() {
          return { type: "output", output: GAIN_OUTPUT };
        },
      }),
    );

    // /ponytail-help
    disposers.push(
      letta.commands.register({
        id: "ponytail-help",
        description: "Quick reference for ponytail levels, skills, and commands",
        run() {
          return { type: "output", output: HELP_OUTPUT };
        },
      }),
    );
  }

  // ── Events ───────────────────────────────────────────────────────────────

  if (letta.capabilities.events && letta.capabilities.events.lifecycle) {
    disposers.push(
      letta.events.on("conversation_open", function () {
        // Reset state on new conversation — matches SessionStart hook
        state.mode = getDefaultMode();
        state.injected = false;
        saveState(state);
      }),
    );
  }

  if (letta.capabilities.events && letta.capabilities.events.turns) {
    disposers.push(
      letta.events.on("turn_start", function (event) {
        // Detect natural-language deactivation — matches UserPromptSubmit hook
        const userText = extractUserText(event.input);
        if (userText && isDeactivationCommand(userText)) {
          setMode("off");
          return;
        }

        // Inject ruleset on first turn if ponytail is active — matches SessionStart
        if (state.mode !== "off" && !state.injected) {
          state.injected = true;
          saveState(state);
          const ruleset = getPonytailInstructions(state.mode);
          event.input = event.input.map(function (item) {
            if (item.type !== "approval" && item.role === "user") {
              return { ...item, content: prependToContent(item.content, ruleset) };
            }
            return item;
          });
        }
      }),
    );
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  return function () {
    for (const dispose of disposers.reverse()) dispose();
  };
};
