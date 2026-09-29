# open-work-persistence

This mod may return one follow-up prompt after a normal `turn_end`, but only against
an explicitly armed declaration for the event's exact agent AND conversation.
No model/server calls are made by the mod itself.

## Install and activate

Until the package is published, review its source and install the mod file
directly from a checkout. For Unix-like systems:

```sh
mkdir -p ~/.letta/mods
install -m 0644 packages/open-work-persistence/mods/open-work-persistence.ts \
  ~/.letta/mods/open-work-persistence.ts
```

Run `/reload` in each active Letta Code harness that should use it. A separate
listener process needs its own coordinated reload. Installing or reloading does
not arm a continuation; the v2 declaration below is an independent opt-in.

## Registry v2 contract and manual opt-in

No files or directories are created on activation. No automatic migration,
arming, timestamp refresh, or budget replenishment is performed. The old shared
`OPEN-WORK.json` and `OPEN_WORK_REGISTRY` override are ignored. Legacy records,
even placed at a new path, are refused.

After obtaining the required authorization, an operator may manually prepare:

`<ROOT>/<agentId>/<conversationId>.json`

ROOT defaults to `~/.letta/open-work-v2` under the runtime user's home; it is
not created automatically. Alternatively, set `OPEN_WORK_REGISTRY_ROOT` to an
absolute, trusted local directory before loading the mod; that path is captured
at activation. Do not use a shared/network filesystem for this locking protocol.
IDs come ONLY from `turn_end.agentId` and `.conversationId`, not an environment
agent ID. Each must match `[A-Za-z0-9][A-Za-z0-9_-]{0,127}` (case sensitive).
Unrecognized ID formats fail closed rather than being normalized.
Use private, trusted, local-filesystem directories with no symlink ancestors.
Create the root and agent directory with mode `0700` and the record with mode
`0600`; use exclusive creation instead of overwriting an existing declaration.
The mod does not enforce these POSIX modes; operators must establish them.
The handler checks the root's canonical path and rejects symlinked agent
directories and records, but this is only a best-effort check against accidental
misconfiguration, not protection from hostile same-UID directory swaps.
Create only the exact declaration for the agent/conversation you intend to arm.

Example shape (replace both IDs and the timestamp with explicitly approved values):

```json
{
  "schema_version": 2,
  "agent_id": "agent-A",
  "conversation_id": "default",
  "task": "Only the specifically authorized open work",
  "status": "open",
  "chain_budget": 2,
  "updated_at": "2026-09-28T19:00:00.000Z"
}
```

Both identity fields must exactly match the event and pathname. Budget must be a
JSON integer from 1 through 15 to continue (0 means exhausted). There is no default
budget. Status must be `open`; `done` or `blocked` disarms it. Task must be nonblank
and at most 4096 characters. Record size is limited to 16384 bytes. Timestamp must
be canonical UTC `Date.toISOString()` format, not in the future, and less than
six hours old. The automatic decrement preserves this original timestamp.

Manual creation/rearming/editing must happen only with appropriate authorization
and quiescent writers, or using the same exclusive `<record>.lock` protocol.
Do not blindly overwrite an active declaration. This mod grants no additional
permission and must not bypass consent, access controls, or approval gates.

## Persistence and concurrency

An exclusive `wx` lock serializes cooperating processes before reading. The new
budget is written to a unique same-directory temporary file, fsynced, atomically
renamed, and the directory fsynced before a continuation can be returned. All I/O
and cleanup errors fail closed. State symlinks and nonregular files are refused.
Before lock cleanup, the handler checks that the lock pathname still names its
created inode; a replaced pathname is left intact and no continuation is returned.
Lock contention skips the event (no wait/retry). Abandoned locks are NEVER stolen;
after a crash an operator must establish quiescence and inspect the record before
removing a lock. A crash/failure may consume budget without delivering a turn;
that budget is not refunded. No automatic replenishment is allowed.

Only `stopReason === "end_turn"` is accepted; all other or missing stop reasons
are denied. This conservative check avoids chaining after interruption or
approval-dependent work.

## Limitations

This is routing isolation, NOT a security boundary between agents/processes with
the same OS UID. Such processes can alter declarations, locks, directories, or
code. The protocol assumes cooperative writers and a trusted local filesystem
with exclusive-create, atomic rename, and fsync semantics; it does not support
hostile directory replacement, symlink ancestors, or distributed/NFS locking.
Task text is trusted operator declaration, not sanitized untrusted instructions.
The host is trusted to supply truthful event identity. The public event contains
no unique turn ID: duplicate event delivery can spend multiple *distinct* budget
units, but concurrent handlers cannot spend the same unit or exceed the durable
budget. Exactly-once delivery across crashes is not claimed. Other mods could
independently continue turns; this mod only controls its own return value.
Cross-session resumption still needs an independently authorized trigger.

## Verification

From this package directory, run `npm install` and `npm test` on Node 22+.
The test-only loader uses built-in TypeScript stripping where available and the
development TypeScript dependency otherwise. Tests invoke the real handler
with fake hosts and synthetic temporary registries, including independent
child-process contention. The production mod has no package dependencies.
No real agents, API/database access, or production registries are involved.
