# Environment Compass

Environment Compass is a read-only Letta Code mod that helps agents orient before touching memory, code, or infrastructure-sensitive work.

It reports:

- detected runtime, such as local Desktop/macOS vs Railway/remote
- key paths and environment markers
- Letta CLI/runtime versions visible in `PATH`
- memory repository path, branch, remote, recent commits, and local git status
- current workspace git status
- simple recommendations about whether the agent should fetch, reconcile, or avoid editing

The mod is intentionally observational. It does not fetch, pull, push, write files, mutate git state, or contact the network.

## Install

```bash
letta install npm:@letta-ai/environment-compass
```

Then reload mods in Letta Code:

```txt
/reload
```

## Usage

Environment Compass provides both an agent-callable tool and a slash command.

### Tool

Agents can call `environment_compass` before memory-sensitive or environment-sensitive work.

### Slash command

```txt
/env-compass
```

## Why use it?

Agents often run across multiple homes: a local Desktop session, a remote Railway/container session, a CLI shell, or another host. Those homes can have different working directories, different installed binaries, and separate git-backed memory checkouts.

Environment Compass gives the agent a small, safe preflight check so it can avoid assuming the wrong environment or making Laura carry the environment map manually.

## Safety

Environment Compass is read-only by design:

- no file writes
- no git fetch/pull/push
- no network calls
- no secret printing; sensitive environment variable names are redacted
- command timeouts and output limits are applied to local probes

It is an orientation tool, not a sync or repair tool.
