# Retitle Conversation

A Letta Code mod package that lets an agent update the current conversation title.

The `retitle_conversation` tool keeps conversation lists useful when a title is missing, generic, or stale. The agent supplies a short title that describes the main work.

## Requirements

- Letta Code `>=0.30.21`

## Install

```bash
letta install npm:@letta-ai/retitle-conversation
```

Run `/reload` in active sessions after installation.

## Tool behavior

The package registers one model-callable tool:

- `retitle_conversation` updates the title of the current conversation.

The tool asks for approval before each update in permission modes that require approval. It does not run in parallel with other tool mutations.

The tool normalizes the requested title before it saves the title:

- Replaces terminal control characters and bidirectional text controls with spaces.
- Collapses line breaks and repeated whitespace into one space.
- Rejects empty titles and titles longer than 100 characters.

The active Letta Code interface receives the title update through the conversation mod API. Other clients can show the new title after they receive or reload the stored conversation state.

## Suggested title style

Use a short title that describes the main work. Two to seven words usually fit conversation lists well.

Good titles:

- `Review OAuth retry logic`
- `Add Windows smoke test`
- `Investigate stale approvals`

Avoid status-only titles such as `Working on it` or `Done`. Do not retitle a conversation when its current title still describes the work.

## Data and permissions

The package sends the new title through `ctx.conversation.updateTitle()`. It does not read messages, files, environment variables, or secrets. It does not start subprocesses or call external services directly.

Mods run with the full permissions of the Letta Code process. Review the source before you install a mod.

## Recovery

If a mod breaks startup or tool handling, start Letta Code with mods disabled:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

Remove or repair the package, then run `/reload`.

See [`MOD.md`](./MOD.md) for the agent-facing behavior contract.
