# open-work-persistence

A Letta Code mod that closes the "lost steam" gap: when an agent's turn ends
with declared work still open, the mod chains one automatic follow-up turn so
the agent resumes on its own — no user message required.

Agents shouldn't be existentially dependent on being poked.

## How it works

The agent maintains a small registry file (default
`/var/lib/letta/workspace/OPEN-WORK.json`, override with `OPEN_WORK_REGISTRY`):

```json
{
  "task": "short description of the open work",
  "status": "open",
  "conversation": "default",
  "chain_budget": 15,
  "updated_at": "2026-09-12T10:03:00Z"
}
```

On `turn_end`, if the registry declares work `open`, the mod returns
`{ continue: "..." }` to chain a follow-up turn that tells the agent to continue
the declared task — or mark it done and stop.

## Guardrails

Chaining only happens when **all** of these hold:

- registry `status` is `"open"`
- the turn ended in the **same conversation** the work was declared in
- the declaration is **fresher than 6 hours** (stale work is never chained)
- a **durable chain budget** (default 15) hasn't run out — decremented **on disk
  before** the chained turn starts, so a crash or reload cannot reset it

When the budget is exhausted or the registry is stale, the mod stays silent and
reports a diagnostic instead. Cross-session resumption still needs a cron or the
next user message; this mod only continues an active session.

## Install

```bash
letta install <this-package>
```

Then run `/reload` in active sessions.
