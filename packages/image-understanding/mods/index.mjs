import { readFile } from "node:fs/promises";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const DEFAULT_PROVIDER = "openai-compatible";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
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

const CONFIG_KEYS = {
  provider: "string",
  model: "string",
  baseUrl: "string",
  maxTokens: "number",
  allowCloud: "boolean",
  allowUrls: "boolean",
  requireLocal: "boolean",
  autoCaption: "boolean",
  autoMode: "string",
  stripImages: "boolean",
  agents: "string",
};

function parseConfigValue(key, value) {
  const type = CONFIG_KEYS[key];
  if (type === "boolean") {
    return !["0", "false", "no", "off", ""].includes(String(value).toLowerCase());
  }
  if (type === "number") {
    const n = Number.parseInt(String(value), 10);
    if (!Number.isFinite(n)) throw new Error(`${key} must be a number.`);
    return n;
  }
  let s = String(value);
  if (key === "provider") s = normalizeProvider(s);
  return s;
}

// Runtime overrides: set via the image_understand tool's config action.
// These take precedence over env vars, allowing agents to change settings
// at runtime without shell access or slash commands.
const runtimeOverrides = {};

// Persistent config file: written when action=config has persist=true.
// Loaded at mod activation so settings survive /reload.
const PERSISTENT_CONFIG_PATH = process.env.IMAGE_UNDERSTANDING_CONFIG_PATH ??
  path.join(homedir(), ".letta", "mods", "image-understanding.config.json");

function loadPersistentConfig() {
  try {
    const raw = JSON.parse(readFileSync(PERSISTENT_CONFIG_PATH, "utf-8"));
    if (raw && typeof raw === "object") {
      for (const key of Object.keys(CONFIG_KEYS)) {
        if (key in raw) {
          try {
            runtimeOverrides[key] = parseConfigValue(key, raw[key]);
          } catch {
            // skip invalid persisted values
          }
        }
      }
    }
  } catch {
    // no persistent config yet — fine
  }
}

function savePersistentConfig() {
  try {
    mkdirSync(path.dirname(PERSISTENT_CONFIG_PATH), { recursive: true });
    const toSave = {};
    for (const key of Object.keys(runtimeOverrides)) {
      toSave[key] = runtimeOverrides[key];
    }
    writeFileSync(PERSISTENT_CONFIG_PATH, JSON.stringify(toSave, null, 2));
  } catch {
    // persistence is best-effort
  }
}

function getConfig() {
  const provider = normalizeProvider(runtimeOverrides.provider ?? process.env.IMAGE_UNDERSTANDING_PROVIDER);
  const openaiApiKey = process.env.IMAGE_UNDERSTANDING_API_KEY || process.env.OPENAI_API_KEY || "";
  return {
    provider,
    apiKey: openaiApiKey,
    model: runtimeOverrides.model ?? (process.env.IMAGE_UNDERSTANDING_MODEL ||
      (provider === "ollama" ? DEFAULT_OLLAMA_MODEL : DEFAULT_OPENAI_MODEL)),
    baseUrl: (runtimeOverrides.baseUrl ?? (process.env.IMAGE_UNDERSTANDING_BASE_URL ||
      (provider === "ollama" ? DEFAULT_OLLAMA_BASE_URL : DEFAULT_OPENAI_BASE_URL))).replace(/\/$/, ""),
    maxTokens: runtimeOverrides.maxTokens ?? Number.parseInt(process.env.IMAGE_UNDERSTANDING_MAX_TOKENS || "1200", 10),
    allowCloud: runtimeOverrides.allowCloud ?? envBool("IMAGE_UNDERSTANDING_ALLOW_CLOUD", true),
    allowUrls: runtimeOverrides.allowUrls ?? envBool("IMAGE_UNDERSTANDING_ALLOW_URLS", true),
    requireLocal: runtimeOverrides.requireLocal ?? envBool("IMAGE_UNDERSTANDING_REQUIRE_LOCAL", false),
    autoCaption: runtimeOverrides.autoCaption ?? envBool("IMAGE_UNDERSTANDING_AUTO_CAPTION", false),
    autoMode: runtimeOverrides.autoMode ?? (process.env.IMAGE_UNDERSTANDING_AUTO_MODE || "describe"),
    stripImages: runtimeOverrides.stripImages ?? envBool("IMAGE_UNDERSTANDING_STRIP_IMAGES", false),
    agents: runtimeOverrides.agents ?? (process.env.IMAGE_UNDERSTANDING_AGENTS || ""),
  };
}

