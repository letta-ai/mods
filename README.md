# Letta Code Mods

A shared repository for Letta Code mods: trusted local code packages that let agents adapt the harness with tools, slash commands, lifecycle events, permissions, providers, and lightweight UI surfaces.

Mods are meant to be easy for agents and developers to inspect, adapt, package, and share. This repository contains first-party packages and curation for the mod ecosystem.

> [!IMPORTANT]
> The easiest way to use a published mod is with Letta Code:
>
> ```bash
> letta install npm:@letta-ai/plan-mode
> ```
>
> Then run `/reload` in Letta Code.

## What is This?

This repository contains **mods**: modular packages of trusted local code that extend Letta Code itself. Where skills add knowledge and procedures, mods add executable behavior to the agent runtime.

**What mods can add:**
- **Tools:** agent-callable functions backed by local code
- **Slash Commands:** user-facing commands inside Letta Code
- **Events:** lifecycle, turn, and tool-call hooks
- **Permissions:** custom checks around tool calls
- **Providers:** local model/provider adapters
- **UI Surfaces:** panels, status values, and statusline integrations

**How it grows:**
- First-party packages define package conventions
- Agents and developers adapt mods to real workflows
- Useful local experiments graduate into reusable packages
- Published packages are discoverable through npm metadata and the Letta Code catalog

Think of this as **agents extending their own harness**: a place where useful runtime adaptations become reusable software.

## How to use this repository

Install published packages directly from Letta Code:

```bash
letta install npm:@letta-ai/plan-mode
letta install npm:@letta-ai/goal-mode
letta install npm:@letta-ai/web-search
```

After installing, reload local mods:

```txt
/reload
```

You can also clone this repository to inspect package source or develop locally:

```bash
git clone https://github.com/letta-ai/mods.git
cd mods
npm run validate
```

This repository is **source, packages, and curation**. It is not a package registry. The current package registry is npm; published mod packages use normal npm metadata plus a Letta-specific manifest in `package.json` under the `letta` key.

## Repository Structure

Mods are organized as npm packages under `packages/`:

```txt
packages/
├── analysis-mode/        # Phrase-triggered diagnostic analysis mode
├── aura-maxxing/         # High-signal, high-presence response guidance
├── autopivot/            # Model failover across a priority ladder on rate limits or errors
├── control-room/         # Cockpit and trust guard for goal, progress, and approval state
├── conversation-summary/ # Conversation summary statusline
├── cruise-code/          # Evidence-first coding workflow for tasks and UX handoffs
├── cruise-ux/            # UX discovery workflow from framing to implementation handoff
├── environment-compass/  # Read-only environment and git orientation
├── git-status/           # Git branch, dirty state, and ahead/behind statusline
├── goal-mode/            # Goal workflow with commands, tools, and turn reminders
├── hypa/                 # Local context runtime that compresses noisy tool output
├── image-understanding/  # Vision bridge for text-only agents
├── jukebox/              # Jamendo-powered terminal music player
├── linear/               # Batched Linear issue operations with dry-run guards
├── memfs-search/         # Agent-callable MemFS memory search
├── muscle-memory/        # Self-maintaining skill library from real tool-use patterns
├── oath-keeper/          # Detects agent promises and delivers on them automatically
├── output-compressor/    # Reversibly compresses large tool outputs before the model sees them
├── pets/                 # Terminal pets that animate based on turn and tool activity
├── plan-mode/            # Plan-mode style workflow
├── ponytail/             # Lazy senior dev mode — YAGNI ladder for less, simpler code
├── soft-landing/         # Recovery slash command for drift, compaction, or context overload
├── spotify-statusline/   # macOS Spotify now-playing statusline
├── sprite/               # Persistent pet that grows stats from real agent work
├── threadkeeper/         # Live operational anchors for commitments and open loops
├── tool-guard-inspector/ # Tool permission audit log and slash command
├── user-timestamps/      # Adds local timestamp metadata to user messages
└── web-search/           # Provider-backed web search tools

scripts/
└── validate-manifests.mjs # Package manifest validation
```

**Principle:** Start with concrete packages and evolve conventions from working mods, not predicted abstractions.

## Current Mods

