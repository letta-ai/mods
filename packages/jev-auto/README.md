# Jev Auto for Letta Code

Approve low-impact tool calls automatically; ask a person about risky or unclear ones.

## Install

Requires Letta Code 0.32.12 or newer and your own funded OpenRouter API key.

```sh
# After publication:
letta install npm:@letta-ai/jev-auto

# From a checkout, before publication:
letta install ./packages/jev-auto
```

Provide `OPENROUTER_API_KEY` in the environment of the process running Letta Code
(or its Desktop listener), then start/restart that process. Do not paste the key
into a conversation or the mod source. `/reload` loads the installed mod into an
existing session; a restart is needed if its environment changed.

```text
/auto on
/auto status
/auto off
```

Auto is **off by default**, scoped to the current conversation, and resets on
reload, restart, or conversation close. `/auto off` restores your underlying
permission mode; it does not change that mode. This is a mod overlay, not a new
entry in the built-in permission-mode selector. Headless sessions cannot turn it
on using a slash command.

In the TUI, auto mode occupies the native footer position beneath the prompt:

```text
⏵⏵ auto mode on (/auto off to exit)
```

It temporarily replaces the primary statusline while active; disabling it or
reloading restores the previous statusline. Narrow terminals omit the exit hint
and agent/model details. Desktop/listener still gets the approval behavior but
has no mod-panel UI.

**Shift+Tab remains the host's built-in permission-mode cycle.** It does not turn
this overlay off or select auto mode. The host may briefly display its own mode
hint after Shift+Tab. Full native cycle integration needs a Letta Code change,
not just a mod. Use `/auto off` to disable the overlay.

## Behavior

- Calls `typesafe/jev-1.13` through OpenRouter's Decisions API once per reviewed
  invocation. No additional model agent or npm runtime dependencies.
- Jev chooses `clear` or `caution` from the actual tool name and arguments.
  Clear allows; caution, invalid responses, or API failures require human
  approval. Like Eve, no confidence threshold is applied.
- Explicit hard denials and host `alwaysAsk` rules still win. Other mod overlays
  can still ask or deny. Auto can require approval even in unrestricted mode.
- Reviews are bound to agent, conversation, call ID, tool, arguments and working
  directory. Changed arguments at the execution overlay are blocked.
- Unchanged calls may execute after the host resolves human approval; caution
  is not an unconditional execution-time denial.
- Requests time out after 30 seconds, without retries. Pending reviews are
  in-memory, bounded to 512 per active conversation, and expire after one hour.

## Privacy and limits

**Every reviewed tool's name and complete arguments are sent to OpenRouter and
TypeSafe.** This can include commands, file content, source code or credentials
embedded in arguments. No conversation history or file content outside arguments
is sent. Enable only where that transfer is acceptable. The mod does not request
or promise zero data retention. OpenRouter bills your key separately.

This is an experimental risk classifier, **not a security sandbox or an
authorization check**. It does not know user intent, inspect files/scripts a
command references, or verify custom tool implementations. Model mistakes and
prompt injection remain possible. Keep deterministic deny/always-ask rules for
critical operations.

It covers client-side tools passing through Letta Code permission overlays, not
server-side tools. The host owns human approval and execution authorization;
the permission event has no explicit human-approval receipt. The mod relies on
the host reaching execution only after approval. Trusted `PreToolUse` hooks can
rewrite inputs after the execution overlay; the mod cannot police those later
rewrites.

Missing call identity, non-JSON/oversized input (64 KiB serialized limit), expired
reviews, reloads during approval, or changed arguments may block execution even
after human approval. Reissue the call. For unreviewable inputs, disable auto and
use normal manual approval mode. Turning auto off over unrestricted mode restores
unrestricted execution.

## Validate

```sh
bun run check
# With OPENROUTER_API_KEY set; makes real, billed classifier requests:
bun run test:live
# With LETTA_API_KEY as well; runs an isolated agent-free CLI conversation:
bun run test:cli
```

Live classifier tests never execute their synthetic commands. The CLI test
executes a harmless printf and checks that a caution-gated fixture tool cannot
write its disposable marker without approval. Its test-only adapter calls the
same /auto on handler because headless mode has no interactive slash commands.
The human-approved execution handoff was also manually tested in the real 0.32.13
TUI using a disposable directory. Electron Desktop remains untested. CLI 0.32.12
supports agent-free mode only for one-shot headless runs, not bidirectional
approval tests.
These are smoke tests, not an adversarial safety benchmark.

## Remove

Disable with `letta mods disable npm:@letta-ai/jev-auto`, then `/reload`.
Recover from a broken mod with `letta --no-mods`.

Inspired by [Eve's auto approval policy](https://eve.dev/docs/human-in-the-loop).
