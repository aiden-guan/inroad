# Research and existing tools

Open **Research** in the sidebar, use **G then F**, or choose **Search the web and research companies** from the command menu. Integrations links to the same connection workspace. The tabs are Intent, Search, Monitors, Connections and Outcomes; `?tab=` opens one directly, and Intent is where Research lands once it has posts.

## Intent: people asking for what you sell

**Asking for it.** **Scan now** builds queries in code from the playbook (the buyer's community words first, then the category, the ICP obstacle and competitor names pinned to the space's main word) and searches the free sources: Hacker News stories and comments (Algolia), Stack Exchange (Software Recommendations plus the sites the playbook's words point to; 300 requests a day per computer, and its `backoff` is obeyed), GitHub issues (10 searches a minute without a token), and Reddit only through your own web search provider. Bluesky is skipped: its public search now refuses signed-out requests. Results are deduped and filtered in code (bots, a repository's own maintainers, job threads, posts older than 30 days, threads you marked not relevant, posts that mention nothing in the playbook); at most 60 go to the fast model in batches, and each verdict is cached per post for four weeks. Code then checks every verdict: quotes must appear in the post word for word, matches must be playbook terms, and a company is kept only when the author's own profile (a work email, an "@org" or a site next to a role) or their own words name it. Usernames never place anyone.

Each post shows the quote, author, link, date, what it matched and where the author works when known. **Draft a reply** writes a community answer in your voice that discloses your affiliation if it names your product; you post it. **Track company** adds the account with the post as dated evidence and a "They said it in public" signal; posts by people at companies already in Companies get that signal on the scan. **Not relevant** hides the whole thread, takes its signal back off the account, and counts against the query that found it: a query is retired after three misses (and three times as many misses as keeps), with **Search it again** under How this works. Filters (24 hours, 7 days, 30 days, All; source; matched pain or competitor; relevance or newest) live in the URL. Undated posts appear only under All. Keys: J/K move, R reply, T track, X not relevant, O open. **Check daily** saves a free monitor that runs the same queries in code and lists new posts under Monitors; nothing goes to the model until you scan. How this works shows each source's state, the exact queries, requests made and cached, posts judged and the scan's cost. Consumer workspaces get the same feed without GitHub issues or company tracking.

**Developers.** Paste up to five repositories (suggestions come from your competitors' GitHub orgs, verified when the org lists the competitor's website). The radar reads the newest forks, issues, pull requests, issue comments and, with a token, discussions from the last 30 days, then each active person's public profile, issue authors first, until the hourly limit's reserve. The repository owners' own people, competitors' and your own are left out. People are placed only from their profile's org, matching site or work email; the rest stay unplaced under People. Companies are ranked with a code-built line ("3 people at Fernwick engaged with … in the last 30 days: 1 fork, 1 issue about …, 1 comment"). **Track company** adds the GitHub activity as evidence; an issue that names a playbook pain is a public signal, while forks and comments are context that never appears in outreach. GitHub has shown who starred a repository only to its admins and collaborators since July 2026, so stars appear as weekly counts, and the stargazer import explains that instead of failing quietly.

In mock mode (`npm run dev:mock`) every source answers from saved, anonymized responses through the mock server (`scripts/mock/intent.mjs`), and the sample workspace carries example posts, a radar and research history so each tab has something to show.

## Find companies and inspect sources

1. Enter a specific brief, such as “usage-based SaaS companies hiring their first finance leader.”
2. Optionally restrict or exclude domains and choose a publication cutoff.
3. **Search the web** returns sources with snippets, dates when available, the provider, elapsed time, and the queries used. Tracking parameters are removed before duplicate detection; ranking gives distinctive title matches more weight and diversifies source domains.
4. **Read source** retrieves the page through guarded HTTP first. If configured, a mapped page reader can handle missing text, then optional browser rendering can handle client-side pages. Retrieved evidence shows its URL, acquisition time and provider.
5. **Track website** saves an unqualified company with its source. **Add and research** also starts the normal dossier workflow. **Find and qualify companies** checks candidates against your playbook, verifies their websites, and applies the existing exclusions. Qualification accepts briefs up to 300 characters.

