const EXA_API_URL = "https://api.exa.ai/search";
const TAVILY_API_URL = "https://api.tavily.com/search";
const PERPLEXITY_API_URL = "https://api.perplexity.ai/v1/sonar";
const PARALLEL_SEARCH_API_URL = "https://api.parallel.ai/v1/search";

const PROVIDERS = [
  { id: "exa", key: "EXA_API_KEY", label: "Exa" },
  { id: "tavily", key: "TAVILY_API_KEY", label: "Tavily" },
  { id: "parallel", key: "PARALLEL_API_KEY", label: "Parallel" },
  { id: "perplexity", key: "PERPLEXITY_API_KEY", label: "Perplexity" },
];

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

function missingProviderKey(provider) {
  return {
    status: "error",
    content: `${provider.label} web search is not configured. Use /secret set ${provider.key} <value> to configure it securely, or start Letta Code with ${provider.key} set in the process environment.`,
  };
}

function missingAllProviderKeys() {
  return {
    status: "error",
    content: [
      "Web search is not configured. Set at least one provider key:",
      ...PROVIDERS.map((provider) => `- /secret set ${provider.key} <value>`),
      "Environment fallback is also supported for the same key names.",
    ].join("\n"),
  };
}

async function selectProvider(ctx) {
  const requested = pickEnum(
    ctx.args.provider,
    ["auto", ...PROVIDERS.map((provider) => provider.id)],
    "auto",
  );

  if (requested !== "auto") {
    const provider = PROVIDERS.find((candidate) => candidate.id === requested);
    const apiKey = await ctx.secret(provider.key, { envFallback: true });
    return apiKey ? { apiKey, provider } : { error: missingProviderKey(provider) };
  }

  for (const provider of PROVIDERS) {
    const apiKey = await ctx.secret(provider.key, { envFallback: true });
    if (apiKey) return { apiKey, provider };
  }

  return { error: missingAllProviderKeys() };
}

function formatExaResult(result, index) {
  const title = stringArg(result?.title, "Untitled");
  const url = stringArg(result?.url);
  const date = stringArg(result?.publishedDate);
  const author = stringArg(result?.author);
  const text = stringArg(result?.text);
  const highlights = Array.isArray(result?.highlights)
    ? result.highlights.map((item) => stringArg(item)).filter(Boolean)
    : [];
  const summary = stringArg(result?.summary);

  return [
    `### ${index + 1}. ${title}`,
    url,
    date ? `Published: ${date}` : "",
    author ? `Author: ${author}` : "",
    summary ? `Summary: ${summary}` : "",
    highlights.length
      ? `Highlights:\n${highlights.map((item) => `- ${item}`).join("\n")}`
      : "",
    text ? `Text:\n${text.slice(0, 1600)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatTavilyResult(result, index, includeRawContent) {
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

function formatPerplexitySearchResults(results) {
  if (!Array.isArray(results) || results.length === 0) return "";

  return [
    "## Search results",
    ...results.map((result, index) => {
      const title = stringArg(result?.title, "Untitled");
      const url = stringArg(result?.url);
      const date = stringArg(result?.date) || stringArg(result?.last_updated);
      const snippet = stringArg(result?.snippet);
      return [
        `### ${index + 1}. ${title}`,
        url,
        date ? `Date: ${date}` : "",
        snippet,
      ]
        .filter(Boolean)
        .join("\n");
    }),
  ].join("\n\n");
}

