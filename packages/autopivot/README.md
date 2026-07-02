# AutoPivot

Autopivot is a Letta Code mod that keeps your agent working when a model fails. It maintains a priority **ladder of models** — primary → backup cloud → local — and swaps over to a working alternate in priority order. Automatic switchover covers general model failures including rate limits, credit exhaustion, auth failures, context overflow, and dropped connections.

`commands` · `ui.panels` · `events.turns`

## Install

```bash
letta install npm:@letta-ai/autopivot
```

Then `/reload`. (Requires Letta Code 0.27.18+.)

## Why

Agent operation can fail for a variety of reasons, from flaky Internet connections or dropouts to models that accept your request and then *fail it* — via a 429, a spent credit balance, an auth error, an over-length context or more. AutoPivot detects model failures and automagically swaps over, so a rate-limit mid-conversation automatically drops you to a backup instead of a dead turn.

## How it works

- **AutoPivot senses the models you've been using** most frequently and attempts to detect any local models you have, so setup starts from a ladder that already reflects how you work.
- **You confirm your preferences** — which model is your primary, which are the cloud and local fallbacks — and tune the settings that matter to you, like how long to wait before giving up on a stalled model and when to fall all the way back to a local model.
- **AutoPivot monitors every turn** for trouble: a model that goes unreachable, or one that accepts your request and then fails it (rate limit, spent credits, auth error, over-length context).
- **When something breaks, it pivots** to the next working model down the ladder — automatically, on your next turn — and walks back up when your primary recovers.
- **It keeps you informed** with a small status pill showing which model you're on and whether you're online, plus a note to your agent so it knows it's offline instead of pretending it sent that email.

## Getting started

On first run, AutoPivot has no config yet and the pill shows `⚙ not configured`. From inside Letta Code, just run:

```
/pivot setup
```

AutoPivot looks at the models you've used recently, guesses a sensible ladder (your usual cloud model as primary, a second cloud model as backup, a local model as the offline fallback), writes it to a config file, and prints exactly what it picked. Look it over, then `/reload`.

Want to fine-tune it? AutoPivot ships an interactive configurator alongside the mod — `/pivot setup` prints the exact one-line command to run it (something like `node <install-dir>/autopivot-configure.cjs`; nothing to install separately).

It shows you your models, asks you to check off which ones run locally (this is difficult to guess reliably, so you confirm), then walks you through your primary, your fallbacks, and how you want failover to behave. It checks everything before saving. Run it again any time to make changes.

## Everyday commands

- `/pivot status` — see which model you're on and whether your connection is up.
- `/pivot down` — "this model is stuck, move me to the next one now." Handy for a slow local model that AutoPivot won't time out on its own.
- `/pivot online` — go back to your preferred model once things recover.
- `/pivot offline` / `/pivot auto` — force offline mode, or hand control back to AutoPivot.

## Automatic vs. manual: when AutoPivot steps in, and when you do

AutoPivot handles the clear-cut cases for you. A cloud model that errors, rate-limits, or hangs is caught automatically — if a turn doesn't finish in a reasonable window (90 seconds by default), that's unambiguously broken and you get moved down the ladder.

Local models are the exception. A local model can legitimately take minutes to warm up, and there's no reliable way to tell "slow" from "stuck." So AutoPivot doesn't auto-time-out a local model by default — you're the better judge. When you've waited long enough, `/pivot down` moves you on, and `/pivot online` brings you back. (If you'd rather have an automatic backstop even for local models, you can set a timeout for them too.)

One deliberate choice: once AutoPivot drops a model because it failed, it stays dropped until you say otherwise (or a turn succeeds on it). A failure it can't fully diagnose is safer left alone than automatically retried into another dead turn.

## Built for extensibility

AutoPivot is deliberately structured so its detection can grow as Letta Code grows.

Today, Letta Code doesn't tell a mod *why* a model failed — there's no error signal a mod can read, so AutoPivot works from the one clue it does get: a turn that starts and never finishes. That's enough to detect a failure and pivot, but not enough to know whether it was a rate limit, a spent balance, or an auth error — or when the limit resets.

AutoPivot is already wired for the day that changes. Its failure handling is split cleanly into a detector and a reaction, connected by a single internal seam. The moment Letta Code exposes a `provider_error` event, it plugs into that same seam with no rework — and AutoPivot will instantly gain the ability to tell failure types apart and, for rate limits, wait exactly until the limit resets before trying again. The mod is ready to deliver that value as soon as the platform makes it possible.

## Good to know

- **Failover happens on your next turn**, not mid-message. The turn that hit the failure still fails; the one after it recovers on a working model. If you need seamless mid-message retries, pair AutoPivot with a transport proxy (like LiteLLM) and use AutoPivot for the status pill and offline awareness.
- **The offline note is a nudge, not a lock.** AutoPivot tells your agent it's offline, but a small local model may still ignore that. Treat it as helpful guidance.
- **Model switching is designed for local and Constellation backends** (developed and tested against the local backend). The offline features (the honesty note, memory-sync hook) are for local backends and quietly do nothing elsewhere.
- **Requires Letta Code 0.27.18 or newer.**

## Scope

AutoPivot is about *which model your agent uses* and *keeping available functionality clear when you're offline*. It's not a backend: it won't turn a cloud agent into a local one, copy your server's data down to your laptop, or sync memory between machines (there's an optional hook if you want to wire your own sync). It manages failover and awareness — nothing behind the scenes pretends to be something it isn't.

## Configuration

AutoPivot reads `~/.letta/mods/autopivot.config.json` (JSONC — comments allowed). `/pivot setup` writes a starter for you, or copy [`autopivot.config.example.json`](./autopivot.config.example.json) and edit. A missing or malformed file falls back safely with a warning. Every reachability `probeUrl` is a trust boundary: it must be `http(s)`, redirects are not followed, and any auth token comes from an env var you name (`probeAuthEnv`), never from the config file.

## License

MIT
