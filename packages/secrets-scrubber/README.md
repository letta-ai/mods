# Secrets scrubber

Redacts detected credentials from Letta Code tool results before those results enter conversation history.

The mod uses [`@sanity-labs/secret-scan`](https://github.com/sanity-io/secret-scan), a local scanner with more than 1,100 TruffleHog-derived rules. It covers common provider keys, bearer tokens, JWTs, private keys, and credential-bearing connection strings. Narrow contextual rules also cover generic password, token, API-key, secret assignments, and common authorization headers. No tool output is sent to a remote scanning service.

## Install

```bash
letta install npm:@letta-ai/secrets-scrubber
```

Then run `/reload` in active sessions.

## Behavior

The package registers a `tool_end` event handler. For every string tool result, it:

1. scans the returned text for known secret patterns;
2. replaces each match with a labeled marker such as `[REDACTED: Github V2]`;
3. preserves the tool's original success or error status;
4. returns clean output unchanged.

Letta Code can place large tool output in an immutable overflow file and return a breadcrumb instead of all bytes inline. The mod recognizes Letta Code's exact breadcrumb format and scrubs the file when its path matches the known harness-owned location and filename shape.

Background log files are different because the public mod API cannot prove that every writer has closed them. The mod never rewrites `bash_<n>.log` or `task_<n>.log`, including when those paths appear in Bash, Task, Monitor, or Workflow output. It still redacts inline background tool results handled through `tool_end`, including launch and status results.

File replacement is atomic. The mod rejects symlinks, unexpected paths, changed files, and unknown filename shapes rather than following arbitrary paths from tool output.

If scanning throws or a referenced harness output file cannot be safely inspected, the mod fails closed: the tool result is replaced with a withholding notice and an error is added to mod diagnostics.

## Scope and limitations

- This protects **tool results entering conversation history**. It does not scan user messages, model responses, tool arguments, environment variables, or history that already exists.
- Live terminal output may be displayed while a tool runs, before the final `tool_end` event. This mod is not a terminal-screen masking layer.
- Secret detection is pattern-based. It can have false positives and false negatives, especially for credentials with no provider-specific structure.
- Immutable overflow files are scrubbed only when Letta Code itself returns a recognized breadcrumb and the path passes the strict harness-path allowlist. The mod does not crawl the filesystem.
- Letta Code uses first-result-wins semantics for `tool_end` replacements. Install this package before other mods that replace tool results so redaction runs first; otherwise an earlier replacement can shadow it.
- Background log files can contain raw secrets on disk. They remain unchanged because the public mod API does not provide a reliable signal that all writers have closed the file. Inline background tool results handled through `tool_end` are still redacted before they enter conversation history. Completion notifications delivered as messages are outside this mod's scope.

This is defense in depth, not a substitute for least-privilege credentials, short-lived tokens, or keeping secrets out of commands when possible.

## Verify

```bash
letta mods list
```

Run a controlled test with a disposable credential-shaped fixture, not a real key:

```bash
printf '%s\n' 'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJ'
```

The tool result should contain a redaction marker rather than the fixture.

## Development

```bash
npm install
bun test
bunx tsc --noEmit
```

## License

MIT. The detector rules are derived from TruffleHog and retain their upstream Apache-2.0 licensing.
