const TAVILY_API_URL = "https://api.tavily.com/search";
const TAVILY_API_KEY = "TAVILY_API_KEY";

function stringArg(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function booleanArg(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function stringArrayArg(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringArg(item)).filter(Boolean);
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return "";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function missingTavilyKey() {
  return {
    status: "error",
    content:
      "Web search is not configured. Use /secret set TAVILY_API_KEY <value> to configure Tavily securely, or start Letta Code with TAVILY_API_KEY set in the process environment.",
  };
}

function formatResult(result, index, includeRawContent) {
  const title = stringArg(result?.title, "Untitled");
  const url = stringArg(result?.url);
  const publishedDate = stringArg(result?.published_date);
  const score = typeof result?.score === "number" ? result.score.toFixed(3) : "";
  const content = stringArg(result?.content);
  const rawContent = includeRawContent ? stringArg(result?.raw_content) : "";

  return [
    `### ${index + 1}. ${title}`,
    url,
    publishedDate ? `Published: ${publishedDate}` : "",
    score ? `Score: ${score}` : "",
    content ? `Snippet:\n${content.slice(0, 1600)}` : "",
    rawContent ? `Raw content:\n${rawContent.slice(0, 2400)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatTavilyResponse(data, includeRawContent) {
  const answer = stringArg(data?.answer);
  const results = Array.isArray(data?.results) ? data.results : [];
  const sections = [];

  if (answer) {
    sections.push(["## Tavily answer", answer].join("\n"));
  }

  if (results.length > 0) {
    sections.push(
      [
        "## Sources",
        ...results.map((result, index) =>
          formatResult(result, index, includeRawContent),
        ),
      ].join("\n\n"),
    );
  }

  return sections.length > 0 ? sections.join("\n\n") : "No Tavily results.";
}

function buildSearchBody(args) {
  const body = {
    query: stringArg(args.query),
    search_depth: pickEnum(args.search_depth, ["basic", "advanced"], "basic"),
    topic: pickEnum(args.topic, ["general", "news", "finance"], "general"),
    max_results: clampInteger(args.max_results, 5, 1, 10),
    include_answer: booleanArg(args.include_answer, true),
    include_raw_content: booleanArg(args.include_raw_content, false),
    include_images: false,
    include_image_descriptions: false,
  };

  const includeDomains = stringArrayArg(args.include_domains);
  if (includeDomains.length > 0) body.include_domains = includeDomains;

  const excludeDomains = stringArrayArg(args.exclude_domains);
  if (excludeDomains.length > 0) body.exclude_domains = excludeDomains;

  return body;
}

export default function activate(letta) {
  if (!letta.capabilities.tools) return;

  return letta.tools.register({
    name: "web_search",
    description:
      "Search the live web with Tavily and return a concise answer plus ranked source results. Use for current facts, source discovery, news, research papers, companies, or web pages.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The web-search query or research question.",
        },
        search_depth: {
          type: "string",
          enum: ["basic", "advanced"],
          description:
            "Search depth. basic is lower latency; advanced is deeper. Defaults to basic.",
        },
        topic: {
          type: "string",
          enum: ["general", "news", "finance"],
          description: "Search topic. Defaults to general.",
        },
        max_results: {
          type: "number",
          description: "Number of source results to return, 1-10. Defaults to 5.",
        },
        include_answer: {
          type: "boolean",
          description: "Whether Tavily should include a generated answer. Defaults to true.",
        },
        include_raw_content: {
          type: "boolean",
          description:
            "Whether to include raw source content snippets when available. Defaults to false.",
        },
        include_domains: {
          type: "array",
          items: { type: "string" },
          description: "Optional domains to restrict results to.",
        },
        exclude_domains: {
          type: "array",
          items: { type: "string" },
          description: "Optional domains to exclude from results.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    requiresApproval: false,
    parallelSafe: true,
    async run(ctx) {
      const apiKey = await ctx.secret(TAVILY_API_KEY, { envFallback: true });
      if (!apiKey) return missingTavilyKey();

      const body = buildSearchBody(ctx.args);
      if (!body.query) return { status: "error", content: "query is required" };

      const response = await fetch(TAVILY_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: ctx.signal,
      });

      if (!response.ok) {
        const detail = await readResponseBody(response);
        return {
          status: "error",
          content: `Tavily API error ${response.status}: ${detail.slice(0, 2000)}`,
        };
      }

      const data = await response.json();
      return formatTavilyResponse(data, body.include_raw_content);
    },
  });
}
