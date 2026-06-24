# Letta Code Mods

This repository contains first-party Letta Code mod packages and examples.

Mods are trusted local code that extend Letta Code with tools, slash commands, events, permissions, providers, and lightweight UI surfaces. They are intended to be easy for agents and developers to inspect, adapt, package, and share.

## Registry vs source

This repository is source, examples, and curation. It is not a package registry.

The MVP package registry is npm. Published mod packages use normal npm metadata plus a Letta-specific manifest in `package.json` under the `letta` key.

```json
{
  "keywords": ["letta-package", "letta-mod"],
  "letta": {
    "manifestVersion": 1,
    "mods": ["./mods/index.ts"],
    "capabilities": ["commands"]
  }
}
```

## Package layout

Each package should include:

```txt
package.json  # npm metadata + package.json#letta manifest
README.md     # user-facing docs and install/usage instructions
MOD.md        # agent-facing semantics and adaptation notes
mods/         # mod implementation files declared by package.json#letta
```

`README.md` is for humans browsing GitHub, npm, or a catalog. `MOD.md` is for agents reading the package to understand behavior, semantics, safety invariants, and how to adapt the mod.

## Packages

- [`packages/plan-mode`](./packages/plan-mode) - sample plan-mode workflow using commands, tools, turn reminders, permissions, and local state
- [`packages/goal-mode`](./packages/goal-mode) - goal workflow using commands, tools, turn reminders, and local state
- [`packages/analysis-mode`](./packages/analysis-mode) - phrase-triggered diagnostic mode using turn reminders and local state
- [`packages/web-search`](./packages/web-search) - provider-backed web search tools using agent-scoped secrets
- [`packages/memfs-search`](./packages/memfs-search) - agent-callable MemFS memory search with optional QMD semantic/hybrid search

## Safety

Mods are trusted local code and can execute with the user's local permissions. Review mod source before installing third-party packages.

If a mod breaks startup or command handling, recover by starting Letta Code with mods disabled:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

## Validation

Run:

```bash
npm run validate
```
