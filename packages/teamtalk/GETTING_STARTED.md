# Getting Started with TeamTalk

This walks through installing the TeamTalk mod, creating the steward
agent in your Letta org, and exercising the read and write paths
manually. It assumes you've cloned the package somewhere on disk and
have Letta Code installed (Desktop or CLI).

## Prerequisites

- Letta Code 0.27.14 or later
- A Letta org where you can create agents
- Active authentication (OAuth in Desktop or CLI; `LETTA_API_KEY` env
  var for scripted installs)

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

## 3. Create the steward agent

```
/teamtalk init
```

This will print a preview of what it will do, but **not** actually
create anything yet. Re-run with `--confirm` to proceed:

```
/teamtalk init --confirm
```

Optional: name the agent something other than the default:

```
/teamtalk init --name my-team-steward --confirm
```

What this does:

1. Calls `letta.client.agents.create` with name, model, embedding, and
   three memory blocks: `persona`, `schema`, `rules`.
2. Tags the new agent with `teamtalk-steward`.
3. Waits briefly for the local MemFS clone to land at
   `~/.letta/agents/<agent-id>/memory/`.
4. Copies the OKF bundle seed files from the mod's `assets/team/`
   directory into `~/.letta/agents/<agent-id>/memory/team/`.
5. Writes the binding to `~/.letta/mods/teamtalk.state.json`.

If successful, you'll see:

```
# TeamTalk steward created

- Agent: teamtalk-steward (agent-XXXXXXXX)
- Tagged: teamtalk-steward
- MemFS dir: /Users/you/.letta/agents/agent-XXXXXXXX/memory
- OKF bundle: /Users/you/.letta/agents/agent-XXXXXXXX/memory/team
- Seeded 9 bundle files.

Next: run `/teamtalk status` to verify, or `/teamtalk search` to exercise the read path.
```

## 4. Confirm the steward is reachable

```
/teamtalk status
```

Expected:

```
# TeamTalk status

- Steward agent: teamtalk-steward (agent-XXXXXXXX)
- Local MemFS dir: /Users/you/.letta/agents/agent-XXXXXXXX/memory
- OKF bundle: /Users/you/.letta/agents/agent-XXXXXXXX/memory/team
- Rules file: .letta/agents/agent-XXXXXXXX/memory/system/rules.md
- Concepts in bundle: 6
- Last sync: 2026-07-03T16:45:00.000Z
```

If `Local MemFS dir` says `(not found on disk)`, the clone hasn't
arrived yet. Wait a few seconds and re-run. If it still doesn't
appear, check that the steward agent was created successfully.

## 5. Exercise the read path

Search for one of the seeded rules:

```
/teamtalk search think
```

Expected: a result block for `rules/global/think-before-coding` with
its title, description, tags, and snippet.

Or ask the model to use the tool directly:

```
What does the team's `think-before-coding` rule say?
```

The model should call `teamtalk_search` and respond with the rule
content from the steward's bundle.

## 6. Exercise rule injection

Start a **new conversation** and submit any user message. The
`turn_start` handler should prepend the steward's global rules as a
transient system reminder.

You can verify this by asking the agent to quote the rules it has in
context, or by inspecting the conversation via `/palace` if your
client supports it. The reminder is transient — it doesn't modify the
user agent's permanent memory.

## 7. Exercise the write path

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
to its own MemFS.

The steward replies with the committed path and any policy notes.
You can verify the write by:

```
/teamtalk search unused imports
```

Expected: a result for `rules/global/no-unused-imports`.

You can also inspect the steward's MemFS directly on disk:

```bash
ls ~/.letta/agents/<agent-id>/memory/team/rules/global/
```

## 8. Ask the steward a question directly

The steward is a regular Letta agent. You can message it from your
agent's session via the existing `agent` or `task` tool, or use
`letta-ai/letta-client` in a script. For example:

```typescript
import { Letta } from "@letta-ai/letta-client";

const client = new Letta({ apiKey: process.env.LETTA_API_KEY });
const response = await client.agents.messages.create(process.env.STEWARD_ID!, {
  messages: [{ role: "user", content: "Summarize the team's current global rules." }],
});
```

## Troubleshooting

**"No steward bound" after `/teamtalk init --confirm`.**

The binding write to `~/.letta/mods/teamtalk.state.json` failed. Check
file permissions on `~/.letta/mods/`.

**Status shows `(not found on disk)` for MemFS dir.**

The Letta Code harness hasn't cloned the steward locally yet. This can
take a few seconds after agent creation. Wait and re-run `/teamtalk
status`. If it persists, check your `MEMORY_DIR` environment variable
or your `~/.letta/` directory layout.

**Search returns no results.**

Verify the bundle exists on disk at the path shown in `/teamtalk
status`. Open a concept file in your editor to confirm content. If the
bundle is empty, re-run the seeding step manually (copy `assets/team/`
from the mod package into the bundle directory).

**Write proposals get rejected.**

The steward rejects proposals that match secret patterns, duplicate
existing concepts, or propose paths outside `team/`. Read the
steward's reply text — it explains the rejection. Modify your
proposal and resubmit.

**Mod breaks startup or commands.**

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

Then fix or remove the package and `/reload`.

## What to do next

Once the manual workflow works end-to-end, the package is ready for a
PR against `letta-ai/mods`. Before opening the PR:

1. Update README.md and MOD.md to reflect actual tested behavior (not
   aspirational).
2. Make sure `npm run validate` passes from the repo root.
3. Open the PR with a clear description of what's been tested and what
   hasn't.

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