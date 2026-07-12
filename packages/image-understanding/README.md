# Image Understanding

A Letta Code mod package that gives text-only/non-vision agents image understanding by routing images through a separate vision backend and returning text the main model can reason over.

This does not make the main model natively multimodal. It adds a trusted bridge:

1. The user or agent provides an image path or URL.
2. The mod sends that image to a configured vision backend.
3. The backend returns a text description, OCR extraction, UI-debug analysis, diagram explanation, or accessibility description.
4. The text-only agent uses that returned text like any other context.

## How this relates to the model pipeline

On Letta Code's local backend, text-only models never receive raw image parts even without this mod: the provider runtime (pi-ai) replaces unsupported image parts with a `(image omitted: model does not support images)` placeholder based on the model's catalog capabilities. Images are not a crash risk there — they are silently *discarded*.

This mod's purpose is to replace that discarded content with something useful: a real caption (auto-caption mode), or a note telling the agent the images exist and can be inspected on demand (strip-images mode, `image_understand` tool).

**The vision backend must be vision-capable.** The mod's vision request is a direct API call that bypasses the provider runtime's capability handling. If you point `IMAGE_UNDERSTANDING_MODEL` / `IMAGE_UNDERSTANDING_BASE_URL` at a text-only model (for example a GLM text handle), the *mod's own request* will fail with a provider 400 rejecting image content — an error that is easy to misread as your conversation model failing.

Original source: <https://tangled.org/cameron.stream/image-understanding>

## Install

```bash
letta install npm:@letta-ai/image-understanding
```

Run `/reload` in active sessions after installing.

## Features

- Agent tool: `image_understand`
- Slash commands:
  - `/image-understand`
  - `/image-understanding-status`
- Optional `turn_start` auto-captioning for image-bearing user turns
- Prompt modes:
  - `describe`
  - `ocr`
  - `ui_debug`
  - `diagram`
  - `accessibility`

## Quick start

### OpenAI-compatible provider

```bash
export OPENAI_API_KEY=...
# optional
export IMAGE_UNDERSTANDING_PROVIDER=openai-compatible
export IMAGE_UNDERSTANDING_MODEL=gpt-4o-mini
```

Then reload and test:

```text
/reload
/image-understanding-status
/image-understand ~/Desktop/screenshot.png what error is shown?
```

### Local Ollama provider

Use this when you want image bytes to stay local.

```bash
ollama pull llava:latest
export IMAGE_UNDERSTANDING_PROVIDER=ollama
export IMAGE_UNDERSTANDING_MODEL=llava:latest
export IMAGE_UNDERSTANDING_BASE_URL=http://localhost:11434
export IMAGE_UNDERSTANDING_ALLOW_CLOUD=0
```

Then reload and test:

```text
/reload
/image-understanding-status
/image-understand ~/Desktop/screenshot.png summarize this screenshot
```

Any Ollama model that supports image input should work. Other possible models include `llama3.2-vision` or Qwen/VL variants if they are available in your Ollama installation.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `IMAGE_UNDERSTANDING_PROVIDER` | `openai-compatible` | Provider backend. Supported: `openai-compatible`, `ollama`. Alias: `openai`. |
| `IMAGE_UNDERSTANDING_API_KEY` | unset | API key for OpenAI-compatible backends. Overrides `OPENAI_API_KEY`. |
| `OPENAI_API_KEY` | unset | Fallback API key for OpenAI-compatible backends. |
| `IMAGE_UNDERSTANDING_MODEL` | `gpt-4o-mini` or `llava:latest` | Vision model name. Default depends on provider. |
| `IMAGE_UNDERSTANDING_BASE_URL` | OpenAI or Ollama URL | Base URL. OpenAI-compatible default: `https://api.openai.com/v1`; Ollama default: `http://localhost:11434`. |
| `IMAGE_UNDERSTANDING_MAX_TOKENS` | `1200` | Max tokens for OpenAI-compatible responses. |
| `IMAGE_UNDERSTANDING_ALLOW_CLOUD` | `1` | Set `0` to block non-local providers. |
| `IMAGE_UNDERSTANDING_ALLOW_URLS` | `1` | Set `0` to block fetching remote image URLs. |
| `IMAGE_UNDERSTANDING_REQUIRE_LOCAL` | `0` | Set `1` to require local provider use. Currently this requires `provider=ollama`. |
| `IMAGE_UNDERSTANDING_AUTO_CAPTION` | `0` | Set `1` to enable automatic image caption injection on `turn_start`. |
| `IMAGE_UNDERSTANDING_AUTO_MODE` | `describe` | Mode used for auto-captioning. Supports `describe`, `ocr`, `ui_debug`, `diagram`, `accessibility`. |
| `IMAGE_UNDERSTANDING_STRIP_IMAGES` | `0` | Set `1` to strip image parts from user messages on `turn_start` without captioning (protects text-only models without requiring a vision backend). Ignored when auto-caption is enabled. |
| `IMAGE_UNDERSTANDING_AGENTS` | unset | Comma-separated agent IDs or names. When set, auto-caption and strip-images only apply to matching agents; other agents' messages are left untouched. Unset applies to all agents. |

## Tool usage

Status check:

```json
{ "action": "status" }
```

General image description:

```json
{
  "path_or_url": "~/Desktop/screenshot.png"
}
```

Targeted question:

```json
{
  "path_or_url": "~/Desktop/screenshot.png",
  "question": "What error is shown in this screenshot?"
}
```

Use a built-in mode:

```json
{
  "path_or_url": "~/Desktop/screenshot.png",
  "mode": "ui_debug"
}
```

## Slash commands

```text
/image-understanding-status
/image-understand ~/Desktop/screenshot.png what error is shown?
```

Use quotes for paths containing spaces:

```text
/image-understand "~/Desktop/error screenshot.png" summarize the UI state
```

## Auto-captioning

Auto-captioning is off by default. Enable it only when you want the mod to automatically inspect images before the main model sees the user turn.

```bash
export IMAGE_UNDERSTANDING_AUTO_CAPTION=1
export IMAGE_UNDERSTANDING_AUTO_MODE=ui_debug
```

For private local-only auto-captioning:

```bash
export IMAGE_UNDERSTANDING_PROVIDER=ollama
export IMAGE_UNDERSTANDING_ALLOW_CLOUD=0
export IMAGE_UNDERSTANDING_REQUIRE_LOCAL=1
export IMAGE_UNDERSTANDING_AUTO_CAPTION=1
```

## Privacy and security

This is trusted local code. It can read local image files you ask it to process and can send image bytes to the configured backend.

Important behavior:

- Agent-initiated `image_understand` tool calls require approval.
- Slash commands are direct user actions and run immediately.
- Auto-captioning is opt-in and runs automatically once enabled.
- `IMAGE_UNDERSTANDING_ALLOW_CLOUD=0` blocks non-local providers.
- `IMAGE_UNDERSTANDING_ALLOW_URLS=0` blocks fetching remote image URLs.
- `IMAGE_UNDERSTANDING_REQUIRE_LOCAL=1` requires local provider use.

For sensitive screenshots, prefer Ollama/local provider mode.

## Supported inputs

Local file extensions:

- `.png`
- `.jpg`
- `.jpeg`
- `.webp`
- `.gif`

Remote inputs:

- `http://...`
- `https://...`

Limits:

- Local and fetched images over 20 MB are rejected.
- URL responses must have an `image/*` content type.
- Unsupported local extensions are rejected unless the image is provided via HTTP(S).

## Safety

If a mod breaks startup or command handling, recover with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

See [`MOD.md`](./MOD.md) for the agent-facing behavioral contract.
