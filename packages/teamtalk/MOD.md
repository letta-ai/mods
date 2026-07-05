---
name: "@letta-community/teamtalk"
description: "Share organizational knowledge across a team via a dedicated steward agent and an OKF bundle in the steward's MemFS."
---

# TeamTalk mod semantics

## When to use

Use `teamtalk_search` before non-trivial implementation work, when the
user asks about team conventions, or when a relevant rule may already
exist. Use `teamtalk_propose` when the team should adopt a new rule,
playbook, decision, or person entry. Use `teamtalk_load_rule` when the
rendered `<system-reminder>` lists a trigger description that matches
your current task and you want the rule's full body in context.

## Architecture summary

- **Steward agent** — a designated agent (bound via `/teamtalk enable`
  or created via `/teamtalk init`) whose MemFS holds the OKF bundle
  under `team/`. Tagged `teamtalk-steward`. The mod uses `letta/auto`
  as the model so the steward is routed to whatever provider is
  currently available.
- **Reads** — direct filesystem reads from the steward's local MemFS
  clone at `~/.letta/agents/<steward-id>/memory/team/` (or
  `~/.letta/lc-local-backend/memfs/<steward-id>/memory/team/` for
  local-backend agents). No remote API calls on the hot path.
- **Writes** — in Letta Code 0.27.x the steward agent has no file-write
  tools (`letta_files_core` exposes only read tools), so
  `teamtalk_propose` writes the concept directly to the steward's
  local MemFS clone, then shells out to `git -C memDir add <file> && git
  commit` to persist the change. OKF conformance, secret patterns, and
  path shape are enforced by the mod before writing.
- **Rule injection** — `events.turns.onTurnStart` reads
  `~/.letta/agents/<steward-id>/memory/system/rules.md` and prepends it
  as a transient system reminder to the user's turn context. No
  remote API call. The file is rendered from the OKF bundle on
  init/reseed.
- **Triggered-rule loader** — the rules file has two sections:
  always-on rules (`team/rules/global/`) and a triggered-rule catalog
  (`team/rules/events/`). The catalog lists each trigger's
  description, never the body. The model calls `teamtalk_load_rule`
  to pull a body into context; see "Triggered rules" below.

## Init flow

The mod does not use `letta.client.agents.create` directly. It shells
out to `letta agents create --tags teamtalk-steward,git-memory-enabled
--pinned --model letta/auto`, which is the supported CLI path that
sets up MemFS, applies tags, and pre-populates `persona.md`. After
agent creation, the local MemFS clone only materializes once a
user-agent session opens with that agent; the mod spawns a
backgrounded `letta --agent <steward-id>` with `stdio: "ignore"` to
trigger that session-open, then polls for the clone to appear.

After agent creation the mod overwrites the persona block with
`steward-persona.md` via the SDK and attaches the read tools
(`open_files`, `grep_files`, `semantic_search_files` — the read subset
of `letta_files_core` for that org) so the steward can navigate the
bundle when answering questions. No write tools are attached.

## Commands

- `/teamtalk init [--name <name>] [--confirm]` — create a steward
  agent in the org (with confirmation), materialize the local MemFS
  clone, and seed the OKF bundle. Without `--confirm`, prints a
  preview.
- `/teamtalk init [--name <name>] [--reseed]` — re-seed the OKF
  bundle and re-render `system/rules.md` for the bound steward
  without recreating the agent. Use when the bundle is stale or
  missing.
- `/teamtalk enable [agent-id]` — bind to an existing steward. Without
  ID, lists agents tagged `teamtalk-steward` in the org.
- `/teamtalk disable` — clear the local binding.
- `/teamtalk status` — show binding, steward ID, local MemFS path, OKF
  bundle root, rules file, concept count, last refresh time.
- `/teamtalk search <query> [--limit N]` — search the steward's OKF
  bundle.
- `/teamtalk propose` — open the proposal flow. Recommended: ask the
  model to call `teamtalk_propose` with structured args instead.
- `/teamtalk debug` — self-check: list agents, list tagged agents,
  retrieve the bound steward, check local filesystem state. Use to
  diagnose org scoping and missing-agent issues.

## Tools

- `teamtalk_search(query, limit?)` — keyword search over markdown files
  in the steward's OKF bundle. Skips files over 1 MB. Filters to
  concepts with OKF `type` frontmatter. Read-only, parallel-safe.
  Default limit 8, max 50.

- `teamtalk_propose(type, title, proposed_path, body, tags?)` — writes
  the concept directly to the steward's local MemFS clone (in
  Letta Code 0.27.x the steward agent has no file-write tools).
  Enforces OKF conformance (frontmatter, path under `team/`,
  reserved filenames), no-secrets, and no-duplicates. Commits via
  `git -C memDir add <file> && git commit`. Refuses to commit if any
  unrelated dirty file is present in the steward's MemFS — the file
  stays written locally and the call surfaces a tool error so the
  operator can resolve manually.

