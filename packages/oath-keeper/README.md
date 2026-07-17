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

```
User asks question
    → Agent responds: "I'll get back to you in 5 minutes..."
        → turn_end fires
            → Stage 0: Negative filter — skip short/code-heavy messages
                → Stage 1: N-gram pre-filter scores the message (score > threshold → proceed)
                    → Stage 2: LLM classifies — is it a genuine promise?
                        → If yes: extract promise text + delay_seconds
                            → Stage 3: LLM dedup — check against active oaths
                                → Oath created with LLM-determined delay
                                    → Timer expires → queued
                                        → Next turn_end → { continue: deliveryPrompt }
                                            → Agent re-engaged with full tool access → delivers
```

### Four-stage detection

**Stage 0 — Negative filter (zero cost)**

Skips messages that are clearly not promises: short messages (<15 chars) and code-heavy messages (>5% syntax characters). When disabled, all messages proceed to n-gram scoring.

**Stage 1 — N-gram pre-filter (zero cost)**

Every assistant message is scored against a weighted list of promise-indicating patterns. This eliminates 70-80% of messages ("done", "here's the code", "sounds good") before any LLM call.

- Strong signals (3.0): "I'll get back to you", "I'll follow up", "I'll circle back", "get back to you"
- Moderate signals (2.0–2.5): "I'll check/verify/investigate", "let me look into", "I'll update you"
- Weak signals (1.0–1.5): "I'll try", "in N minutes", "later today"

Score > threshold (default: 1) → send to LLM. Below threshold → skip (not a promise).

**Stage 2 — LLM classification (per message that passes pre-filter)**

The LLM determines whether the message contains a genuine promise and extracts:

- **Promise text** — what the agent specifically committed to
- **Delay** — how long until delivery (e.g., "in 5 minutes" → 300s, "tomorrow" → 86400s). If no time is specified, the LLM estimates based on task complexity.

If the LLM rejects the message, it's logged as a `false_positive` — a separate status from genuine failures.

**Stage 3 — LLM semantic dedup (only if active oaths exist)**

Before creating a new oath, the LLM compares the new promise against all active (pending/queued/delivering) oaths to catch semantic duplicates. "Tell you the time" and "Tell the user the time in 20 seconds" would be caught as duplicates.

### Delivery via `turn_end { continue }`

When the oath timer expires, the oath is marked as `queued`. On the next `turn_end` event, the handler returns `{ continue: deliveryPrompt }` — the Letta Code runtime injects this as a real user turn through the normal pipeline. **Tools work properly** because the delivery goes through the runtime, not a REST API bypass.

The delivery prompt grants full tool access — the agent can investigate, run code, check APIs, whatever the promise requires.

### Oath lifecycle

```
pending → queued → delivering → delivered
                                    ↓
                              false_positive (LLM rejected)
                              prefilter_rejected (n-gram score too low)
                              failed (delivery error)
```

## Installation

```bash
letta install npm:@letta-ai/oath-keeper
```

Then run `/reload` in Letta Code.

## Configuration

All configuration lives in `~/.letta/mods/oath-keeper.config.json`:

```json
{
  "classifierAgentId": "agent-xxxxx",
  "classifierModel": "letta/auto-fast",
  "negativeFilter": true,
  "ngramFilter": true,
  "ngramThreshold": 1,
  "llmConfirm": true,
  "llmDedup": true
}
```

### Classifier model (optional)

By default, LLM classification and dedup calls use `letta/auto-fast` — a cheap, fast model. This is set per-conversation when creating throwaway classification conversations. Change it via `classifierModel` to use any available model (e.g., `openai/gpt-4o-mini`, `google_ai/gemini-3.5-flash`).

The classifier agent (`classifierAgentId`) determines which agent owns the throwaway conversations. By default this is the same agent the mod is running on. You only need to set this if you want classification to run on a different agent entirely.

The configured model is displayed in the TUI header.

### Filter toggles

All four detection stages can be individually toggled:

| Config key | Default | Description |
|-----------|---------|-------------|
| `negativeFilter` | `true` | Negative filter — skips short messages (<15 chars) and code-heavy messages (>5% syntax characters). |
| `ngramFilter` | `true` | N-gram pre-filter. When disabled, all messages skip the pre-filter and go directly to LLM confirmation. |
| `ngramThreshold` | `1` | Minimum n-gram score required to trigger LLM classification. Lower = more sensitive (more LLM calls). Higher = stricter (fewer calls, may miss promises). |
| `llmConfirm` | `true` | LLM promise classification. When disabled, messages that pass the n-gram filter create oaths directly without LLM confirmation. |
| `llmDedup` | `true` | LLM semantic dedup. When disabled, only string-based dedup is used. |

**Safety:** If both `ngramFilter` and `llmConfirm` are disabled, no oaths are created — the mod skips detection entirely. The TUI displays a red warning when this occurs.

### Listener/desktop mode