/**
 * Agent allowlist for turn-level behavior (auto-caption / strip-images).
 * `agents` is a comma-separated list of agent IDs or names. When empty, turn
 * handlers apply to every agent (previous behavior). When set, they only apply
 * to matching agents, so a globally installed mod does not silently change
 * message content for every agent on the machine.
 */
function agentAllowed(config, ctx) {
  const allowlist = String(config.agents || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (allowlist.length === 0) return true;
  const agentId = ctx?.agent?.id ?? null;
  const agentName = ctx?.agent?.name ?? null;
  return allowlist.some((entry) => {
    if (agentId && entry === agentId) return true;
    if (agentName && entry.toLowerCase() === String(agentName).toLowerCase()) return true;
    return false;
  });
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isDataUrl(value) {
  return typeof value === "string" && value.startsWith("data:");
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

async function dataUrlImage(pathOrUrl) {
  const match = pathOrUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/is);
  if (!match) {
    throw new Error(`Invalid image data URI: ${pathOrUrl.slice(0, 40)}...`);
  }
  const [, mime, base64] = match;
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`Image is too large (${bytes.length} bytes). Limit is ${MAX_IMAGE_BYTES} bytes.`);
  }
  return { bytes, base64, mime: mime || "image/png", source: "data-url", isUrl: false };
}

async function loadImage(pathOrUrl, ctx) {
  if (isDataUrl(pathOrUrl)) return await dataUrlImage(pathOrUrl);
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
    `strip_images: ${config.stripImages ? "yes" : "no"}`,
    `agents: ${config.agents || "(all)"}`,
    `config_file: ${PERSISTENT_CONFIG_PATH}`,
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
    if (part.source.type === "base64" && typeof part.source.data === "string") {
      return `data:${part.source.media_type || "image/png"};base64,${part.source.data}`;
    }
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

/**
 * Replace image parts in message content with replacement text.
 * Strips any part whose type includes "image" or has an image_url field,
 * then appends the replacement text as a new text part.
 * For string content (markdown images), the text is appended as-is since
 * markdown image syntax is just text and won't cause provider 400s.
 */
function replaceImageParts(content, replacementText) {
  if (typeof content === "string") {
    const cleaned = content.replace(/!\[[^\]]*\]\([^)]+\)/g, "").trim();
    if (!replacementText) return cleaned || "[image content removed by image-understanding mod]";
    return cleaned ? `${cleaned}\n\n${replacementText}` : replacementText;
  }
  if (!Array.isArray(content)) return content;
  const filtered = content.filter((part) => {
    const type = String(part?.type || "").toLowerCase();
    const isImage = type.includes("image") || Boolean(part?.image_url);
    return !isImage;
  });
  if (replacementText) {
    filtered.push({ type: "text", text: replacementText });
  }
  // Ensure we never leave the content completely empty after stripping images.
  const hasText = filtered.some((part) => part?.type === "text" && typeof part.text === "string" && part.text.trim() !== "");
  if (!hasText) {
    filtered.push({ type: "text", text: "[image content removed by image-understanding mod]" });
  }
  return filtered;
}

function displayRef(ref) {
  if (isDataUrl(ref)) {
    const match = ref.match(/^data:([^;]+);base64,/);
    return `pasted ${match ? match[1] : "image"}`;
  }
  return ref;
}

function createSystemMessage(content) {
  return { type: "message", role: "system", content };
}

