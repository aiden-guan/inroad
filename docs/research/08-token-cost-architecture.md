# Token-cost-minimizing architecture for the AI Head of GTM

**Core rule: code gathers the facts and Claude only writes the final text.** Free HTTP sources and plain code collect, normalize, dedupe, score and diff the signals. Each workflow then makes one cached Claude call on a small JSON summary. Web search is a capped fallback for when the free sources come back empty, not the default way to research.

Measured on real sites today, a page's raw HTML is 0.6–1.8 MB (roughly 150K–450K tokens if sent as is). Extracted text from the same pages is 634–7,808 tokens, a 50–200× cut. Ramp's Ashby job board is 3 MB of JSON; reduced in code to counts it is about 150 tokens ("167 roles; Sales 67, Eng 37; 35 GTM roles").

---

## 1. Free / deterministic GTM data sources (all live-tested 2026-10-20 with curl)

| Source | URL pattern (tested) | Format / key fields | GTM signal | ToS / rate limit |
|---|---|---|---|---|
| **Greenhouse** | `boards-api.greenhouse.io/v1/boards/{token}/jobs` (add `?content=true` for descriptions, dept, office); also `/v1/boards/{token}`, `/jobs/{id}`, `/departments`, `/offices` | JSON `{jobs[], meta.total}`; job: `title, location, updated_at, first_published, absolute_url, requisition_id`. Unknown token → `404 {"error":"Job not found"}`. Sends ETag | Hiring velocity, new GTM roles (AE, SDR, RevOps), expansion into new regions or departments | Docs: "authentication is not required for any GET endpoints." No rate limit documented. Stripe with `content=true` is 5.6 MB, so request it only when needed |
| **Lever** | `api.lever.co/v0/postings/{site}?mode=json` (EU: `api.eu.lever.co`); filters `skip, limit, location, commitment, team, department, level, group` | JSON array; `text, categories{team,location,commitment}, createdAt (ms), hostedUrl, workplaceType`. Unknown → `404 {"error":"Document not found"}` | Same as Greenhouse | README: postings "may be scraped by third parties". The only rate limit stated is 2 POST/s for applications. GET auth is not stated, but it worked without a key |
| **Ashby** | `api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true` | JSON `{jobs[]}`; `title, department, team, location, isRemote, workplaceType, publishedAt, isListed, compensation.compensationTierSummary` | Hiring plus **salary bands**, which show seniority and budget | Documented public API. Name is case-insensitive (`linear` = `Linear`). Rate limits UNVERIFIED. `Cache-Control: max-age=60` |
| **Workable** | `apply.workable.com/api/v1/widget/accounts/{sub}` (GET) or `apply.workable.com/api/v3/accounts/{sub}/jobs` (POST with `{"query":""...}`) | v1: `name, description, jobs[]{title, department, created_at, published_on, ...}` | Hiring | Both work, but neither is a documented public API (UNVERIFIED stability). `www.workable.com/api/accounts/...` now returns 302 via Cloudflare |
| SmartRecruiters (bonus) | `api.smartrecruiters.com/v1/companies/{id}/postings` | JSON `{totalFound, content[]}` | Hiring | Responds 200. Terms UNVERIFIED |
| **Google News RSS** | `news.google.com/rss/search?q="{name}"+when:30d&hl=en-US&gl=US&ceid=US:en` | RSS; `title, link` (google redirect URL that must be resolved), `pubDate, source` | Funding, launches, exec hires, layoffs | **The feed's own copyright line forbids commercial use** ("personal feed reader for personal, non-commercial use … Any other use … expressly prohibited"). Make it an opt-in connector, off by default |
| **Bing News RSS** | `bing.com/news/search?q={q}&format=rss` | RSS; link wrapped in `apiclick.aspx?...&url=` | Same | Same non-commercial restriction in the feed. The Bing Search APIs were retired 2025-08-11 |
| **GDELT DOC 2.0** (recommended default for news) | `api.gdeltproject.org/api/v2/doc/doc?query="{phrase}"&mode=artlist&format=json&maxrecords=50&timespan=30d&sourcelang=english` | JSON `articles[]{url,title,seendate,domain,language}` | Media mentions | Free. **1 request per 5 s** (returns 429 otherwise). Very noisy: a quoted "Ramp Business" query returned unrelated pages, so filter by domain and name, then run a Haiku relevance check. Open-use terms UNVERIFIED |
| **Crunchbase** | Org pages `crunchbase.com/organization/{x}` return **403** (bot wall), so don't scrape them. `news.crunchbase.com/feed/` returns 200 (RSS) | RSS | Funding-round headlines; match company names in code | The full API is paid |
| **Hacker News (Algolia)** | `hn.algolia.com/api/v1/search?query={domain}&tags=story` and `/search_by_date`. Tags: `story, comment, show_hn, ask_hn, author_X, story_X`. `numericFilters=created_at_i%3E{unix}` (`>` must be URL-encoded or you get a 400). Also `/items/{id}` | JSON `hits[]{title,url,points,num_comments,created_at}` | Show HN launches, mentions, "Who is hiring" posts, complaints about competitors | Rate limit **UNVERIFIED**. The often-quoted 10,000 req/hour per IP appears only in third-party code |
| **GitHub REST** | `api.github.com/orgs/{org}`, `/orgs/{org}/repos?sort=pushed`, `/search/repositories?q=org:{org}&sort=stars` | JSON; `stargazers_count, pushed_at, language, created_at` | Developer traction (snapshot stars daily and diff), new repos as launch signals, language stack | 60/hour unauthenticated (we saw `x-ratelimit-limit: 60`); 5,000/hour with a PAT; secondary limit 900 points/min. Ask users for a PAT. Whether a 304 from a conditional request avoids counting is UNVERIFIED in this pass |
| **SEC EDGAR** | Full-text search `efts.sec.gov/LATEST/search-index?q="{name}"&forms=D&dateRange=custom&startdt=…&enddt=…` → `hits[]._source{ciks, display_names, file_date, adsh, biz_locations}`. Then `sec.gov/Archives/edgar/data/{cik}/{adsh-no-dashes}/primary_doc.xml` → `totalOfferingAmount, totalAmountSold, dateOfFirstSale, industryGroupType`. Also `data.sec.gov/submissions/CIK{10-digit}.json` | JSON / XML | **Form D = private fundraise** (amount and date) without Crunchbase | Fair access: **10 requests/s and a User-Agent with contact email are required**. The `efts` endpoint is what the official search UI uses, but it is not documented as an API (UNVERIFIED) |
| **Product Hunt** | `producthunt.com/feed` (Atom, 200). GraphQL `api.producthunt.com/v2/api/graphql` needs a token (401 without) | Atom / GraphQL | Launches by target accounts and competitors | API docs: "By default the Product Hunt API must not be used for commercial purposes." Contact them for a business license. The Atom feed's terms are UNVERIFIED |
| **YC directory (yc-oss)** | `yc-oss.github.io/api/meta.json`, `/api/companies/all.json` (10.6 MB, 6,311 companies), `/api/batches/{e.g. summer-2025}.json` | JSON; `name, website, one_liner, long_description, team_size, industry, subindustry, tags, batch, status, stage, isHiring, launched_at, all_locations, small_logo_thumb_url` | **Account discovery** by industry, tags, team size, stage and hiring status | Unofficial community mirror; `last_updated: 2026-10-20T02:41Z`. Fetch once a day. YC's own terms are UNVERIFIED |
| **Company website** | `/`, `/pricing`, `/about`, `/customers`, `/careers`; `robots.txt` → `Sitemap:` lines (ramp.com lists 17 sitemaps, while `/sitemap.xml` returned HTML); blog RSS (`/feed`, `/rss.xml`) | HTML → extracted text; sitemap XML with `lastmod` | Positioning, pricing tiers, customer-logo count (`/customers/*` URLs), competitor pages (`/vs/`, `/versus`), content and changelog velocity | Respect robots.txt, about 1 req/s per host, identify the user agent. **JS-rendered pages extract poorly** (linear.app/pricing gave only 713 tokens), so fall back to a headless browser when text is under ~1.5K characters. Claude's web_fetch can't render JS either |
| **Page-change history** | `web.archive.org/cdx/search/cdx?url={domain}/pricing&output=json&limit=-3&fl=timestamp,digest,statuscode` | JSON rows with content digest | **Pricing or positioning changed**, detected without fetching the page | Free. Or hash our own extracted text on each crawl |
| **Tech stack from HTML/headers** | Regex over the homepage HTML and headers | `/_next/static`, `x-powered-by: Next.js`, `x-vercel-id`, `server: cloudflare`, `wp-content`, `cdn.shopify`, webflow, `gtm.js?id=GTM-`, `js.hs-scripts.com` (HubSpot), munchkin (Marketo), `cdn.segment`, `widget.intercom.io`, `js.driftt`, `6sc.co`, chilipiper, navattic, qualified, posthog, `js.stripe.com/v3`, `static.zdassets` (Zendesk) | Tools in use: competitor or complement, budget proxy | Use exact domain signatures, not bare words (a bare "heap" match gave false positives). Fingerprint database: `enthec/webappanalyzer` (Wappalyzer fork, active 2026-10-19, **GPL-3.0**, so check licence obligations) or a hand-curated list of about 60 GTM-relevant signatures |
| **DNS (DoH)** | `dns.google/resolve?name={d}&type=MX`, `type=TXT`, `name=_dmarc.{d}&type=TXT`; or `cloudflare-dns.com/dns-query?...` with `accept: application/dns-json` | JSON `Answer[]` | MX gives the email provider (ramp.com → `aspmx.l.google.com` = Google Workspace). **TXT verification tokens reveal the SaaS stack**: ramp.com has hubspot, atlassian, slack, notion, linear, zoom, openai, anthropic, cursor, segment, 1password and stripe tokens. SPF includes show email tools; DMARC shows email maturity | Free public resolvers |
| **RDAP** | `rdap.org/domain/{d}` (302 → registry, e.g. `rdap.verisign.com/com/v1/domain/…`); bootstrap at `data.iana.org/rdap/dns.json` | JSON `events[]{registration, expiration, last changed}`, `nameservers` | Domain age as a company-age proxy; DNS host | Free |
| **Logos / favicons** | Best: `<link rel=icon>` or `og:image` from the homepage we already fetched, or `/favicon.ico`. Others: `google.com/s2/favicons?domain={d}&sz=128` (301 → `t1.gstatic.com/faviconV2…`), `icons.duckduckgo.com/ip3/{d}.ico` (200 PNG) | Image | UI only | Google and DDG favicon services are undocumented (ToS UNVERIFIED) |
| crt.sh (optional) | `crt.sh/?q=%25.{d}&output=json` | JSON | New subdomains (launches) | **Returned 502 in testing**; treat as unreliable |

