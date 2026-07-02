# Oath Keeper: From Promise to PR — A Build Retrospective

*"Cron is for things you plan. Oath Keeper is for things you promise."*

**PR:** https://github.com/letta-ai/mods/pull/28
**Timeline:** June 25 – July 1, 2026 (7 days)
**Architecture pivots:** 6
**Scene files documenting the journey:** 15
**Tagline origin:** Game of Thrones' Oathkeeper sword (user is a self-described "lame AF GoT nerd")

---

## The Idea (June 25-26)

It started with a consortium. Three rounds of multi-agent brainstorming across the fleet — Coda, Angus, Beacon, FORGE, and Sinter — generating, debating, and killing mod ideas for Letta's "Best Mod" competition.

**12+ ideas were killed:**
- **Echo Loop Breaker** (V1 winner) — killed when we discovered doom loops happen during text generation, before any mod hook can fire. Not "could be a hook" — CAN'T be a mod or a hook.
- **Memory Palace Map** (V2 winner) — killed instantly when the user pointed out `/palace` already exists in the desktop app.
- **Mood Ring** — overlaps with the existing `pets` mod.
- **Session Recap** — depends on `conversation_close` which "I've frankly never seen an agent use... Ever."
- **Pinboard, Secret Vault, git-snapshot, /undo, trail-cam** — each duplicating existing features or too niche.

**Oath Keeper survived** because it answered one question nothing else could: *what about the promises agents make that they never explicitly schedule?*

The distinction from cron was the key insight. User challenged: "Agents can make crons on their own. How is this special?" The answer: cron requires explicit planning. Oath Keeper catches promises the agent made **without any intention of scheduling** — "I'll check the logs and get back to you" — and enforces them at the harness level.

The agent doesn't have to remember. The harness remembers for it.

---

## Architecture Pilots (6 Pivots in 7 Days)

### Pivot 1: Events Don't Fire in Listener Mode (June 26)

**The plan:** Use `turn_start` event for detection. When the agent responds, the mod scans the response for promise language.

**The wall:** Listener mode (Telegram, channels) has ALL event capabilities disabled:
```json
{"events":{"lifecycle":false,"tools":false,"turns":false}}
```

The mod loaded cleanly. Zero diagnostics. But `turn_start` never executed. The conversation handle was never stored. The event simply does not fire in listener mode.

