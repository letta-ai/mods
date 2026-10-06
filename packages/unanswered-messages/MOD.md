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
- At `turn_end`, if any pending route has not been reminded yet, the mod returns `{ continue }` with a reminder wrapped in `<unanswered-channel-messages>`. The reminder lists only those routes and says that ending the turn is fine if silence was intentional.
- A route that was already reminded is cleared at the next `turn_end`, so the mod can't loop. A new message on that route earns it one fresh reminder.
- Channel messages that arrive in the same turn as the mod's own reminder are still tracked. The listener can merge queued messages into that turn.
- Entries older than 30 minutes expire at the next turn start. A turn's own messages stay pending through its end, however long it runs. If a turn errors or is interrupted, its messages stay pending until the next `turn_end` or until they expire.
- Repeated message IDs on the same route do not increment counts or reset the reminder allowance. Deduplication retains up to 4,096 IDs per conversation for 24 hours, including after replies or dismissal. Notifications without message IDs cannot be deduplicated.

## Capabilities

`events.turns`, `events.tools`, and optionally `tools`. No commands, network or filesystem access.

The read-only `unanswered_messages_status` tool takes no arguments. It returns pending routes, message IDs, counts, whether each route was reminded, and the last 128 outcomes for the invoking conversation. Outcomes are `pending`, `answered`, `reminded`, `dismissed-after-reminder`, or `expired`. It omits message bodies and sender names. All state resets on reload; this is runtime inspection, not a persistent task ledger. Reminders still work on hosts without tool registration.

## Adapting

- Change `SEND_ACTIONS` if a channel adds another reply action.
- Change `STALE_AFTER_MS` to forget pending messages sooner or later.
- Edit the reminder text in the `turn_end` handler to match your agent's voice.