### How to detect a company's ATS board token
1. Fetch `/careers`, `/jobs` and `/company/careers`, plus any homepage link matching `careers|jobs|join`. Also try `careers.{d}` and `jobs.{d}`.
2. Run these regexes over the HTML, including iframes and scripts:
   - Greenhouse: `(?:job-boards|boards)\.greenhouse\.io/(?:embed/job_board(?:/js)?\?for=)?([a-z0-9]+)` or `boards-api\.greenhouse\.io/v1/boards/([a-z0-9]+)`. A bare `gh_jid=` or `grnhse_app` means Greenhouse but no token, so go to step 3.
   - Lever: `jobs\.(?:eu\.)?lever\.co/([a-z0-9-]+)`. An `eu.` match means use `api.eu.lever.co`.
   - Ashby: `jobs\.ashbyhq\.com/([A-Za-z0-9._-]+)`.
   - Workable: `apply\.workable\.com/([a-z0-9-]+)`.
   - SmartRecruiters: `jobs\.smartrecruiters\.com/([A-Za-z0-9]+)`.
   - Also mark Recruitee, BambooHR, Teamtailor and Rippling as "ATS present"; their public endpoints are UNVERIFIED.
   - Results today: ramp.com → Ashby `ramp`; linear.app → Ashby `Linear`; notion.com → Ashby `notion`; vercel.com → Greenhouse `vercel`; posthog.com → none found (custom page).
