---
name: "@letta-ai/image-understanding"
description: "Image-understanding tool, slash commands, and optional auto-captioning for text-only agents."
---

# Image understanding mod semantics

## When to use

Use this package when the current model cannot inspect images directly but needs to understand a screenshot, diagram, photo, UI error, OCR text, or accessibility context.

The package does not make the main model natively multimodal. It sends the image to a separate configured vision backend and returns text.

## Capabilities

This package registers:

- Tool: `image_understand`
- Commands:
  - `/image-understand`
  - `/image-understanding-status`
- Optional `turn_start` auto-captioning when `IMAGE_UNDERSTANDING_AUTO_CAPTION=1`

## Providers

Supported providers:

- `openai-compatible` (default), using chat completions with image input
- `ollama`, using `/api/generate` with `images`

Configuration is controlled by environment variables, especially:

- `IMAGE_UNDERSTANDING_PROVIDER`
- `IMAGE_UNDERSTANDING_API_KEY` or `OPENAI_API_KEY`
- `IMAGE_UNDERSTANDING_MODEL`
- `IMAGE_UNDERSTANDING_BASE_URL`
- `IMAGE_UNDERSTANDING_ALLOW_CLOUD`
- `IMAGE_UNDERSTANDING_ALLOW_URLS`
- `IMAGE_UNDERSTANDING_REQUIRE_LOCAL`
- `IMAGE_UNDERSTANDING_AUTO_CAPTION`
- `IMAGE_UNDERSTANDING_AUTO_MODE`

## Tool behavior

`image_understand` supports:

- `action: "status"` to inspect provider configuration
- `path_or_url` for local image paths, workspace-relative paths, `~/` paths, or HTTP(S) image URLs
- `question` for targeted image questions
- `mode` for built-in prompts: `describe`, `ocr`, `ui_debug`, `diagram`, `accessibility`
- `detail` for OpenAI-compatible detail preference (`low`, `high`, `auto`)

Agent-initiated tool calls require approval because image bytes may be read from local disk or sent to a provider.

## Auto-captioning behavior

Auto-captioning is opt-in. When enabled, the mod listens for `turn_start`, finds image content parts or markdown image links in user messages, runs image understanding, and appends text descriptions to the user turn before the main model sees it.

For sensitive images, prefer:

```bash
IMAGE_UNDERSTANDING_PROVIDER=ollama
IMAGE_UNDERSTANDING_ALLOW_CLOUD=0
IMAGE_UNDERSTANDING_REQUIRE_LOCAL=1
IMAGE_UNDERSTANDING_AUTO_CAPTION=1
```

## Safety

- Slash commands are direct user actions and run immediately.
- Auto-captioning runs automatically once enabled.
- `IMAGE_UNDERSTANDING_ALLOW_CLOUD=0` blocks non-local providers.
- `IMAGE_UNDERSTANDING_ALLOW_URLS=0` blocks remote image fetching.
- `IMAGE_UNDERSTANDING_REQUIRE_LOCAL=1` requires the Ollama provider.
- Local and fetched images over 20 MB are rejected.
- Supported local extensions: `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`.

## Adaptation notes for agents

- Use `/image-understanding-status` or tool `action: "status"` before debugging provider setup.
- Prefer `mode: "ui_debug"` for screenshots and error states.
- Prefer `mode: "ocr"` when the goal is text extraction.
- Prefer `mode: "diagram"` for architecture or technical diagrams.
- Do not enable auto-captioning casually; it is intentionally opt-in.
