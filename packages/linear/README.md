# Linear

A Letta Code mod for reading and updating Linear without a chain of one-ticket tool calls.

It adds batched issue reads, rich issue detail, creates, updates, comments, and relations. Every write tool supports `dry_run: true`; updates and comments can also reject stale work with `expected` state.

## Setup

Install and authenticate the Linear CLI:

```bash
npm install -g @schpet/linear-cli
linear auth login
```

The CLI stores credentials in the system keyring by default. The mod delegates authentication to the CLI and does not read `LINEAR_API_KEY`.

Install the mod and reload Letta Code:

```bash
letta install npm:@letta-ai/linear
```

```text
/reload
```

A workspace with one team is detected automatically. For a multi-team workspace, set the non-secret team key before starting Letta Code:

```bash
LINEAR_TEAM_KEY=ENG letta
```

## Tools

- `linear_search` and `linear_issue`: batched summary or full reads
- `linear_create`: up to 20 issues plus relations using local aliases
- `linear_update` and `linear_comment`: one operation across up to 50 issues
- `linear_relation`: batched `blocks`, `blocked-by`, `related`, and `duplicate` relations

Write tools require approval, execute sequentially, stop on cancellation, and preserve per-item failures. `dry_run` executes no mutations. `expected` guards are checked immediately before each update/comment, but they are best-effort preconditions rather than atomic compare-and-swap operations.

The Linear subprocess receives an allowlisted environment containing only operational values such as paths, locale, temporary directories, and keyring/session access. Letta keys, Linear API keys, cloud credentials, and unrelated agent secrets are not passed through.

## Development

```bash
cd packages/linear
bun test
```
