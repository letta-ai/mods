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
  under `team/` and whose `system/` memory blocks hold persona, schema,
  and the rendered global rules summary. Tagged `teamtalk-steward`.
- **Reads** — direct filesystem reads from the steward's local MemFS
  clone at `~/.letta/agents/<steward-id>/memory/team/` (or
  `~/.letta/lc-local-backend/memfs/<steward-id>/memory/team/`). No
  remote API calls on the hot path.
- **Writes** — routed through the steward via a structured
  `PROPOSE_NEW_CONCEPT` message. The steward's persona validates OKF
  conformance and policy (no secrets, no duplicates, paths under
  `team/`) before committing to its own MemFS via filesystem tools.
- **Rule injection** — `events.turns.onTurnStart` reads
  `~/.letta/agents/<steward-id>/memory/system/rules.md` and prepends a
  transient system reminder to the user's turn context. No remote API
  call.

## Commands

- `/teamtalk init [--name <name>] [--confirm]` — create a steward
  agent in the org (with confirmation) and seed its MemFS with persona,
  schema, rules, and the OKF bundle. Without `--confirm`, prints a
  preview.
- `/teamtalk enable [agent-id]` — bind to an existing steward. Without
  ID, lists agents tagged `teamtalk-steward` in the org.
- `/teamtalk disable` — clear the local binding.
- `/teamtalk status` — show binding, steward ID, local MemFS path, OKF
  bundle root, concept count, last refresh time.
- `/teamtalk search <query> [--limit N]` — search the steward's OKF
  bundle.
- `/teamtalk propose` — open the proposal flow. Recommended: ask the
  model to call `teamtalk_propose` with structured args instead.

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
  `system/rules.md`, prepends it as a transient system reminder on the
  user's turn. Skipped when not bound or when the rules file is
  missing/empty.

## Identity discipline

- The steward agent and the user's agent are separate. The mod never
  writes to the steward's MemFS directly; it forwards proposals and
  lets the steward apply policy.
- The mod does not modify the user's agent's permanent memory. Rule
  injection is transient — the system reminder exists only for the
  duration of the turn.

## Local state

`~/.letta/mods/teamtalk.state.json` holds:

- `stewardAgentId` — the bound agent's id, or `null` if unbound.
- `stewardAgentName` — the bound agent's display name, or `null`.
- `lastSyncAt` — ISO timestamp of the last state refresh (set when
  `teamtalk_search` or `teamtalk_status` discovers the bundle).
- `bundlePath` — the resolved on-disk path to the steward's OKF bundle,
  or `null` if not yet located.

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
  then delete the steward agent via the Letta Code UI or `letta-client`.