- `teamtalk_load_rule(trigger)` — pulls a triggered rule's body
  into the calling agent's session cache and resets its activity
  timer to the current turn. The body persists in `<system-reminder>`
  blocks until the rule's TTL of inactivity elapses. The trigger
  catalog (always-on) tells the model which rules exist and when to
  load them; the model decides when this tool is appropriate.

## Triggered rules (dynamic loading)

Rules under `team/rules/events/` are not always-on. The rules file's
triggered-rules catalog lists each rule's:

- `trigger` — short identifier, used as the load argument.
- `trigger-description` — human prose describing when the rule fires.
- `ttl` — inactivity threshold (turns) before the body ages out.
- `cacheable: true` (default) — body is retained after first load.

### When to call `teamtalk_load_rule`

The model calls the tool when:

- A trigger description in the catalog matches the current task.
- The rule body is needed for the next response (rather than just for
  reference).
- The user explicitly invokes a triggered rule's workflow.

If unsure, the agent can search for the trigger name via
`teamtalk_search` to find the full body, but `teamtalk_load_rule` is
the structured way and resets the TTL.

### TTL semantics (activity-reset)

The TTL countdown resets to the rule's full value on any of:

- An explicit `teamtalk_load_rule` call (resets to full).
- A `teamtalk_search` hit on this rule (resets to full).
- A `turn_start` keyword match against the rule's trigger description
  (resets to full — heuristic; see `TRIGGER_KEYWORDS` in
  `mods/index.ts`).

After `ttl` turns of no matching activity, the body stops appearing
in the reminder but stays in cache (re-loadable without cost).

### Per-agent cache

The mod keeps a session-local map keyed by `agent_id` (the calling
user-agent) and `trigger`. Two agents in the same conversation have
independent loaded-rule sets. Cache resets on session restart.

## Events

- `turn_start` — when the bound steward has a non-empty
  `system/rules.md`, prepends it as a transient system reminder on
  the user's turn. The reminder has two sections:
  1. Always-on rules (global) — full path/description per rule.
  2. Triggered-rules catalog — trigger + path + TTL + description,
     body omitted.
  3. Loaded dynamic rules — bodies of rules that were loaded (or
     auto-detected) this session, plus their remaining TTL.

  The reminder also carries the agent's session cache so bodies
  remain across turns until the TTL elapses.

## Identity discipline

- The steward agent and the user's agent are separate. The mod never
  asks the steward to write its own MemFS — writes flow through
  `teamtalk_propose` after OKF validation.
- The mod does not modify the user's agent's permanent memory. Rule
  injection is transient — the system reminder exists only for the
  duration of the turn.
- The init flow uses `letta agents create --pinned`, which makes the
  steward discoverable in the user's pinned agent list. The user
  should be aware the steward will appear in chat.letta.com.

## Local state

`~/.letta/mods/teamtalk.state.json` holds:

- `stewardAgentId` — the bound agent's id, or `null` if unbound.
- `stewardAgentName` — the bound agent's display name, or `null`.
- `lastSyncAt` — ISO timestamp of the last state refresh (set when
  `teamtalk_search` or `teamtalk_status` discovers the bundle).
- `bundlePath` — the resolved on-disk path to the steward's OKF
  bundle, or `null` if not yet located.

## Adaptation notes for agents

- Use `teamtalk_search` before answering questions about team
  conventions from general knowledge.
- Use `teamtalk_load_rule` when the rendered reminder lists a
  triggered rule whose trigger description matches your task.
- Prefer `teamtalk_propose` for new rules or playbooks over writing
  directly to the user's own memory.
- Triggered rules age out of context after their TTL of inactivity
  elapses. Re-load via `teamtalk_load_rule` when needed again; the
  tool call is cheap.
- When proposing, paths must start with `team/` and end with `.md`.
  Body is markdown. Frontmatter fields for global rules: `type`,
  `title`, optional `description`, `tags`, `timestamp`. Frontmatter
  fields for triggered rules add: `trigger`, `trigger-description`,
  `ttl`, `cacheable`. Multi-line block scalars (`|`, `>`) are not
  supported by the mod's frontmatter reader — keep every
  frontmatter value on one line.

## Recovery

- If the mod breaks startup or commands: `letta --no-mods` or
  `LETTA_DISABLE_MODS=1 letta`, then fix or remove the package and
  `/reload`.
- To unbind: `/teamtalk disable` clears the local state file.
- To fully reset: remove `~/.letta/mods/teamtalk` and the state file,
  then delete the steward agent via the Letta Code UI or
  `letta-client`.
- Debug with `/teamtalk debug` to inspect state, API connectivity,
  tagged-agent queries, and local filesystem state.
