# Search, AI discovery, and Monid

Implemented in the local app on November 8, 2026. Open **Search & AI** in the sidebar (`/visibility`) for SEO/AEO performance and citation snapshots. Configure sources under **Integrations**.

## What to measure

| Question | Source | Inroad behavior |
| --- | --- | --- |
| Are people seeing and clicking your site in Google? | Google Search Console | Property-level Web clicks, impressions, CTR, and average position. Latest finalized 28-day period versus the preceding 28 days. |
| Is Bing bringing search traffic? | Bing Webmaster Tools | Dated clicks, impressions, and calculated CTR, plus reported-date coverage. Bing includes multiple search verticals and Chat in this API. |
| Do search and AI visits turn into customers? | PostHog · Search & AI | Anonymous-inclusive sessions for one exact entry hostname, organic versus recognized AI referrers, converted sessions, conversion rates, and prior-period comparisons. |
| How often are AI answers citing your pages? | Monid → Ahrefs | Paid, on-demand platform-specific citation links and distinct cited pages, with locally saved matching domain/country baselines. |
| Where are your pages visible in Google's or Bing's own AI products? | Their first-party AI reports | Direct links to Google Search Generative AI reports and Bing AI Performance. These dedicated reports are not imported through an undocumented API. |

Visits, search impressions, and AI citations answer different questions. A visit-only report misses answers that cite your site without a click. A citation snapshot cannot establish traffic, revenue, recommendation rate, or causal lift from an optimization. Use conversions to evaluate visit quality, and annotate the dates of substantive content changes in your source tools before comparing periods.

Google's new dedicated generative-AI reports show impressions. The documented Search Analytics API search types do not include a dedicated generative-AI type. Bing's documented traffic endpoint does not return the AI Performance citation report. Inroad links to these interfaces and labels API totals according to their actual scope.

## Connect your accounts

**Google Search Console**

1. Verify the site in Search Console.
2. In a Google Cloud project, enable the Search Console API and create a service account with a JSON key.
3. Add that account's `client_email` to the Search Console property's users. No Google Cloud project admin role is needed by Inroad.
4. In Integrations → Google Search Console, enter the exact property (`sc-domain:example.com` or its URL-prefix property) and paste the downloaded JSON.

Inroad signs a short-lived assertion with `webmasters.readonly`, exchanges it at Google's fixed OAuth endpoint, and queries property totals without grouping by query or page. This avoids mistaking truncated top-query results for account totals. The uploaded `token_uri` is ignored. Private keys stay in the local secrets file, separate from the workspace/browser response.

**Bing Webmaster Tools**

Verify your site, open Settings → API access → API Key, and connect the key plus the exact registered site URL. Inroad only calls `GetRankAndTrafficStats`; the underlying Bing key may grant broader access. Dated rows are validated, duplicate dates rejected, and missing reporting dates are disclosed. An empty report displays unavailable values rather than invented zeros.

Google/Bing windows end three Pacific calendar days before today to reduce reporting-lag effects. Google uses inclusive Pacific dates. Bing preserves each legacy JSON date's reporting offset. The current and previous windows each cover 28 dates; they are not interchangeable with PostHog's UTC windows.

**PostHog · Search & AI**

Use the project that captures your public website, which may differ from your signed-in product project. Enter its US/EU region, numeric project ID, exact entry hostname, and a personal API key scoped to `query:read`. Optionally name an existing conversion event such as `signup_completed` or `purchase_completed`.

The adapter queries PostHog sessions, using session-entry referrers rather than a person's original referrer. Recognized ChatGPT, Perplexity, Claude, Gemini, Copilot, Meta AI and Grok hosts are classified before Organic Search. Hostname boundary checks exclude lookalikes. Anonymous visitors are included independently of the existing active-user connection's identified-only setting. Other/direct traffic is not reassigned to AI.

Converted sessions require the chosen event to carry the website's `$session_id`. Server events must receive that ID from the browser. A session counts once, after entry and before the reporting cutoff, within PostHog's maximum 24-hour session. Cross-session and later conversions are excluded. Consent, blockers, absent instrumentation, stripped referrers, and source bot/internal-traffic rules affect coverage. Zero sessions produces no conversion rate.

