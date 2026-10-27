# Security and functionality review, 2026-10-27

This review started at `4d2e2b2` and produced the v0.2.5 update. It combined source review of security boundaries, dependency and secret scans, regression tests, browser workflows, a production build, and HTTP smoke checks. Dedicated Codex Security scan tooling was unavailable; this is a manual review record, not a generated Codex Security scan or a claim of exhaustive vulnerability detection.

## Findings addressed

| Area | Evidence and impact | Change |
| --- | --- | --- |
| Dependencies | npm audit reported two high and two moderate affected packages: Electron, Undici, Vitest and its mocker. Electron is part of the distributed runtime even though it is a development dependency here. | Pin Electron 44.10.0, Undici 7.30.1 and Vitest 4.1.12; audit all dependency classes in CI. The updated dependency audit reports zero known vulnerabilities. |
| Private media on disk | Studio used umask-dependent writes. In a traversable shared data directory, other local accounts could read uploaded screenshots and generated graphics. Startup migration did not recognize Studio or encrypted AI key files. New AI key writes were already owner-only. | Reuse atomic owner-only writes; migrate Studio and the exact AI key file names, including temporary/corrupt copies. Preserve unrelated files, shared root permissions and symlink non-traversal. |
| Public upload limits | Authenticated MCP, REST and webhook readers counted JavaScript characters after buffering. Multibyte uploads could exceed the advertised 1 MB cap. Next Proxy also buffered these requests before their route handlers. | Enforce actual UTF-8 byte limits while reading and cancel oversized streams. Exclude only the already-public routes from Proxy matching. Their handlers still authenticate before reading; internal key management stays protected. |
| Research redirects | The manual redirect loop resent custom headers, including a GitHub bearer token, on another origin. Exploitation requires the initial API response to redirect to an attacker-controlled public endpoint. | Drop custom headers permanently after any origin change, including HTTPS downgrades; preserve same-origin API redirects and unauthenticated public-site redirects. Retain destination and connect-time SSRF checks. |
| Studio provider redirects | Native fetch strips a cross-origin bearer token, but a 307 can still replay private image prompt data at another endpoint. | Reject redirects on both Studio provider calls. Configured gateways remain supported directly. |
| Browser framing | Local pages could be embedded by another site, exposing controls to clickjacking. | Send `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, and a no-referrer policy. |
| Release validation | Mac publishing previously depended only on packaging. | Require the reusable CI suite and both Mac packages before publishing, inheriting configured evaluation secrets. |
| Runtime correctness | Browser runs exposed duplicate orb transition names during responsive layout updates. Two permission tests also assumed a permissive host umask. | Give desktop and phone transitions distinct shared names; assert against transition errors in the existing responsive browser workflow. Set explicit legacy fixture permissions. |

## Coverage and verification

- Reviewed the launcher/socket stamp, Host and forwarding checks, browser origin checks, public route exemptions, agent authentication/scopes/rate limits, inbound webhook secrets, outbound webhook signing, and connector redirect policies.
- Reviewed private JSON/media persistence, encrypted/keychain credential storage, backup credential exclusions and restore suppression handling, research URL/DNS/redirect protections, SVG sanitization and download restrictions, Electron isolation/IPC/navigation, and updater checksum/signature/version controls.
- Gitleaks 8.30.1 inspected all 162 available Git commits and a snapshot of tracked current source. Its five history and six current-source alerts were manually classified: import names, an activity-name enum, an intentionally invalid test key and test filenames. No actual exposed credential was identified. Scanner reports were redacted; history was not rewritten.
- The full unit/integration suite passed 1,226 tests in 120 files; a subsequently added endpoint integration file passed three additional tests. The final focused security run passed 132 tests, including the updated proxy matcher and the new endpoint integration file.
- All 30 offline Chromium workflows passed before the animation correction. Release validation reruns the full browser suite, including onboarding's shared transition and responsive error assertions.
- Typechecking, ESLint, the production build, actionlint and whitespace checks passed. The mock critic/classifier evaluation harness passed; mock quality scores are not evidence of real-model quality.
- Production HTTP smoke checks passed startup, core pages, security headers, hostile Host and forwarding headers, cross-origin write rejection, unauthenticated public endpoint rejection, authenticated MCP ping, and a chunked upload rejected with HTTP 413 before the client sent EOF.

The release workflow repeats dependency auditing, typechecking, linting, unit/integration tests, offline browser tests and production building on GitHub, then builds both Mac architectures and opens the Apple silicon app before publication. Those remote results are recorded in GitHub Actions rather than predicted here.

## Limits and operating assumptions

Inroad still trusts its host computer: any local account/process able to connect to its running loopback server can use the workspace. POSIX file modes do not replace Windows profile ACLs. A shared multi-user or serverless deployment is not supported.

Live AI/search/CRM/tunnel services were not called during the local review, and local Linux checks cannot validate macOS signing, notarization or native app launch. Configured live evaluation gates run in CI when their repository secret exists. Dependency advisories and source review cannot prove the absence of unknown vulnerabilities; the new security policy documents the supported boundaries and reporting process.
