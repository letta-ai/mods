import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import path from "node:path";

const DEFAULT_PROVIDER = "openai-compatible";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OLLAMA_MODEL = "llava:latest";
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const MIME_BY_EXT = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);

const MODE_PROMPTS = {
  describe:
    "Describe this image clearly. Include important visual details, context, visible objects, people, UI state, errors, diagrams, and any visible text.",
  ocr:
    "Extract all visible text from this image. Preserve line breaks and reading order where possible. If text is unclear, mark uncertain words with [?].",
  ui_debug:
    "Analyze this screenshot for UI/debugging. Extract visible text, identify errors or broken states, describe relevant controls/layout, and suggest likely next debugging steps.",
  diagram:
    "Explain this diagram or technical visual. Identify nodes, arrows, labels, structure, relationships, and the main takeaway.",
  accessibility:
    "Write an accessibility-focused description of this image for someone who cannot see it. Include layout, salient visual details, and visible text.",
};

function envBool(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  return !["0", "false", "no", "off"].includes(String(raw).toLowerCase());
}

function normalizeProvider(value) {
  const provider = String(value || DEFAULT_PROVIDER).toLowerCase();
  if (["openai", "openai-compatible", "openai_compatible"].includes(provider)) return "openai-compatible";
  if (provider === "ollama") return "ollama";
  return provider;
}

function getConfig() {
  const provider = normalizeProvider(process.env.IMAGE_UNDERSTANDING_PROVIDER);
  const openaiApiKey = process.env.IMAGE_UNDERSTANDING_API_KEY || process.env.OPENAI_API_KEY || "";
  return {
    provider,
    apiKey: openaiApiKey,
    model:
      process.env.IMAGE_UNDERSTANDING_MODEL ||
      (provider === "ollama" ? DEFAULT_OLLAMA_MODEL : DEFAULT_OPENAI_MODEL),
    baseUrl: (
      process.env.IMAGE_UNDERSTANDING_BASE_URL ||
      (provider === "ollama" ? DEFAULT_OLLAMA_BASE_URL : DEFAULT_OPENAI_BASE_URL)
    ).replace(/\/$/, ""),
    maxTokens: Number.parseInt(process.env.IMAGE_UNDERSTANDING_MAX_TOKENS || "1200", 10),
    allowCloud: envBool("IMAGE_UNDERSTANDING_ALLOW_CLOUD", true),
    allowUrls: envBool("IMAGE_UNDERSTANDING_ALLOW_URLS", true),
    requireLocal: envBool("IMAGE_UNDERSTANDING_REQUIRE_LOCAL", false),
    autoCaption: envBool("IMAGE_UNDERSTANDING_AUTO_CAPTION", false),
    autoMode: process.env.IMAGE_UNDERSTANDING_AUTO_MODE || "describe",
  };
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveLocalPath(input, cwd) {
  const expanded = input.startsWith("~/")
    ? path.join(process.env.HOME || "", input.slice(2))
    : input;
  return path.isAbsolute(expanded) ? expanded : path.resolve(cwd || process.cwd(), expanded);
}

function promptFor({ question, mode }) {
  const trimmed = typeof question === "string" ? question.trim() : "";
  if (trimmed) return trimmed;
  return MODE_PROMPTS[mode] || MODE_PROMPTS.describe;
}

async function localImage(pathOrUrl, cwd) {
  const resolved = resolveLocalPath(pathOrUrl, cwd);
  const stat = statSync(resolved);
  if (!stat.isFile()) throw new Error(`Not a file: ${resolved}`);
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new Error(`Image is too large (${stat.size} bytes). Limit is ${MAX_IMAGE_BYTES} bytes.`);
  }

  const ext = path.extname(resolved).toLowerCase();
  const mime = MIME_BY_EXT.get(ext);
  if (!mime) {
    throw new Error(`Unsupported image extension "${ext}". Use png, jpg, jpeg, webp, gif, or an http(s) URL.`);
  }

  const data = await readFile(resolved);
  return { bytes: data, base64: data.toString("base64"), mime, source: resolved, isUrl: false };
}

