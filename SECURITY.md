# Security Policy

## Mod security model

Mods are executable local code. They run with the permissions of the Letta Code process and may read or modify files, access environment variables, make network requests, launch subprocesses, intercept runtime events, or alter tool behavior.

The mods catalog is a discovery surface, not a sandbox or security review. Official, Community, and Featured labels describe ownership or editorial selection; none removes the need to inspect source and publisher provenance before installation.

Use operating-system isolation when a mod should not have access to the full host environment.

## Reporting a vulnerability

Please email support@letta.com with a description of the vulnerability, steps to reproduce, the affected package and version, and any relevant details.

Please do not open a public issue for security vulnerabilities.

We will acknowledge receipt within 48 hours and aim to provide a fix or mitigation timeline within 7 days.

## Supported versions

Security fixes for official packages are applied to the latest published version. Community package support and disclosure processes are owned by each package publisher.