3. If nothing matches, probe slug guesses taken from the domain and company name in the order Ashby → Greenhouse → Lever → Workable. All four return clean 404s for unknown slugs. Accept a hit only if the board name matches (Greenhouse `/v1/boards/{t}` returns `{"name":"Stripe"}`; the Workable widget returns `name`).
4. Store the mapping permanently and re-verify it monthly. Use ETag / `If-None-Match` (Greenhouse, Ashby and Lever all send ETags).

---

## 2. Claude cost levers (from Anthropic's pricing and docs pages, fetched today)

| | Opus 5.5 | Sonnet 5.5 | Haiku 5.5 (prompt ≤100K) | Haiku 5.5 (>100K) |
|---|---|---|---|---|
| Input | $4 | $2 | $0.10 | $0.50 |
| 5-min cache write (1.25×) | $5 | $2.50 | $0.125 | $0.625 |
| 1-hour cache write (2×) | $8 | $4 | $0.20 | $1.00 |
| Cache read | **$0.20 (0.05×)** | **$0.10 (0.05×)** | $0.01 (0.1×) | $0.05 |
| Output | $20 | $10 | $0.50 | $2.50 |
| Batch in / out | $2 / $10 | $1 / $5 | $0.05 / $0.25 | $0.25 / $1.25 |

