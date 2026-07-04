---
name: "@letta-community/teamtalk"
description: "Share organizational knowledge across a team via a dedicated steward agent and an OKF bundle in the steward's MemFS."
---

# TeamTalk mod semantics

## When to use

Use `teamtalk_search` before non-trivial implementation work, when the
user asks about team conventions, or when a relevant rule may already
exist. Use `teamtalk_propose` when the team should adopt a new rule,
playbook, decision, or person entry.

## Architecture summary

- **Steward agent** — a designated agent (bound via `/teamtalk enable`
  or created via `/teamtalk init`) whose MemFS holds the OKF bundle
  under `team/` and whose `system/` directory holds persona, human, and
  the rendered `rules.md`. Tagged `teamtalk-steward`. The mod uses
  `letta/auto` as the model so the steward is routed to whatever
  provider is currently available.
- **Reads** — direct filesystem reads from the steward's local MemFS
  clone at `~/.letta/agents/<steward-id>/memory/team/` (or
  `~/.letta/lc-local-backend/memfs/<steward-id>/memory/team/` for
  local-backend agents). No remote API calls on the hot path.
- **Writes** — routed through the steward via a structured
  `PROPOSE_NEW_CONCEPT` message. The steward's persona validates OKF
  conformance and policy (no secrets, no duplicates, paths under
  `team/`) before committing to its own MemFS.
- **Rule injection** — `events.turns.onTurnStart` reads
  `~/.letta/agents/<steward-id>/memory/system/rules.md` and prepends
  it as a transient system reminder to the user's turn context. No
  remote API call. The file is rendered from the OKF bundle on
  init/reseed.

## Init flow

The mod does not use `letta.client.agents.create` directly. It shells
out to `letta agents create --tags teamtalk-steward,git-memory-enabled
--pinned --model letta/auto`, which is the supported CLI path that
sets up MemFS, applies tags, and pre-populates `persona.md`. After
agent creation, the local MemFS clone only materializes once a
user-agent session opens with that agent; the mod spawns a
backgrounded `letta --agent <steward-id>` with `stdio: "ignore"` to
trigger that session-open, then polls for the clone to appear.

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

- `teamtalk_propose(type, title, proposed_path, body, tags?)` — sends
  a `PROPOSE_NEW_CONCEPT` message to the bound steward. Requires
  approval. The steward validates and commits, or replies with a
  rejection. The mod pre-validates against secret patterns and path
  shape before sending.

## Events

- `turn_start` — when the bound steward has a non-empty
  `system/rules.md`, prepends it as a transient system reminder on
  the user's turn. Skipped when not bound or when the rules file is
  missing/empty.

## Identity discipline

- The steward agent and the user's agent are separate. The mod never
  writes to the steward's MemFS directly; it forwards proposals and
  lets the steward apply policy.
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
- Prefer `teamtalk_propose` for new rules or playbooks over writing
  directly to the user's own memory.
- The steward may reject proposals that violate policy (secrets,
  duplicates, schema violations). Treat a rejection as a revision
  request, not a failure — read the steward's reply text, adjust, and
  resubmit.
- Global rules are injected automatically; do not re-paste them in
  responses unless the user asks.
- When proposing, paths must start with `team/` and end with `.md`.
  Body is markdown. Frontmatter fields (`type`, `title`, optional
  `description`, `tags`, `timestamp`) follow OKF v0.1.

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
