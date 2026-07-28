# Explicit Oath

A Letta Code mod for deliberate follow-up promises without passive phrase detection.

Explicit Oath gives agents one tool, `schedule_oath`. The agent must intentionally call it with a concrete promise, due time, and delivery instructions. The mod then creates a one-shot `letta cron` schedule bound to the current agent and conversation.

It does not scan messages, classify ordinary language, poll conversations, or infer that phrases such as "I'll check" should create future work.

## Install

```bash
letta install npm:@letta-ai/explicit-oath
```

Then reload mods in Letta Code:

```text
/reload
```

## Usage

The agent calls `schedule_oath` with:

- `promise`: the concrete result it committed to deliver
- `due_at`: a Letta cron time such as `in 30m`, `tomorrow at 9am`, or an ISO timestamp
- `delivery_instructions`: what to do or verify when the schedule fires
- `runner`: optional `cloud` or `local` runner override
- `computer`: optional connected device ID for cloud schedules that need a particular computer

Example tool arguments:

```json
{
  "promise": "Report whether the deployment completed successfully",
  "due_at": "in 20m",
  "delivery_instructions": "Check the deployment status and send the final state with any failed step."
}
```

When due, Letta re-engages the same agent in the same conversation so it can use current context and tools to deliver the result.

## Behavioral contract

Agents should use `schedule_oath` only when:

1. they made a concrete commitment to deliver something later;
2. the work cannot reasonably be completed in the current turn; and
3. the timing is meaningful enough to justify another invocation.

Agents should not use it for casual status narration, speculative ideas, work they can finish immediately, or vague offers to help.

The tool requests approval because it creates durable future work. Users can change that behavior through normal Letta Code permission rules if they trust the workflow.

## Why explicit?

Natural-language promise detection is convenient, but ordinary agent narration often uses phrases such as "let me check" while completing the check in the same turn. Treating those phrases as future commitments creates duplicate work and surprise re-engagements.

Explicit Oath makes scheduling an intentional action rather than a guess.

## How it works

1. The agent deliberately calls `schedule_oath`.
2. The mod invokes `letta cron add` with the current agent and conversation IDs.
3. Letta stores a one-shot schedule using the selected or default runner.
4. At the requested time, the agent receives a delivery prompt containing the promise and instructions.

## Requirements and safety

- Requires the `letta` CLI to be available in `PATH`.
- Uses Letta's normal cron runner defaults unless `runner` is supplied.
- Uses the current agent and conversation rather than a global or hard-coded target.
- Does not inspect conversation history or assistant messages.
- Does not run background polling or classification calls.
- Rejects `computer` when paired with the local runner.
- Scheduling remains subject to Letta Code's normal tool approval and permission policies.
