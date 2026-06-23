---
name: "@letta-ai/web-search"
description: "Provider-backed web_search tool using Letta Code agent-scoped secrets."
---

# Web search mod semantics

## When to use

Use this package when an agent needs live web search, current facts, source discovery, news, research papers, company pages, or web-grounded answers.

## Tool

This package registers one tool:

- `web_search` - searches the live web using the first configured provider key, or an explicitly selected provider.

## Secret behavior

The tool reads provider keys at invocation time with:

```ts
await ctx.secret("PROVIDER_API_KEY", { envFallback: true })
```

Supported keys:

- `EXA_API_KEY`
- `TAVILY_API_KEY`
- `PARALLEL_API_KEY`
- `PERPLEXITY_API_KEY`

Resolution order for each key:

1. agent-scoped `/secret` store
2. matching `process.env` variable

Auto provider selection checks keys in this order: Exa, Tavily, Parallel, Perplexity. If no provider key is configured, the tool returns a normal error result with instructions to run `/secret set ... <value>`.

Do not hardcode API keys or import private Letta Code secret internals.

## Provider guidance

- Use `provider: "exa"` for ranked source discovery, research, companies, news, pages, and results with text/highlights.
- Use `provider: "tavily"` for concise web answers plus ranked source results.
- Use `provider: "perplexity"` for concise web-grounded answers with citations.
- Use `provider: "parallel"` for LLM-optimized excerpts from targeted queries.
- Use `provider: "auto"` when any configured provider is acceptable.

## Behavior

- The tool is a read-only network call and is marked `parallelSafe: true`.
- Queries are sent to the selected third-party provider.
- The package uses `fetch`; it has no provider SDK dependencies.
- The tool should return setup/API errors as tool error results, not throw for expected missing configuration.

## Adaptation notes for agents

- Keep secret access inside tool invocation context only.
- If the user wants approval before network calls, set `requiresApproval: true` in the tool registration.
