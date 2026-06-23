# Web Search

A Letta Code mod package that adds a provider-backed `web_search` tool.

The tool reads API keys through Letta Code's agent-scoped secret API, with process environment fallback for local development. This means it works with `/secret set ... <value>` and does not require hardcoding API keys in the mod.

## Requirements

- Letta Code `>=0.27.16`
- At least one provider API key

## Install

```bash
letta install npm:@letta-ai/web-search
```

Run `/reload` in active sessions after installing.

## Configure

Recommended, agent-scoped:

```text
/secret set EXA_API_KEY <value>
/secret set TAVILY_API_KEY <value>
/secret set PARALLEL_API_KEY <value>
/secret set PERPLEXITY_API_KEY <value>
```

Environment fallback is also supported if keys are present when Letta Code starts:

```bash
export EXA_API_KEY=...
export TAVILY_API_KEY=...
export PARALLEL_API_KEY=...
export PERPLEXITY_API_KEY=...
letta
```

You only need to configure the providers you want to use. If no provider is configured, the tool returns a setup error telling the agent/user how to add a key.

## Tool

- `web_search` searches the live web using the first configured provider key, or an explicitly selected provider.

Provider selection defaults to `auto`, which checks keys in this order:

1. `EXA_API_KEY`
2. `TAVILY_API_KEY`
3. `PARALLEL_API_KEY`
4. `PERPLEXITY_API_KEY`

Pass `provider: "exa" | "tavily" | "parallel" | "perplexity"` to force a provider.

## Privacy

Search queries are sent to the selected third-party provider. Review provider terms and avoid sending sensitive data unless appropriate.

## Safety

Mods are trusted local code. Review the source before installing third-party mods.

If a mod breaks startup or command handling, recover with:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

See [`MOD.md`](./MOD.md) for the agent-facing behavioral contract.