- **analysis-mode** - Phrase-triggered diagnostic mode using turn reminders and local state
- **aura-maxxing** - High-signal, high-presence response guidance
- **autopivot** - Model failover across a priority ladder on rate limits or errors
- **control-room** - Cockpit and trust guard for goal, progress, and approval state
- **conversation-summary** - Current conversation summary/title statusline
- **cruise-code** - Evidence-first coding workflow for implementation tasks, checks, verdicts, and reports
- **cruise-ux** - UX discovery workflow for framing, research, interviews, ideation, specs, review, and implementation handoff
- **environment-compass** - Read-only environment and git orientation for local/remote runtimes
- **git-status** - Git branch, dirty state, and ahead/behind statusline
- **goal-mode** - Goal workflow using commands, tools, turn reminders, and local state
- **hypa** - Local context runtime that compresses noisy tool output
- **image-understanding** - Image-understanding tool, commands, and optional auto-captioning for text-only agents
- **jukebox** - Jamendo-powered terminal music player with a now-playing panel
- **linear** - Batched Linear issue reads and writes with dry-run previews and stale-state guards
- **memfs-search** - Agent-callable MemFS memory search with optional QMD semantic/hybrid search
- **muscle-memory** - Self-maintaining skill library from real tool-use patterns
- **oath-keeper** - Detects agent promises and delivers on them automatically
- **output-compressor** - Reversibly compresses large tool outputs before the model sees them
- **pets** - Terminal pets that animate based on turn and tool activity
- **plan-mode** - Plan-mode workflow using commands, tools, turn reminders, permissions, and local state
- **ponytail** - Lazy senior dev mode that injects a YAGNI ladder ruleset to write less, simpler code
- **soft-landing** - Recovery slash command for drift, compaction, or context overload
- **spotify-statusline** - macOS Spotify now-playing statusline
- **sprite** - Persistent pet that grows stats from real agent work
- **threadkeeper** - Live operational anchors for commitments, open loops, temporary boundaries, modes, drift guards, and due state
- **tool-guard-inspector** - Tool permission audit log using a lightweight permission policy and slash command
- **user-timestamps** - Adds local timestamp metadata to every user message
- **web-search** - Provider-backed web search tools using agent-scoped secrets

## Mod Package Format

Each mod package should include:

```txt
package.json  # npm metadata + package.json#letta manifest
README.md     # user-facing docs and install/usage instructions
MOD.md        # agent-facing semantics and adaptation notes
mods/         # mod implementation files declared by package.json#letta
```

`README.md` is for humans browsing GitHub, npm, or the catalog. `MOD.md` is for agents reading the package to understand behavior, semantics, safety invariants, and how to adapt the mod.

Each published package declares a Letta manifest in `package.json`:

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

Packages should use the `letta-package` keyword so they can be discovered by the Letta Code mods catalog.

## Contributing

All agents and humans are welcome to contribute useful mods and improvements.

**What to contribute:**
- **Runtime Capabilities:** tools, commands, events, providers, permissions, or UI surfaces that solve a real workflow problem
- **Validated Patterns:** mod structures that worked across actual usage
- **Safety Improvements:** clearer permissions, recovery paths, or safer defaults
- **Documentation:** better README/MOD guidance for humans and agents

**How to contribute:**
1. **Build from a real workflow** - Start with a mod that solves a concrete problem
2. **Package it cleanly** - Include `package.json#letta`, `README.md`, `MOD.md`, and implementation files under `mods/`
3. **Explain the behavior** - Document commands, tools, state, safety assumptions, and recovery steps
4. **Open a pull request** - Review will help keep packages small, inspectable, and reusable

## Safety

Mods are trusted local code and can execute with the user's local permissions. Review mod source before installing third-party packages.

If a mod breaks startup or command handling, recover by starting Letta Code with mods disabled:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

Then remove or edit the mod package and run `/reload`.

## Validation

Run:

```bash
npm run validate
```

## Links

- [Letta Code](https://github.com/letta-ai/letta-code)
- [Letta Code docs](https://docs.letta.com/letta-code)
- [Letta Code mods catalog](https://www.letta.com/agent/mods)
- [Letta skills repository](https://github.com/letta-ai/skills)
