# Ponytail for Letta Code

Makes your Letta Code agent think like the laziest senior dev in the room. The best code is the code you never wrote.

This is a [Letta Code](https://docs.letta.com/letta-code/index.md) mod port of [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) — the same ruleset, the same ladder, the same commands, adapted to Letta Code's mod API.

## What it does

Before writing code, the agent stops at the first rung that holds:

1. **Does this need to exist?** → no: skip it (YAGNI)
2. **Already in this codebase?** → reuse it, don't rewrite
3. **Stdlib does it?** → use it
4. **Native platform feature?** → use it
5. **Installed dependency?** → use it
6. **One line?** → one line
7. **Only then:** the minimum that works

Lazy about the solution, never about reading. The agent traces the real flow end to end before picking a rung. Trust-boundary validation, data-loss handling, security, and accessibility are never on the chopping block.

## Install

```bash
letta install npm:@vedant020000/ponytail
```

Then reload local mods:

```
/reload
```

You can also install from a local checkout of this repository:

```bash
git clone https://github.com/letta-ai/mods.git
cd mods/packages/ponytail
letta install .
```

## Commands

| Command | What it does |
| --- | --- |
| `/ponytail [lite\|full\|ultra\|off]` | Set the intensity, or turn it off. No argument reports the current level. |
| `/ponytail-review` | Review the current diff for over-engineering, hands back a delete-list. |
| `/ponytail-audit` | Audit the whole repo for over-engineering, not just the diff. |
| `/ponytail-debt` | Harvest `ponytail:` shortcut comments into a tracked debt ledger. |
| `/ponytail-gain` | Show the measured impact scoreboard (less code, less cost, more speed). |
| `/ponytail-help` | Quick reference for the commands above. |

## Levels

| Level | What changes |
|-------|-------------|
| **lite** | Build what's asked, name the lazier alternative in one line. User picks. |
| **full** | The ladder enforced. Stdlib and native first. Shortest diff, shortest explanation. Default. |
| **ultra** | YAGNI extremist. Deletion before addition. Challenges requirements. |

## Configuration

Set the default level for every new session:

**Environment variable:**
```bash
PONYTAIL_DEFAULT_MODE=full  # lite | full | ultra | off
```

**Config file:**
- Linux/macOS: `~/.config/ponytail/config.json`
- Windows: `%APPDATA%\ponytail\config.json`

```json
{ "defaultMode": "lite" }
```

Resolution: env var > config file > `full`.

Deactivate anytime by saying "stop ponytail" or "normal mode". Resume with `/ponytail full` (or lite/ultra).

## How it works

The mod registers six slash commands and two event handlers:

- **`turn_start` event** — injects the ponytail ruleset into the first user turn of each conversation (as a system reminder), and detects natural-language deactivation ("stop ponytail", "normal mode").
- **`conversation_open` event** — resets mode to the configured default on new conversations.
- **Commands** — `/ponytail` switches levels and re-injects the ruleset; the others send review/audit/debt prompts or display static output.

State (current mode + injection flag) is persisted to the platform config directory (`~/.config/ponytail/state.json` on Linux/macOS, `%APPDATA%\ponytail\state.json` on Windows), not in the mods folder.

## Safety

This mod is trusted local code and can execute with the user's local permissions. Review the source before installing or modifying it.

The mod only uses Node.js built-ins (`node:fs`, `node:path`, `node:os`). No third-party dependencies. No network access. No shell execution.

## License

MIT — same as the [original project](https://github.com/DietrichGebert/ponytail).

Credit: [Dietrich Gebert](https://github.com/DietrichGebert) — the ruleset, the ladder, and the benchmark methodology are all his.