No tracking script or new events are injected into your public sites. Configure their existing PostHog instrumentation as needed. Inroad imports aggregates; it does not retain underlying people or events.

## Monid research

Create a workspace key in Monid → Access → API keys. The run workflows need `runs:create` and `runs:get`. Validation calls `/v1/auth/whoami`; previews call `/v1/inspect`. Neither starts a paid run.

Supported workflows:

- **TikTok creator discovery:** Monid's Apify `/apidojo/tiktok-scraper`, one keyword, country, and 1–25 posts. Creators are deduplicated by handle and shown with the highest-viewed returned post. Only public names, handles, source URLs, and available engagement counts are retained. Emails, phone numbers, and raw profiles are discarded. This is creator research, not verification that someone sells UGC services.
- **AI citation snapshots:** Ahrefs `/site-explorer/ai-responses-count`, whole domain including subdomains, both protocols, selected country, and the run's UTC report date. ChatGPT, Copilot, Gemini, Google AI Mode, Google AI Overviews, Grok, and Perplexity remain separate. Comparisons match domain, country, and Monid workspace. Ahrefs' monitored index is a sample, not all possible answers.

The advertised Jev/Typesafe UGC tool was not found in the current public Monid registry during research. The integration uses the documented, currently listed TikTok endpoint instead. It does not assume that unavailable tool's API or capabilities.

Each run rechecks endpoint fields and pricing. Price changes require a new preview. The user explicitly starts each paid run. `maxCost` is an **estimated-cost threshold**, not a guaranteed final spending cap: Monid documents that metered/per-result actuals can exceed the estimate. Review the full live price card and set workspace budgets/run caps in Monid as appropriate.

Paid submissions are never retried automatically. Local request IDs prevent duplicate submissions of the same attempt. Asynchronous runs are polled while the panel is open and resume when revisited. A timeout with no known outcome stays marked unknown and directs you to Monid's history. `BLOCKED`, provider errors inside `COMPLETED`, malformed results, and actual billed amounts are handled separately. Late polls cannot regress terminal results. Saved research is in `.data/monid-research.json`; credentials remain in `.data/secrets.json`.

Metric connections refresh every 15 minutes while Inroad is open and retain the last successful snapshot on errors. Monid research has no automatic paid polling schedule or background paid runs. No account credentials have been added or real paid queries executed as part of implementation.

## Validation

All 472 tests across 25 files pass, including the new search and Monid coverage. TypeScript, lint on changed code, and the production build pass. Browser checks covered connection forms, empty and populated dashboards, matched citation baselines, creator-search controls, and a 390-pixel viewport. Citation tables scroll inside their cards without widening the page; no browser console errors were observed. Browser fixtures and build validation used an isolated copy with synthetic data. Real provider access, actual billing, and the installed desktop release have not been verified or changed.

## Sources checked

- [Monid OpenAPI specification](https://monid.ai/openapi.json) — authoritative composite `input`, `maxCost`, response statuses, authentication, scopes and billing shapes. The older quickstart's flat-input examples differ from the current schema; the adapter follows OpenAPI.
- [Monid public registry](https://monid.ai/tools) and [AI citation example](https://monid.ai/docs/examples/seo-visibility/ai-citations).
- [Apify TikTok input schema](https://apify.com/apidojo/tiktok-scraper/input-schema) and [Apidojo output fields](https://apidojo.io/).
- [Ahrefs AI Responses Count](https://docs.ahrefs.com/en/api/reference/site-explorer/get-ai-responses-count).
- [Google Search Analytics API](https://developers.google.com/webmaster-tools/v1/searchanalytics/query), [service-account OAuth](https://developers.google.com/identity/protocols/oauth2/service-account), and [Search Generative AI reports announcement](https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports).
- [Bing traffic API](https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.getrankandtrafficstats?view=bing-webmaster-dotnet) and [AI Performance announcement](https://blogs.bing.com/webmaster/2026/2/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview/).
- [PostHog sessions](https://posthog.com/docs/data/sessions).