async function urlImage(pathOrUrl, signal) {
  const response = await fetch(pathOrUrl, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch image URL: HTTP ${response.status} ${response.statusText}`);
  }
  const contentLength = Number.parseInt(response.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image URL is too large (${contentLength} bytes). Limit is ${MAX_IMAGE_BYTES} bytes.`);
  }
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image URL is too large (${arrayBuffer.byteLength} bytes). Limit is ${MAX_IMAGE_BYTES} bytes.`);
  }
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  if (!contentType.startsWith("image/")) {
    throw new Error(`URL did not return an image content-type: ${contentType}`);
  }
  const bytes = Buffer.from(arrayBuffer);
  return { bytes, base64: bytes.toString("base64"), mime: contentType, source: pathOrUrl, isUrl: true };
}

async function loadImage(pathOrUrl, ctx) {
  return isHttpUrl(pathOrUrl) ? await urlImage(pathOrUrl, ctx.signal) : await localImage(pathOrUrl, ctx.cwd);
}

function enforceSafety({ pathOrUrl, config }) {
  if (config.requireLocal && config.provider !== "ollama") {
    return "IMAGE_UNDERSTANDING_REQUIRE_LOCAL=1 requires IMAGE_UNDERSTANDING_PROVIDER=ollama.";
  }
  if (!config.allowCloud && config.provider !== "ollama") {
    return "IMAGE_UNDERSTANDING_ALLOW_CLOUD=0 blocks non-local vision providers. Set IMAGE_UNDERSTANDING_PROVIDER=ollama or allow cloud use.";
  }
  if (!config.allowUrls && isHttpUrl(pathOrUrl)) {
    return "IMAGE_UNDERSTANDING_ALLOW_URLS=0 blocks fetching image URLs. Use a local file path or allow URLs.";
  }
  return null;
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function errorContent(message, config) {
  const setup = config.provider === "ollama"
    ? `Ollama setup example: IMAGE_UNDERSTANDING_PROVIDER=ollama IMAGE_UNDERSTANDING_MODEL=${DEFAULT_OLLAMA_MODEL} IMAGE_UNDERSTANDING_BASE_URL=${DEFAULT_OLLAMA_BASE_URL}`
    : "OpenAI-compatible setup example: set OPENAI_API_KEY or IMAGE_UNDERSTANDING_API_KEY, optionally IMAGE_UNDERSTANDING_MODEL and IMAGE_UNDERSTANDING_BASE_URL.";
  return `${message}\n${setup}`;
}

async function askOpenAiCompatible({ image, prompt, detail }, config, ctx) {
  if (!config.apiKey) {
    return { status: "error", content: errorContent("Missing API key for openai-compatible image understanding.", config) };
  }

  const imageUrl = { url: `data:${image.mime};base64,${image.base64}` };
  if (detail) imageUrl.detail = detail;

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: imageUrl },
          ],
        },
      ],
      max_tokens: Number.isFinite(config.maxTokens) ? config.maxTokens : 1200,
    }),
    signal: ctx.signal,
  });

  const body = parseJson(await response.text());
  if (!response.ok) {
    const rendered = typeof body === "string" ? body : JSON.stringify(body);
    const hint = response.status === 400
      ? " The configured endpoint/model may not support image input. Use a vision-capable model or provider=ollama with a vision model."
      : "";
    return { status: "error", content: errorContent(`Vision request failed: HTTP ${response.status} ${response.statusText}: ${rendered}.${hint}`, config) };
  }

  const answer = body?.choices?.[0]?.message?.content;
  if (!answer) return { status: "error", content: `Vision response had no answer: ${JSON.stringify(body)}` };
  return answer;
}

async function askOllama({ image, prompt }, config, ctx) {
  const response = await fetch(`${config.baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      prompt,
      images: [image.base64],
      stream: false,
    }),
    signal: ctx.signal,
  });

  const body = parseJson(await response.text());
  if (!response.ok) {
    const rendered = typeof body === "string" ? body : JSON.stringify(body);
    const hint = response.status === 404
      ? ` Is Ollama running and is the model pulled? Try: ollama pull ${config.model}`
      : "";
    return { status: "error", content: errorContent(`Ollama vision request failed: HTTP ${response.status} ${response.statusText}: ${rendered}.${hint}`, config) };
  }

  const answer = body?.response;
  if (!answer) return { status: "error", content: `Ollama response had no answer: ${JSON.stringify(body)}` };
  return answer;
}

