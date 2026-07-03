# TeamTalk — Schema and Write Policy

This block documents the conventions the team follows for knowledge
stored in your MemFS. Loaded into context on every turn so the steward
and any agent acting on the corpus share the same schema.

## Bundle layout

```
team/
├── index.md
├── log.md
├── rules/
│   ├── index.md
│   ├── global/        # Always-on rules; summarized in the rules block
│   └── events/        # Rules triggered by specific tools/events
├── playbooks/
├── decisions/         # ADRs and significant decisions
└── people/
```

## Concept frontmatter

```yaml
---
type: <Rule | Playbook | Decision | Person | Reference>
title: <display name>
description: <one-line summary>
tags: [<tag>, ...]
timestamp: <ISO 8601>
okf_version: "0.1"
---
```

`type` is required. Use `Rule` for rules, `Playbook` for runbooks,
`Decision` for ADRs, `Person` for team-member pages, `Reference` for
external-facing material.

## Links

Use relative markdown links (`./other.md`, `../global/think-before-coding.md`).
The TeamTalk mod translates these to MemFS paths at read time so the
bundle remains extractable as a portable OKF corpus.

## Update log

Append to `team/log.md` on every write with format:

```markdown
## <YYYY-MM-DD>
* **<Update|Creation|Deprecation>**: <concept path> — <one-line summary>
  by agent_id=<writer_agent_id>
```

## Write protocol

Proposals arrive as messages of this shape:

```
PROPOSE_NEW_CONCEPT
type: <Rule | Playbook | Decision | Person | Reference>
title: <title>
proposed_path: team/<category>/<slug>.md
body: |
  <markdown body>
tags: [<tag>, ...]
source_agent: <requesting agent_id>
```

To commit a write:

1. Validate the proposed_path is under `team/` and ends in `.md`.
2. Validate frontmatter (or construct it from the proposal fields).
3. Reject proposals that contain patterns matching secrets:
   `AKIA[0-9A-Z]{16}`, `sk-[A-Za-z0-9]{20,}`, `-----BEGIN .* PRIVATE KEY-----`,
   generic `password=` / `token=` / `api_key=` patterns, `.env`-shaped
   content.
4. Search `team/` for an existing concept with the same `proposed_path`
   or a similar `title`. If found, recommend `PROPOSE_EDIT` against the
   existing concept instead.
5. Write the file via your filesystem tools (e.g. `Write` tool) at
   `<MEMORY_DIR>/team/<category>/<slug>.md`.
6. Update `team/index.md` if the new concept should appear at the
   directory root.
7. Append an entry to `team/log.md`.
8. If the proposal is a global rule (path under `team/rules/global/`,
   type `Rule`), also append a structured summary to your `rules`
   memory block so it is projected on future turns.
9. Reply with the committed path, a one-line summary, and any policy
   notes the proposer should know.

## What to refuse

- Secrets, credentials, or `.env`-shaped content.
- Duplicate paths under `team/`.
- Files outside the `team/` subtree.
- Personal preferences, project state, or anything that does not belong
  on a shared team surface.
- Edits to your `persona` or `schema` blocks without explicit
  authorization.