All prices are per million tokens.

- **Web search: $10 per 1,000 searches ($0.01 each)**, plus the result tokens as input. Results keep counting as input in every later turn of the same conversation. Errored searches are not billed. Versions are `web_search_20250305`, `_20260209` (dynamic filtering: Claude filters results in code before they enter context) and `_20260318` (adds `response_inclusion:"excluded"`). Parameters: `max_uses`, `allowed_domains` or `blocked_domains` (not both), `user_location`. Search works inside batches, but batch searches are throttled per organization.
- **Web fetch: no extra charge, tokens only.** Typical sizes: ~2,500 tokens for a 10 kB page, ~25K for 100 kB, ~125K for a 500 kB PDF. Parameters: `max_content_tokens`, `max_uses`, `use_cache` (from `_20260309`). It only fetches URLs already in the conversation, and **cannot render JS**.
- **Code execution is free** when web search or web fetch `_20260209`+ is in the request (that is what powers dynamic filtering). Otherwise organizations get 1,550 free hours a month, then billing by execution time.
- **Prompt caching:**
  - Minimum cacheable prefix is **512 tokens** on Opus, Sonnet and Haiku 5.5. Shorter prefixes silently don't cache.
  - TTLs are 5 minutes (default) or 1 hour (`"ttl":"1h"`). Every read refreshes the timer. 1-hour entries must come before 5-minute entries.
  - Up to 4 breakpoints; the lookback window is 20 blocks; render order is tools → system → messages.
  - Caches are isolated per organization and per workspace, and should be treated as per-model.
  - **Invalidators:** changing tool definitions breaks everything. Toggling web search or citations, or changing tool choice or images, breaks the system and message caches. Changing thinking or effort breaks the message cache (system cache depends on the model). Changing `output_config.format` breaks the cache for that thread.
  - Measured by Anthropic: running without caching cost 3.1–7.3× more on Sonnet 5.5 workloads. If 1 turn in 10 comes after a pause longer than 5 minutes, the 5-minute TTL cost 54% more than 1 hour; break-even is about 1 turn in 30.
