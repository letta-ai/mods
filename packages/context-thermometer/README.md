# @letta-ai/context-thermometer

A Letta Code mod that visualizes context window usage as a real-time thermometer gauge panel.

## Features

- **Visual gauge** — a horizontal bar showing context window fill percentage
- **Token tracking** — input, output, and peak token counts
- **Trend sparkline** — a Unicode sparkline showing input token history over recent turns
- **Memory block breakdown** — per-file token estimates for all system memory blocks
- **Status indicators** — COMFORTABLE (<50%), GETTING FULL (50-75%), WARM (75-90%), CRITICAL (>90%)
- **Critical warnings** — automatically injects a system reminder when context usage exceeds 90%

## Install

```bash
letta install npm:@letta-ai/context-thermometer
```

Then run `/reload` in Letta Code.

## Usage

The thermometer panel appears automatically. Use `/context` to toggle it.

### Commands

| Command | Description |
|---------|-------------|
| `/context` | Toggle the thermometer panel |
| `/context on` | Enable the panel |
| `/context off` | Disable the panel |
| `/context status` | Show current stats as output |
| `/context max <tokens>` | Set max context window size |

### Configuration

Set `CONTEXT_THERMOMETER_MAX_TOKENS` in your environment to override the default max of 128,000 tokens.

## How it works

The mod hooks into `turn_start` events to read context window token counts from the conversation context. It reads memory block files from the MemFS filesystem to estimate their token sizes (~4 chars per token). The gauge updates on every turn, and a system reminder is injected when usage exceeds 90%.