Results are evidence to inspect, not proof of ICP fit. Missing publication dates are labeled. Domain filters are enforced on returned results; date cutoffs discard known older dates while undated results remain explicitly unverified.

Recent searches persist locally and can be reopened from **Recent research**. Successful external results cache for ten minutes; **Refresh sources** bypasses the cache. A failed provider does not silently switch the query to a different vendor. Errors from one of several queries remain visible.

## Choose search and page providers

**Settings → General → Web search** supports Firecrawl, DeepSeek, TinyFish, Tavily, Exa, Brave, a custom HTTP adapter, or an enabled connected tool with a mapped search capability.

The Research workspace uses the configured external provider when one exists. With automatic/off external search and Claude configured, it can use native Claude web search. Claude agent workflows retain their native search. Other model providers use the external search adapter. DeepSeek model users opt into DeepSeek search explicitly; its saved model key can be reused.

External and native Research requests share a daily request limit, initially 100. The counter lives in machine settings and survives history pruning, resets and workspace restores. Native Research reserves two searches before starting and releases unused capacity afterward. Cached results do not consume a provider request. Search request limits do not enforce a provider-dollar budget; keep provider account limits configured too.

An optional connected page reader uses its **fetch** capability. Map query input to the tool's URL argument and output fields to `url`, `title`, and `text`.

TinyFish browser rendering is off initially. Enable it and save a TinyFish key in the browser key field or provide `TINYFISH_API_KEY`. Its separate daily request limit starts at ten. Rendering opens an isolated session, blocks form/network writes and WebSockets, extracts a bounded document, and terminates the session in cleanup. It does not log into sites, click workflow buttons, or send outreach. Cleanup failures are shown; the remote session also has a bounded inactivity timeout.

## Connect a tool with MCP or OpenAPI

In **Research → Connections**:

1. Enter a name and full endpoint. Choose **MCP over HTTP** or **OpenAPI 3 document**. For OpenAPI, use the API's base URL and paste or upload its JSON specification.
2. Supply an optional bearer token or API-key header. Keys use the local integration secret store and never enter workspace backups or API responses.
3. **Discover tools** lists operations. Only MCP tools explicitly marked read-only and compatible OpenAPI GET operations are available.
4. Choose a capability: web search, page fetch, record reads or enrichment. Map its input query/limit arguments, result array path, output fields, and any fixed default arguments.
5. Save, then use **Run read-only preview** with a small input. Inspect its actual JSON response and adjust the mapping if needed.
6. A mapped search connection has **Use for web search**. Page-reader selection is in Web search settings. Ask can list enabled connections and invoke mapped record, enrichment and fetch reads; importing their data still requires the separate preview/import action.

The MCP client handles initialization, negotiated protocol headers, sessions, paginated tool lists, JSON and streamed responses, and session cleanup. It reads a matching streamed response without waiting for a long-lived stream to close. HTTP responses and input sizes are bounded. Requests keep the saved key on the configured endpoint and do not follow redirects. Changing a credentialed endpoint requires entering the key again. A restore pauses a credentialed connection when its endpoint/authentication differs from the current machine's configuration.

Supported scope: MCP Streamable HTTP using supported 2025 protocol revisions, OpenAPI 3 JSON, local references, and GET operations with query/path parameters. Legacy SSE transport, stdio subprocesses, automatic OAuth enrollment, arbitrary imported scripts, and imported write operations are not supported. Services using those surfaces need an appropriate bridge or their native connector.

## Map and import records

Use a connection preview or paste a JSON export in Connections. Choose its record-array path, suggest fields, and inspect the mapped sample and duplicate/skip counts. Dotted paths and numeric indices are supported; expressions are not evaluated.