function formatParallelResult(result, index) {
  const title = stringArg(result?.title, "Untitled");
  const url = stringArg(result?.url);
  const publishDate = stringArg(result?.publish_date);
  const excerpts = Array.isArray(result?.excerpts)
    ? result.excerpts.map((item) => stringArg(item)).filter(Boolean)
    : [];

  return [
    `### ${index + 1}. ${title}`,
    url,
    publishDate ? `Published: ${publishDate}` : "",
    excerpts.length ? excerpts.map((excerpt) => `- ${excerpt}`).join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function runExaSearch(ctx, apiKey, query) {
  const body = {
    query,
    type: pickEnum(
      ctx.args.exa_type ?? ctx.args.search_type,
      ["auto", "instant", "fast", "deep-lite", "deep"],
      "auto",
    ),
    numResults: clampInteger(ctx.args.max_results ?? ctx.args.num_results, 5, 1, 10),
    contents: {
      text: { maxCharacters: 1600 },
      highlights: true,
      summary: { query: "Main relevant facts for the user's question" },
    },
    moderation: true,
  };

  const category = pickEnum(
    ctx.args.category,
    ["company", "research paper", "news", "personal site", "financial report", "people"],
    "",
  );
  if (category) body.category = category;

  const includeDomains = stringArrayArg(ctx.args.include_domains);
  if (includeDomains.length > 0) body.includeDomains = includeDomains;

  const excludeDomains = stringArrayArg(ctx.args.exclude_domains);
  if (excludeDomains.length > 0) body.excludeDomains = excludeDomains;

  const startPublishedDate = stringArg(ctx.args.start_published_date);
  if (startPublishedDate) body.startPublishedDate = startPublishedDate;

  const endPublishedDate = stringArg(ctx.args.end_published_date);
  if (endPublishedDate) body.endPublishedDate = endPublishedDate;

  const response = await fetch(EXA_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(body),
    signal: ctx.signal,
  });

  if (!response.ok) {
    const detail = await readResponseBody(response);
    return {
      status: "error",
      content: `Exa API error ${response.status}: ${detail.slice(0, 2000)}`,
    };
  }

  const data = await response.json();
  const results = Array.isArray(data?.results) ? data.results : [];
  if (results.length === 0) return "No Exa results.";

  return ["## Exa results", ...results.map(formatExaResult)].join("\n\n");
}

async function runTavilySearch(ctx, apiKey, query) {
  const body = {
    query,
    search_depth: pickEnum(ctx.args.search_depth, ["basic", "advanced"], "basic"),
    topic: pickEnum(ctx.args.topic, ["general", "news", "finance"], "general"),
    max_results: clampInteger(ctx.args.max_results, 5, 1, 10),
    include_answer: booleanArg(ctx.args.include_answer, true),
    include_raw_content: booleanArg(ctx.args.include_raw_content, false),
    include_images: false,
    include_image_descriptions: false,
  };

  const includeDomains = stringArrayArg(ctx.args.include_domains);
  if (includeDomains.length > 0) body.include_domains = includeDomains;

  const excludeDomains = stringArrayArg(ctx.args.exclude_domains);
  if (excludeDomains.length > 0) body.exclude_domains = excludeDomains;

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
  const answer = stringArg(data?.answer);
  const results = Array.isArray(data?.results) ? data.results : [];
  const sections = [];

  if (answer) sections.push(["## Tavily answer", answer].join("\n"));
  if (results.length > 0) {
    sections.push(
      [
        "## Sources",
        ...results.map((result, index) =>
          formatTavilyResult(result, index, body.include_raw_content),
        ),
      ].join("\n\n"),
    );
  }

  return sections.length > 0 ? sections.join("\n\n") : "No Tavily results.";
}

async function runPerplexitySearch(ctx, apiKey, query) {
  const body = {
    model: "sonar",
    messages: [
      {
        role: "system",
        content:
          "Answer with concise, factual web-grounded information. Include citations when available.",
      },
      { role: "user", content: query },
    ],
    max_tokens: clampInteger(ctx.args.max_tokens, 1200, 100, 4000),
    search_mode: pickEnum(ctx.args.search_mode, ["web", "academic", "sec"], "web"),
    stream: false,
  };

  const recency = pickEnum(
    ctx.args.recency,
    ["hour", "day", "week", "month", "year"],
    "",
  );
  if (recency) body.search_recency_filter = recency;

  const response = await fetch(PERPLEXITY_API_URL, {
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
      content: `Perplexity API error ${response.status}: ${detail.slice(0, 2000)}`,
    };
  }

  const data = await response.json();
  const answer = stringArg(data?.choices?.[0]?.message?.content);
  const citations = Array.isArray(data?.citations) ? data.citations : [];
  const citationText = citations.length
    ? ["## Citations", ...citations.map((url, index) => `${index + 1}. ${url}`)].join("\n")
    : "";
  const searchResults = formatPerplexitySearchResults(data?.search_results);

  return ["## Perplexity answer", answer, citationText, searchResults]
    .filter(Boolean)
    .join("\n\n");
}

async function runParallelSearch(ctx, apiKey, query) {
  const objective = stringArg(ctx.args.objective, query);
  const searchQueries = stringArrayArg(ctx.args.search_queries).slice(0, 3);
  if (searchQueries.length === 0) searchQueries.push(query);

  const sourcePolicy = {};
  const includeDomains = stringArrayArg(ctx.args.include_domains);
  if (includeDomains.length > 0) sourcePolicy.include_domains = includeDomains;
  const excludeDomains = stringArrayArg(ctx.args.exclude_domains);
  if (excludeDomains.length > 0) sourcePolicy.exclude_domains = excludeDomains;
  const afterDate = stringArg(ctx.args.after_date);
  if (afterDate) sourcePolicy.after_date = afterDate;

  const advancedSettings = {
    max_results: clampInteger(ctx.args.max_results, 6, 1, 10),
    excerpt_settings: { max_chars_per_result: 1200 },
  };
  if (Object.keys(sourcePolicy).length > 0) {
    advancedSettings.source_policy = sourcePolicy;
  }

  const body = {
    objective,
    search_queries: searchQueries,
    mode: pickEnum(ctx.args.mode, ["basic", "advanced"], "advanced"),
    max_chars_total: clampInteger(ctx.args.max_chars_total, 6000, 1000, 12000),
    advanced_settings: advancedSettings,
  };

  const response = await fetch(PARALLEL_SEARCH_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(body),
    signal: ctx.signal,
  });

  if (!response.ok) {
    const detail = await readResponseBody(response);
    return {
      status: "error",
      content: `Parallel API error ${response.status}: ${detail.slice(0, 2000)}`,
    };
  }

  const data = await response.json();
  const results = Array.isArray(data?.results) ? data.results : [];
  if (results.length === 0) return "No Parallel results.";

  const warnings = Array.isArray(data?.warnings)
    ? data.warnings.map((warning) => stringArg(warning?.message)).filter(Boolean)
    : [];
  const warningText = warnings.length
    ? ["## Warnings", ...warnings.map((warning) => `- ${warning}`)].join("\n")
    : "";

  return ["## Parallel results", ...results.map(formatParallelResult), warningText]
    .filter(Boolean)
    .join("\n\n");
}

