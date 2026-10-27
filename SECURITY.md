# Security

Inroad is a single-user application for a trusted personal computer. The supported launchers bind to loopback and stamp requests with their real socket address. Pages and internal APIs require a local connection, a local Host header, and browser origin checks. Public tunnels expose only agent APIs authenticated with scoped keys and inbound webhooks authenticated with their URL secret.

Any process or account that can connect to the running loopback server can use the workspace. Run Inroad on a computer you trust. It does not provide user accounts, tenant isolation, or a supported shared/serverless deployment.

## Supported versions

Use the latest published release. Security fixes are shipped there; older releases are not maintained separately.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository when available. Otherwise, contact the maintainer through their GitHub profile to arrange a private report. Do not put credentials, private workspace data, or an exploitable vulnerability in a public issue.

Include the affected version, supported launch command, relevant configuration, prerequisites, reproduction steps, and observed impact. Use synthetic data and revoke any credentials accidentally included in a report.

## Security boundaries

- Keep locality checks, socket stamps, browser origin checks, and public API authentication intact. Headers supplied by a caller cannot establish locality.
- Research URLs are untrusted. Block private addresses at validation and connection time, recheck redirects, and do not forward credentials across origins.
- Configured AI and tool endpoints are selected by the local user. Never redirect authenticated provider requests or silently send an existing key to a changed endpoint.
- Store private data, media, and encrypted key material with owner-only POSIX permissions. Windows relies on the user's profile ACLs. Backups and exports exclude machine credentials.
- Agent scopes and write budgets apply to every call. Inbound data cannot approve outreach or authorize outbound actions.
- Keep Electron sandboxing and context isolation enabled. Shell access and updater IPC are restricted to the application; updates require checksum, version, and signature validation.

CI runs dependency auditing, typechecking, linting, automated tests, a production build, and offline browser workflows. Tagged releases must pass those checks and both Mac packaging jobs before publication. Passing checks reduces risk; it does not establish that software has no vulnerabilities.