For environments where `turn_end` events are not available (listener mode, older desktop versions), create `~/.letta/extensions/oath-env.json`:

```json
{
  "LETTA_AGENT_ID": "your-agent-id",
  "LETTA_CONVERSATION_ID": "your-conversation-id",
  "LETTA_BASE_URL": "http://localhost:PORT"
}
```

In listener mode, Oath Keeper polls the conversation API every 15s for new messages. When `turn_end` is available, polling handles delivery timing only — scanning is automatically disabled to prevent duplicate oaths.

### Verbose logging

Console output is silent by default. Enable with:

```bash
touch ~/.letta/mods/oath-keeper.verbose
```

Disable with `rm ~/.letta/mods/oath-keeper.verbose`. Debug logs are always written to `~/.letta/mods/oath-keeper-debug.json`.

## Usage

Just talk to your agent. When it says "I'll follow up" or "I'll get back to you," Oath Keeper catches it automatically.

Check tracked oaths:

```
list_oaths
```

Output shows pending, queued, delivering, recently delivered, false positive, and prefilter-rejected oaths with n-gram scores.

## Architecture

- **Detection:** `turn_end` event handler (primary, CLI v0.27.25+ / desktop v0.27.29+) with `setInterval` polling fallback (listener/desktop). Polling scan is automatically disabled when `turn_end` is available.
- **Pre-filter:** Weighted n-gram scoring eliminates 70-80% of messages before LLM classification. Threshold is configurable (default: 1).
- **LLM calls:** Classification (promise detection + delay extraction) and semantic dedup. Uses `letta/auto-fast` by default (configurable via `classifierModel`). All four stages can be individually toggled via config.
- **Conversation scoping:** `turn_end` extracts `conversationId` and `agentId` from the event context. Oaths deliver back to the conversation that originated them.
- **Delivery:** `turn_end { continue }` injects the delivery prompt through the runtime (tools work properly). REST API POST remains as fallback for listener mode.
- **State:** Local JSON at `~/.letta/mods/oath-keeper.state.json` with builder-pattern StateStore (load → mutate → save). Tracks lifecycle: `pending → queued → delivering → delivered` with stuck-state recovery and 24h pruning. All entries store n-gram score for debugging.

## TUI Dashboard

A standalone terminal dashboard for monitoring oaths in real time:

```bash
cd packages/oath-keeper/cli
cargo build --release
./target/release/oath-keeper
```

Launches the TUI by default (use `--plain` for text output, `--purge` to clear state).

### Header display

The TUI header shows:

- Oath counts by status (P, Q, >, OK, X, FP, PF)
- Filter status: `NEG:on/off`, `NGRAM:on/off(>threshold)`, `LLM:on/off`, `DEDUP:on/off` (green/red)
- Classifier model: `Model: letta/auto-fast`
- Red warning if all filters are off: `⚠ ALL FILTERS OFF — no oaths will be created`

### Status types displayed

| Badge | Status | Color | Description |
|-------|--------|-------|-------------|
| PENDING | pending | Yellow | Promise detected, waiting for timer |
| QUEUED | queued | Blue | Timer expired, waiting for next turn_end |
| DELIVERING | delivering | Cyan | Delivery prompt sent via `{ continue }` |
| DELIVERED | delivered | Green | Agent fulfilled the promise |
| FAILED | failed | Red | Delivery error |
| FALSE POS | false_positive | Dark gray | LLM rejected — not a genuine promise |
| PREFILTER | prefilter_rejected | Magenta | N-gram score ≤ threshold — never sent to LLM |

Each entry shows 3 lines: status badge + promise text, done/timer timestamp + source + age + n-gram score, and resolved conversation + agent names (fetched from the API). Detail view (press `i`) shows full promise, context, result, and creation/due timestamps.

### Keyboard controls

| Key | Action |
|-----|--------|
| `j`/`k` | Move selection |
| `i` | View oath detail |
| `d` | Manually deliver (pending oaths only) |
| `x` | Cancel oath |
| `p` | Purge all oaths |
| `c` | Clear filtered entries (prefilter_rejected + false_positive) |
| `C` | Clear completed entries (delivered, failed, false_positive, prefilter_rejected) |
| `q` | Quit |

Reads from `~/.letta/mods/oath-keeper.state.json`. Requires Rust (uses [ratatui](https://github.com/ratatui/ratatui) + [crossterm](https://github.com/crossterm-rs/crossterm)).

## Why not cron?

Cron requires explicit scheduling. Oath Keeper catches promises the agent made **implicitly** — "I'll get back to you" — without the agent calling any scheduling tool.

**Cron is for things you plan. Oath Keeper is for things you promise.**

## Safety

- Uses only the public tools API, `fetch()`, and mod event surface
- Does not modify turn input or tool arguments
- Recursion prevention: skips its own `[Oath Keeper]` and `[Oath Delivered]` messages
- All timers and event handlers cleaned up on unload
- State mutations enforced via builder pattern (load → mutate → save)
