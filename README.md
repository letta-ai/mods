# Letta Code Mods

Official package source and public ecosystem curation for [Letta Code](https://github.com/letta-ai/letta-code) mods.

Mods are executable local code that can add tools, slash commands, lifecycle events, permissions, providers, and UI surfaces to the Letta agent harness.

> [!WARNING]
> Mods run with the full permissions of the Letta Code process. Review package source and publisher provenance before installing any mod, including packages shown in the catalog.

## Install a mod

Published packages install through Letta Code:

```bash
letta install npm:@letta-ai/plan-mode
```

Community packages use the same command with the publisher's npm package name:

```bash
letta install npm:@publisher/package
```

Git repositories are also supported:

```bash
letta install git:github.com/publisher/repository
```

Run `/reload` after installation.

## Package discovery and ownership

The [mods catalog](https://www.letta.com/agent/mods) discovers npm packages tagged with the `letta-package` keyword and GitHub repositories tagged with supported Letta mod topics. Package source does not need to live in this repository to appear in the catalog.

Catalog labels have separate meanings:

- **Official** packages are published and maintained by Letta.
- **Community** packages are published and maintained by their authors.
- **Featured** packages are selected by Letta for additional visibility. Featured is an editorial signal, not a security audit or ownership claim.

New community mods should live in author-owned repositories and npm scopes. New package source is accepted into this repository only when Letta explicitly adopts the package and commits to maintaining it. Existing packages are being evaluated under this policy separately from this repository foundation work.

## Featured packages

[`catalog/featured.json`](catalog/featured.json) is the public source of truth for featured catalog placement. It contains typed npm-package or GitHub-repository sources in display order. Catalog consumers overlay this list on top of normal registry and topic discovery.

A featured package may be official or community-maintained. The website should preserve the ownership label independently from the Featured badge.

Changes to the featured list are reviewed like code changes. See [CONTRIBUTING.md](CONTRIBUTING.md) for nomination criteria.

## Repository structure

```text
catalog/
└── featured.json          # Public featured-package curation
packages/
└── <package>/             # Letta-published mod package source
scripts/
├── validate-featured.mjs  # Featured-list schema validation
└── validate-manifests.mjs # Package manifest validation
```

The duplicated hand-maintained package indexes that previously lived in this README were removed. Package metadata belongs in each package's `package.json`, while the catalog is generated from registry metadata.

## Mod package format

A published mod package should include:

```text
package.json  # npm metadata and package.json#letta manifest
README.md     # user-facing documentation
MOD.md        # agent-facing semantics and adaptation notes
mods/         # implementation files declared by package.json#letta
```

Example manifest:

```json
{
  "name": "@publisher/example-mod",
  "keywords": ["letta-package", "letta-mod"],
  "letta": {
    "manifestVersion": 1,
    "mods": ["./mods/index.ts"],
    "capabilities": ["commands"]
  }
}
```

`README.md` is for people browsing GitHub, npm, or the catalog. `MOD.md` helps agents inspect package behavior, safety assumptions, and adaptation points.

## Development

Clone the repository and run its validation suite:

```bash
git clone https://github.com/letta-ai/mods.git
cd mods
npm run validate
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before proposing package source or featured-list changes.

## Recovery

If a mod breaks startup or command handling, start Letta Code with mods disabled:

```bash
letta --no-mods
# or
LETTA_DISABLE_MODS=1 letta
```

Then remove or repair the package and run `/reload`.

Security vulnerabilities should be reported privately according to [SECURITY.md](SECURITY.md).

## Links

- [Letta Code](https://github.com/letta-ai/letta-code)
- [Letta Code documentation](https://docs.letta.com/letta-code)
- [Mods catalog](https://www.letta.com/agent/mods)
- [Letta skills repository](https://github.com/letta-ai/skills)
