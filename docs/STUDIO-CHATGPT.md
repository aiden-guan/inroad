# ChatGPT image generation in Studio

Inroad can use a ChatGPT subscription for image generation through the local, official Codex app-server. This is a local application integration, not a hosted service or an implementation of the separate Sign in with ChatGPT token-sharing API. That API currently excludes image generation.

Official references: [Codex authentication](https://learn.chatgpt.com/docs/app-server#auth-endpoints), [built-in image generation](https://learn.chatgpt.com/docs/image-generation), [token-sharing limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

## Use it

1. Install a recent ChatGPT desktop app or Codex CLI that supports built-in image generation.
2. Open Studio → Graphics, choose a saved message, then select AI image → ChatGPT plan.
3. Select Connect ChatGPT. Inroad uses an existing local Codex ChatGPT sign-in when available. Otherwise, follow Continue to ChatGPT to finish the official browser sign-in.
4. Add visual direction and select Generate image in ChatGPT. The image is saved in Studio, selected for reuse, and available through Download image.

The direct image action prepares its brief in code and makes no prompt-writing, layout, review or Images API call. It consumes the ChatGPT plan's allowance, whose availability and limits depend on the account and workspace. It does not consume or reserve Inroad's API dollar budget. There is no fallback to an API key.

Design 2 graphics is a separate action for checked typography and composition. Those layout and review steps require the selected AI provider. The OpenAI API image route remains an explicit alternative with its own key and billing.

## Account and runtime boundaries

- Codex owns OAuth, token storage and refresh. Inroad never copies tokens or reads browser cookies. The connection response exposes only connected/pending state, the plan and an official browser sign-in URL.
- `chatgpt-connection.json` in the local data directory stores permission to use a shared or private Codex sign-in. It contains no credentials and is excluded from workspace exports/backups.
- New sign-ins use a private Codex home at `<data>/chatgpt-auth`, outside workspace exports/backups. Disconnect signs out that private session. For a shared sign-in, Disconnect revokes Inroad's permission and leaves other Codex clients signed in.
- Connection routes are protected by the existing same-computer and same-origin proxy checks. External agent endpoints do not expose login operations.
- The runtime is found in the ChatGPT/Codex app or on PATH. An absolute `INROAD_CODEX_PATH` can select a local executable. A capability check rejects runtimes without built-in image generation.
- Image jobs run in a temporary working directory with shell, plugins, hooks, MCP, web search and child agents disabled. Additional runtime tool/permission requests are rejected. API credentials are removed from the child environment; an API-key account is rejected before inference.
- Only one image job runs at a time. Stop, disconnect and the ten-minute image timeout terminate the job; RPC requests have their own shorter timeout. Temporary job files are removed afterward.
- Results must be completed image-generation items and a completed turn, followed by PNG and dimension validation. Missing output, plan limits and failed turns are errors. Generated files retain AI attribution and cannot stand in for real product screenshots.

## Verification on October 28, 2026

- The standard unit suite passed 1,282 tests; its live test is opt-in and skipped in CI. Auth reuse, private sign-in, cancellation, plan limits, credential stripping, zero-API image work and API-budget separation have mock/protocol coverage.
- The full browser suite passed 54 tests, including connection, generation, downloads and mobile layout. The keyless connection/download scenario was also run separately after final UI refinements.
- A separate live test returned a real PNG through Codex `0.165.0-alpha.1.2` with a ChatGPT sign-in and no API-key credentials.
- The production UI also connected and generated a real 1730×909 PNG with both the primary AI provider and OpenAI image key unavailable. Studio saved it with `source: chatgpt`, the browser downloaded it, and API spend stayed unchanged.
- Fresh-account browser sign-in and exhausted real-account quotas were not exercised against a live account; they have protocol coverage. Local success does not guarantee entitlement or availability for every plan or runtime version.