/**
 * Turn handler for auto-caption mode: sends images to a vision backend,
 * gets text descriptions back, then STRIPS image parts from the user message
 * and appends a system message with the caption text. This prevents text-only
 * providers from rejecting the request with 400 "content.type is invalid,
 * allowed values: ['text']".
 */
async function autoCaptionTurn(event, ctx) {
  const config = getConfig();
  if (!config.autoCaption) return;
  if (!agentAllowed(config, ctx)) return;
  const input = Array.isArray(event.input) ? event.input : [];
  const descriptions = [];

  for (const item of input) {
    if (!item || item.type === "approval" || item.role !== "user") continue;
    const refs = extractImageRefsFromContent(item.content);
    for (const ref of refs.slice(0, 4)) {
      try {
        const result = await askVision({ pathOrUrl: ref, mode: config.autoMode }, ctx);
        const text = typeof result === "string" ? result : result.content || JSON.stringify(result);
        descriptions.push(`Image ${descriptions.length + 1} (${displayRef(ref)}):\n${text}`);
      } catch (error) {
        descriptions.push(`Image ${descriptions.length + 1} (${displayRef(ref)}): auto-caption failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (descriptions.length === 0) return;
  const imageCount = descriptions.length;
  const note = `[image-understanding: ${imageCount} image${imageCount === 1 ? "" : "s"} auto-captioned and replaced (via ${config.provider}/${config.model})]\n<image_understanding>\n${descriptions.join("\n\n")}\n</image_understanding>`;
  notifyUser(`${imageCount} image${imageCount === 1 ? "" : "s"} auto-captioned by ${config.provider}/${config.model}`);

  let changed = false;
  const strippedInput = input.map((item) => {
    if (!item || item.type === "approval" || item.role !== "user") return item;
    const refs = extractImageRefsFromContent(item.content);
    if (refs.length === 0) return item;
    changed = true;
    return { ...item, content: replaceImageParts(item.content, "") };
  });
  if (!changed) return;
  event.input = [...strippedInput, createSystemMessage(note)];
  return { input: event.input };
}

/**
 * Turn handler for strip-images mode: when auto-caption is off but
 * strip_images is on, removes image parts from user messages and appends a
 * system message pointing the agent to the image_understand tool. This
 * protects text-only models from 400 errors without requiring a vision
 * backend call.
 */
function stripImagesTurn(event, ctx) {
  const config = getConfig();
  if (!config.stripImages || config.autoCaption) return;
  if (!agentAllowed(config, ctx)) return;
  const input = Array.isArray(event.input) ? event.input : [];
  let changed = false;
  let totalImages = 0;
  const strippedInput = input.map((item) => {
    if (!item || item.type === "approval" || item.role !== "user") return item;
    const refs = extractImageRefsFromContent(item.content);
    if (refs.length === 0) return item;
    changed = true;
    totalImages += refs.length;
    return { ...item, content: replaceImageParts(item.content, "") };
  });
  if (!changed) return;
  const note = `[image-understanding: ${totalImages} image${totalImages === 1 ? "" : "s"} stripped (via ${config.provider}/${config.model})] The user pasted image(s) but the current model is text-only. Use the image_understand tool to inspect them if needed.`;
  notifyUser(`${totalImages} image${totalImages === 1 ? "" : "s"} stripped from turn (strip_images mode)`);
  event.input = [...strippedInput, createSystemMessage(note)];
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

/**
 * Build a user-feedback helper. In TUI/desktop/listener, opens a transient
 * panel above the input (order=100) and auto-closes after a few seconds.
 * Falls back silently if no UI panels capability is available.
 */
function createNotifier(letta) {
  if (!letta.capabilities.ui?.panels) {
    return () => {};
  }
  let panel = null;
  let statusText = "";
  let hideTimer = null;
  const show = (text) => {
    statusText = text;
    if (!panel) {
      panel = letta.ui.openPanel({
        id: "image-understanding-notify",
        order: 100,
        render: ({ width, row, chalk }) => {
          if (!statusText) return "";
          return row(chalk.dim("image-understanding:"), statusText, width);
        },
      });
    }
    panel.update();
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      statusText = "";
      if (panel) {
        panel.close();
        panel = null;
      }
    }, 5_000);
  };
  return show;
}

// Module-level notifier: set during activation so turn handlers can show
// transient UI feedback without needing it passed through the harness ctx.
let notifyUser = () => {};

export default function activate(letta) {
  const disposers = [];
  // Clear any stale runtime overrides from a previous activation so that
  // non-persisted settings don't survive /reload when the module is cached.
  for (const key of Object.keys(runtimeOverrides)) {
    delete runtimeOverrides[key];
  }
  loadPersistentConfig();
  notifyUser = createNotifier(letta);

  if (letta.capabilities.tools) {
    disposers.push(letta.tools.register({
      name: "image_understand",
      description: "Use a vision model to answer questions about a local image path or image URL when the current model cannot inspect images directly. Supports OpenAI-compatible vision and local Ollama vision backends. Useful for screenshots, UI errors, diagrams, photos, OCR, and visual debugging. Also use action=config to read or change runtime settings for the mod.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["understand", "status", "config"],
            description: "Use status to inspect provider configuration. Use config to read or set runtime settings. Defaults to understand.",
          },
          config_key: {
            type: "string",
            enum: ["provider", "model", "baseUrl", "maxTokens", "allowCloud", "allowUrls", "requireLocal", "autoCaption", "autoMode", "stripImages"],
            description: "Config key to read or set when action=config. Boolean keys accept true/false/on/off/yes/no/1/0.",
          },
          config_value: {
            type: "string",
            description: "Value to set for config_key. Omit or leave empty to clear the override and revert to env/default.",
          },
          persist: {
            type: "boolean",
            description: "If true, write this setting to disk so it survives /reload. Defaults to false (runtime-only).",
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
        if (action === "config") {
          const key = ctx.args.config_key;
          const value = ctx.args.config_value;
          const persist = ctx.args.persist === true || String(ctx.args.persist).toLowerCase() === "true";
          if (!key) return await providerStatus();
          if (!(key in CONFIG_KEYS)) {
            return { status: "error", content: `Unknown config key "${key}". Available: ${Object.keys(CONFIG_KEYS).join(", ")}` };
          }
          if (value === undefined || value === null || value === "") {
            delete runtimeOverrides[key];
            if (persist) savePersistentConfig();
            return `${key} override cleared. Current effective value will be shown by action=status.`;
          }
          try {
            const parsed = parseConfigValue(key, value);
            runtimeOverrides[key] = parsed;
            if (persist) savePersistentConfig();
            const display = typeof parsed === "boolean" ? (parsed ? "on" : "off") : parsed;
            const scope = persist ? "persistent override" : "runtime override";
            return `${key} set to ${display} (${scope}).`;
          } catch (err) {
            return { status: "error", content: err.message };
          }
        }
        const pathOrUrl = String(ctx.args.path_or_url || "").trim();
        if (!pathOrUrl) return { status: "error", content: "path_or_url is required for image understanding. Use action=status to inspect configuration. Use action=config to change settings." };
        const question = typeof ctx.args.question === "string" ? ctx.args.question : "";
        const detail = typeof ctx.args.detail === "string" ? ctx.args.detail : undefined;
        const mode = typeof ctx.args.mode === "string" ? ctx.args.mode : "describe";
        return await askVision({ pathOrUrl, question, detail, mode }, ctx);
      },
    }));
  }

  if (letta.capabilities.events?.turns) {
    disposers.push(letta.events.on("turn_start", autoCaptionTurn));
    disposers.push(letta.events.on("turn_start", stripImagesTurn));
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
    notifyUser = () => {};
    for (const key of Object.keys(runtimeOverrides)) {
      delete runtimeOverrides[key];
    }
    for (const dispose of disposers.reverse()) dispose();
  };
}
