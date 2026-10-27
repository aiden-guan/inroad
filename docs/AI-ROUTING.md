# AI connections and task routing

Open **Settings → General → AI connections and task routing**. Add as many connections as needed, including several accounts at the same provider. Each has its own name, encrypted/keychain credential, endpoint, model catalog, prices, tier models, and automatic-routing preferences. The original provider setup remains available. Saving a connection never runs paid inference; Cloudflare configurations are saved without a token verification call.

Choose a default connection and optionally a connection/model for each workflow. Ask also has a **Model** selector for an individual message. API clients can pass `route: { connectionId, model? }` alongside `workflow` and `args` to `POST /api/runs`. The model must belong to the connection's saved catalog or configured models. Explicit unavailable routes fail with an actionable error.

Resolution order:

1. A model selected for this run/message.
2. A saved task selection.
3. Automatic routing, when enabled.
4. The default connection.

Automatic routing considers enabled, eligible connections and their configured tier models. Reasoning tasks use the strategist tier; research and writing use operator; classification/extraction use fast. A discovered smaller sibling can fill the fast tier. Connection preferences identify research, writing, reasoning, and fast-task strengths. Set the tier models to reflect your own quality evaluations. This is a deterministic fit heuristic, not a benchmark or a claim that one vendor is universally best.

**Task fit** prioritizes strengths and tier configuration. **Balanced** uses known input/output prices to break fit ties. **Lowest known cost** prefers the lowest known price. Unknown prices are never treated as free. A configured context window excludes an automatic candidate when a conservative prompt estimate plus output allowance exceeds it; unknown context limits remain unverified. Explicit selections bypass that estimate. Context limits do not guarantee all future tool results fit.

The work log names the selected connection/model and routing reason. Receipts report serving model IDs returned by the provider. Routing stays fixed during each agent loop, including tool calls and retries. Inroad does not silently rerun a tool sequence at another provider. Gateway-side policies can still select upstream providers/models; configure these deliberately in the gateway dashboard.

## Vercel AI Gateway

Select **Vercel AI Gateway**, provide an AI Gateway API key (or `AI_GATEWAY_API_KEY` on the server), and save. Inroad uses the documented `https://ai-gateway.vercel.sh/v1` base, Bearer authentication, `GET /models`, and streaming `POST /chat/completions` with normal tool calling. Model IDs retain their `provider/model` prefix. Saving again refreshes the catalog. Configure BYOK, upstream provider policies, and billing in Vercel.

Published per-token prices are imported when returned by a catalog, including prompt/completion or input/output fields and cache-read rates; absent prices remain unknown. Enter per-million input/output rates in the connection editor to account for a default model whose catalog omits rates. The API also accepts a `prices` map for tier and upstream models. Receipts use the actual served model's known price. An unpriced fallback remains unpriced instead of borrowing the requested alias's rate. Gateway fees or upstream discounts may differ from these estimates; gateway billing is authoritative.

Official reference: [Chat Completions and model catalog](https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions).

## Cloudflare AI Gateway

Select **Cloudflare AI Gateway** and enter:

- A Cloudflare account ID (32 hex characters).
- A gateway slug, such as `default`.
- An account API token with **Account → Workers AI → Read**, or `CLOUDFLARE_API_TOKEN` on the server. A token with only AI Gateway management permissions is insufficient for account inference.
- A canonical chat model ID from [Cloudflare's model catalog](https://developers.cloudflare.com/ai/models/). Third-party models use `author/model`; Workers AI models use `@cf/author/model`.

Inroad uses the current account REST base `https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1`, Bearer authentication, streaming Chat Completions, and `cf-aig-gateway-id`. It does not probe an undocumented `/models` endpoint or validate a token by charging for inference. Enable the necessary credits/billing and upstream credentials in Cloudflare before running a task.

Optionally enter an existing **dynamic route name**. Inroad sends `dynamic/route-name` to the same account REST endpoint and explicitly scopes it to the selected gateway. Enable gateway authentication and store upstream keys through Cloudflare BYOK. The gateway owns dynamic routing/fallback policy; app-level tier/model overrides do not replace the named route.

Requests bypass Cloudflare response caching (`cf-aig-skip-cache: true`) to keep agent tool sequences fresh. Gateway request-log collection defaults off (`cf-aig-collect-log: false`) and can be enabled in the editor. These controls apply to Cloudflare gateway features; upstream providers maintain their own retention policies. No prompts or keys are sent as extra routing metadata.

Official references: [account REST API, permissions, and headers](https://developers.cloudflare.com/ai-gateway/usage/rest-api/), [dynamic routes](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/usage/).

## Compatibility and credentials

Anthropic uses its native SDK; other connections use the existing Chat Completions adapter. Local Ollama and custom HTTPS/loopback endpoints remain supported. Keys stay in the OS credential store or the machine-local encrypted key file, keyed by connection ID. They never appear in configuration responses or workspace backups. Changing a saved connection's endpoint/account requires entering its key again. HTTP redirects are rejected on authenticated compatibility API calls.

Search providers and browser automation remain separate settings. Native Anthropic web search uses the default Anthropic connection as an explicitly chosen source. Gateway models use the independent web-search/read tools, so configure a search provider for their research tasks. Studio image generation retains its separate image-provider configuration.

Delete a connection to remove its credential and task/default references. Saved settings are machine-local. In-flight work already holding a credential finishes against its original connection. Changes apply to subsequent agent calls.
