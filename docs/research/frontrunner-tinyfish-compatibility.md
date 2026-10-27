# What Inroad can learn from Frontrunner and TinyFish

Research date: October 26, 2026. Based on public product pages, official developer documentation, and inspection of this repository. This is a product and implementation assessment, not an audit of either company's private infrastructure or customer results.

## Recommendation

Make Inroad the place where a founder's existing tools share useful context. Keep their CRM, sequencer, research vendor, and model provider interchangeable. Build a common contract for each capability rather than requiring everyone to move to one vendor.

The first change in this working tree makes web search independent of the model: DeepSeek, TinyFish, Tavily, Exa, Brave Search, Firecrawl, and a custom search adapter all feed the same research and citation pipeline. This addresses the concrete dependency the code had: non-Anthropic models could search only through Firecrawl.

The follow-on implementation adds a Research workspace, mapped MCP/OpenAPI connections, import previews, saved monitors, optional browser extraction and outcome reporting. See [the Research guide](../RESEARCH.md) for the supported scope and operational details.

## How the companies operate

### Frontrunner: context and workflows across a GTM stack

Frontrunner markets a GTM agent platform that connects existing systems, tracks business signals, runs reusable workflows, and relates activity to pipeline. Its public examples cover account research, inbound routing, meeting preparation, leadership changes, renewals, and dormant opportunities. It advertises multiple models and agents rather than a single required model. [Product site](https://usefr.com/)

Its founders describe ingesting CRM, email, calendar, product, and call-recording data into connected account, person, conversation, and signal context. Agents then research, enrich, prioritize, and hand actions to people. That shared context is the interesting mechanism: later work can use what earlier work learned. [Founder explanation on Y Combinator](https://www.ycombinator.com/companies/frontrunner)

**Implication for Inroad:** sell continuity across tools and a useful next action. Inroad already has accounts, people, deals, activities, a playbook, research receipts, and an approval queue; it does not need a new graph database to start applying this idea. Improve how those existing records connect and retain the source and date of each important fact.

Frontrunner's advertised customer improvements are vendor claims, not evidence of what Inroad would achieve. I did not verify a public pricing contract or detailed production API specification for Frontrunner. The similarly rendered `/docs` and `/developers` pages are not enough to promise direct API compatibility.

### TinyFish: web capabilities delivered as infrastructure

TinyFish separates search, page retrieval, browser sessions, multi-step web agents, monitoring, and research into distinct APIs. Its documentation describes shared authentication and structured results. This lets another product consume web capabilities without rebuilding a browser automation service. [API overview](https://docs.tinyfish.ai/)

It also distributes capabilities through MCP, SDKs, a CLI, and workflow integrations. Its MCP documentation describes connecting assistants to its web tools. [MCP integration](https://docs.tinyfish.ai/mcp-integration)

TinyFish agents support a requested output schema, with a documented subset of JSON Schema. An integration still needs to validate the returned facts; a valid JSON object alone does not prove the facts are correct. [Structured output](https://docs.tinyfish.ai/key-concepts/structured-output)

Its pricing page describes usage-based Agent and Browser charges and free Search and Fetch within published limits, plus enterprise arrangements. The Search reference also describes daily-allowance and wallet exhaustion errors. Treat the account's actual allowance as authoritative rather than promising unlimited free searches. [Pricing](https://www.tinyfish.ai/pricing), [Search reference](https://docs.tinyfish.ai/search-api/reference)

**Implication for Inroad:** integrate the inexpensive, narrowly scoped capability first. Use browser execution only when a normal fetch cannot retrieve the required information, and keep that an explicit escalation with a run budget.

## Features worth adopting and improving

These are recommendations, not claims that either competitor lacks the proposed improvements.

| Pattern | Benefit to an Inroad user | How to improve it in Inroad | Status |
| --- | --- | --- | --- |
| Bring an existing model and search provider | Users keep their subscriptions, preferences, and local models | Pick the model and search separately; maintain the same citations and approval flow across combinations | Search layer implemented here; model selection already existed |
| Shared account and relationship context | Less repeated research and fewer contradictory drafts | Attach source, observation date, provider, and confidence to important facts; show conflicting evidence | Existing workspace is the base; richer fact provenance is future work |
| Reusable GTM recipes | Less prompt writing and faster repeat work | Start with leadership changes, dormant-deal revival, and meeting prep; preview inputs, credit use, and proposed changes | Implemented as editable monitor recipes; qualification and dossier workflows remain separate actions |
| Scheduled signal monitoring | Find a reason to act at the right time | Alert on a meaningful change, suppress duplicates, distinguish "no change" from "lookup failed," and catch up after the computer wakes | Implemented topic/page monitors with persistent leases and failure recovery |
| One capability across API, MCP, and automation tools | Users can keep their preferred orchestration tool | Use the same schema and validation behind each surface; supply tested examples and connection diagnostics | Inroad already does this for its external agent tools; extend it |
| Browser-based extraction | Reach information hidden behind client-side navigation | Add an optional read-only browser adapter with structured outputs, evidence, time limits, and cancellation | Implemented optional isolated TinyFish browser reads; general Agent automation is not enabled |
| Learn from outcomes | Improve prioritization using actual results | Compare qualified replies, meetings, and wins by signal; include sample sizes and avoid claiming attribution is causation | Implemented provider associations and raw outcome counts; no causal lift is claimed |

## Compatibility: what exists and what still needs work

"Anyone can plug in any previous tool" is a useful direction, but not a literal protocol guarantee. A tool must expose an API, MCP server/client, webhook, or usable export, or require a specific adapter. Closed applications and proprietary formats cannot be connected just by accepting their API key.

| Existing tool or service | Inroad connection today | Remaining work |
| --- | --- | --- |
| DeepSeek and other supported model providers | Existing AI provider settings; OpenAI-compatible Chat Completions adapter for non-Anthropic models | Tool-capable model required; different models can produce different quality |
| DeepSeek, TinyFish, Tavily, Exa, Brave, Firecrawl search | Native search adapters added in this change | User saves a key or configures the documented environment variable; paid account behavior needs a live check |
| Another search provider or an internal search service | Custom HTTP search contract added in this change | A small adapter translates that service's request and response format |
| Claude Code, Cursor, or another compatible MCP client | Existing authenticated Inroad MCP server at `/api/mcp` | Connection instructions and transport compatibility still matter |
| A third-party MCP server whose tools Inroad should call | Outbound MCP client added | HTTP transport, declared read-only tools, mapped capabilities and session handling; stdio and automatic OAuth enrollment are not supported |
| Zapier, n8n, Make, Clay, and API-capable tools | Existing REST mirror, inbound hooks, outbound events, and generated OpenAPI schema | n8n templates, mapping previews and connection examples added; middleware plan requirements may apply |
| HubSpot, Attio, Instantly, Smartlead, lemlist, Slack, Calendly, Cal.com | Existing native connectors | Other CRMs and sequencers need adapters or middleware |
| Historical data in spreadsheets and exports | Existing import workflows | Salesforce, Pipedrive and Attio presets added, with JSON mapping profiles and opt-out handling |
| A tool with no integration or export surface | Optional isolated browser extraction | Read-only public page extraction; arbitrary UI workflows are not supported |

An MCP **server** exposes Inroad to other assistants. The new outbound MCP **client** lets Inroad use mapped reads from supported HTTP servers. Transport, credentials and the service’s available operations still determine compatibility.

Repository evidence: `src/lib/ai/providers.ts`, `src/lib/ai/openai-compat.ts`, `src/lib/connectors/catalog.ts`, `src/lib/api-keys/mcp.ts`, `src/lib/api-keys/rest.ts`, and `src/lib/hub/`.

## DeepSeek search: verified implementation target

DeepSeek now documents an independent Search API at `POST https://api.deepseek.com/v1/tools/search`, authenticated with its normal bearer key. It accepts a query and result count and returns ranked results with URLs, titles, snippets, and summaries. The query limit is 128 Unicode characters. It also documents a separate Fetch API. [Official search and fetch guide](https://api-docs.deepseek.com/guides/search/)

This change calls that Search endpoint directly. It does not assume DeepSeek's consumer-chat search is available through Chat Completions. Any supported non-Anthropic model can use DeepSeek search, and a DeepSeek model can use another search provider.

Selecting DeepSeek search explicitly can reuse the model key already saved in Inroad. Automatic selection does not opt a DeepSeek model user into search billing. A search-specific saved key takes precedence; removing it leaves the model key intact.

DeepSeek's guide lists per-successful-request pricing. Search spending is separate from model token spending in this implementation; the app does not claim to enforce a provider-dollar search budget.

## What this implementation does

In **Settings → General → Web search**, choose the provider, save a key, and use **Test search** to make one real request from the user's installation. Saving alone does not claim that the key has been validated.

| Provider | Wire contract used | Credential source |
| --- | --- | --- |
| Firecrawl | Existing `POST /v2/search` adapter | Search key, existing enabled Firecrawl integration, or `FIRECRAWL_API_KEY` |
| DeepSeek | `POST /v1/tools/search` | Search key, saved DeepSeek model key, or `DEEPSEEK_API_KEY` |
| TinyFish | `GET https://api.search.tinyfish.ai?query=…` | Search key or `TINYFISH_API_KEY` |
| Tavily | `POST https://api.tavily.com/search` | Search key or `TAVILY_API_KEY` |
| Exa | `POST https://api.exa.ai/search` | Search key or `EXA_API_KEY` |
| Brave Search | `GET /res/v1/web/search` | Search key or `BRAVE_SEARCH_API_KEY` |
| Custom adapter | `POST` to the full endpoint with `{query, limit}` | Optional search key or `INROAD_SEARCH_KEY` |

Additional official contracts: [Tavily](https://docs.tavily.com/documentation/api-reference/endpoint/search), [Exa](https://exa.ai/docs/reference/search), [Brave](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started).

Automatic selection preserves Firecrawl first, then tries configured TinyFish, Tavily, Exa, Brave, and a custom endpoint in that order. A deliberately selected but unconfigured provider stays unavailable instead of silently sending data to another vendor. A turn keeps its selected provider; provider errors do not trigger cross-vendor fallback. New adapters make one attempt per request to avoid retry charges after a lost response; the existing Firecrawl connector keeps its original retry behavior.

Search keys use the existing local integration secret store (`secrets.json`, with restricted file permissions), separate from workspace data and exports. They are not stored in the AI keychain. Browser responses include only saved-key hints. A full key is sent only to its selected provider. Custom adapters may use HTTPS or loopback HTTP, and redirects are not followed. Search-result URLs are filtered to HTTP/HTTPS without embedded credentials, deduplicated, and normalized to the existing citation format. Page fetching continues through Inroad's existing guarded fetcher.

Anthropic keeps its native web search. The external-search **Off** setting applies to models using the compatible adapter; it is not a global network-off switch. Existing per-run search-count limits remain in place.

## Custom adapter contract

Use an adapter when the user's existing search service has a different native API. For example, an internal gateway can translate an existing provider's results into this response without changing Inroad's workflows.

Request to the full configured endpoint:

```http
POST /search
Content-Type: application/json
Authorization: Bearer <optional adapter key>

{"query":"companies hiring a head of sales","limit":8}
```

Response:

```json
{
  "results": [
    {
      "url": "https://example.com/careers",
      "title": "Open roles",
      "description": "Example is hiring its first head of sales."
    }
  ]
}
```

Return `results: []` for a valid search with no matches. Return a non-2xx status for an error. Missing result arrays are errors, not successful empty searches. The adapter must translate vendor-specific authentication; pasting an arbitrary vendor URL does not automatically make that vendor compatible.

Headless configuration uses `INROAD_SEARCH_PROVIDER` and the selected provider's key variable. A custom adapter also uses `INROAD_SEARCH_URL`. A saved selection takes precedence over the environment. Invalid explicit provider names disable external search rather than selecting another paid vendor.

## Implemented roadmap and limits

The five roadmap areas are now implemented within a defined scope:

1. **Connections and field mapping:** discovery, capability mappings, read-only previews, nested JSON imports, saved mappings, CSV presets and source opt-outs. Existing inbound hooks and REST/MCP surfaces remain available, with n8n starter templates.
2. **Outbound tool adapters:** MCP over Streamable HTTP, session negotiation, pagination and streamed responses; OpenAPI 3 JSON read operations with bounded schema/input validation. Automatic OAuth setup, stdio subprocesses and imported writes are outside this implementation.
3. **Saved monitors:** topic/page checks, three GTM recipes, persistent schedules and leases, catch-up after downtime, baseline/deduplication rules, visible errors and pause/delete controls. Checks need Inroad and the computer running.
4. **Optional browser extraction:** isolated TinyFish sessions with guarded navigation, blocked writes and WebSockets, fixed evidence outputs, cancellation, request caps and cleanup. Live browser performance is not verified, and the general TinyFish Agent API is not enabled.
5. **Outcome and cost feedback:** bounded local operation receipts, research sessions, provider/source associations and raw replies/meetings/wins. Unknown costs remain unknown, and the interface does not infer causal lift.

Search itself now includes exact domain filters, publication cutoffs with undated-source labels, lexical ranking, domain diversity, canonical URL deduplication, ten-minute caching, explicit refresh, cancellation, durable daily request counters and source-grounded company qualification. The full user guide is [Research and existing tools](../RESEARCH.md).

## Verification limits

Unit/integration tests and local browser workflows cover the implementation. No production provider credentials were used, so account access, retrieval relevance, actual browser latency and paid billing behavior remain unverified live. The n8n templates were authored as importable workflow JSON and have not been executed against a live n8n account. The production build retains the repository’s existing filesystem-tracing warnings.
