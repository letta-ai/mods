# Oath Keeper

*"Cron is for things you plan. Oath Keeper is for things you promise."*

An agent that keeps its word — automatically.

## What it does

Agents make promises they can't keep. "I'll get back to you" becomes "I forgot." Oath Keeper **passively** listens to what agents say, catches their promises, and makes them follow through — automatically, in the same conversation, with full tool access.

**No human prompting required. No agent cooperation required.**

## How it works

1. Agent says: *"I'll get back to you on that."*
2. Oath Keeper detects the promise (passive polling, no agent action needed)
3. Oath created with a countdown timer (5 minutes by default)
4. Timer expires → Oath Keeper re-engages the agent: *"You promised to check on that. Deliver now."*
5. Agent investigates with full tools and provides the answer

The agent never has to call a tool, set a reminder, or acknowledge the mod. It just works.

## Installation

```bash
cp packages/oath-keeper/mods/index.ts ~/.letta/mods/oath-keeper.ts
```

Then run `/reload` in Letta Code.

For local API access, create `~/.letta/extensions/oath-env.json`:

```json
{
  "LETTA_AGENT_ID": "your-agent-id",
  "LETTA_CONVERSATION_ID": "your-conversation-id"
}
```

## Usage

Just talk to your agent. When it says "I'll follow up" or "I'll get back to you," Oath Keeper catches it automatically.

Check tracked oaths with the `list_oaths` tool.

## Architecture

- **Detection:** `setInterval` polls the conversation API every 15s for new assistant messages. Regex patterns match common promise phrasing.
- **Anti-false-positive:** Code blocks, inline code, blockquotes, and quoted text are stripped before scanning. Oath Keeper's own injected messages are skipped.
- **Delivery:** POST to the conversation API endpoint with retry on 409 (conversation busy). Up to 5 retries with 15s backoff.
- **State:** Local JSON at `~/.letta/mods/oath-keeper.state.json`.
- **Capabilities:** Works with `{ tools: true }` only — no events required.

## Why not cron?

Cron requires explicit scheduling. Oath Keeper catches promises the agent made **implicitly** — "I'll get back to you" — without the agent calling any scheduling tool.

**Cron is for things you plan. Oath Keeper is for things you promise.**
