# Oath Keeper

*"Cron is for things you plan. Oath Keeper is for things you promise."*

An agent that keeps its word — automatically.

## What it does

Agents make promises they can't keep. "I'll get back to you" becomes "I forgot." Oath Keeper **passively** detects when agents make follow-up promises and makes them follow through — automatically, in the same conversation, with full tool access.

**No human prompting required. No agent cooperation required.**

## Demo

**User:** Can you check if the build is passing and let me know?

**Agent:** I'll look into that and get back to you with the CI status.

*(agent has moved on to other things)*

**Agent (automatically re-engaged by Oath Keeper):** [Oath Delivered] The build is currently passing. I checked the CI pipeline — all 47 tests pass on the latest commit (a3f2b1c).

---

**User:** Can you investigate the memory bloat issue?

**Agent:** I'll dig into that and report back what I find.

*(unprompted, after the delay the agent specified)*

**Agent (automatically re-engaged):** [Oath Delivered] The memory bloat is coming from `node_modules` in the memory directory — 16,813 files being indexed by the scanner. I've added a `.gitignore` and deleted the bloated directory.

---

The agent never called a scheduling tool. It never set a reminder. It just made a promise in natural language, and Oath Keeper held it to its word.

## How it works

1. Agent says: *"I'll get back to you on that in a few minutes."*
2. Oath Keeper detects the promise via `turn_end` event (or polling fallback)
3. An LLM classifies the message as a genuine promise and extracts the delay
4. Oath created with the specified countdown (defaults to 5 minutes if unspecified)
5. Timer expires — Oath Keeper posts a delivery prompt to the conversation
6. Agent re-engages with full tool access and delivers

```
User asks question
    → Agent responds with "I'll get back to you in 5 minutes..."
        → turn_end fires → LLM confirms promise + extracts delay (300s)
            → Timer starts
                → Timer fires → agent re-engaged → delivers answer
```

## Installation

```bash
letta install npm:@letta-ai/oath-keeper
```

Then run `/reload` in Letta Code.

For listener/desktop mode where `turn_end` events are not available, create `~/.letta/extensions/oath-env.json`:

```json
{
  "LETTA_AGENT_ID": "your-agent-id",
  "LETTA_CONVERSATION_ID": "your-conversation-id",
  "LETTA_BASE_URL": "http://localhost:PORT"
}
```

## Usage

Just talk to your agent. When it says "I'll follow up" or "I'll get back to you," Oath Keeper catches it automatically.

Check tracked oaths:

```
list_oaths
```

### Verbose logging

Console output is silent by default. Enable with:

```bash
touch ~/.letta/mods/oath-keeper.verbose
```

Disable with `rm ~/.letta/mods/oath-keeper.verbose`. Debug logs are always written to `~/.letta/mods/oath-keeper-debug.json`.

## Promise detection

Oath Keeper uses LLM-based detection — no regex patterns. The same LLM call that classifies a promise also extracts:

- **The promise text** — what the agent specifically committed to
- **The delay** — how long until delivery (e.g., "in 5 minutes" → 300s, "tomorrow" → 86400s). If no time is specified, the LLM estimates based on task complexity.

This catches any phrasing:

- "I'll get back to you on that"
- "I'll follow up"
- "I'll check on this"
- "I'll look into that and report back"
- "Let me investigate and I'll have results in an hour"

## Architecture

- **Detection:** `turn_end` event handler (primary, CLI v0.27.25+ / desktop v0.27.29+) or `setInterval` polling every 15s (listener fallback). Polling scan is automatically disabled when `turn_end` is available — no duplicate oaths.
- **Conversation scoping:** `turn_end` extracts `conversationId` and `agentId` from the event context. Oaths deliver back to the conversation that originated them.
- **Delivery:** POST to conversation API endpoint with retry on 409 (busy conversation). Queued state lifecycle: `pending → queued → delivering → delivered`
- **State:** Local JSON at `~/.letta/mods/oath-keeper.state.json` with builder-pattern StateStore (load → mutate → save)
- **LLM delay:** The classification LLM determines how long to wait before delivery based on the agent's own words

## TUI Dashboard

A standalone terminal dashboard for monitoring oaths in real time:

```bash
cd packages/oath-keeper/cli
cargo build --release
./target/release/oath-keeper
```

Shows pending, delivering, and recently delivered oaths with live countdowns. Reads from `~/.letta/mods/oath-keeper.state.json`. Requires Rust (uses [ratatui](https://github.com/ratatui/ratatui) + [crossterm](https://github.com/crossterm-rs/crossterm)).

## Why not cron?

Cron requires explicit scheduling. Oath Keeper catches promises the agent made **implicitly** — "I'll get back to you" — without the agent calling any scheduling tool.

**Cron is for things you plan. Oath Keeper is for things you promise.**

## Safety

- Uses only the public tools API and fetch()
- Does not modify turn input or tool arguments
- Recursion prevention: skips its own `[Oath Keeper]` and `[Oath Delivered]` messages
- All timers cleaned up on unload
