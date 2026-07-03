---
name: "@letta-community/teamtalk"
description: "Share organizational knowledge across a team via a dedicated steward agent and an OKF bundle in the steward's MemFS."
---

# TeamTalk mod semantics

> **Skeleton.** This MOD.md documents the intended behavior. The
> implementation in `mods/index.ts` is a stub pending validation of the
> steward-agent pattern.

## When to use

Use `teamtalk_search` before non-trivial implementation work, when the
user asks about team conventions, or when the work might be governed by
an existing rule. Use `teamtalk_propose` when the team should adopt a
new rule, playbook, decision, or person entry.

## Architecture summary

- **Steward agent** — a designated agent (bound via `/teamtalk enable`)
  whose MemFS holds the OKF bundle under `team/` and whose `system/`
  memory blocks hold persona, schema, and the rendered global rules
  summary.
- **Reads** — direct filesystem reads from the steward's local MemFS
  clone. No remote API calls on the hot path.
- **Writes** — routed through the steward via structured PROPOSE
  messages. The steward's persona validates OKF conformance and policy
  before committing.
- **Rule injection** — `events.turns` reads the steward's
  `system/rules.md` on every turn and prepends a transient prefix to the
  user's turn context.

## Commands

- `/teamtalk enable [agent-id]` — bind to a steward. Without an
  `agent-id`, lists candidate agents in the org (those tagged
  `teamtalk-steward`).
- `/teamtalk status` — show binding, steward `agent_id`, local MemFS
  path, and OKF bundle root.
- `/teamtalk search <query>` — search the steward's OKF bundle.
- `/teamtalk propose` — open a guided flow to propose a new concept.

## Tools

- `teamtalk_search` — searches the steward's OKF bundle. Reads
  markdown files under `team/`, applies keyword or QMD-backed semantic
  search, returns matching snippets with concept IDs.
- `teamtalk_propose` — sends a `PROPOSE_NEW_CONCEPT` message to the
  steward. Returns the steward's response (commit confirmation or
  revision request).

## Events

- `turn_start` — reads `~/.letta/agents/<steward-id>/memory/system/rules.md`,
  prepends a transient prefix to the turn context. No remote API call.
  Skipped if the file is missing or empty.

## Identity discipline

The steward agent and the user's agent are separate. The mod never
writes to the steward's MemFS directly; it forwards proposals and lets
the steward apply policy. The mod does not modify the user's agent's
permanent memory; rule injection is transient only.

## Adaptation notes for agents

- Use `teamtalk_search` first when answering questions about team
  conventions, before responding from general knowledge.
- Prefer `teamtalk_propose` for new rules or playbooks over writing
  directly to the user's own memory.
- The steward may reject proposals that violate policy (secrets,
  duplicates, schema violations). Treat a rejection as a revision
  request, not a failure.
- Global rules are injected automatically; do not re-paste them in
  responses unless the user asks.