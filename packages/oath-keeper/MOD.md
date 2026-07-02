---
name: "oath-keeper"
description: "Passively detects when agents make follow-up promises and automatically delivers on them"
---

# Oath Keeper mod semantics

## When to use

Agents make promises they can't keep. "I'll get back to you" becomes "I forgot." Use this mod when you want agents to follow through — automatically, with zero agent cooperation.

## How it works

Oath Keeper **passively** polls the conversation API every 15 seconds for new assistant messages. When it detects promise language ("I'll get back to you", "I'll follow up", "I'll check on that"), it:

1. Creates an oath with a 5-minute countdown
2. After the delay, re-engages the agent with a delivery prompt
3. The agent delivers on its promise with full tool access

The agent never has to call a tool, set a reminder, or acknowledge the mod.

## Detection

Regex patterns match common follow-up promises:

- "I'll get back to you"
- "I'll follow up on that"
- "I'll check on this"
- "I'll look into that"
- "I'll let you know"
- "I'll circle back"
- And 10+ more patterns

Anti-false-positive: code blocks, inline code, blockquotes, and quoted text are stripped before scanning. Oath Keeper's own messages are skipped.

## Delivery

Posts to the conversation API endpoint with retry on 409 (conversation busy):
- Up to 5 retries with 15-second backoff
- 45-second timeout per attempt
- Failed deliveries marked, not retried infinitely

## Tools

- `list_oaths` — Check pending and recently delivered oaths

## Why not cron?

Cron requires explicit scheduling. Oath Keeper catches promises the agent made **implicitly** — "I'll get back to you" — without the agent calling any scheduling tool.

**Cron is for things you plan. Oath Keeper is for things you promise.**

## Safety

- Uses only the public tools API and fetch()
- Does not modify turn input or tool arguments
- Recursion prevention: skips messages containing "[Oath Keeper]" or "[Oath Delivered]"
- All timers cleaned up on unload
