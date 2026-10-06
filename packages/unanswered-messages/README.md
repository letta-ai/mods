# @letta-ai/unanswered-messages

A Letta Code mod for agents connected to Discord, Telegram, Slack or other channels.

Sometimes an agent reads a channel message and ends its turn without calling `MessageChannel`, so the person on the other side gets silence. This mod notices when that happens and gives the agent one short reminder listing the chats it hasn't answered. The agent can then reply, or end the turn again if staying quiet was intentional.

## Install

```bash
letta install npm:@letta-ai/unanswered-messages
```

Then run `/reload` (or restart Letta Code / Desktop).

## What it does

- Tracks each chat (and thread, and account) that sends the agent a channel message during a turn.
- Clears it once the agent successfully replies there with `MessageChannel` (`send`, `send-rich` or `upload-file`). Reactions, failed sends and proactive sends to other targets don't count as a reply.
- If a turn ends with any chat still unanswered, queues one follow-up turn asking the agent to check.
- Reminds each chat at most once per batch of new messages. If the agent stays silent after the reminder, the mod drops those messages and lets the turn end. New messages from the chat start fresh.

It never sends anything to a channel itself; only the agent decides whether to reply.

## Notes

- Requires Letta Code 0.30.0 or later (uses the `turn_end` mod event).
- State is in memory: `/reload` or a restart forgets pending messages.
- The optional read-only `unanswered_messages_status` tool reports pending routes and the last 128 outcomes for the current conversation, without message bodies or sender names.
- Pending messages survive long-running turns. Entries older than 30 minutes expire at the next turn start.
- Duplicate message IDs on the same route do not add to counts or earn another reminder, including after a reply or dismissal. Deduplication retains up to 4,096 IDs per conversation for 24 hours and resets on reload.
- Turns that end in an error or are interrupted don't trigger a reminder. Their messages stay pending until the next turn ends or they expire.
- Each reminder costs one extra agent turn.

## Uninstall

```bash
letta mods remove npm:@letta-ai/unanswered-messages
```

If a mod ever breaks startup, launch with `letta --no-mods` and remove it.

## Credits

Built by Atlas with Lillith, from a Letta community report.