- **Batch API:** 50% off every token, cached ones included. Up to 100,000 requests or 256 MB per batch. Most batches finish in under 1 hour; anything not done in 24 hours expires unbilled. Results stay available for 29 days. Tools, web search and fetch work in batches; `stream`, `speed` (fast mode) and `max_tokens:0` are rejected. Cache hits in batches are best-effort ("30% to 98%"), and Anthropic recommends the 1-hour TTL there.
- **Effort** (`output_config.effort`: low, medium, high, xhigh, max):
  - Defaults are **medium on Opus 5.5 and Haiku 5.5** and **high on Sonnet 5.5**.
  - Effort governs all output tokens, including thinking and tool calls. Medium costs about 30–52% less than high, and low about two-thirds less, with "up to 15 points lower" quality depending on the task.
  - Opus 5.5 on SWE-bench Pro: low 87.4% at $0.11/task, medium 92.8% at $0.21, high 95.3% at $0.29. Opus 5.5 at low matched Sonnet 5.5's default for about 7% more per solved task. That makes "one model at lower effort" a viable simpler alternative to routing, with one cache namespace.
  - Opus 5.5 thinking **cannot be disabled**. Sonnet 5.5 can turn off up-front thinking with `thinking:{type:"between_tools"}` at ≤high. Haiku 5.5 accepts `disabled` at ≤high.
  - Per-message effort (beta `mid-conversation-output-config-2026-07-01`) changes effort mid-conversation without breaking the cache.
- **Structured outputs** (`output_config.format` json_schema, or `strict:true` tools): supported on all three models and in batches. The grammar compiles on first use and is cached for 24 hours. It adds a small system prompt. Up to 20 strict tools. Haiku 5.5 with thinking off and a JSON format can skip a needed tool call, so use adaptive thinking there.
- **Output costs 5× input.** Anthropic measured one-line answers at $0.49 per run against $1.40 for a six-section memo, with accuracy within noise. Prefer JSON fields the UI renders over prose.
- Other small items:
  - Tool use adds 286 system-prompt tokens on all three models.
  - `inference_geo:"us"` costs 1.1×.
  - Fast mode on Opus 5.5 is $8/$40 and can't be used in batches.
  - Refusals: use `fallbacks:"default"` with beta `server-side-fallback-2026-07-01` on Opus and Sonnet; Haiku 5.5 has no server-side fallback, so handle `stop_reason:"refusal"` in code.
- Haiku 5.5 web search support: it supports programmatic tool calling (verified), but server web search support was not confirmed in this pass (**UNVERIFIED**). Check the Models API field `capabilities.server_tools.web_search.supported`, and route search to Sonnet.

### Prompt layout so one company context pack is cached across workflows
```
tools:   ONE fixed, sorted tool set per (model, search on/off) variant — never vary per workflow
system[0]: GLOBAL_RULES (voice, banned phrases, output conventions)            — static, in code
system[1]: CONTEXT_PACK v{n}: company profile, ICP, personas, positioning,
           proof points, objection handling, style guide (~5–8K tokens,
           deterministic JSON→text, sorted keys, NO dates/IDs)                 ← cache_control {ephemeral, ttl:"1h"}
messages[0] user: [WORKFLOW_SPEC block (≥512 tok; add a 2nd 1h breakpoint in batches),
                   "Today is 2026-10-20", ACCOUNT_SIGNALS json, task input]    ← volatile, after breakpoints
chat only: top-level cache_control {ephemeral} (5m) for the growing tail (1h-before-5m ordering OK)
```
- Put workflow instructions in `messages`, not `system`, so every workflow on a model shares one system prefix. Keep the date out of `system`; it is a silent cache invalidator.
- Expect one cache entry per (model × search on/off × effort × output schema) combination, about 6–8 in practice. Each 8K-token write costs only $0.032 (Sonnet, 1-hour) or $0.064 (Opus, 1-hour). Give Haiku a slim pack (rubric only).
- Verify that `usage.cache_read_input_tokens > 0`. Alert when it stays at zero across repeated runs.

---

## 3. Per-workflow architecture and cost

Prices are computed from the verified rates above. "Out" includes thinking. Context pack is 8K tokens.

