# Oath Keeper

*"Cron is for things you plan. Oath Keeper is for things you promise."*

An agent that keeps its word — automatically.

## What it does

Agents make promises they can't keep. "I'll get back to you" becomes "I forgot." Oath Keeper **passively** detects when agents make follow-up promises and makes them follow through — automatically, in the same conversation, with full tool access.

**No human prompting required. No agent cooperation required.**

## Demo

**User:** Can you check if the build is passing and let me know?

**Agent:** I'll look into that and get back to you with the CI status.

*(5 minutes pass — the agent has moved on to other things)*

**Agent (automatically re-engaged by Oath Keeper):** [Oath Delivered] The build is currently passing. I checked the CI pipeline — all 47 tests pass on the latest commit (a3f2b1c). The only flaky test (`test_network_timeout`) passed on retry.

---

**User:** Can you investigate the memory bloat issue?

**Agent:** I'll dig into that and report back what I find.

*(5 minutes later, unprompted)*

**Agent (automatically re-engaged):** [Oath Delivered] The memory bloat is coming from `node_modules` in the memory directory — 16,813 files being indexed by the scanner. I've added a `.gitignore` and deleted the bloated directory. Memory index size dropped from 193MB to 12MB.

---

The agent never called a scheduling tool. It never set a reminder. It just made a promise in natural language, and Oath Keeper held it to its word.

## How it works

1. Agent says: *"I'll get back to you on that."*
2. Oath Keeper detects the promise passively (polls conversation every 15s)
3. Oath created with a 5-minute countdown
4. Timer expires — Oath Keeper posts a delivery prompt to the conversation
5. Agent re-engages with full tool access and delivers

```
User asks question
    → Agent responds with "I'll get back to you..."
        → Oath Keeper detects promise (passive, no agent action)
            → 5-minute timer starts
                → Timer fires → agent re-engaged → delivers answer
```

## Installation

```bash
# Copy the mod file
cp packages/oath-keeper/mods/index.ts ~/.letta/mods/oath-keeper.ts
```

Then run `/reload` in Letta Code.

The mod auto-discovers conversation and agent IDs from the tool context on first use. For headless/polling-only setups where tools never fire, you can optionally create `~/.letta/extensions/oath-env.json`:

```json
{
  "LETTA_AGENT_ID": "your-agent-id",
  "LETTA_CONVERSATION_ID": "your-conversation-id"
}
```

## Usage

Just talk to your agent. When it says "I'll follow up" or "I'll get back to you," Oath Keeper catches it automatically.

Check tracked oaths:

```
list_oaths
```

## Promise detection

Oath Keeper catches natural-language promises without any agent cooperation:

- "I'll get back to you on that"
- "I'll follow up"
- "I'll check on this"
- "I'll look into that and report back"
- "I'll let you know"
- "I'll circle back"
- "I'll update you"
- "I'll have results for you"
- 15+ patterns total

Anti-false-positive: code blocks, inline code, blockquotes, and quoted text are stripped before scanning.

## Architecture

- **Detection:** `setInterval` polls the conversation API every 15s for new assistant messages
- **Delivery:** POST to conversation API endpoint with retry on 409 (busy conversation). Up to 5 retries with 15s backoff
- **State:** Local JSON at `~/.letta/mods/oath-keeper.state.json`
- **Capabilities:** Works with `{ tools: true }` only — no events required

## Why not cron?

Cron requires explicit scheduling. Oath Keeper catches promises the agent made **implicitly** — "I'll get back to you" — without the agent calling any scheduling tool.

**Cron is for things you plan. Oath Keeper is for things you promise.**

## Safety

- Uses only the public tools API and fetch()
- Does not modify turn input or tool arguments
- Recursion prevention: skips its own messages
- All timers cleaned up on unload

## Demo

[![asciicast](https://asciinema.org/a/P8pDDmuF2aJnk1PL.svg)](https://asciinema.org/a/P8pDDmuF2aJnk1PL)

Watch the full flow: agent makes a promise → moves on to other work → Oath Keeper re-engages it to deliver.