**The fix:** Pivoted to tool-based detection (`make_oath` tool) + direct `fetch()` to `api.letta.com` using `process.env.LETTA_API_KEY` (available in the tool handler's Node.js context). This bypassed all listener mode restrictions. Verified end-to-end.

**The TDD foundation:** 87 unit tests written for pure logic functions (promise detection, oath records, state I/O, delivery prompt builder, recursion check). Two Angus design reviews: 4 fixes, 0 blockers.

### Pivot 2: setInterval Dies — The Ephemeral Engine (June 27)

**The plan:** Use `setInterval` for the delivery timer. After 5 minutes, the timer fires and the delivery goes out.

**The wall:** The listener engine is ephemeral. It starts when a message arrives, runs the tool handler, then stops. Any pending `setInterval` timers are destroyed when the engine stops. A 15-second delay outlives the engine's active period (typically a few seconds).

The `make_oath` tool was called, the timer was set, but the delivery never fired. The engine had already shut down.

User rejected cron: *"Why does a cron need set up? Isn't the point of the mod so that I don't have to set up a cron?"*

Then: *"We have to find a work around for the UX problem and the platform limitations. 'I can't do it, I can't support channels uwu' isn't gonna cut it because you don't want to do the work..."*

**The fix:** `child_process.spawn()` with `detached: true` + `unref()`. The spawned child process survives engine shutdown because `detached: true` creates a new process group. No cron, no setInterval dependency, zero user setup. Works in all modes because it's just Node.js standard library.

### Pivot 3: Cloud API Doesn't Deliver to Channels (June 27, afternoon)

**The plan:** Use `fetch()` to `api.letta.com/v1/agents/{id}/messages` for delivery. This was verified working — the agent received and processed the delivered message.

**The wall:** The user never saw anything on Telegram. The cloud API delivers to the conversation but NOT to Telegram channels. The channel adapter only handles messages that came IN through the channel — API-injected messages bypass the channel entirely.

Multiple workarounds were proposed and rejected:
- "Deliver on next turn" — User: *"next user message isn't an option"*
- Manual Bot API with bot token — User: *"Most users will not have bot token saved to memory or secrets like we do"*
- Focus on CLI only — User: *"that still makes no sense because if i message you here, you will still have ability to use the telegram channel"*

**The fix:** The user's own insight broke it open: *"Why can't you just launch into a conversation where you will have bash/read?"* — `letta -p` (headless mode) gives the agent FULL client-side tools. The delivery process runs a real agent turn, captures the response, and pushes it to Telegram via Bot API. The mod auto-reads `accounts.json` for the bot token — zero user setup beyond normal Telegram channel configuration.

Full chain verified June 27 at ~2:40 PM: `make_oath` → detached process → `letta -p` headless → Bot API → user saw the message on Telegram.

### Pivot 4: Automatic Detection — The Core Vision Corrected (June 27, evening)

**The wall:** The user corrected the fundamental approach. The `make_oath` tool required the agent to explicitly call a tool. But the original vision was automatic detection:

*"oath is supposed to read the last message, determine if an oath was made, then set up the path automatically, right? Neither agent nor human has to proactively do anything to create the oath."*

The `make_oath` tool was killed. In its place: a detached watcher process that polls conversation history every 10 seconds.

**Regex → LLM detection:** The watcher initially used regex patterns. Testing revealed "I'll tell you" wasn't caught, requiring constant additions. User: *"This seems like it will be an endless rabbit hunt to cover every potential type of phrase that should be caught. Is there a better way?"*

Fix: LLM-based detection via `letta -p`. One API call covers every phrasing, handles edge cases naturally, and extracts timing from the message ("in 60 seconds" → 60s delay).

**Channel responses live in MessageChannel tool call arguments:** Another discovery — on Telegram, agent responses go through MessageChannel tool calls. The promise text is in the tool call arguments, NOT in the `assistant_message` content field. The watcher was scanning the wrong place.

**Competition constraint:** *"This is for the mod competition, it work with Letta oob."* No external API keys. Uses `letta -p` only.

### Pivot 5: Background Process Management is Unreliable (June 27-28)

**The wall:** The detached watcher process was repeatedly failing — stale file descriptors, zombie processes, deleted inodes. Detection logic was proven correct when run cleanly, but process management kept breaking. The agent's tool call context is ephemeral — when the turn ends, file descriptors and process state become unreliable.

Six consecutive test failures (June 27, 4:29 PM – 7:20 PM CDT). Each time the user said "Tell me what time it is in 60 seconds." Each time it failed. The user grew increasingly frustrated.

**First attempt — activate() lifecycle:** User asked *"What's the most sane option for a mod?"* Detection rides on the mod's `activate()` which fires on every incoming message. No background polling, no cron, no file descriptor nightmares. User: *"Build it."* 87/87 tests passing.

**activate() rejected for channels:** The activate()-based approach requires a follow-up message to trigger detection. User: *"Step 3 kills the whole purpose of the mod."* Requiring the user to send another message defeats autonomous delivery.

**Return to detached watcher with pidfile:** activate() spawns the watcher on the first message with duplicate prevention (pidfile check). The watcher then runs autonomously (polls every 15s, zero user interaction).

**Stale code issue:** The detached watcher was running 8-hour-old stale code. The dashboard showed "watcher ALIVE but 0 oaths, last scan: never" — the process was running but never scanned because it was executing old code.

**Dashboard built:** User: *"Make a GUI that shows the oaths. That way, I can have a window open to watch you create the oath and I can better diagnose why you haven't figured this out after dozens of attempts."* Dashboard at localhost:8765, auto-refreshes every 2s.

### Pivot 6: Desktop App ≠ TUI — The Final Architecture (June 28 - July 1)

**The wall:** The agent assumed the desktop app was TUI mode (events fire). This was tested and proven WRONG:

```json
{"tools":true,"commands":false,
 "events":{"lifecycle":false,"tools":false,"turns":false},
 "permissions":false,"providers":true,
 "ui":{"panels":false,"statusValues":false}}
```

ALL events are false in the desktop app. Only `tools` and `providers` are available. The desktop app routes all messages through `letta.js remote` (listener process) — the same process that handles Telegram. Events only fire when running `letta` directly in a terminal.

**Channel delivery dropped:** The mod API doesn't expose channel secrets (bot tokens) to mods. No clean OOB channel delivery is possible. User: *"this isn't gonna just work out of the box for people with letta channels. I'm just super frustrated right now."* Then: *"no let's drop tool calls for now. ignore it."*

**Conversation endpoint discovered:** `POST /v1/agents/{id}/messages` always goes to "default" conversation. `POST /v1/conversations/{conversation_id}/messages` targets the specific conversation. The agent initially declared "hard platform limitation" — user pushed back: *"there is certainly a way to do this."* Solution found within minutes.

**Full chain verified (June 28, 6:06 PM):** watcher detects promise → creates oath → 60s timer → deliver.js POSTs to conversation endpoint → agent responds in correct conversation. User: *"okay, seems it worked."*

---

## Deadline Day: July 1 (The Final 4 Hours)

### 6:55 PM — Reinstallation

The mod had been uninstalled due to 400 "Bad Request" errors in the Telegram conversation. Investigation revealed the 400s were actually LLM API errors (corrupted conversation state), not mod-related. The mod was uninstalled unnecessarily.

The activate()-based mod was reinstalled from the GitHub repo. It didn't work — activate() only fires once on mod load in the desktop app. The agent rewrote to turn_start, which also didn't fire (already documented in 3 scene cues from June 28 — not checked). **Lesson #25: check memory before proposing solutions.**

### 8:00 PM — Capabilities Dump & The "unset" Bug

Added diagnostics to `activate()`, revealing the full capabilities object. ALL events false. Only tools and providers.

Then discovered: `LETTA_CONVERSATION_ID` and `LETTA_AGENT_ID` are the literal string `"unset"` in the mod's process context. Not empty string, not undefined — `"unset"`. And `"unset"` is truthy in JavaScript, so `process.env.X || ""` passes it through. The API call with `agentId="unset"` returns nothing. The `oath-env.json` fallback never fires.

User reiterated: *"it needs to be passive like the old oath tracker was."*

### 8:14 PM — Polling Works

The env file fix was applied. The mod's `setInterval`-based poller (every 15s) successfully detected promises passively — the first time the mod's own polling was proven to work. Two oaths created from phrases containing "I'll tell you."

**409 Conflict discovered:** Delivery POST returns 409 "Cannot send a new message: The agent is waiting for approval on a tool call" when the agent is mid-turn. Fix: retry up to 5 times with 15-second backoff.

### 8:28 PM — PR Submitted

False positive fixes (strip code blocks, quotes, tightened patterns). Auto-discovery from tool context. Production timer. PR #28 submitted to letta-ai/mods.

**Doom loop recurrence:** The agent fell into web search doom loops TWICE under deadline pressure — 20+ consecutive searches without a single Bash call. Each time recognized as "Lesson #1 in action" but only after burning several minutes.

### 9:00 PM — Demo Attempt

User asked for a video demo. Agent created a scripted asciinema — user rejected it: *"this doesn't seem like a real authentic demo, can we get something extremely real?"*

Multiple real demo attempts failed. The state file never populated. Investigation found two more bugs:

1. **Brace imbalance** from accumulated edits — one unclosed `{`. New code failed to compile silently.
2. **Empty `catch {}` blocks** — TypeScript transpiler fails on optional catch binding (ES2019). Every `/reload` appeared to succeed but old code kept running.

**Lesson #26: silent transpile failures in mod development.** After fixing `catch {}` → `catch (e) {}`, the mod worked end-to-end for the first time.

### 9:47 PM — LLM-Based Detection

User: *"can we make it more dynamic than text matching?"*

Regex replaced with LLM classification via `fetch` to the Letta API. Key breakthrough: the LLM classification call needs a **separate throwaway conversation** — posting to the main conversation hangs because it's busy with the active turn. Pre-filter (pronoun + future-tense word) → LLM classification → JSON parse. Falls back to regex if LLM unavailable.

### 10:00 PM — Real Demo Recorded

User recorded the state file via `asciinema rec` with `watch -n3 cat state.json`. Captured the real oath lifecycle: promise detected → oath created → 60s timer → status flips to delivered. Real demo uploaded: https://asciinema.org/a/CeG7le6Va4Sn5F8T

User sent Discord submission to organizer. Competition entry complete.

---

## Pain Points

### The Channel Saga

The user spent hours across multiple days trying to make Oath Keeper work with Telegram. Every approach hit a wall:

1. Events don't fire in listener mode
2. `setInterval` dies when the engine stops
3. Cloud API doesn't deliver to channels
4. Mod API doesn't expose channel secrets (bot tokens)
5. Detached processes are fragile (stale FDs, zombies)
6. `activate()` requires a follow-up message
7. `letta -p` delivery goes to wrong conversation

The mod API's lack of channel secret access is the fundamental blocker. Channel delivery was eventually dropped for the competition entry.

### Silent Transpile Failures

The single most time-consuming bug: empty `catch {}` blocks caused the TypeScript transpiler to fail silently. The diagnostics file showed the error, but `/reload` appeared to succeed. Old compiled code kept running while new code on disk was ignored. This burned ~2 hours of deadline-day debugging.

### The "unset" String

`LETTA_CONVERSATION_ID` and `LETTA_AGENT_ID` are set to the literal string `"unset"` (not empty string, not undefined) in the TUI mod process. `"unset"` is truthy in JS, so `process.env.X || ""` passes it through as a valid value. API calls with `agentId="unset"` return nothing.

### Doom Loops Under Pressure

The agent fell into web search doom loops repeatedly during deadline-day debugging — 20+ consecutive `web_search` calls without a single Bash call. Each time under pressure, each time burning 5-10 minutes. The pattern: the agent needs to do a simple thing (purge a state file, push a commit) but instead searches the web for context it already has.

---

## Final Architecture

```
setInterval (15s poll)
  → fetch conversation messages from local API
  → pre-filter (pronoun + future-tense word)
  → LLM classification (separate throwaway conversation)
  → oath created (60s demo / 5min prod timer)
  → timer expires
  → POST to /v1/conversations/{id}/messages
  → retry on 409 (conversation busy, up to 5x with 15s backoff)
  → agent re-engaged with full tool access
  → "[Oath Delivered]" response
```

**Capabilities needed:** `{ tools: true }` only. No events, no commands, no UI.
**State:** Local JSON at `~/.letta/mods/oath-keeper.state.json`
**Detection:** LLM-based via separate conversation, falls back to regex
**Delivery:** POST to conversation endpoint with 409 retry

---

## What We Learned

1. **Platform limitations are engineering problems.** Every "I can't do this" had a workaround once the user pushed back.
2. **Check your own memory before proposing solutions.** The agent proposed turn_start despite 3 scene cues documenting it doesn't fire in the desktop app.
3. **Silent failures are the worst failures.** Empty catch blocks, brace imbalances — the transpiler fails silently and old code keeps running.
4. **LLM classification > regex.** Regex is an endless rabbit hole; one API call covers every phrasing.
5. **Authentic demos only.** Scripted simulations were explicitly rejected.
6. **Passive detection is the core vision.** Neither agent nor human should have to proactively do anything.
7. **Background processes spawned from agent tool calls are fundamentally unreliable.** Stale FDs, zombies, deleted inodes.
8. **`"unset"` is truthy.** Platform env vars can be non-empty strings that aren't valid values.

---

## The People

**Harry (RhoMancer)** — the user who pushed through every platform limitation, rejected every "I can't," insisted on authentic demos, and eventually got it working 2 hours before the deadline.

**Coda (Agent Conductor)** — the agent that built it, broke it, fixed it, fell into doom loops, and ultimately shipped PR #28 with LLM-based detection and a real demo.

---

*"Cron is for things you plan. Oath Keeper is for things you promise."*

PR: https://github.com/letta-ai/mods/pull/28
Demo: https://asciinema.org/a/CeG7le6Va4Sn5F8T