| # | Workflow | Done in code (no LLM) | LLM step | Web search | Caching / batch | Est. tokens | **Est. $/run** | All-Opus + search agent |
|---|---|---|---|---|---|---|---|---|
| 1 | Company analysis from a URL | Crawl ≤8 pages, extract text (Readability), dedupe; ATS summary, tech stack, DNS TXT/MX, RDAP, GitHub, HN, YC, Form D → ~18K | **Opus 5.5 medium**, JSON schema (company profile) | Optional, `max_uses:3` (competitors) | One-off; no cache | 18K in / 6K out | **$0.19** ($0.30 with 3 searches); Sonnet alternative $0.10 | — |
| 2 | ICP / positioning playbook | Assemble profile JSON, founder answers, win/loss notes, compacted competitor pages | **Opus 5.5 high** | No (competitor pages come from code) | Output **becomes the cached context pack** | 20K / 12K | **$0.32** (monthly) | — |
| 3 | Account discovery (500 candidates → N=50) | Source from YC API, CRM / Clay / Apollo imports and ATS probes; hard ICP filters (size, industry, region, hiring GTM) and rule score | **Haiku 5.5 low**, 20 compact cards (~300 tokens each) per request, JSON scores | No (top-10 fallback optional) | **Batch**; rubric cached | 25 × 7.5K / 2K | **$0.02** batch ($0.04 sync) | **$11.50** (50 × Opus + 5 searches) |
| 4 | Account dossier + why-now | All collectors with TTLs; diff since last run; keyword rules tag events; signals JSON ~3K + homepage text 4K | Haiku tags only ambiguous headlines ($0.0004); **Sonnet 5.5 medium** writes the dossier JSON | Fallback only if fewer than 2 signals: `max_uses:3`, dynamic filtering | Context-pack read; **reuse for 7 days** unless a high-weight signal arrives | 8K cached + 7K / 4K | **$0.055** ($0.11 with fallback) | $0.42 |
| 5 | Email sequence, one contact | Merge fields, lint (length, spam words, banned phrases, link and merge-tag checks) | **Sonnet 5.5 low–medium**; try `between_tools` | No | Pack read + cached dossier summary | 8K cached + 2K / 1.8K | **$0.023** | ~$0.10 |
| 6 | Batch drafting, 25 accounts | Same lint; build 25 requests | Sonnet 5.5 via **Batch API**; Haiku drafts only if evals pass | No | Warm the 1-hour cache with one sync call, then batch with 1-hour breakpoints | 25 × (8K cached + 1.8K / 1.8K) | **$0.28–0.52** (+$0.69 if 25 dossiers also batch-built); sync $0.56 | ~$13 |
| 7 | Meeting prep brief | CRM pull (deal, emails, notes), attendee titles, news delta since the dossier | **Sonnet 5.5 medium** | Only if dossier is older than TTL and has no news | Pack read + dossier reuse | 8K cached + 5.5K / 2.5K | **$0.037** | ~$0.40 |
| 8 | Post-call follow-up | Pull transcript or summary from the call recorder (if its summary is good, skip extraction) | Sonnet direct when ≤15K tokens; for long calls, Haiku extracts fields to JSON, then Sonnet writes email + CRM update | No | Pack read | 10K transcript | **$0.048** direct / $0.027 two-stage | ~$0.10 |
| 9 | Exec dinner plan | Filter ICP accounts and contacts by city from the DB; tier ranking | **Sonnet 5.5 medium** | Yes, `max_uses:5`, `user_location` (venues) | Pack read | 8K cached + 18K / 3K | **$0.12** | ~$0.40 |
| 10 | Daily brief | Nightly diff of all watched accounts (ATS, RSS/GDELT, Form D, GitHub, page hashes, CRM tasks); dedupe by URL and title hash; rank by weight × tier × recency. **No new events = no LLM call** | Haiku low: one line per event (all events in one request); Sonnet low composes the top 10 with actions | No | **Batch at night** | ~5K + 10K / 3K | **$0.01** batch ($0.02 sync) | ~$1–3 |
| 11 | Chat Q&A | Intent router: list and filter questions become SQL/FTS with **no LLM**; client tools (`search_accounts`, `get_dossier`, `get_signals`) instead of stuffing context | **Sonnet 5.5 low**; Opus via an "Think harder" button | Opt-in per message, `max_uses:2` | Pack + automatic tail caching; start a new thread after ~30 turns; don't carry search results forward | ~15.5K (13K cached) / 0.6K | **$0.012/turn** (Opus low $0.031) | ~$0.10/turn |

