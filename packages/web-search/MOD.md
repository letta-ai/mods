---
name: "@letta-ai/web-search"
description: "Tavily-backed web search tool using Letta Code agent-scoped secrets."
---

# Web search mod semantics

## When to use

Use this package when an agent needs live web search, current facts, source discovery, news, research papers, company pages, or web-grounded answers.

## Tool

This package registers one tool:

- `web_search` - searches the live web with Tavily and returns a concise answer plus ranked source results.

## Secret behavior

The tool reads `TAVILY_API_KEY` at invocation time with:

```ts
await ctx.secret("TAVILY_API_KEY", { envFallback: true })
```

Resolution order:

1. agent-scoped `/secret` store
2. `process.env.TAVILY_API_KEY`

If neither source is configured, the tool returns a normal error result with instructions to run:

```text
/secret set TAVILY_API_KEY <value>
```

Do not hardcode API keys or import private Letta Code secret internals.

## Behavior

- The tool is a read-only network call and is marked `parallelSafe: true`.
- Queries are sent to Tavily.
- The package uses `fetch`; it has no provider SDK dependencies.
- The tool should return setup/API errors as tool error results, not throw for expected missing configuration.

## Adaptation notes for agents

- Keep the public tool name generic (`web_search`) unless adding additional provider-specific tools.
- Keep secret access inside tool invocation context only.
- If the user wants approval before network calls, set `requiresApproval: true` in the tool registration.
