---
name: "@letta-ai/unanswered-messages"
description: "Reminds the agent once when a turn ends with channel messages it never replied to."
---

# Unanswered channel messages

## When to use

Use this mod for agents that talk to people through channels (Discord, Telegram, Slack and others) and sometimes end a turn without calling `MessageChannel`.

## Behavioral contract

- Inbound `<channel-notification>` blocks in a turn mark their route as pending: `source`, `account_id`, `chat_id` and `thread_id`, so separate threads and accounts are tracked separately.
- A successful `MessageChannel` call with action `send`, `send-rich` or `upload-file` and a `chat_id` clears the pending route it answered. `accountId` and `threadId` narrow the match (a Slack `threadId` equal to an inbound `message_id` counts as replying in that message's thread). If omitted fields leave more than one candidate route, nothing is cleared and the reminder lists them.
- A proactive send to a `target` (no `chat_id`) doesn't clear anything, since it isn't a reply to an inbound message.
- At `turn_end`, if anything is pending and no reminder has been sent for these messages, the mod returns `{ continue }` with a reminder wrapped in `<unanswered-channel-messages>`. The reminder lists the chats and says that ending the turn is fine if silence was intentional.
- The mod's own reminder turn is ignored by its `turn_start` handler. After one reminder, pending entries are cleared at the next `turn_end`, so it can't loop.
- Idle entries older than 30 minutes expire at the next ordinary turn start. Active turns retain their pending messages through their first end-of-turn reminder, regardless of duration.
- Repeated message IDs on the same route do not increment counts or reset the reminder allowance. Deduplication retains up to 4,096 IDs per conversation for 24 hours, including after replies or dismissal. Notifications without message IDs cannot be deduplicated.

## Capabilities

`events.turns`, `events.tools`, and optionally `tools`. No commands, network or filesystem access.

The read-only `unanswered_messages_status` tool takes no arguments. It returns pending routes, message IDs, counts, active-turn state, and the last 128 outcomes for the invoking conversation. Outcomes are `pending`, `answered`, `reminded`, `dismissed-after-reminder`, or `expired`. It omits message bodies and sender names. All state resets on reload; this is runtime inspection, not a persistent task ledger. Reminders still work on hosts without tool registration.

## Adapting

- Change `SEND_ACTIONS` if a channel adds another reply action.
- Change `STALE_AFTER_MS` to forget pending messages sooner or later.
- Edit the reminder text in the `turn_end` handler to match your agent's voice.