async function runSelectedProvider(ctx, provider, apiKey, query) {
  switch (provider.id) {
    case "exa":
      return runExaSearch(ctx, apiKey, query);
    case "tavily":
      return runTavilySearch(ctx, apiKey, query);
    case "parallel":
      return runParallelSearch(ctx, apiKey, query);
    case "perplexity":
      return runPerplexitySearch(ctx, apiKey, query);
    default:
      return { status: "error", content: `Unsupported web search provider: ${provider.id}` };
  }
}

export default function activate(letta) {
  if (!letta.capabilities.tools) return;

  return letta.tools.register({
    name: "web_search",
    description:
      "Search the live web using the first configured provider key (Exa, Tavily, Parallel, or Perplexity), or a provider selected explicitly. Use for current facts, source discovery, news, research papers, companies, or web pages.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The web-search query or research question.",
        },
        provider: {
          type: "string",
          enum: ["auto", "exa", "tavily", "parallel", "perplexity"],
          description:
            "Provider to use. auto picks the first configured key in this order: Exa, Tavily, Parallel, Perplexity. Defaults to auto.",
        },
        max_results: {
          type: "number",
          description: "Number of source results to return, 1-10. Defaults to 5.",
        },
        include_domains: {
          type: "array",
          items: { type: "string" },
          description: "Optional domains to restrict results to, supported by Exa/Tavily/Parallel.",
        },
        exclude_domains: {
          type: "array",
          items: { type: "string" },
          description: "Optional domains to exclude from results, supported by Exa/Tavily/Parallel.",
        },
        search_depth: {
          type: "string",
          enum: ["basic", "advanced"],
          description: "Tavily search depth. Defaults to basic.",
        },
        topic: {
          type: "string",
          enum: ["general", "news", "finance"],
          description: "Tavily topic. Defaults to general.",
        },
        include_answer: {
          type: "boolean",
          description: "Whether Tavily should include a generated answer. Defaults to true.",
        },
        include_raw_content: {
          type: "boolean",
          description:
            "Whether Tavily should include raw source content snippets when available. Defaults to false.",
        },
        category: {
          type: "string",
          enum: ["company", "research paper", "news", "personal site", "financial report", "people"],
          description: "Exa result category to focus the search.",
        },
        exa_type: {
          type: "string",
          enum: ["auto", "instant", "fast", "deep-lite", "deep"],
          description: "Exa search type. Defaults to auto.",
        },
        start_published_date: {
          type: "string",
          description: "Exa ISO date/time. Only results published after this date.",
        },
        end_published_date: {
          type: "string",
          description: "Exa ISO date/time. Only results published before this date.",
        },
        search_mode: {
          type: "string",
          enum: ["web", "academic", "sec"],
          description: "Perplexity search corpus. Defaults to web.",
        },
        recency: {
          type: "string",
          enum: ["hour", "day", "week", "month", "year"],
          description: "Perplexity publication recency filter.",
        },
        max_tokens: {
          type: "number",
          description: "Perplexity maximum answer tokens. Defaults to 1200.",
        },
        objective: {
          type: "string",
          description:
            "Parallel natural-language research goal. Defaults to query when omitted.",
        },
        search_queries: {
          type: "array",
          description:
            "Parallel keyword queries. Defaults to [query] when omitted.",
          items: { type: "string" },
          maxItems: 3,
        },
        mode: {
          type: "string",
          enum: ["basic", "advanced"],
          description: "Parallel search mode. Defaults to advanced.",
        },
        max_chars_total: {
          type: "number",
          description: "Parallel maximum characters across all excerpts. Defaults to 6000.",
        },
        after_date: {
          type: "string",
          description: "Parallel YYYY-MM-DD start date for filtering results.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    requiresApproval: false,
    parallelSafe: true,
    async run(ctx) {
      const query = stringArg(ctx.args.query);
      if (!query) return { status: "error", content: "query is required" };

      const selection = await selectProvider(ctx);
      if (selection.error) return selection.error;

      return runSelectedProvider(ctx, selection.provider, selection.apiKey, query);
    },
  });
}