Map a company domain or work email. Nested fields such as `company.domain` and `person.email` work. A separate opt-out path can identify unsubscribed contacts. **Preview import** is required before **Import previewed records**. Existing values are retained and missing fields are filled; suppressions are checked again at commit time. Source opt-outs are preserved, including after undo. Mapping profiles can be saved for future exports.

CSV imports also include Salesforce, Pipedrive and Attio presets. Common source opt-out columns are recognized automatically. Undo remains available through the existing import history.

## Starter automation workflows

Two importable n8n workflows are available in Connections and as local files:

- `public/integrations/n8n-read-playbook.json`: manual trigger, configure the Inroad URL, then read the playbook.
- `public/integrations/n8n-import-account.json`: manual trigger, configure the URL and sample company, then import one account. The HTTP import node starts disabled so you can inspect and replace the sample first.

After importing into n8n, select an HTTP Header Auth credential on the HTTP node: header `Authorization`, value `Bearer <Inroad agent key>`. Create the key under Integrations → AI agents; use read scope for the playbook and write-record scope for account import. Supply the public Inroad URL for cloud-hosted automation; localhost works only when the caller can reach the same computer. Enable the import node only after replacing its example fields. The templates include no credentials and have not been executed against a live n8n account.

For Zapier or Make, use the existing inbound URL and JSON example shown under Integrations → incoming leads, or call the REST mirror with an agent key. Its current schema is available at `/api/v1/openapi.json`. Inbound data does not approve or send outreach.

## Monitor meaningful changes

In **Research → Monitors**, choose a topic or public page, interval, and optional terms. Leadership, dormant-deal and meeting-preparation recipes prefill useful queries from tracked companies, dormant deals or an upcoming meeting. Edit the target before saving.

The first successful check establishes a baseline. Topic checks notify when a previously unseen matching source appears; result reordering and returning old URLs do not create duplicate observations. Page checks compare normalized text, optionally limited to sentences containing watched terms. These are deterministic change rules, not an LLM judgment that every change is a buying signal.

Changes appear under **Changes to review**. Open their sources, research the signal, and mark them reviewed. A provider failure keeps the prior baseline, records a visible error, and retries with backoff. Pause, resume, edit, check-now and delete controls are available. Paused monitors remain paused when edited.

The server checks schedules once a minute while it runs. Persistent leases prevent duplicate overlapping checks; overdue monitors catch up once after sleep or restart and then resume their cadence. Sample workspaces do not run checks. There is no always-on cloud service when the computer or Inroad is stopped.

## Measure outcomes and recover data

**Outcomes** shows requests, cache use, failures, accepted accounts, replies, meetings, won deals and known or unknown provider cost. Accepted websites and discovered companies retain provider/source associations. An account can be associated with more than one provider; these counts do not establish causal lift. History is bounded to 2,000 operations within 90 days and twenty research sessions, so the view describes retained history rather than a complete financial ledger.

`automation.json` contains connection definitions, mappings, monitors, observations and research history. It participates in workspace backups, restore and reset, with owner-only file permissions. Secrets and daily request counters remain machine-local. Active reads are aborted and drained before workspace replacement. “Delete their details” also removes matching auxiliary research history and monitors and clears the in-memory search cache.

## Verification scope

Tests cover provider formats, exact filters, citation/source grounding, request-limit concurrency and persistence, caching, MCP streaming/session behavior, OpenAPI reads, nested mappings, opt-outs, monitor deduplication/failure recovery, browser write blocking/cleanup, backups and erasure. Browser tests exercise the connected workflow with local HTTP adapters. Production provider credentials were not used: live account permissions, browser performance, result relevance and actual billing still need checking on the user's configured accounts.

Completed checks: 1,201 unit/integration tests across 118 files; all 24 Playwright browser tests, including desktop/phone regressions and the new connected research flow; TypeScript and ESLint. The full unit suite runs with `umask 022` because two existing file-permission fixtures assume that mask.
