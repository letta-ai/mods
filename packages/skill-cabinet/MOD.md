---
name: "@letta-ai/skill-cabinet"
description: "Live skill discovery, search, auditing, and usage provenance for Letta Code agents."
---

# Skill Cabinet mod semantics

## When to use

Use Skill Cabinet when an agent has a broad or changing skill surface and needs to find capabilities by meaning, source, or category instead of relying on perfect recall.

Good use cases include:

- searching for an already-installed capability before inventing a manual workflow
- checking whether a relevant skill is bundled, agent-owned, global, or project-local
- surfacing skills not observed during the current tracking window
- finding duplicate IDs, weak frontmatter, scan errors, or uncategorized skills
- generating a local point-in-time catalog for inspection

## Behavioral contract

Skill Cabinet observes and indexes skills. It does not invoke them, install them, rewrite them, or decide that an agent must use them.

The model tool is read-only. Snapshot generation is explicit through the slash command. Usage state records only completed `Skill` tool calls seen while the observer is loaded.

## Model tool

`skill_catalog`

Actions:

- `summary`
- `search`
- `category`
- `source`
- `forgotten`

Search results return skill metadata and observed-use timestamps without returning local filesystem paths.

## Slash command

The default command is `/skills`. Set `SKILL_CABINET_COMMAND` before mod activation to use another valid command ID, such as `/cabinet`.

Key forms:

```text
/skills
/skills <query>
/skills categories
/skills category <name>
/skills source <agent|project|global|bundled>
/skills forgotten [limit]
/skills audit
/skills paths
/skills help
```

## Source semantics

The live catalog scans bundled, global, agent-owned, legacy project, and primary project roots. Higher-precedence roots shadow lower-precedence copies with the same skill ID. The audit preserves duplicate provenance so shadowing remains inspectable.

Project roots are derived from the active context's working directory. A cabinet is therefore a live view of the current environment, not one timeless global list.

## Category semantics

Declared `category:` frontmatter wins. Custom declared categories are normalized and preserved. Keyword inference is only a fallback for skills without a declared category.

Do not treat inferred categories as ontology. If categorization matters, improve the skill's frontmatter.

## Usage provenance

“Observed use” means the mod received a completed `tool_end` event for the `Skill` tool and a concrete `skill` argument.

“Never observed” does not mean “never used historically.” The observation window can have gaps across installation, reload, process, host, or event availability. Preserve that caveat in downstream summaries.

## State

Per-agent local state defaults to:

```text
~/.letta/mods/data/skill-cabinet/<agent_id>/
```

`SKILL_CABINET_DATA_DIR` overrides the root. Missing agent scope fails closed for state access. The mod does not use shared unknown-agent storage.

## Safety invariants

- No network calls or telemetry.
- Never modify skill source files.
- Never write generated snapshots into agent memory by default.
- Keep local usage state scoped by agent.
- Keep ordinary tool search results free of local filesystem paths.
- Protect recursive scans against symlink cycles.
- Reject individual `SKILL.md` files larger than 1 MB and report the scan error.
- Use atomic writes for state and snapshots.
- Return all registration disposers when the mod unloads.

## Adaptation notes for agents

- Search the cabinet when a request plausibly matches a capability but no exact skill name is salient.
- Treat the cabinet as orientation, not obligation; tools serve intent.
- Prefer frontmatter categories over extending hardcoded per-skill lists.
- Read provenance caveats literally. Do not convert an observation window into historical certainty.
- Run `/skills audit` when a durable local snapshot is useful, not after every scan.
- If bundled discovery misses a nonstandard installation, set `LETTA_BUNDLED_SKILLS_DIR` rather than adding one machine's private absolute path to the package.
