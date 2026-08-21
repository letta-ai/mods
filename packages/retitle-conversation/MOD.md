---
name: "@letta-ai/retitle-conversation"
description: "Agent-callable tool for updating the current Letta Code conversation title."
---

# Retitle conversation mod semantics

## When to use

Use `retitle_conversation` when the current conversation title is missing, generic, stale, or no longer describes the main work.

Do not use the tool when the current title still describes the work. Do not retitle a conversation only to report progress or completion.

## Tool

The package registers one tool:

- `retitle_conversation` accepts a required plain-text `title` and updates the current conversation.

Choose a short title, usually two to seven words. Describe the work with concrete nouns and verbs. Avoid vague labels, status phrases, punctuation-only titles, and unnecessary detail.

## Behavior

- Requires approval in permission modes that enforce tool approval.
- Runs as a non-parallel mutation.
- Requires a current conversation ID.
- Uses `ctx.conversation.updateTitle()` to save the title and refresh active local interface state.
- Replaces terminal controls, bidirectional text controls, unsafe invisible separators, line breaks, and repeated whitespace with spaces.
- Rejects empty, invisible-only, and longer-than-100-code-point titles.
- Returns an error without mutation when the host cannot update conversation titles.

## Safety boundaries

- Does not read conversation history.
- Does not read or write files.
- Does not read environment variables or secrets.
- Does not start subprocesses.
- Does not make direct network requests.
- Mutates only the title of the current conversation.

## Adaptation notes for agents

- Keep the tool scoped to `ctx.conversation`. Do not replace the conversation handle with a global client call.
- Keep `requiresApproval: true` and `parallelSafe: false` because the tool changes stored conversation state.
- Preserve control and invisible-content filtering if title formatting changes.
- Update the minimum Letta Code version if the package starts using a newer mod API.