**Example month** for an early-stage team: onboarding $0.62, 4 discovery runs about $1, 200 dossiers $11–22, 200 sequences in batch $2.2–4.2, 30 preps $1.1, 30 follow-ups $1.4, 2 dinners $0.24, 22 briefs $0.25–0.45, 600 chat turns $7.4, context-pack writes about $3. **Total ≈ $28–40 a month**, against roughly $150–250 for an all-Opus web-search agent.

Anti-pattern to block: sending raw homepage HTML (~300K tokens) to Sonnet costs **$0.60 per page**.

**Where the founder's "plug in existing tools" requirement cuts tokens:**
- Define a single `SignalProvider` interface that every source implements, both the free collectors and third-party tools (Clay, Apollo, HubSpot/Salesforce, Gong/Fathom summaries, and whatever "Muse / Meta Muse" is; that product is UNVERIFIED). Each provider emits `Signal{domain, type, ts, source, url, payload, weight}`. Imported enrichment replaces research tokens.
- If a team's existing agent already sends outreach, skip workflows 5 and 6 and push dossiers and angles to it by webhook or CSV. That costs zero Claude tokens for drafting.

---

## 4. Guardrails
- **Call ledger.** Every Claude call writes one row: `{run_id, workflow, account_id, model, effort, input, cache_write_5m, cache_write_1h, cache_read, output, web_search_requests, web_fetch_requests, batch, usd}`.
  - Read the token counts from `usage` and `usage.cache_creation.ephemeral_{5m,1h}_input_tokens`, and searches from `usage.server_tool_use`.
  - Price it from a versioned `pricing.json` with an `effective_date`.
  - Show a cost chip on every run and a month-to-date bar.
- **Pre-flight estimate and caps.**
  - Estimate = (characters ÷ 4, or `count_tokens`, whose "free" status is UNVERIFIED) × rate, plus expected output and search count.
  - Defaults: per-run $1 (batch $5, confirm above $1); daily automation $2; monthly $50, warning at 80% and hard stop at 100%.
  - At the cap, drop to **code-only mode** (signals and scores with no narrative) or to Haiku.
  - Set an Anthropic Console **workspace spend limit** as the final backstop. Reconcile with the Admin `cost_report` API if an admin key exists (not available to individual accounts).
- **Per-call limits.** `max_uses` on search and fetch, `max_content_tokens` (e.g. 8K) on fetch, a sensible `max_tokens` that leaves room for thinking, and `allowed_domains` where it fits.
- **Research cache with TTLs** (`source_cache{key, fetched_at, etag, last_modified, content_hash, body}`), using conditional GETs:

  | Source | TTL |
  |---|---|
  | ATS | 24 h |
  | News (RSS/GDELT/HN) | 6–12 h |
  | GitHub | 24 h |
  | Form D | 7 d |
  | Homepage and pricing | 7 d |
  | About and customers pages | 14 d |
  | Tech stack, DNS | 7–30 d |
  | RDAP | 30 d |
  | YC dump | 24 h |
  | ATS token mapping | permanent, re-verify monthly |

- **LLM output cache.** Store `dossier{account_id, inputs_hash, model, created_at}` and reuse it for 7 days (configurable 3–14). Regenerate only when `inputs_hash` changes on a high-weight signal, and then send **only the delta** for an incremental update.
- **Idempotency.** Key each run on `hash(workflow, account, inputs_hash, pack_version)`; a repeat within the TTL returns the stored result for $0.
- **Dedupe.**
  - Accounts: canonicalize domains (eTLD+1 via a public-suffix library, strip www, follow redirects).
  - News: canonical URL (unwrap Google and Bing redirects) plus title similarity hash.
  - Contacts: lowercased email.
  - Never send the same event to the LLM twice; mark events `summarized_at`.
