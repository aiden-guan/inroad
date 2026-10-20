# GTM tool stack and integration plan for the AI Head of GTM hub (as of 2026-10-20)

## Summary
- **"Meta Muse" is almost certainly Meta's Muse.** It is a consumer agent launched on 2026-09-08. "Muse for Small Business" followed on 2026-09-29.
  - It has no public API or webhooks to call.
  - It can connect to any external API as a user-built custom connector. Third-party guides say this includes MCP servers over Streamable HTTP with a bearer token.
  - **Conclusion:** we integrate with Muse by letting it call us through our own MCP/REST. We cannot call it.
- **Teams run 4–6 core tools:** CRM, Clay/Apollo, a sequencer (Instantly/Smartlead/HeyReach), n8n, and a meeting recorder.
  - AI SDRs are still under 1% of businesses by spend (Ramp data).
- **Nearly every tool that matters now ships an official MCP server**, but most use OAuth only and are built for LLM-driven use.
  - For automatic, code-driven sync at no token cost, REST API keys plus polling is the cheapest universal path, and it works on localhost.
  - Webhooks need a public URL, which a local app does not have without a tunnel.
- **Build our own MCP server and REST API (about 9 tools).** It turns us into the strategy layer that Muse, Claude, Cursor, n8n and AI SDRs read from and write to. Those agents pay for their own inference, so our Claude spend stays at zero for that traffic.
- **v1 build:** native connectors for HubSpot, Attio, Instantly, Fathom/Granola and Slack. Everything else goes through CSV, a generic inbound webhook, or our MCP/REST.

---

## 1. Who "Muse" / "Meta Muse" is

