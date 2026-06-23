# Web Search

A Letta Code mod package that adds a Tavily-backed `web_search` tool.

The tool reads `TAVILY_API_KEY` through Letta Code's agent-scoped secret API, with process environment fallback for local development. This means it works with `/secret set TAVILY_API_KEY <value>` and does not require hardcoding API keys in the mod.

## Requirements

- Letta Code `>=0.27.16`
- A Tavily API key

## Install

```bash
letta install npm:@letta-ai/web-search
```

Run `/reload` in active sessions after installing.

## Configure

Recommended, agent-scoped:

```text
/secret set TAVILY_API_KEY <value>
```

Environment fallback is also supported if the key is present when Letta Code starts:

```bash
export TAVILY_API_KEY=...
letta
```

If neither source is configured, the tool returns a setup error telling the agent/user how to add the key.

## Tool

- `web_search` searches the live web with Tavily and returns a concise answer plus ranked source results.

Supported options include search depth, topic, max result count, domain include/exclude filters, and whether to include Tavily's generated answer or raw source content.

## Privacy

Search queries are sent to Tavily. Review Tavily's terms and avoid sending sensitive data unless appropriate.

## Safety

Mods are trusted local code. Review the source before installing third-party mods.

If a mod breaks startup or command handling, recover with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

See [`MOD.md`](./MOD.md) for the agent-facing behavioral contract.
