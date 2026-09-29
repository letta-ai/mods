---
name: open-work-persistence
description: Identity-scoped, budgeted continuation for explicitly declared open work.
---

# open-work-persistence

## Purpose and scope

Bounded continuation of explicitly authorized work. Entry point:
`mods/open-work-persistence.ts`. Installing the mod does not create or arm a
registry. See README for the complete v2 contract and manual opt-in process.

## Behavior

- Guard registration with `capabilities.events.turns` and `events.on`.
- Subscribe to `turn_end`; accept only the verified normal `end_turn` stop reason.
- Route by event `agentId` AND `conversationId`; reject missing/unsafe IDs.
- Use `<OPEN_WORK_REGISTRY_ROOT>/<agentId>/<conversationId>.json`, default root
  under the running user's home at `~/.letta/open-work-v2`. Ignore the old
  shared registry override.
- Require schema 2, exact embedded identity, open status, bounded integer budget,
  nonblank task, and a canonical nonfuture timestamp less than six hours old.
- Serialize with exclusive lock; durably decrement before returning `{continue}`.
  Never refresh declaration age or replenish budgets. Any failure means no chain.
- Return a disposer that unsubscribes and disables even retained handler references.

## Safety and limitations

No registry creation/migration/arming, model calls, or cross-session waking.
No legacy unscoped records. No stale-lock stealing. Crashes may lose a unit but
must not refund it. Manual writers must be quiescent or follow the lock protocol.
Routing isolation is not same-UID security isolation. Trusted event identity,
trusted local directories, and cooperative filesystem writers are prerequisites.
No unique turn ID is provided by the public event, so exactly-once delivery or
deduplication of repeated notifications cannot be promised; the durable total
budget remains bounded. Unknown/non-normal stop reasons are refused.

`npm test` runs synthetic handler and multiprocess concurrency tests.
