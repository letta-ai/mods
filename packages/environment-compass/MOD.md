---
name: "@letta-ai/environment-compass"
description: "Read-only environment and git orientation tool for Letta Code agents working across local and remote runtimes."
---

# Environment Compass mod semantics

## When to use

Use this mod before memory-sensitive, repository-sensitive, or infrastructure-sensitive work where the agent needs to know which runtime it is operating in.

Good use cases include:

- checking whether the current session is local Desktop/macOS or remote Railway/container
- checking which memory repository path is active
- checking whether memory is dirty, ahead, behind, diverged, or stale from the local remote view
- checking whether the current workspace is a git repository
- checking visible Letta CLI/runtime versions before debugging runtime behavior

## Behavioral contract

Environment Compass is observational only. It should not repair, sync, fetch, pull, push, write, or modify state.

The output should give the agent a concise orientation report and a recommendation, not an exhaustive diagnostic dump.

## Tool

`environment_compass`

Returns a markdown report containing environment markers, key paths, runtime information, memory repo status, current workspace git status, and a short recommendation.

## Command

`/env-compass`

Runs the same read-only orientation check from a user-facing slash command.

## Safety invariants

- Do not print secret values. Environment variables with names containing token/key/secret/password/auth are reported as set/hidden.
- Do not perform network operations.
- Do not mutate git state.
- Do not write files.
- Keep command timeouts short so the compass does not become a long-running diagnostic task.

## Adaptation notes for agents

- Treat this as a preflight, not a substitute for deliberate sync/repair workflows.
- If the memory repo is dirty, diverged, behind, or conflict-marked, stop and reconcile before editing memory.
- If the current workspace is not a git repo, avoid repository-specific assumptions.
- If multiple Letta executables are visible, prefer the selected CLI reported by the compass when debugging CLI behavior.