### Primary candidate (high confidence): Meta Muse
- **Launch:** personal AI agent launched 2026-09-08, US only.
  - Available on iOS, Android, muse.ai and WhatsApp.
  - Runs on a dedicated cloud VM with its own browser, powered by the Muse Spark model.
  - Free tier, with paid plans reported at $20 and $100 per month. ([Meta newsroom](https://about.fb.com/news/2026/09/introducing-muse); [TechRepublic](https://www.techrepublic.com/article/news-meta-muse-ai-agent-us-launch/))
- **Sales use:** it works as one rep's assistant, not a team sales engine. ([eesel](https://www.eesel.ai/blog/meta-muse-for-sales))
  - Connectors: Gmail, Google Workspace and Calendar, Granola, Zoom, Slack, Notion, Box, Dropbox, Stripe, QuickBooks, Shopify.
  - Muse for Small Business (2026-09-29) added 15 connectors, including HighLevel (the only CRM named), Asana, Klaviyo, Canva, Figma and Lovable. It can also read Meta Pages, Instagram analytics and ad accounts. ([ppc.land](https://ppc.land/metas-muse-agent-gains-access-to-ad-accounts-and-15-business-tools/); [Help Net Security](https://helpnetsecurity.com/2026/09/29/meta-muse-for-small-business))
  - Not natively supported: HubSpot, Salesforce, Pipedrive, LinkedIn, Outlook (per eesel; not confirmed by Meta).
  - Approvals: "nothing publishes, sends, or spends without your approval." Sending email is a separate write permission.
- **Integration surface:**

| Surface | Status |
|---|---|
| Public API to drive Muse | None found |
| Outbound webhooks | None found |
| Custom connectors | Yes. Meta: "Muse can also write its own custom connectors for other services… if they have their own APIs or CLIs." Keys go in a Secure Credentials Store, and Meta does not review custom connectors. ([Meta research](https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse); [Meta Help](https://www.meta.com/help/artificial-intelligence/1687253048996149/)) |
| MCP | Third-party sources only (**partly unverified**). Muse builds an MCP client with the official SDK, connects over Streamable HTTP, and uses a bearer key entered through a secure prompt. ([Parallel](https://parallel.ai/articles/meta-muse-custom-integrations.md)) |
| Partner connectors | Developer portal at muse.ai/platform with review. Over 1,500 applications in under a week. ([TechCrunch](https://techcrunch.com/2026/09/23/everything-new-coming-to-metas-ai-agent-muse/); [Crypto Briefing](https://cryptobriefing.com/meta-muse-developer-connector-api-access/)) |
| Export | Muse can generate PDF, DOCX and spreadsheet files (eesel). Its own email address is "coming soon", and users can CC or forward email to it. |
| Network | The Sentinel gate controls every outbound request and blocks public hostnames that resolve to private IPs. **A localhost hub is unreachable; we need a public HTTPS URL (tunnel).** |

### Other candidates (lower confidence)
- **SalesRobot "Muse":** an AI layer on SalesRobot's LinkedIn/outbound tool. It has MCP at mcp.salesrobot.co, API-key auth, webhooks and CSV import. ([salesrobot.co/muse](https://www.salesrobot.co/muse))
- **Meta Business Agent:** a separate product for inbound chats on WhatsApp, Messenger and Instagram.
  - Billed at $2 per 1M tokens, roughly 4–5¢ per message.
  - Can only reply within a 24-hour window and cannot start conversations.
  - CRM links require a connector you build yourself.
  - Not an outbound tool.
- **Agensi "Muse marketplace" / "Muse Code via One" / "Meta Muse via AnythingMCP":** third-party skill and connector marketplaces built on Muse. This confirms people are already wiring Muse to sales tools.

**Design implication:** treat Muse as the reference "bring-your-own agent." Whatever works for Muse (remote MCP plus bearer token, or REST plus API key) also works for Claude, ChatGPT, Cursor, n8n and AI SDRs.

---

## 2. Typical seed–Series B stack, ranked by adoption

The four datasets measure different things:
- **ColdIQ:** n=62, companies over $1M revenue, unprompted answers, July 2026. ([ColdIQ](https://coldiq.com/blog/the-2026-gtm-tool-report-what-62-revenue-leaders-run))
- **State of GTM Engineering 2026:** n=228 GTM engineers. ([GTME Pulse](https://gtmepulse.com/tools/tech-stack-benchmark/))
- **LeanScale:** 50+ companies, H1 2026, skewed to Series B–C. ([LeanScale](https://www.leanscale.team/knowledge/research/customer-tool-stack-study/))
- **Ramp Rate:** card and bill-pay spend data, updated 2026-10-18. Its percentages are the share of buyers in a category who use each vendor. ([Ramp CRM](https://ramp.com/vendors/categories/crm), [Ramp Sales Data](https://ramp.com/vendors/categories/sales-data-providers), [Ramp AI-First GTM](https://ramp.com/vendors/categories/ai-first-gtm-agentic-systems))

| # | Category | Adoption evidence | Leaders at seed–B |
|---|---|---|---|
| 1 | CRM | 92% (GTME). Under 200 employees: Salesforce 38% / HubSpot 38% (LeanScale). ColdIQ: HubSpot 39%, Attio 32%. Ramp: Salesforce 74%, HubSpot 36%, Zoho 13%, Attio 5% (fastest growing), Pipedrive 4%. | HubSpot, Attio, Salesforce (from Series B), Pipedrive |
| 2 | Data / enrichment | 70% of stacks (LeanScale). Clay 71% (ColdIQ) / 84% (GTME). Apollo 35% (ColdIQ). Apollo + ZoomInfo 65% combined (GTME). Ramp: Sales Navigator 48%, Apollo 39% (fastest growing), Clay 24%, ZoomInfo 17%. | Clay, Apollo, Sales Navigator, Prospeo (29%) |
| 3 | Sequencer / sales engagement | 65% (LeanScale). Instantly 35%, Apollo 35% (ColdIQ). | Instantly, Smartlead, Apollo, lemlist; Outreach/Salesloft at enterprise |
| 4 | Automation glue | n8n 48% (ColdIQ) / 54% (GTME). iPaaS 44% (LeanScale). | n8n, Zapier, Make |
| 5 | Meeting recorders / conversation intelligence | 51% of stacks; Gong 40% (LeanScale, B–C skew). Granola has the strongest momentum: about 3x spend growth in 6 months and near-zero churn. Fireflies, Otter and Fathom have larger installed bases but flat growth. ([YipitData](https://www.yipitdata.com/resources/blog/granola-vs-fathom-otter-fireflies-ai-notetaking), vendor panel) | Granola, Fathom (generous free tier); Gong from Series B |
| 6 | LinkedIn automation | HeyReach 35% (ColdIQ); "dominates" (GTME). | HeyReach, Expandi (no data, **unverified**) |
| 7 | Intent / signals | Intent data under 30% (GTME); intent/ABM 21% (LeanScale). | Common Room, Unify, Trigify (no adoption figures, **unverified**) |
| 8 | AI SDR / agentic GTM | Ramp "AI-First GTM" category reaches **under 1% of businesses**. Within it: Attention 33%, Rox 16%, Relevance AI 15%; 11x 33% at enterprise. Widely repeated "41% adoption" and "50–70% churn" claims trace to vendor blogs (**unverified**). | 11x, Artisan, AiSDR |
| — | Calendar / Slack | Ubiquitous; no reliable 2026 adoption data found (**unverified**). | Google Calendar, Calendly, Cal.com, Chili Piper; Slack |

Other useful signals:
- In-house teams run 4–5 active tools, agencies 6–8 (GTME).
- 71% of GTM engineers use AI coding tools, and Lovable appears in 29% of ColdIQ stacks. These teams are comfortable pasting an MCP URL.
- AI SDRs mostly integrate *through the CRM*:
  - 11x has native Salesforce/HubSpot/Pipedrive connectors; its API exists but the endpoint reference is not public. ([11x docs](https://docs.11x.ai/integrations/webhooks))
  - AiSDR has no external API and no Zapier, only HubSpot and Salesforce. ([AiSDR help](https://help.aisdr.com/articles/8943502512-what-crms-does-aisdr-integrate-with))
  - **Reading the CRM is therefore how we see AI SDR activity.**

---

## 3. Integration surface of the top tools

| Tool | API and auth | Webhooks | Official MCP | Our v1 path |
|---|---|---|---|---|
| **HubSpot** | REST. **Service Keys** (public beta since 2026-02-10) replace private apps. New legacy private apps are disabled from 2026-09-28 (new accounts) and **2026-10-26 (existing accounts)**. ([changelog](https://developers.hubspot.com/changelog/legacy-private-app-creation-sunset)) | **Service Keys do not support webhooks** ([changelog](https://developers.hubspot.com/changelog/service-keys)), so we poll on last-modified date. | `mcp.hubspot.com`, OAuth. Read/write on contacts, companies, deals, tickets, and engagements (calls, emails, meetings, notes, tasks). ([HubSpot](https://developers.hubspot.com/mcp)) | **Native:** paste Service Key, poll |
| **Attio** | REST, API key | record.created/updated/merged/deleted, signed (third-party mirrors; **official page not fetched**) | `mcp.attio.com/mcp`, OAuth. Reads run without confirmation; writes ask first. Rate limits 100 reads/s, 25 writes/s. ([Attio](https://docs.attio.com/mcp/overview)) | **Native:** API key, poll (webhooks once a public URL exists) |
| **Salesforce** | OAuth External Client App | Platform events | Hosted MCP GA around 2026-04-29, Enterprise Edition and above (secondary sources, **unverified**) | Defer; CSV for now |
| **Pipedrive** | Personal API token | Yes (set up in UI) | About 32 tools, OAuth only, June 2026 (single source, **unverified**) | Later |
| **Apollo** | REST, API key | — | `mcp.apollo.io/mcp`. OAuth, or `X-Api-Key` with a master key (scoped keys get 403). About 50 actions: search, enrichment, sequences, one-off emails. Credits apply. ([Apollo docs](https://docs.apollo.io/docs/apollo-mcp), updated 2026-10-05) | CSV in. Users wire Apollo MCP into their own agent. |
| **Clay** | Public API v0 with `clay-api-key` header: routines, searches, signals. Tables API is Enterprise only. ([Clay](https://developers.clay.com/llms.txt)) | Routine-run-finished webhook. Each table has an inbound webhook URL and an outbound HTTP API column (community docs). | Local `clay mcp` via CLI. A hosted endpoint `api.clay.com/v3/mcp` appears only in directories (**unverified**). | Clay's HTTP column posts to our webhook; CSV |
| **Instantly** | API v2 with scoped bearer key. Bulk add up to 1,000 leads per call. | reply_received, lead_interested / not_interested, meeting_booked, bounced, unsubscribed, OOO, and others, with reply text in the payload ([events](https://developer.instantly.ai/webhook-events)) | `mcp.instantly.ai/mcp`, 31 tools, API key in a header (or in the URL path) ([help](https://help.instantly.ai/en/articles/12980002-instantly-mcp-model-context-protocol)) | **Native:** push leads, receive replies |
| **Smartlead** | API key **in the query string**. `POST /campaigns/{id}/leads`, max 400 per call. | EMAIL_REPLY, LEAD_CATEGORY_UPDATED ([docs](https://api.smartlead.ai/api-reference/webhooks/events)) | None official found | Webhook template plus CSV |
| **HeyReach** | `X-API-KEY`, 300 requests/min | Configured in the UI; full event list **unverified** | Official per-workspace URL and key ([help](https://help.heyreach.io/en/articles/12126083-how-to-integrate-heyreach-mcp-with-make)) | Webhook template plus CSV |
| **lemlist** | — | — | Nothing found (**unverified**) | CSV |
| **Granola** | `public-api.granola.ai/v1`, `grn_` key, Business plan or above. Read-only notes and transcripts, `created_after` cursor, 5 requests/s. ([docs](https://docs.granola.ai/introduction)) | **None** | `mcp.granola.ai/mcp`, OAuth with dynamic client registration. Transcripts on paid plans only. ([docs](https://docs.granola.ai/help-center/sharing/integrations/mcp)) | **Native:** API key, poll |
| **Fathom** | `api.fathom.ai/external/v1`, `X-Api-Key` | One "new meeting content ready" event that can include transcript, summary, action items and CRM matches, plus a signing secret ([docs](https://developers.fathom.ai/api-reference/webhooks/create-a-webhook.md)) | Official Claude and ChatGPT connectors ([index](https://developers.fathom.ai/llms.txt)) | **Native:** webhook, or poll |
| **Gong** | REST | Automation-rule webhooks signed with RS256 JWT. Transcripts can lag up to 24 hours. ([help](https://help.gong.io/docs/create-a-webhook-rule)) | Synthesized answers only; **no raw transcripts** over MCP. Available on any plan. ([help](https://help.gong.io/docs/about-gong-mcp.md)) | Defer (Series B+); paste box |
| **Common Room** | **Unverified** | **Unverified** | `mcp.commonroom.io/mcp`, OAuth 2.1, 5 generic tools (catalog/list/create/update; read and write) ([docs](https://www.commonroom.io/docs/using-common-room/mcp-server/)) | Webhook or CSV |
| **Unify** | "Data Out API" listed as coming soon | Webhook action inside Plays ([support](https://support.unifygtm.com/articles/8174262358-webhooks-in-plays)) | — | Webhook |
| **Calendly / Cal.com** | Token | `invitee.created` (Standard plan and up, per help center) / `BOOKING_CREATED` | — | Webhook |
| **Slack** | — | Incoming webhook: one URL per channel, POST text or blocks ([docs](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks)) | — | **Native** for outbound alerts |
| **n8n / Zapier** | — | n8n Webhook node | n8n MCP Server Trigger (SSE and Streamable HTTP) ([docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcpTrigger/)). Zapier MCP reportedly costs 2 tasks per call (secondary). | They call our REST/MCP |

### Which path is most universal
1. **CSV.** Every tool exports it, it costs no tokens, and it works offline. It is manual.
2. **REST plus API key, with polling.** Covers HubSpot, Attio, Apollo, Granola, Fathom, Instantly, Smartlead and HeyReach. **Works on localhost** with no OAuth flow to build.
3. **Generic inbound webhook.** Covers sequencers, recorders, calendars, Clay, Unify, n8n/Zapier and 11x. **Needs a public URL.**
4. **Vendor MCPs.** Nearly universal, but mostly OAuth (HubSpot, Attio, Apollo, Granola, Common Room) and designed to be driven by an LLM.
   - Calling them from our backend through Claude's MCP connector means paying tokens for tool definitions and results on every call.
   - The connector is beta, supports tools only, and requires that "the server must be publicly exposed through HTTP." ([Claude docs](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector))
   - **Use vendor MCPs in the user's own agent, not in our sync pipeline.**
5. **Our own MCP/REST.** The one interface every *agent* can use.

---

## 4. Should we expose our own API and MCP server? Yes.

### Precedent
- Attio, HubSpot, Apollo, Instantly, HeyReach, Common Room, Granola, Gong, Fathom and SalesRobot all expose MCP.
- Common Room ships just 5 generic tools.
- Gong exposes synthesized answers rather than raw data.
- Clay lets admins choose which functions agents can call, with credit caps.
- Attio separates reads (no confirmation) from writes (confirmation required).

### Why it matters for tokens
- When Muse, Claude, Cursor or an AI SDR calls our MCP, our server does plain database reads and writes. **We spend zero Claude tokens**; the caller pays for its own inference.
- Our Claude budget is reserved for strategy and drafting.

### Protocol facts (MCP spec 2026-07-28) ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog))
- **Stateless:** no sessions and no initialize handshake. This fits Next.js route handlers.
- **Tool order:** servers SHOULD return tools in a deterministic order, which helps prompt caching for callers.
- **Auth:** authorization is optional for HTTP servers. If implemented, it is OAuth 2.1 with Client ID Metadata Documents; dynamic client registration is now deprecated. ([auth](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization))
- **Human in the loop:** clients SHOULD keep a human able to deny tool calls. ([tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools))
- **Next.js:** `mcp-handler` in `app/api/[transport]/route.ts`, with `@modelcontextprotocol/sdk` 1.26.0 or later (earlier versions have a security flaw). ([README](https://cdn.jsdelivr.net/npm/mcp-handler@1.1.0/README.md))
- **Unverified:** which SDK version supports 2026-07-28, and whether most clients still speak 2025-11-25. Support both.

### Minimal tool surface (9 tools)
Each tool also exists at `/api/v1/*` with the same handlers, plus an OpenAPI spec for n8n, Zapier, Make and Clay.

| Tool | Hint | Purpose and key arguments |
|---|---|---|
| `get_icp` | read-only | ICP, personas, disqualifiers, tiers; compact JSON plus markdown |
| `get_playbook` | read-only | `channel` (email / linkedin / call), `persona?`: positioning, approved claims, banned claims, templates, objection handling |
| `score_accounts` | read-only | `accounts[]` → tier and reasons from **rule-based scoring (no LLM)**. Lets external SDRs filter before spending credits. |
| `search_records` | read-only | Look up accounts, contacts or deals; dedupe check by domain, email or LinkedIn URL |
| `get_next_actions` | read-only | `owner?`, `channel?`, `limit` → approved drafts ready to send, follow-ups due, hot replies, each with an `action_id` |
| `add_accounts` | write, idempotent | Upsert accounts and contacts on domain, email or LinkedIn URL (Common Room pattern). Requires `source` and `external_id`. Returns created / updated / skipped plus fit tier. |
| `log_activity` | write, idempotent | `type` (email_sent, reply, linkedin, call, meeting, note), refs, `occurred_at`, body or summary, `source_tool`, `external_id` |
| `submit_draft` | write | Goes to the **approval queue**; never sends |
| `complete_action` | write | `action_id`, `outcome` (sent, skipped, booked, …) |

Optionally a 10th tool, `add_meeting_notes`, or fold it into `log_activity(type=meeting)`.

Rules for the server:
- Keep descriptions short, because tool definitions cost callers tokens.
- No delete tools.
- Rate-limit per key.
- Log every call with the key name ("Muse added 40 accounts").
- **Treat everything agents push in as untrusted data.** Pushed content never triggers an outbound action without approval in the UI.

### Auth for v1
- A per-key bearer token generated in our UI, with scopes: read / write-records / submit-drafts.
- A URL-path token as a fallback for clients that can't set headers (the Instantly pattern), with rotation.
- Defer OAuth.
- **Unverified:** whether Claude.ai web custom connectors accept a static bearer header. If not, users connect through Claude Code, Cursor, or Claude Desktop with `mcp-remote`.

---

## 5. Data flows that matter

| Flow | Sources | v1 mechanism | Dedupe / ownership | Claude spend |
|---|---|---|---|---|
| **Leads / accounts in** | Apollo, Clay, Sales Navigator and Muse spreadsheets (CSV); Clay HTTP column (webhook); agents (`add_accounts`) | CSV with saved mapping presets; webhook; MCP/REST | Normalized domain, email, LinkedIn URL; per-field provenance | Fixed alias rules for column headers. Haiku only for unmapped headers: one call per file with headers plus 3 sample rows, mapping cached. |
| **Enrichment in** | Clay, Apollo, and fields already in the CRM | Accept their fields; never re-enrich with Claude | Last-write-wins per field, with source and timestamp | 0 |
| **Approved drafts out** | Instantly (≤1,000 per call), Smartlead (≤400), HeyReach, Apollo sequences | Push lead plus custom variables (`{{opener}}`, `{{p1}}`) into the user's existing campaign; the sequencer sends. Fallback: sequencer-formatted CSV, or copy to Muse/Gmail. | Our `draft_id` ↔ their lead ID | Sonnet drafts once; vary them with templates and variables rather than regenerating |
| **Activities / replies back** | Instantly and Smartlead webhooks, HeyReach webhooks, CRM engagements (AI SDRs), `log_activity` | Webhook; polling fallback (Instantly email listing allows 20 requests/min) | Idempotent on (`source_tool`, `external_id`) | **Use the sequencer's own reply labels** (interested, OOO, wrong person). Haiku only for unlabeled replies; Sonnet only to draft a response to a positive reply. |
| **Deals ↔ CRM** | HubSpot (Service Key; no webhooks), Attio | Poll on last-modified every 5–15 min; write deals, associations, notes, tasks | **The CRM owns contacts and deals; we own ICP, playbook, drafts and next actions.** Each field is owned by one side, which prevents sync loops. | 0 |
| **Meeting notes in** | Fathom (webhook includes transcript, summary and action items), Granola (poll; Business plan), Gong (later), paste box | Webhook, polling, paste | Match on attendee email to contact and account | Use the **vendor's summary and action items**. Haiku extracts stage, pains and next step from the summary only. The full transcript goes to Sonnet only on an explicit "deep deal review." |
| **Meetings booked** | Calendly, Cal.com | Webhook | Invitee email | 0 (fixed rule creates a prep task) |
| **Alerts out** | Slack incoming webhook | Templated digest and hot-reply alerts | — | 0 |
| **External agents** | Muse, Claude, Cursor, n8n, 11x | Our MCP/REST | API key per agent | 0 on our side |

**Local-app constraint:**
- Webhooks, Muse, Claude.ai connectors and Claude's API connector all need public HTTPS.
- Default to **polling**, and offer a one-toggle "Public URL" through Cloudflare Tunnel or ngrok.
- Claude Code works locally (`claude mcp add --transport http … --header "Authorization: Bearer …"`) ([docs](https://code.claude.com/docs/en/mcp)). Cursor and Claude Desktop via `mcp-remote` should also work locally (**unverified**).

---

## RECOMMENDATIONS

### v1 integration architecture
1. **Core model.** Account, Contact, Deal, Activity, Draft, Action and Note.
   - An `external_refs(tool, external_id)` table and an append-only event log.
   - Every write is an idempotent upsert carrying `source`.
2. **Build three universal adapters first** (one shared handler layer):
   - **CSV import/export.** Auto-detects the source from headers ("Looks like an Apollo export") and offers presets for Apollo, Clay, Sales Navigator, HubSpot, Instantly, Smartlead, HeyReach and Muse spreadsheets. Export formats match each sequencer.
   - **Generic inbound webhook** at `/api/hooks/{source}/{secret}`.
     - Ships with payload templates for Instantly, Smartlead, HeyReach, Fathom, Calendly, Cal.com, Clay, Unify and n8n.
     - Unknown payloads are stored raw, and the user maps fields in a UI. Haiku suggests a mapping once and it is saved as a template.
   - **Our MCP server plus REST API** (the 9 tools above, bearer keys with scopes, approval queue for drafts).
3. **Native connectors** (API-key paste, polling, no OAuth):
   - HubSpot (Service Key) and Attio: two-way sync of records and notes.
   - Instantly: push leads, pull replies. Smartlead as the fast follow.
   - Fathom: webhook or poll. Granola: poll.
   - Slack: incoming webhook for alerts.
4. **Defer:**
   - Salesforce: Enterprise-only MCP, rare at seed.
   - Gong: Series B and up.
   - Apollo, Clay and HeyReach native connectors: CSV, webhook and the user's own agent with vendor MCP cover these.
   - Any OAuth flows.
   - Consuming vendor MCPs from our backend.
5. **Token policy for integrations:**
   - Sync, dedupe, scoring, reply routing and alerts are plain code (0 tokens).
   - Haiku ($0.10/$0.50 per MTok) for column mapping, unlabeled replies and summary extraction.
   - Sonnet ($2/$10) for drafts and positive-reply responses.
   - Opus ($4/$20) only for playbook and ICP strategy refreshes, cached.

### Connect UX (as simple as possible)
- **Onboarding: one question, "What's in your stack?"**
  - Multi-select of logos grouped by job: *Where do leads come from? What sends outreach? Where do deals live? Where are call notes? Which AI agents do you use?*
  - The Integrations page then shows only those cards, each labeled with the recommended method.
- **Card type A, API key (HubSpot, Attio, Instantly, Smartlead, Fathom, Granola).** Connect, then a modal with:
  1. A deep link ("Open HubSpot → Settings → Integrations → Service Keys") and the required scopes listed.
  2. A paste field, validated live with a cheap "who am I" call. The card shows "Connected · Acme workspace."
  3. A first-sync preview ("1,240 contacts, 86 open deals: import?").
  - Write-back to the CRM is **off by default**, with one toggle to turn it on.
- **Card type B, webhook (sequencers, recorders, calendars, Clay, Unify, n8n, Zapier, Other):**
  - A copyable URL with 3 tool-specific steps and a screenshot.
  - A live "Waiting for first event…" indicator that turns green, then a field-mapping preview.
  - If no public URL exists: "Enable public URL" (one toggle) or "Use API-key polling instead."
- **Card type C, AI agent (Muse, Claude Code, Claude Desktop, Cursor, ChatGPT, n8n):**
  - A "Generate agent key" button, with a choice of read-only / add leads & activities / submit drafts.
  - Tabs with a copy-paste snippet for each client:
    - Claude Code: `claude mcp add …` command
    - Cursor: `mcp.json` entry
    - Claude Desktop: `mcp-remote` config
    - Muse: a ready-made prompt ("Create a custom connector to my GTM hub MCP at https://…/api/mcp; I'll enter the bearer token in the secure prompt"), with a note that a public URL is required
    - n8n / Zapier: REST base URL plus OpenAPI link
  - Each key gets a revoke button and its own activity feed.
- **Card type D, CSV:** always visible. Drag and drop, auto-detected source, mapping preview, dedupe report, undo import.

---
Sources: linked inline above. Additional sources: [Parallel best MCPs for Muse](https://parallel.ai/articles/best-mcp-servers-for-meta-muse.md), [Cleanlist Apollo MCP review](https://www.cleanlist.ai/blog/2026-10-01-apollo-mcp-server-review), [Scalekit Granola MCP vs API](https://www.scalekit.com/blog/granola-mcp-vs-api), [Scalekit HeyReach MCP vs API](https://www.scalekit.com/blog/heyreach-mcp-vs-api), [Scalekit Pipedrive MCP vs API](https://www.scalekit.com/blog/pipedrive-mcp-vs-api), [Smartlead add-to-campaign](https://api.smartlead.ai/api-reference/leads/add-to-campaign.md), [Instantly docs index](https://developer.instantly.ai/llms.txt), [Clay auth](https://developers.clay.com/public-api/authentication.md), [Salesforce MCP (secondary)](https://truto.one/blog/best-mcp-server-for-salesforce-hosted-mcp-vs-unified-api-2026/), [Zapier MCP pricing (secondary)](https://latenode.com/blog/zapier-mcp-pricing), [Laxis AI SDR (vendor)](https://laxis.com/blog/state-of-ai-sdr-2026).