- **Per-host rate limiters.** SEC 10/s with a contact User-Agent; GitHub 60/hour without a PAT; GDELT 1 per 5 s; crawl 1/s per host and obey robots.txt.
- **Compliance.** Google and Bing News RSS stay opt-in because of their non-commercial terms. Product Hunt API needs a license. Don't scrape Crunchbase. Attribute GPL-3.0 fingerprint data.

---

## RECOMMENDATIONS

**Model routing**

| Task class | Model | Effort / thinking | Notes |
|---|---|---|---|
| Collect, parse, score, diff, dedupe, rank, lint, route chat intents | **None (code)** | — | Default for everything deterministic |
| Classify, tag, extract (job functions, news event type, relevance filter, ICP fit scoring, transcript fields) | **Haiku 5.5** | low (medium for multi-step); thinking `disabled` unless tools + JSON together | Structured outputs, batch, keep prompts under 100K tokens (5× price above) |
| Short writing at volume (sequences, daily-brief composition, chat) | **Sonnet 5.5** | low–medium; test `between_tools` for pure drafting | Cached context pack; batch when not interactive |
| Account synthesis (dossier, meeting prep, follow-up, dinner plan) | **Sonnet 5.5** | medium | Web search only as a capped fallback; `fallbacks:"default"` |
| Strategy (company analysis, ICP/positioning playbook, "think harder", quarterly GTM plan) | **Opus 5.5** | medium (high for the playbook); thinking always on | Rare and high-value; `fallbacks:"default"` |

Alternative to measure first: Opus 5.5 at low effort for every LLM step. It is about 7% or more costlier per solved task than Sonnet's default in Anthropic's tests, but gives one cache namespace and simpler code. Choose it if your evals show Sonnet's quality falls short.

**Per-workflow cost plan**

| Workflow | Model | Search | Batch | Target $/run |
|---|---|---|---|---|
| Company analysis | Opus medium | ≤3 | No | ≤$0.30 |
| ICP playbook | Opus high | 0 | No | ≤$0.35 |
| Discovery (500 → 50) | Haiku low | 0 | Yes | ≤$0.05 (+≤$1 fallback) |
| Dossier | Sonnet medium | 0 (≤3 fallback) | Optional | $0.05–0.11 |
| Sequence (1 contact) | Sonnet low/medium | 0 | No | ≤$0.025 |
| Batch of 25 | Sonnet | 0 | Yes | ≤$0.55 |
| Meeting prep | Sonnet medium | 0 | No | ≤$0.04 |
| Follow-up | Sonnet (Haiku pre-extract for >15K transcripts) | 0 | No | ≤$0.05 |
| Exec dinner | Sonnet medium | ≤5 | No | ≤$0.12 |
| Daily brief | Haiku + Sonnet low | 0 | Yes (overnight) | ≤$0.02; $0 if no new events |
| Chat | Sonnet low (Opus on demand) | opt-in ≤2 | No | ≤$0.015/turn |

Sources:
- [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) · [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) · [Batch processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing) · [Effort](https://platform.claude.com/docs/en/build-with-claude/effort) · [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool) · [Web fetch tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool) · [Tool reference](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference) · [Programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)
- [Cost & intelligence](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence) · [Prompting Haiku 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5)
- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html) · [Lever postings API](https://github.com/lever/postings-api) · [Ashby public posting API](https://developers.ashbyhq.com/docs/public-job-posting-api)
- [GitHub REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) · [SEC accessing EDGAR data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data) · [Product Hunt API docs](https://api.producthunt.com/v2/docs)
- [Bing Search API retirement](https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement) · [HN rate-limit claim (third-party, unverified)](https://glama.ai/mcp/servers/@sam3690/Hackernews_mcp/blob/7abf5075868b29341b93741cba0c893637e4bb36/src/lib/rate-limiter.ts)

The measurement scripts (`cost.py`, `strip.py`) were run during research and are not included.