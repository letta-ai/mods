# Getting Started with TeamTalk

This walks through installing the TeamTalk mod, creating the steward
agent in your Letta org, and exercising the read and write paths
manually. It assumes you've cloned the package somewhere on disk and
have Letta Code installed (Desktop or CLI).

## Prerequisites

- Letta Code 0.27.14 or later (tested on 0.27.21)
- A Letta org where you can create agents
- Active authentication (OAuth in Desktop or CLI; `LETTA_API_KEY` env
  var for scripted installs)
- The `letta` CLI on `$PATH` (the mod shells out to it during init)

## 1. Install the mod from your local fork

From the parent directory that contains the package:

```bash
letta install ./packages/teamtalk
```

Or, from inside `packages/teamtalk/`:

```bash
letta install .
```

After install, **reload** in any active sessions:

```
/reload
```

Note: `letta install` does not resolve `package.json#dependencies` for
mod packages. Installing TeamTalk does not pull in any peer mods. If
you want semantic search as a complement to the keyword search, install
`npm:@letta-ai/memfs-search` separately.

If install fails, run with `LETTA_DISABLE_MODS=1 letta` to start without
mods and recover.

## 2. Verify the install

Open a new conversation and run:

```
/teamtalk status
```

Expected output (since nothing is bound yet):

```
# TeamTalk status

No steward bound. Run `/teamtalk init` or `/teamtalk enable <agent-id>`.
```

## 3. Create the steward agent (preview)

```
/teamtalk init
```

This prints a preview of what it will do, but **does not** create
anything yet. Re-run with `--confirm` to proceed:

```
/teamtalk init --confirm
```

Optional: name the agent something other than the default:

```
/teamtalk init --name my-team-steward --confirm
```

## 4. Create the steward agent (confirmed)

```
/teamtalk init --name my-team-steward --confirm
```

What this does:

1. **Shells out to `letta agents create`** with
   `--tags teamtalk-steward,git-memory-enabled --pinned --model letta/auto`.
   The CLI sets up MemFS, applies tags, and pre-populates `persona.md`.
2. **Verifies via the SDK** that the new agent is retrievable in the
   session's org (this catches "phantom ID" failures where the API call
   succeeds but the agent isn't actually visible).
3. **Backgrounds `letta --agent <id>`** to materialize the local MemFS
   clone. This is needed because the clone only appears once a
   user-agent session opens with the agent; the backgrounded CLI exits
   promptly on no-TTY and the clone lands within ~5 seconds.
4. **Polls for the local clone**, then **seeds the OKF bundle** from
   the mod's bundled `assets/team/` into
   `~/.letta/agents/<id>/memory/team/`.
5. **Renders `system/rules.md`** from the OKF bundle so the
   `turn_start` event handler has something to read.
6. **Writes the binding** to `~/.letta/mods/teamtalk.state.json`.

Successful output looks like:

```
# TeamTalk steward created

- Agent: my-team-steward (agent-XXXXXXXX)
- Tagged: teamtalk-steward
- Verified: retrieve succeeded
- MemFS dir: ~/.letta/agents/agent-aa340af3-.../memory (present)
- Seeded 9 bundle files.
- Wrote 3 rules to ~/.letta/agents/agent-aa340af3-.../memory/system/rules.md
```

If the local clone didn't land within 5 seconds, you'll see "not yet
present" and a hint to run `/teamtalk init --reseed`. That's the
fallback path; the CLI shell-out usually wins.

## 5. Confirm binding and paths

```
/teamtalk status
```

Expected:

```
# TeamTalk status

- Steward agent: my-team-steward (agent-XXXXXXXX)
- Local MemFS dir: ~/.letta/agents/agent-aa340af3-.../memory
- OKF bundle: ~/.letta/agents/agent-aa340af3-.../memory/team
- Rules file: ~/.letta/agents/agent-aa340af3-.../memory/system/rules.md
- Concepts in bundle: 3
- Last sync: 2026-07-04T12:37:00.000Z
```

If `Local MemFS dir` says `(not found on disk)`, the backgrounded CLI
session hasn't completed yet. Wait a few seconds and re-run. If it
persists, run `/teamtalk init --reseed` to retry the seeding (the
mod will try `letta memory pull` as a fallback before giving up).

## 6. Exercise the read path

```
/teamtalk search think
```

Expected: a result block for `think-before-coding` with its title,
description, tags, and snippet.

Or ask the model to use the tool directly:

```
What does the team's `think-before-coding` rule say?
```

The model should call `teamtalk_search` and respond with the rule
content from the steward's bundle.

## 7. Exercise rule injection

Submit any user message in your session. The `turn_start` handler
should prepend the steward's global rules as a transient system
reminder.

You can verify this by asking the agent to quote the rules it has in
context, or by inspecting the conversation history. The reminder is
transient — it doesn't modify the user agent's permanent memory.

## 8. Exercise the write path

Use `teamtalk_propose` via the model:

```
Please propose a new rule for the team: "Always check that imports
are used before committing TypeScript code." Type: Rule. Tags:
quality, typescript. Path:
team/rules/global/no-unused-imports.md.
```

The model should construct a `teamtalk_propose` tool call. On approval,
the mod sends a `PROPOSE_NEW_CONCEPT` message to the steward. The
steward's persona validates OKF conformance and policy, then commits
the new concept to its own MemFS.

The steward replies with the committed path and any policy notes.
You can verify the write by:

```
/teamtalk search unused imports
```

Expected: a result for `rules/global/no-unused-imports`. You can also
inspect the steward's MemFS directly:

```bash
ls ~/.letta/agents/<agent-id>/memory/team/rules/global/
```

## 9. Self-check the install with `/teamtalk debug`

```
/teamtalk debug
```

Output covers the local state file, a tag-filtered agent list, the
bound steward's retrievability, and the local filesystem state.
Use this to diagnose org-scoping issues (e.g. "the steward was
created but I can't see it in chat.letta.com") and missing-clone
problems.

## Troubleshooting

**"No steward bound" after `/teamtalk init --confirm`.**

The binding write to `~/.letta/mods/teamtalk.state.json` failed.
Check file permissions on `~/.letta/mods/`.

**Status shows `(not found on disk)` for MemFS dir after init.**

The backgrounded `letta --agent` may not have completed within the
5-second polling window. Wait a few seconds and re-run `/teamtalk
status`, or run `/teamtalk init --reseed` to retry seeding. Reseed
calls `letta memory pull --agent <id>` as a fallback.

**Search returns no results.**

Verify the bundle exists on disk at the path shown in `/teamtalk
status`. Open a concept file in your editor to confirm content. If the
bundle is empty, run `/teamtalk init --reseed`.

**Write proposals get rejected.**

The steward rejects proposals that match secret patterns, duplicate
existing concepts, or propose paths outside `team/`. Read the
steward's reply text — it explains the rejection. Modify your
proposal and resubmit.

**Steward not visible in chat.letta.com.**

Use `/teamtalk debug` to confirm the agent is retrievable in your
session's org. If retrieve succeeds but chat.letta.com doesn't show the
agent, your browser may be bound to a different org than your CLI
session. Use the CLI session to manage the steward.

**Mod breaks startup or commands.**

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

Then fix or remove the package and `/reload`.

## Uninstall

```bash
letta mods remove teamtalk
```

Or manually:

```bash
rm -rf ~/.letta/mods/teamtalk
rm ~/.letta/mods/teamtalk.state.json
```

Then `/reload`. The steward agent itself is not removed; delete it
through the Letta Code UI or `letta-client` if you want a clean slate.