async function askVision({ pathOrUrl, question, detail, mode }, ctx) {
  const config = getConfig();
  if (!["openai-compatible", "ollama"].includes(config.provider)) {
    return { status: "error", content: `Unsupported IMAGE_UNDERSTANDING_PROVIDER=${config.provider}. Supported providers: openai-compatible, ollama.` };
  }

  const safetyError = enforceSafety({ pathOrUrl, config });
  if (safetyError) return { status: "error", content: safetyError };

  const image = await loadImage(pathOrUrl, ctx);
  const prompt = promptFor({ question, mode });

  if (config.provider === "ollama") {
    return await askOllama({ image, prompt }, config, ctx);
  }
  return await askOpenAiCompatible({ image, prompt, detail }, config, ctx);
}

async function providerStatus() {
  const config = getConfig();
  const lines = [
    `provider: ${config.provider}`,
    `model: ${config.model}`,
    `base_url: ${config.baseUrl}`,
    `api_key: ${config.provider === "ollama" ? "not required" : (config.apiKey ? "present" : "missing")}`,
    `allow_cloud: ${config.allowCloud ? "yes" : "no"}`,
    `allow_urls: ${config.allowUrls ? "yes" : "no"}`,
    `require_local: ${config.requireLocal ? "yes" : "no"}`,
    `auto_caption: ${config.autoCaption ? "yes" : "no"}`,
    `auto_mode: ${config.autoMode}`,
    `supported_providers: openai-compatible, ollama`,
    `modes: ${Object.keys(MODE_PROMPTS).join(", ")}`,
  ];

  if (config.provider === "ollama") {
    try {
      const response = await fetch(`${config.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3_000) });
      lines.push(`ollama_reachable: ${response.ok ? "yes" : `no (${response.status})`}`);
      if (response.ok) {
        const body = await response.json();
        const models = Array.isArray(body.models) ? body.models.map((m) => m.name).slice(0, 20) : [];
        lines.push(`ollama_models: ${models.length ? models.join(", ") : "none reported"}`);
      }
    } catch (error) {
      lines.push(`ollama_reachable: no (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  return lines.join("\n");
}

function imageRefFromPart(part) {
  if (!part || typeof part !== "object") return null;
  if (typeof part.path === "string" && part.path) return part.path;
  if (typeof part.file_path === "string" && part.file_path) return part.file_path;
  if (typeof part.url === "string" && isHttpUrl(part.url)) return part.url;
  if (typeof part.image_url === "string" && isHttpUrl(part.image_url)) return part.image_url;
  if (part.image_url && typeof part.image_url === "object" && typeof part.image_url.url === "string") return part.image_url.url;
  if (part.source && typeof part.source === "object") {
    if (typeof part.source.path === "string") return part.source.path;
    if (typeof part.source.url === "string") return part.source.url;
  }
  return null;
}

function extractImageRefsFromContent(content) {
  const refs = [];
  if (typeof content === "string") {
    const markdownImage = /!\[[^\]]*\]\(([^)]+)\)/g;
    for (const match of content.matchAll(markdownImage)) {
      const ref = match[1]?.trim();
      if (ref) refs.push(ref);
    }
    return refs;
  }
  if (!Array.isArray(content)) return refs;
  for (const part of content) {
    const type = String(part?.type || "").toLowerCase();
    const looksImage = type.includes("image") || Boolean(part?.image_url);
    if (!looksImage) continue;
    const ref = imageRefFromPart(part);
    if (ref) refs.push(ref);
  }
  return refs;
}

function appendTextContent(content, text) {
  if (typeof content === "string") return `${content}\n\n${text}`;
  if (Array.isArray(content)) return [...content, { type: "text", text }];
  return text;
}

async function autoCaptionTurn(event, ctx) {
  const config = getConfig();
  if (!config.autoCaption) return;
  const input = Array.isArray(event.input) ? event.input : [];
  const descriptions = [];

  for (const item of input) {
    if (!item || item.type === "approval" || item.role !== "user") continue;
    const refs = extractImageRefsFromContent(item.content);
    for (const ref of refs.slice(0, 4)) {
      try {
        const result = await askVision({ pathOrUrl: ref, mode: config.autoMode }, ctx);
        const text = typeof result === "string" ? result : result.content || JSON.stringify(result);
        descriptions.push(`Image ${descriptions.length + 1} (${ref}):\n${text}`);
      } catch (error) {
        descriptions.push(`Image ${descriptions.length + 1} (${ref}): auto-caption failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (descriptions.length === 0) return;
  const note = `[Auto image understanding (${config.provider}/${config.model})]\n${descriptions.join("\n\n")}`;
  event.input = input.map((item) => {
    if (!item || item.type === "approval" || item.role !== "user") return item;
    const refs = extractImageRefsFromContent(item.content);
    if (refs.length === 0) return item;
    return { ...item, content: appendTextContent(item.content, note) };
  });
  return { input: event.input };
}

function parseCommandArgs(args) {
  const raw = String(args || "").trim();
  if (!raw) return { pathOrUrl: "", question: "" };
  if (raw.startsWith('"') || raw.startsWith("'")) {
    const quote = raw[0];
    const end = raw.indexOf(quote, 1);
    if (end > 0) {
      return { pathOrUrl: raw.slice(1, end), question: raw.slice(end + 1).trim() };
    }
  }
  const [pathOrUrl, ...rest] = raw.split(/\s+/);
  return { pathOrUrl, question: rest.join(" ").trim() };
}

export default function activate(letta) {
  const disposers = [];

  if (letta.capabilities.tools) {
    disposers.push(letta.tools.register({
      name: "image_understand",
      description: "Use a vision model to answer questions about a local image path or image URL when the current model cannot inspect images directly. Supports OpenAI-compatible vision and local Ollama vision backends. Useful for screenshots, UI errors, diagrams, photos, OCR, and visual debugging.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["understand", "status"],
            description: "Use status to inspect provider configuration. Defaults to understand.",
          },
          path_or_url: {
            type: "string",
            description: "Local image path, path relative to the current workspace, ~/ path, or http(s) image URL. Required for action=understand.",
          },
          question: {
            type: "string",
            description: "Optional specific question to ask about the image. If omitted, the selected mode prompt is used.",
          },
          mode: {
            type: "string",
            enum: ["describe", "ocr", "ui_debug", "diagram", "accessibility"],
            description: "Prompt mode to use when question is omitted. Defaults to describe.",
          },
          detail: {
            type: "string",
            enum: ["low", "high", "auto"],
            description: "Optional OpenAI image detail preference. Ignored by Ollama.",
          },
        },
        additionalProperties: false,
      },
      requiresApproval: true,
      parallelSafe: true,
      async run(ctx) {
        const action = String(ctx.args.action || "understand");
        if (action === "status") return await providerStatus();
        const pathOrUrl = String(ctx.args.path_or_url || "").trim();
        if (!pathOrUrl) return { status: "error", content: "path_or_url is required for image understanding. Use action=status to inspect configuration." };
        const question = typeof ctx.args.question === "string" ? ctx.args.question : "";
        const detail = typeof ctx.args.detail === "string" ? ctx.args.detail : undefined;
        const mode = typeof ctx.args.mode === "string" ? ctx.args.mode : "describe";
        return await askVision({ pathOrUrl, question, detail, mode }, ctx);
      },
    }));
  }

  if (letta.capabilities.events?.turns) {
    disposers.push(letta.events.on("turn_start", autoCaptionTurn));
  }

  if (letta.capabilities.commands) {
    disposers.push(letta.commands.register({
      id: "image-understanding-status",
      description: "Show image-understanding provider configuration and diagnostics",
      async run() {
        return { type: "output", output: await providerStatus() };
      },
    }));

    disposers.push(letta.commands.register({
      id: "image-understand",
      description: "Inspect an image with the configured vision backend",
      args: "<path-or-url> [question]",
      async run(ctx) {
        const { pathOrUrl, question } = parseCommandArgs(ctx.args);
        if (!pathOrUrl) {
          return { type: "output", output: "Usage: /image-understand <path-or-url> [question]" };
        }
        const result = await askVision({ pathOrUrl, question, mode: "describe" }, ctx);
        const output = typeof result === "string" ? result : result.content || JSON.stringify(result, null, 2);
        return { type: "output", output };
      },
    }));
  }

  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
