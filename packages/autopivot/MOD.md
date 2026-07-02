---
name: "@letta-ai/autopivot"
description: "Model failover ladder for Letta Code — pivots primary → backup cloud → local when a model rate-limits, runs out of credit, errors, or drops offline."
---

# autopivot

## Purpose

Keeps a Letta Code agent working when a model fails. AutoPivot maintains a priority
**ladder of models** (primary → backup cloud → local) and switches the active model to
the highest working rung when the current one rate-limits, runs out of credit, errors,
goes over context, or drops offline. On a local backend it also keeps the agent honest —
telling it it's offline instead of pretending networked actions succeeded.

## Behavior

- **Events** — hooks `turn_start` (applies the model switch for the next turn via
  `updateLlmConfig`, and injects an offline/honesty note), and `llm_start` / `llm_end` /
  `turn_end` (the stall watchdog that detects a turn which starts an LLM request and never
  completes).
- **Commands** — registers `/pivot`: `status`, `setup` (first-run auto-config), `down`
  (fail over now), `offline` / `online` / `auto` (manual override).
- **UI** — registers a statusline panel (the mode/model pill). TUI only; no-ops elsewhere.
- **Config** — reads `~/.letta/mods/autopivot.config.json` (JSONC). First run writes a
  starter config via `/pivot setup`; a bundled interactive configurator ships alongside the
  mod (`dist/autopivot-configure.cjs`).
- **Providers / network** — makes outbound HTTP reachability probes to the endpoints you
  configure (`probeUrl`s). No other network access. Any probe auth token comes from an env
  var you name (`probeAuthEnv`), never from the config file.

## Entry points

- `mods/index.mjs`

## Safety

This mod is trusted local code and runs with your local permissions. It reads/writes its
own config and state under `~/.letta/mods/`, makes HTTP reachability probes to endpoints
you configure, and (opt-in only, off by default) can invoke `git` via argv within your
local MemFS memory dir if you enable the `memorySync` seam. It does not exfiltrate data,
does not read secrets, and follows no redirects on probes. Review the source before
installing.
