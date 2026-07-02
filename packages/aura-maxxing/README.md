# Aura Maxxing

A Letta Code mod package that nudges the agent toward high-signal, high-presence replies.

This is for sessions where the user wants the answer to land cleanly: less filler, more clarity, stronger framing, and a little more charisma without becoming cheesy.

## Install

```bash
letta install npm:@letta-ai/aura-maxxing
```

Then reload local mods:

```text
/reload
```

## What it does

- `/aura` slash command
- `aura_maxxing` model-callable tool
- turn-start reminder that encourages concise, grounded, high-signal output

## Quick start

```text
/aura
```

## Safety

This mod is stylistic, not factual. It should sharpen delivery without inventing confidence, hiding uncertainty, or overclaiming.

See [`MOD.md`](./MOD.md) for the agent-facing behavioral contract.
