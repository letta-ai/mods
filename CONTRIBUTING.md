# Contributing

## Community packages

Community mod authors retain ownership of their source and publication. Create the package in an author-owned repository, publish it under an author-owned npm name, and include the `letta-package` keyword for catalog discovery.

A minimal package manifest looks like this:

```json
{
  "name": "@publisher/example-mod",
  "keywords": ["letta-package", "letta-mod"],
  "letta": {
    "manifestVersion": 1,
    "mods": ["./mods/index.ts"],
    "capabilities": ["tools"]
  }
}
```

Users can install the npm package directly:

```bash
letta install npm:@publisher/example-mod
```

Git-only packages remain installable with `letta install git:github.com/publisher/repository`. Add the `letta-package` or `letta-mode` topic and a valid `package.json#letta` manifest for automatic GitHub discovery.

## Official package adoption

Adding package source to this repository means Letta is adopting the package as official software rather than only listing it in the ecosystem catalog. Official adoption is exceptional and requires:

- broad usefulness beyond one person's workflow
- an active Letta maintainer
- clear behavior, configuration, and recovery documentation
- tests appropriate to the package's behavior and risk
- focused, inspectable implementation
- explicit security review for permissions, secrets, subprocesses, network access, or filesystem mutation
- publication under the `@letta-ai` npm scope
- an ongoing maintenance commitment

A community package does not need official adoption to be discovered or featured.

## Featured package nominations

[`catalog/featured.json`](catalog/featured.json) is an ordered list of typed npm-package and GitHub-repository sources selected for additional visibility in catalog surfaces.

A Featured badge means Letta selected the package as useful or noteworthy. It does not mean that every release was security-audited, that Letta owns the package, or that the package receives official support.

A featured-list pull request should explain:

- why the package is broadly useful
- who publishes and maintains it
- where its source is hosted
- what permissions and external services it uses
- how it was tested in Letta Code

The source must already be discoverable by the catalog and contain a valid Letta manifest. Keep `catalog/featured.json` limited to source identity; descriptions, authors, versions, media, and install commands come from registry or repository metadata.

## Package changes

Each package includes:

- `package.json` with npm metadata and a `letta` manifest
- `README.md` for users
- `MOD.md` for agent-facing semantics and adaptation notes
- implementation files declared by `letta.mods`

Before opening a pull request, run:

```bash
npm run validate
```

Package-specific tests and checks should also pass. Pull requests should describe runtime capabilities, security boundaries, external dependencies, configuration, recovery behavior, and validation performed.

## Security reports

Please follow [SECURITY.md](SECURITY.md) rather than opening a public issue for a vulnerability.
