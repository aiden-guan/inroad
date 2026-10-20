# Connector API specs for the AI Head of GTM hub (verified 2026-10-20)

Everything below was checked against official docs fetched today unless it is marked **UNVERIFIED**. Every connector is plain HTTP and costs **zero Claude tokens**. Claude is only used to create content: first lines, briefs and reply triage. Wherever a vendor already gives us something free (Instantly's `lead_interested` labels, Apollo's free search, HubSpot dedupe), we use that instead of an LLM call.

## 0. Cross-cutting facts that shape the architecture

| Concern | Finding | Design consequence |
|---|---|---|
| **The app runs locally** | Vendor webhooks (Cal.com, Attio, Instantly, Smartlead, Lemlist, Zapier/Make/n8n, Clay HTTP column) need a public HTTPS URL. Cal.com SaaS only accepts HTTPS. | Ship an optional tunnel (cloudflared or ngrok) and show the public inbound URL in Settings. Every inbound source also needs a **polling fallback**. |
| **HubSpot versioning** | Date-based paths `/crm/objects/2026-09/...` are current. Releases come every March and September, each supported for at least 18 months. v4 is supported until **March 2027**. One HubSpot doc says all v1–v4 legacy APIs lose support in **Sept 2027**; another says the v1–v3 timeline hasn't been announced. | Build on `2026-09` paths and keep the v3 path as a config fallback. |
| **Pipedrive v1 sunset** | Zapier, Make and Workato all report v1 removal on **2026-07-31**, which has already passed. Pipedrive's own page only promises "≥1 year grace". | **Use v2 only.** |
| **Secrets in URLs** | Smartlead takes `api_key` as a query parameter. Slack, Zapier and Make webhook URLs *are* the secret. | Redact query strings and webhook URLs in every log. Store them encrypted. |
| **Idempotency** | Attio sends an `Idempotency-Key` header. Standard Webhooks uses `webhook-id`. Apollo may retry its webhooks. | Keep an `external_refs` ledger (connector, object, our id → their id) and an `inbound_events` dedupe table. |

---

## 1. HubSpot (private app access token)

**Auth.** Requires super admin. Go to **Development → Legacy apps → Create legacy app → Private**, then **Scopes → Add new scope**. The token is under **Auth tab → Show token → Copy**.
- Header: `Authorization: Bearer <token>`.
- Rotate with "expire later" (old token dies in 7 days) or "expire now". HubSpot emails super admins once a token is 180+ days old.
- Private apps are now labelled "legacy": still supported, but they don't get the newest platform features.
- If the user who created the app is removed, calls can fail with `USER_DOES_NOT_HAVE_PERMISSIONS`. Rotating the token fixes it.

**Base URL:** `https://api.hubapi.com`

**Scopes**
- `crm.objects.companies.read` and `.write`
- `crm.objects.contacts.read` and `.write`
- `crm.objects.deals.read` and `.write`
- For pipelines: `crm.objects.deals.read` appears in the Pipelines API's accepted list. The docs don't map scopes to individual endpoints, so **UNVERIFIED** whether it alone is enough.

| Operation | Method & path (2026-09) | v3 fallback |
|---|---|---|
| Create company | `POST /crm/objects/2026-09/companies` | `POST /crm/v3/objects/companies` |
| Update company | `PATCH /crm/objects/2026-09/companies/{id}` | `PATCH /crm/v3/objects/companies/{id}` |
| Search companies by domain | `POST /crm/objects/2026-09/companies/search` | `POST /crm/v3/objects/companies/search` |
| Create contact | `POST /crm/objects/2026-09/contacts` | `POST /crm/v3/objects/contacts` |
| Update contact by email | `PATCH /crm/v3/objects/contacts/{email}?idProperty=email` (2026-09 equivalent **UNVERIFIED**) | — |
| Batch upsert contacts | `POST /crm/v3/objects/contacts/batch/upsert` (max 100 per batch) | — |
| Create deal | `POST /crm/objects/2026-09/deals` (inferred from the path pattern) | `POST /crm/v3/objects/deals` |
| Default association (single pair) | `PUT /crm/objects/2026-09/{fromType}/{fromId}/associations/default/{toType}/{toId}`, no body | v4: `PUT /crm/v4/objects/.../associations/default/...` |
| Batch default association | `POST /crm/associations/2026-09/{fromType}/{toType}/batch/associate/default` | — |
| Labeled association | `PUT /crm/objects/2026-09/{type}/{id}/associations/{toType}/{toId}` with body `[{"associationCategory":"HUBSPOT_DEFINED","associationTypeId":N}]` | — |
| List deal pipelines | `GET /crm/pipelines/2026-09/0-3` (`0-3` is the deal object type) | `GET /crm/v3/pipelines/deals` |
| List stages | `GET /crm/pipelines/2026-09/0-3/{pipelineId}/stages` | — |

**Association type IDs (HUBSPOT_DEFINED)**

| From → to | Unlabeled | Primary |
|---|---|---|
| contact → company | 279 | 1 |
| deal → company | 341 | 5 |

deal → contact is **3** — taken from the deals guide example, which doesn't name the target object, so **UNVERIFIED**.

**Request bodies**

Create a company:
```json
{"properties":{"name":"Acme","domain":"acme.com","industry":"COMPUTER_SOFTWARE"}}
```

Search companies by domain:
```json
{"filterGroups":[{"filters":[{"propertyName":"domain","operator":"EQ","value":"acme.com"}]}],
 "properties":["name","domain","hs_object_id"],"limit":1}
```

Create a contact and associate it to a company in the same call:
```json
{"properties":{"email":"jane@acme.com","firstname":"Jane","lastname":"Doe","jobtitle":"VP Sales"},
 "associations":[{"to":{"id":"123"},"types":[{"associationCategory":"HUBSPOT_DEFINED","associationTypeId":279}]}]}
```

Create a deal and associate it to a company:
```json
{"properties":{"dealname":"Acme – Pilot","pipeline":"default","dealstage":"appointmentscheduled","amount":"12000"},
 "associations":[{"to":{"id":"123"},"types":[{"associationCategory":"HUBSPOT_DEFINED","associationTypeId":341}]}]}
```

**Key response fields**
- Objects: `id`, `properties.*`, `createdAt`, `updatedAt`, `archived`.
- Search: `total`, `results[]`, `paging.next.after`.
- Pipelines: `results[].id`, `label`, `displayOrder`, `stages[].id`, `stages[].label`. Stage `metadata.probability` shows up in examples but isn't confirmed in list responses.

**Rate limits (private apps)**

| Tier | Per 10 s, per app | Per day, per account |
|---|---|---|
| Free / Starter | 100 | 250k |
| Pro | 190 | 625k |
| Enterprise | 190 | 1M |

- With the API Limit Increase add-on: 250 per 10 s.
- **Search: 5 requests per second per account.** Search responses carry no rate-limit headers.
- The `X-HubSpot-RateLimit-Secondly*` headers are deprecated.

**Gotchas**
- **Search limits:** indexing lags by "a few moments", so search can miss a record created seconds ago. Keep our own domain → id cache. Maximum 10,000 results, 200 per page, 5 filter groups of 6 filters (18 filters total), request body ≤3,000 characters.
- **Domain upserts:** upserting a company by `domain` via `idProperty` is not documented and is **UNVERIFIED**. Use search, then PATCH or POST, guarded by our ledger.
- **Required fields:** a company needs `name` or `domain` (always send `domain`). A deal needs `dealname` and `dealstage` (the **internal stage id**, not the label). Without `pipeline`, the deal goes to the default pipeline.
- **Lifecycle stage** can only move forward unless you clear it first. Enumeration properties take internal values.
- **Partial upserts are not supported** when `idProperty=email`. Batch read cannot return associations.
- Some portals have the "auto-create and associate companies from contact email domain" setting enabled. That can create duplicate companies if we also create them. **UNVERIFIED** current default. Search before creating.

---

## 2. Attio

**Auth.** A workspace admin goes to **Workspace settings (dropdown beside the workspace name) → Developers → new access token**, names it and picks scopes. Tokens don't expire.
- Header: `Authorization: Bearer <token>`. Basic with the token as username also works.
- **Base URL:** `https://api.attio.com/v2`

| Operation | Method & path | Scopes |
|---|---|---|
| Assert (upsert) company | `PUT /v2/objects/companies/records?matching_attribute=domains` | `record_permission:read-write`, `object_configuration:read` |
| Assert person | `PUT /v2/objects/people/records?matching_attribute=email_addresses` | same |
| Add to list, idempotent (**preferred**) | `PUT /v2/lists/{list}/entries`: upserts by parent and returns `MULTIPLE_MATCH_RESULTS` if duplicates exist | `list_entry:read-write`, `list_configuration:read` |
| Add to list, always creates | `POST /v2/lists/{list}/entries`: duplicates are allowed | same |
| Create note | `POST /v2/notes` | `note:read-write`, `object_configuration:read`, `record_permission:read` |

**Request bodies**

Company. The docs give no explicit companies example; this follows the documented pattern and the domain value shape:
```json
{"data":{"values":{"name":"Acme","domains":[{"domain":"acme.com"}]}}}
```

Person, linked to a company by domain and creating the company if it doesn't exist:
```json
{"data":{"values":{"name":"Jane Doe","email_addresses":["jane@acme.com"],
  "company":[{"target_object":"companies","target_record_reference":{
    "match":{"domains":[{"domain":"acme.com"}]},"if_unmatched":"create","if_multiple_matches":"error",
    "create":{"name":"Acme"}}}]}}}
```

List entry (`{list}` is the list slug or UUID):
```json
{"data":{"parent_record_id":"<record uuid>","parent_object":"companies","entry_values":{"stage":"Prospecting"}}}
```

Note:
```json
{"data":{"parent_object":"companies","parent_record_id":"<uuid>","title":"Account brief",
 "format":"markdown","content":"## Why now\n- Raised Series A\n- Hiring 3 AEs"}}
```

**Key response fields**
- Records: `data.id.record_id`, `data.id.object_id`, `data.web_url` (store it for deep links), `data.values`.
- List entries: `data.id.entry_id`.
- Notes: `data.id.note_id`.

**Rate limits**
- 100 reads per second and **25 writes per second**.
- Each `if_unmatched:"create"` reference counts as an extra write.
- A 429 response includes `Retry-After` as a *date*, usually the next second, and the request is safe to retry.
- List and query endpoints also have a complexity-score limit summed over a 10-second window.

**Gotchas**
- `data` rejects unknown properties.
- If the matching value hits more than one record, the request is rejected.
- On assert, any multiselect attribute **other than** the matching attribute is *replaced* to match what you send. To avoid clobbering, send only the fields you own.
- Note titles are plaintext. Note Markdown only supports H1–H3, lists, bold, italic, strikethrough, highlight and links.
- Webhooks: signed in the `Attio-Signature` header (also `X-Attio-Signature`) as an HMAC-SHA256 **hex** digest of the raw body. Deliveries time out after 5 s, retry up to 10 times over about 3 days, and carry an `Idempotency-Key`.

---

## 3. Pipedrive (API token, **v2 only**)

**Auth.** **Account name → Company settings → Personal preferences → API**, or go directly to `https://app.pipedrive.com/settings/api`.
- Header: `x-api-token: <token>`.
- The token is tied to one user. Only one can be active at a time, so regenerating it breaks existing integrations.
- **Base URL:** `https://{companydomain}.pipedrive.com/api/v2`

| Operation | Method & path | Required | Example body |
|---|---|---|---|
| Create organization | `POST /api/v2/organizations` (cost 5) | `name` | `{"name":"Acme","website":"https://acme.com","owner_id":123,"visible_to":3}` |
| Create person | `POST /api/v2/persons` | `name` | `{"name":"Jane Doe","org_id":42,"emails":[{"value":"jane@acme.com","primary":true,"label":"work"}]}` |
| Create deal | `POST /api/v2/deals` | `title` | `{"title":"Acme – Pilot","org_id":42,"person_id":77,"value":12000,"currency":"USD","pipeline_id":1,"stage_id":3}` |
| Find person by email | `GET /api/v2/persons/search?term=jane%40acme.com&fields=email&exact_match=true` | — | — |
| Find organization | `GET /api/v2/organizations/search?term=...` (**UNVERIFIED** path) | — | — |
| Pipelines | `GET /api/v2/pipelines` | — | — |
| Stages | `GET /api/v2/stages?pipeline_id=` (**UNVERIFIED** path) | — | — |

**Key response fields:** `success`, `data.id`, `additional_data.next_cursor`. v2 uses cursor pagination.

**Rate limits**
- Daily token budget = 30,000 × plan multiplier × seats. Multipliers: Lite 1, Growth 2, Premium 5, Ultimate 7.
- Burst per 2 seconds, per token: Lite 20, Growth 40, Premium 100, Ultimate 120.
- **Search: 10 requests per 2 seconds** on every plan, and each search costs 40 tokens.
- Headers: `x-ratelimit-*` and `x-daily-requests-left`.
- Once the daily budget is used up, everything returns 429 until the next day. If you keep hammering after 429s, you can get a 403 Cloudflare HTML page.

**Gotchas (v2 changes)**
- `user_id` becomes `owner_id`. `email` and `phone` become `emails[]` and `phones[]`.
- Custom fields move into a nested `custom_fields` object, keyed by 40-character hashes. Fetch the field definitions to map them.
- `PUT` becomes `PATCH`. Booleans replace `1`/`0`. Timestamps are RFC 3339.
- There is **no domain field** for dedupe. Store the domain in `website` and keep our own domain → org_id map.

---

## 4. Instantly (API v2)

**Auth.** **Settings → Integrations → API Keys** (`app.instantly.ai/app/settings/integrations`). Create a v2 key and pick its scopes. The key is shown only once.
- Header: `Authorization: Bearer <key>`.
- A paid plan is required; otherwise calls return **402**.
- **Base URL:** `https://api.instantly.ai/api/v2`

**List campaigns**
- `GET /campaigns?limit=100&starting_after=<cursor>&status=1&search=`
- Scopes (any one): `campaigns:read`, `campaigns:all`, `all:read`, `all:all`.
- Response: `items[].id`, `items[].name`, `items[].status`, `next_starting_after`.
- Status values: 0 draft, 1 active, 2 paused, 3 completed, 4 running subsequences, -1 accounts unhealthy, -2 bounce protect, -99 suspended.

**Add leads in bulk**
- `POST /leads/add`
- Scopes (any one): `leads:create`, `leads:all`, `all:create`, `all:all`.
- Body:
```json
{"campaign_id":"<uuid>","skip_if_in_workspace":true,"verify_leads_on_import":false,
 "leads":[{"email":"jane@acme.com","first_name":"Jane","last_name":"Doe","company_name":"Acme",
   "job_title":"VP Sales","website":"https://acme.com",
   "personalization":"Saw Acme just opened a Berlin office — congrats.",
   "custom_variables":{"pain_point":"ramp time for new AEs","trigger":"Series A"}}]}
```
- Allowed lead fields (`additionalProperties:false`): `email`, `first_name`, `last_name`, `company_name`, `job_title`, `phone`, `website`, `personalization`, `lt_interest_status`, `pl_value_lead`, `assigned_to`, `custom_variables`. Custom variable values must be string, number, boolean or null.
- Response: `leads_uploaded`, `duplicated_leads`, `skipped_count`, `in_blocklist`, `invalid_email_count`, `duplicate_email_count`, `remaining_in_plan`, `created_leads[]` (with `index` and `id`).

**Rate limits:** 100 requests per second and 6,000 per minute, **per workspace, shared between v1 and v2.** No documented Retry-After.

**Gotchas**
- 1–1000 leads per call.
- Send exactly one of `campaign_id` or `list_id`. Campaign imports require `email`.
- `skip_if_in_workspace` overrides the other `skip_if_*` flags.
- Unknown lead keys are rejected, so all personalization goes into `personalization` or `custom_variables`.
- Adding custom variables updates the *campaign's* variable set.
- In templates, use `{{variable_name}}`. **UNVERIFIED:** whether `personalization` renders as `{{personalization}}`.
- Use `created_leads[].index` to map results back to our input.

**Webhooks (inbound to us)**
- `POST /webhooks` with body `{"target_hook_url":"https://.../in/instantly/<token>","event_type":"reply_received","campaign":null,"headers":{"Authorization":"Bearer <ourInboundSecret>"}}`
- Events include `reply_received`, `lead_interested`, `lead_meeting_booked`, `email_bounced`, `lead_unsubscribed`, or `all_events`.
- Payloads include `reply_text`, `lead_email`, `campaign_id`, `unibox_url`.
- There is no HMAC signature. Authenticate with the custom header we set.
- Webhook `status` becomes -1 when deliveries fail, so poll it to detect the error.

**Token saving:** use Instantly's own `lead_interested` / `lead_not_interested` labels instead of classifying replies with Claude.

---

## 5. Smartlead

**Auth.** **Profile icon → Settings → API Keys → Generate New API Key**. The key is shown once.
- Passed as the query parameter `?api_key=` (or as `api_key` in a POST JSON body).
- **Base URL:** `https://server.smartlead.ai/api/v1`

**List campaigns**
- `GET /campaigns/?api_key=...&include_tags=false`
- Response: `id` (number), `name`, `status` (`ACTIVE`, `PAUSED`, `STOPPED`, `ARCHIVED`, `DRAFTED`), `created_at`, `client_id`.
- The docs contradict themselves on shape: a bare array vs `{success, campaigns}`. Parse both.

**Add leads**
- `POST /campaigns/{campaign_id}/leads?api_key=...`
- Body:
```json
{"lead_list":[{"email":"jane@acme.com","first_name":"Jane","last_name":"Doe","company_name":"Acme",
  "website":"acme.com","linkedin_profile":"https://linkedin.com/in/jane",
  "custom_fields":{"first_line":"Saw Acme just opened a Berlin office.","trigger":"Series A"}}],
 "settings":{"ignore_global_block_list":false,"ignore_unsubscribe_list":false,
  "ignore_duplicate_leads_in_other_campaign":false,"ignore_community_bounce_list":false}}
```
- Response: `added_count`, `skipped_count`, `skipped_leads[]` (the reason format isn't documented).

**Rate limits**
- Standard: 60 per minute, 1,000 per hour, burst 10 per second.
- Pro: 120 per minute, 3,000 per hour, burst 20 per second.
- Headers: `X-RateLimit-*` and `Retry-After`.
- Some analytics endpoints are capped at 10 requests per 60 s, and their 429 is plain text with no headers.

**Gotchas**
- **Max 400 leads per request** according to the current docs. An older figure of 100 circulates, so keep the batch size configurable.
- Up to 200 `custom_fields` per lead.
- Template tokens are `{{field_name}}` and are **case-sensitive**. A mismatched name renders blank.
- Leads already in the campaign, block-listed or unsubscribed are always skipped.
- Webhooks: one guide documents `POST /webhook/create` with `event_type_map` (`EMAIL_SENT`, `EMAIL_REPLIED`, …). Another variant is `POST /campaigns/{id}/webhooks` with `event_types` like `EMAIL_REPLY` (**UNVERIFIED**). Retries happen at 1 min, 5 min, 15 min, 1 h and 6 h, then the webhook is disabled. The HMAC header name is **UNVERIFIED**.

---

## 6. lemlist

**Auth.** **Profile picture (bottom-left) → Settings → Integrations → generate API key**. The key is shown once.
- HTTP Basic with an **empty username** and the key as the password: `Authorization: Basic base64(":" + key)`.
- **Base URL:** `https://api.lemlist.com/api`

**List campaigns**
- `GET /campaigns?version=v2&status=running&limit=100&offset=0&sortBy=createdAt&sortOrder=desc`
- Returns a bare array of `_id`, `name`, `status` (`running`, `paused`, `draft`, `ended`, `archived`, `errors`) with no cursor. Page until you get fewer than `limit`.

**Add a lead (one per call; no bulk endpoint)**
- `POST /campaigns/{campaignId}/leads/?deduplicate=true&updateStrategy=fillEmptyOnly`
- Body:
```json
{"email":"jane@acme.com","firstName":"Jane","lastName":"Doe","companyName":"Acme","companyDomain":"acme.com",
 "jobTitle":"VP Sales","linkedinUrl":"https://www.linkedin.com/in/jane","timezone":"America/New_York",
 "icebreaker":"Saw Acme just opened a Berlin office — congrats.","trigger":"Series A"}
```
- Any extra key, such as `trigger`, becomes a text custom variable `{{trigger}}`. Names keep only letters, digits, `_`, `-`, space and `#`; other characters become `_`.
- Optional enrichment flags: `findEmail`, `verifyEmail`, `linkedinEnrichment`, `findPhone`. Whether they consume lemlist credits is **UNVERIFIED**.
- Response: `_id`, `campaignId`, `contactId`, `isPaused`, `warnings[]` (for example `COMPANY_DOMAIN_IGNORED` for gmail.com).

**Rate limit:** 20 requests per 2 seconds per key. `Retry-After` and `X-RateLimit-*` are on every response.

**Gotchas**
- Returns 400 `LEAD_ALREADY_IN_CAMPAIGN` if the lead exists, and 409 if they're in another campaign (with `deduplicate=true`).
- A new company requires the "Create companies" permission, otherwise you get 403 and nothing is written.
- Company fields write to a *shared* company record that other leads read.
- To update an existing lead, use `PATCH /campaigns/{id}/leads/{leadId}`.
- Webhooks: `POST /hooks` with `{"targetUrl","type","secret"}`. The `secret` is echoed back in the callback body; there is no HMAC.
  - Maximum 200 webhooks per workspace, one per URL.
  - The webhook auto-disables on a 404 or 410 from us.
  - Since 2026-03-30, unsubscribes arrive as `entityUnsubscribed` or `variableUnsubscribed`.

---

## 7. Apollo.io

**Auth.** **Settings → Integrations → API Keys → Create new key**. Choose the endpoints it can call, or toggle "Set as master key".
- Header: `x-api-key: <key>`.
- **Base URL:** `https://api.apollo.io/api/v1`

| Operation | Method & path | Credits | Notes |
|---|---|---|---|
| **People search** (domain + titles) | `POST /mixed_people/api_search?q_organization_domains_list[]=acme.com&person_titles[]=vp%20sales&person_seniorities[]=vp&per_page=100&page=1` | **0** | Parameters go in the **query string** even though it's a POST. **No emails or phones**: you get `id`, `first_name`, `last_name_obfuscated`, `title`, `has_email`, `organization`. Up to 100 per page, 500 pages, 50k results. Up to 1,000 domains. Needs a key scoped to this endpoint or a master key. |
| Person enrichment (reveal email) | `POST /people/match?id=<apollo person id>` | 1 for email or demographics; **+8 for mobile**; 0 if nothing found | Phone or waterfall data needs an HTTPS `webhook_url` and arrives asynchronously. Bulk version takes up to 10 people (path `/people/bulk_match` **UNVERIFIED**). |
| Organization enrichment | `GET /organizations/enrich?domain=acme.com` | **1** | Returns `organization.name`, `estimated_num_employees`, `industry`, `keywords`, `total_funding`, `latest_funding_stage`, `funding_events`, `technology_names`. |
| Create contact | `POST /contacts` with `{"first_name","last_name","email","organization_name","website_url","title","run_dedupe":true}` | 0 | Without `run_dedupe` it creates duplicates. With it, a match **overwrites** fields you send. |
| Find sequences | `POST /emailer_campaigns/search?q_name=` | 0 | `emailer_campaigns[].id`, `name`, `active` |
| Mailboxes | `GET /email_accounts` | 0 | `email_accounts[].id` |
| **Add to sequence** | `POST /emailer_campaigns/{sequence_id}/add_contact_ids?emailer_campaign_id={sequence_id}&send_email_from_email_account_id={id}&contact_ids[]=...` | 0 | Only works for **contacts**, not raw people. Unknown IDs come back in `skipped_contact_ids` instead of as an error. Flags like `sequence_active_in_other_campaigns` and `sequence_unverified_email` default to false. |

**Rate limits**
- Limits are per team, per endpoint, in fixed windows.

| Plan | Per minute | Per hour | Per day |
|---|---|---|---|
| Free | 50 | 200 | 600 |
| Basic / Pro | 200 | 400 | 2,000 |
| Organization | 200 | 600 | 6,000 |

- Search on Basic and above: 200 per minute, 6,000 per hour, 50,000 per day.
- Enrichment on paid plans: 1,000 per minute, but credits still apply. Docs examples also show **600 per hour** on enrichment endpoints.
- Headers: `x-minute-requests-left` and similar, plus `retry-after`.
- Two kinds of 429: `USAGE.RATE_LIMIT.API_RATE_LIMIT_EXCEEDED` (wait for `retry-after`) and `PLATFORM_RATE_LIMIT` (wait 60 s; no header).

**Gotchas**
- Legacy error fields are removed on **2027-02-16**. Read `error_details`.
- **Credit-saving flow:** free `api_search` → score ICP fit in code or with Haiku → `people/match` only for the top N → cache org enrichment by domain for 30–90 days.

---

## 8. Clay

**Pushing rows *into* Clay (webhook source)**
- Setup: in the table, **+ Add → Webhooks → Monitor webhook**, then copy the URL. Use the URL Clay generates; example path formats differ.
- Send `POST` with `Content-Type: application/json`, **one JSON object per row**. Whether arrays are accepted is **UNVERIFIED**.
- Optional auth token: sent in a request header and visible only once. The header name `x-clay-webhook-auth` comes from third-party sources and is **UNVERIFIED** in official docs.
- **Hard cap: 50,000 submissions per webhook source, for its lifetime.** Deleting rows doesn't reset it. Enterprise "auto-delete / passthrough" tables are unlimited. Track the count and prompt the user to rotate to a new webhook.
- Throughput: **UNVERIFIED**. Third-party sources mention 429s; space requests about 100 ms apart.
- Plan: per clay.com/pricing, **Webhooks and HTTP API are on Growth** ($446/mo headline, "$495" in the FAQ) and Enterprise. Launch doesn't have them. Which *direction* the "Webhooks" line covers is **UNVERIFIED**.

**Clay pushing rows *out* to us**
- Use the **HTTP API enrichment column**: method, our URL, headers stored as a reusable "HTTP API (Headers) account", and a JSON body with column references (`"email": "/Email"`; leave numbers unquoted).
- It has a configurable rate limit (for example 10 requests per 1000 ms) and conditional-run formulas.
- Point it at `POST https://<tunnel>/api/hooks/in/clay/<token>`.
- Clay's public API is Enterprise-only.

**Positioning:** treat Clay as *the user's* enrichment brain. We send it domains and pull back enriched rows, which avoids running enrichment through our own Claude calls.

---

## 9. Slack (incoming webhook)

**Auth.** Go to `api.slack.dev/apps`, **Create app → Incoming Webhooks → Activate → Add New Webhook to Workspace → choose channel → Authorize**. For a private channel the user must be a member.
- The URL `https://hooks.slack.com/services/T…/B…/…` is the secret. Slack actively revokes leaked ones.

**Request:** `POST <url>` with `Content-Type: application/json`. Success returns 200 with plain text `ok`.

**Daily brief payload**
```json
{"text":"GTM daily brief – Oct 20: 3 hot accounts, 2 replies need you",
 "blocks":[
  {"type":"header","text":{"type":"plain_text","text":"GTM Daily Brief · Tue Oct 20"}},
  {"type":"section","fields":[
    {"type":"mrkdwn","text":"*Pipeline*\n$184k (+$12k)"},
    {"type":"mrkdwn","text":"*Meetings this week*\n7"},
    {"type":"mrkdwn","text":"*Replies (24h)*\n9 · 3 positive"},
    {"type":"mrkdwn","text":"*Bounce rate*\n1.8%"}]},
  {"type":"divider"},
  {"type":"section","text":{"type":"mrkdwn","text":"*Top 3 actions*\n1. Reply to <https://app.instantly.ai/...|Jane @ Acme> (asked for pricing)\n2. Move *Globex* to Demo stage\n3. Approve 40 leads for _Series-A RevOps_ campaign"}},
  {"type":"context","elements":[{"type":"mrkdwn","text":"Generated by AI Head of GTM · <http://localhost:3000|Open dashboard>"}]}]}
```

**Limits**
- 50 blocks per message.
- Section `text` 1–3,000 characters. `fields` up to 10 items, each ≤2,000 characters.
- Header is `plain_text`, ≤150 characters.
- `block_id` ≤255 characters.
- **1 message per second** per webhook or channel; short bursts are tolerated.

**Errors**
- Don't retry: `invalid_payload`, `no_text`, `channel_not_found`, `action_prohibited`, `posting_to_general_channel_denied`.
- Disable the connector and alert the user: `no_service`, `no_active_hooks`, `channel_is_archived`.

**Gotchas**
- You can't override the channel, username or icon.
- Messages can't be deleted or edited, and no `ts` is returned, so you can't thread replies.
- Always include top-level `text` as the notification fallback.
- Prefer mrkdwn `<url|label>` links over `button` elements. Buttons may expect an interactivity endpoint (**UNVERIFIED** behavior without one).

---

## 10. Zapier, Make and n8n, and our generic webhook contract

### Their catch hooks (we POST to them)

| Tool | URL | Payload | Limits | Response |
|---|---|---|---|---|
| Zapier "Catch Hook" | `https://hooks.zapier.com/hooks/catch/{acct}/{hook}/` | JSON object. **An array of N objects triggers N runs.** | 10 MB (Catch Raw Hook: 2 MB). Paid plans only: Professional, Team, Enterprise. | Always 200 and can't be customized. Paused or deleted Zaps return 404, possibly hours later. |
| Make custom webhook | `https://hook.{region}.make.com/...` (format **UNVERIFIED**) | Query string and body merge into one bundle. | **300 requests per 10 s**, then 429. Queue holds 667 items per 10k credits, max 10k; a full queue returns 400. | 200 `Accepted`, or a custom reply via the Webhook response module. |
| n8n Webhook node | Production `/webhook/<path>`, test `/webhook-test/<path>` (prefixes **UNVERIFIED**; the docs only say test vs production URL) | Any method. Basic, Header or JWT auth. Optional IP allowlist. | 16 MB (`N8N_PAYLOAD_SIZE_MAX`) | Immediate, after the last node, or via a "Respond to Webhook" node. |

### Our **outbound** webhook (Standard Webhooks spec)

Headers:
- `content-type: application/json`
- `webhook-id: msg_<ulid>` — stable across retries
- `webhook-timestamp: <unix seconds>`
- `webhook-signature: v1,<base64(HMAC_SHA256(secretBytes, id + "." + ts + "." + rawBody))>`

The secret is `whsec_` followed by 24–64 random bytes in base64. Space-separate multiple signatures during secret rotation.

Body:
```json
{"type":"lead.qualified","timestamp":"2026-10-20T14:03:11Z",
 "data":{"lead":{"email":"jane@acme.com","first_name":"Jane","title":"VP Sales","company_domain":"acme.com"},
         "score":82,"reasons":["Series A in last 90d","Hiring AEs"],"first_line":"...","dashboard_url":"..."}}
```

Keep payloads under 20 KB. Event types: `lead.qualified`, `lead.created`, `account.signal`, `brief.daily`, `reply.positive`, `meeting.booked`, `deal.stage_changed`.

Retries:
- Timeout 15–30 s.
- Schedule after the first attempt: 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 14 h, 20 h, 24 h, with jitter.
- Any 2xx is success. Don't follow 3xx.
- **410: disable the endpoint.** 429, 502 or 504: back off and honor `retry-after`.
- Persist attempts in an outbox table so they survive app restarts.

Tool-specific notes:
- **Zapier can't check HMAC natively.** The URL secrecy is the auth, plus an optional Code step.
- Emit one object per event by default. Add an opt-in "batch as array" flag for Zapier fan-out.

### Our **inbound** webhook (tools POST to us)

- Endpoint: `POST /api/hooks/in/{source}/{token}`. `source` is one of `generic`, `clay`, `zapier`, `make`, `n8n`, `instantly`, `lemlist`, `calcom`, `attio`, `smartlead`.
- Auth, accept any one of:
  - path token, or `Authorization: Bearer <token>`, or `x-gtm-token`;
  - a Standard Webhooks signature;
  - vendor-native checks: Cal.com `x-cal-signature-256` (HMAC-SHA256 of the raw body), `Attio-Signature` (hex HMAC), the lemlist body `secret`, or the Instantly custom header.
- Accept a single object or an array.
- Canonical body:
```json
{"type":"lead.upsert","data":{"email":"...","first_name":"...","company_domain":"...","title":"...","custom":{}}}
```
- Map fields with a **deterministic alias table** (`Email`, `email_address`, `work_email` → `email`) and no LLM. Only ask Haiku when an unknown schema shows up for the first time, then cache that mapping per source.
- Reply 200 within about 2 s and process asynchronously (Attio times out at 5 s).
- Dedupe on `Idempotency-Key`, `webhook-id`, or `sha256(body)`.
- Store raw payloads for 7 days for replay.

---

## 11. Cal.com and Calendly

**Cal.com (API key, no OAuth)**
- Key: **Settings → Security** per the docs. Prefix `cal_live_` (live) or `cal_` (test). Header `Authorization: Bearer <key>`.
- **Base URL:** `https://api.cal.com/v2` (the spec's server list is empty; this is the standard host).
- Upcoming bookings: `GET /v2/bookings?status=upcoming&afterStart=2026-10-20T00:00:00Z&limit=100`
  - Header `cal-api-version: 2026-05-01` is required, per the docs today. It used to be `2024-08-13`, so keep it configurable.
  - Response: `data[].uid`, `title`, `start`, `end`, `attendees[]`, `status`, `location` (`meetingUrl` is deprecated), `pagination.nextCursor`, `hasMore`.
- Rate limit: 120 requests per minute. About 200 is available on request; 800 may cost extra.
- Webhooks (no OAuth, free):
  - Configure at `/settings/developer/webhooks`. Events: `BOOKING_CREATED`, `BOOKING_CANCELLED`, `BOOKING_RESCHEDULED`, `MEETING_ENDED`, and others.
  - Body: `{triggerEvent, createdAt, payload}`. `MEETING_STARTED` and `MEETING_ENDED` are flat, with no `payload` wrapper.
  - Signature: `x-cal-signature-256`, HMAC-SHA256 of the raw body. Hex encoding is **UNVERIFIED**.
  - Custom payload templates are supported.
- Booking-link prefill: `https://cal.com/{user}/{event}?name=Jane%20Doe&email=jane@acme.com&notes=...&guests=a@x.com&guests=b@x.com`. `metadata[key]` is documented for embeds; whether it works as a plain URL parameter is **UNVERIFIED**.

**Calendly (Personal Access Token: this is *not* OAuth)**
- Token: **Integrations → API & Webhooks → Personal Access Tokens → Generate new token**, choosing scopes. The token is shown once and is meant for internal use.
- Header: `Authorization: Bearer`. Base URL: `https://api.calendly.com`.
- Calls:
  - `GET /users/me` returns `resource.uri` and `current_organization`.
  - `GET /scheduled_events?user=<uri>&status=active&min_start_time=<ISO>` (scope `scheduled_events:read`).
- Per the FAQ, API GET and POST calls work on **any plan including Free**, except a few Enterprise-only endpoints.
- **Webhooks need a paid Standard, Teams or Enterprise plan.** Use `POST /webhook_subscriptions` with events `invitee.created`, `invitee.canceled`, `routing_form_submission.created`, at `user` or `organization` scope. On Free, poll instead.
- Prefill: `?name=&email=&a1=...a10=`. This is documented for embeds and routing forms; plain scheduling-page URL parameters are **UNVERIFIED**.
- Rate limits: **UNVERIFIED**.

**Zero-auth value:** store the booking link and inject a prefilled link per lead into first lines and the brief. This needs no API at all.

---

## 12. Gmail and Outlook without OAuth

- **Gmail compose deep link:** `https://mail.google.com/mail/u/0/?tf=cm&to=jane%40acme.com&cc=&bcc=&su=Quick%20idea&body=Hi%20Jane%2C%0D%0A...`
  - The legacy `view=cm&fs=1` form is still widely used; `fs` has no effect.
  - Replace `/u/0/` with `/u/{email}/` to choose the account.
  - Mobile Safari opens the inbox, not a compose window.
- **Outlook (unofficial):** `https://outlook.office.com/mail/deeplink/compose?to=...&subject=...&body=...` (consumer accounts use `outlook.live.com`). `cc` is unreliable, and fields can drop after a session expires. **No official spec.**
- **mailto:** `mailto:jane@acme.com?subject=...&body=...` (RFC 6068). Uses the OS default client. Encode newlines as `%0D%0A`.
- **Length:** there is no official limit. About 4,096 encoded characters total is reported for Gmail (third-party, **UNVERIFIED**). Keep the encoded URL under about 1,800 characters. Above that, fall back to "copy body to clipboard, then open compose with to and subject only".

**What OAuth unlocks**
- **Gmail API:** `gmail.send` is a *sensitive* scope (OAuth verification required). `gmail.compose`, `readonly`, `modify` and `metadata` are *restricted* scopes; storing that data server-side requires a security assessment. Together these enable server-side drafts, sending, reply detection and thread sync.
- **Microsoft Graph:** delegated `Mail.Send` and `Mail.ReadWrite`.
- **Outlook SMTP:** Exchange Online basic-auth SMTP is disabled by default for existing tenants **from end of Dec 2026** (third-party mirrors of MC786329). Don't build on SMTP AUTH.
- A local single-user Google OAuth app in "Testing" status, with the user as test user, may avoid verification (**UNVERIFIED** current policy). That's a v2 option.

---

## Claude-token budget per connector

| Connector | Claude needed? | Where tokens are spent (cheapest viable model) |
|---|---|---|
| HubSpot, Attio, Pipedrive | No | Only the *content* of notes or account briefs (Sonnet, once per account, cached) |
| Instantly, Smartlead, lemlist | No | `personalization`, `icebreaker` and `custom_fields` first lines (Haiku in batches; Sonnet only for top-tier accounts). Reply triage uses vendor labels: **0 tokens**. |
| Apollo | No | ICP scoring of free search results uses rules first, then Haiku only for ambiguous rows |
| Clay | No | — |
| Slack | No | Daily brief: one Sonnet call per day over precomputed metrics (numbers come from code) |
| Webhooks | No | One-time Haiku field mapping for an unknown inbound schema, then cached |
| Cal.com, Calendly, email deep links | No | — |

---

## Recommended v1 connector list (ranked by value-to-effort, seed–Series B)

1. **Slack incoming webhook.** Size XS. The daily brief is the hero feature: one POST, no OAuth.
2. **Generic webhooks out and in (Standard Webhooks).** Size S. One build covers Zapier, Make, n8n, Clay's HTTP column, and any agent tool the team already runs (the "Muse"-style tools), with no per-vendor code.
3. **HubSpot (private app token).** Size M. The most common CRM at this stage. Covers company, contact and deal create plus default associations and pipelines.
4. **Instantly v2.** Size S. Bulk 1,000 leads per call, `custom_variables` for first lines, webhook replies with vendor interest labels so triage costs nothing.
5. **Apollo.** Size S–M. **Free (0-credit) people search** by domain and title, 1-credit org enrichment cached by domain, push to sequences.
6. **Attio.** Size S. Popular with seed teams, and assert-by-domain or email gives natural idempotency.
7. **Email compose deep links (Gmail, Outlook, mailto).** Size XS. "Send from my own inbox" for founder-led sales with zero auth.
8. **Calendly PAT and Cal.com API key (read upcoming meetings) plus prefilled booking links.** Size S. Feeds meetings-booked metrics and meeting-prep briefs.

**v1.1:** Smartlead (400 per batch, query-string key), lemlist (one lead per call, 20 requests per 2 s), Pipedrive (v2 only, no domain field), Clay native setup screen, Gmail and Graph OAuth.

**Muse:** this is ambiguous.
- Meta's Muse is a consumer agent launched 2026-09-08 that connects to email, calendar and payments. A public developer API or custom-connector support is **UNVERIFIED**.
- SalesRobot's "Muse" connects through MCP plus an API key.
- Integrate both through the generic webhook contract, plus an optional MCP server that exposes our hub's read and write tools.

---

## Generic connector interface (TypeScript)

```ts
// ---------- Canonical domain objects (the hub's lingua franca) ----------
export type Scalar = string | number | boolean | null;

export interface Company {
  domain: string;                      // normalized: lowercase, no scheme / www
  name?: string; website?: string; industry?: string;
  employeeCount?: number; fundingStage?: string; linkedinUrl?: string;
  custom?: Record<string, Scalar>;
}
export interface Person {
  email?: string; firstName?: string; lastName?: string; title?: string;
  linkedinUrl?: string; phone?: string; companyDomain?: string; timezone?: string;
  firstLine?: string;                  // -> Instantly.personalization / lemlist.icebreaker / Smartlead custom_fields.first_line
  customVars?: Record<string, Scalar>; // -> custom_variables / custom_fields / extra lemlist keys
}
export interface Deal {
  name: string; amount?: number; currency?: string;
  pipelineId?: string; stageId?: string; companyRef?: ExternalRef; personRefs?: ExternalRef[];
}
export interface Note { title: string; markdown: string; parent: ExternalRef }

export interface ExternalRef {
  connectorId: ConnectorId; objectType: "company" | "person" | "deal" | "list_entry" | "note" | "lead" | "contact";
  externalId: string; url?: string;    // e.g. Attio web_url, HubSpot record URL
}

// ---------- Manifest ----------
export type ConnectorId =
  | "hubspot" | "attio" | "pipedrive" | "instantly" | "smartlead" | "lemlist" | "apollo"
  | "clay" | "slack" | "webhook_out" | "webhook_in" | "calcom" | "calendly" | "email_links";

export type AuthSpec =
  | { kind: "bearer" }                                   // HubSpot, Attio, Instantly, Cal.com, Calendly
  | { kind: "header"; header: "x-api-key" | "x-api-token" } // Apollo, Pipedrive
  | { kind: "basic_empty_user" }                         // lemlist
  | { kind: "query"; param: "api_key" }                  // Smartlead (redact in logs!)
  | { kind: "secret_url" }                               // Slack, Zapier, Make, n8n, Clay webhook
  | { kind: "none" };                                    // email deep links

export interface RateLimitSpec {
  requests: number; perMs: number;                       // token bucket, e.g. HubSpot 100/10_000
  extraBuckets?: Record<string, { requests: number; perMs: number }>; // e.g. { search: {5,1000} }
  retryAfter: "seconds" | "http-date" | "none";          // Attio sends a date
  maxBatch?: Partial<Record<"leads" | "records" | "associations", number>>; // Instantly 1000, Smartlead 400, HubSpot 100
}

export type Capability =
  | "crm.findCompanyByDomain" | "crm.upsertCompany" | "crm.upsertPerson" | "crm.createDeal"
  | "crm.associate" | "crm.addToList" | "crm.addNote" | "crm.listPipelines"
  | "outreach.listCampaigns" | "outreach.addLeads"
  | "enrich.searchPeople" | "enrich.revealPerson" | "enrich.company"
  | "notify.post" | "events.inbound" | "events.outbound"
  | "calendar.listUpcoming" | "calendar.bookingLink" | "email.composeLink";

export interface ConnectorManifest {
  id: ConnectorId; name: string;
  category: "crm" | "outreach" | "enrichment" | "notify" | "automation" | "calendar" | "email";
  auth: AuthSpec; configFields: { key: string; label: string; secret: boolean; help: string }[];
  capabilities: Capability[]; rateLimit: RateLimitSpec;
  costModel?: { creditsPer?: Partial<Record<Capability, number>> }; // Apollo: revealPerson 1(+8 mobile), company 1
  docsUrl: string;
}

// ---------- Results ----------
export type Result<T> =
  | { ok: true; value: T; warnings?: string[] }
  | { ok: false; error: { code: "auth" | "rate_limited" | "not_found" | "conflict" | "validation" | "plan" | "upstream";
                         message: string; retryAfterMs?: number; raw?: unknown } };

export interface BulkResult { created: ExternalRef[]; skipped: { index: number; reason: string }[]; }

// ---------- Capability adapters (implement only what the tool supports) ----------
export interface CrmAdapter {
  findCompanyByDomain?(domain: string): Promise<Result<ExternalRef | null>>;
  upsertCompany?(c: Company): Promise<Result<ExternalRef>>;                 // Attio assert / HubSpot search→create|patch
  upsertPerson?(p: Person, company?: ExternalRef): Promise<Result<ExternalRef>>;
  createDeal?(d: Deal): Promise<Result<ExternalRef>>;
  associate?(from: ExternalRef, to: ExternalRef, label?: "primary" | "default"): Promise<Result<void>>;
  addToList?(listId: string, record: ExternalRef, values?: Record<string, Scalar | Scalar[]>): Promise<Result<ExternalRef>>;
  addNote?(n: Note): Promise<Result<ExternalRef>>;
  listPipelines?(): Promise<Result<{ id: string; label: string; stages: { id: string; label: string; probability?: number }[] }[]>>;
}
export interface OutreachAdapter {
  listCampaigns(): Promise<Result<{ id: string; name: string; status: "active" | "paused" | "draft" | "completed" | "other" }[]>>;
  addLeads(campaignId: string, leads: Person[], opts?: { skipIfInWorkspace?: boolean; dedupeAcrossCampaigns?: boolean })
    : Promise<Result<BulkResult>>;                                           // adapter chunks to manifest.rateLimit.maxBatch.leads
}
export interface EnrichAdapter {
  searchPeople?(q: { domains: string[]; titles?: string[]; seniorities?: string[]; page?: number; perPage?: number })
    : Promise<Result<{ people: (Person & { providerId: string; hasEmail?: boolean })[]; total: number }>>; // must be 0-credit
  revealPerson?(providerId: string): Promise<Result<Person>>;               // credit-consuming: gate behind budget
  company?(domain: string): Promise<Result<Company>>;                        // cache by domain (TTL 30–90d)
}
export interface NotifyAdapter { post(msg: { text: string; blocks?: unknown[] }): Promise<Result<void>> }
export interface CalendarAdapter {
  listUpcoming(since: Date): Promise<Result<{ id: string; title: string; start: string; end: string; attendees: { email: string; name?: string }[] }[]>>;
  bookingLink?(p: Person): string;                                           // prefilled, no API call
}

// ---------- Inbound / outbound events ----------
export interface InboundEvent {
  id: string;                                   // idempotency key (Idempotency-Key / webhook-id / sha256(body))
  source: ConnectorId; type: "reply.received" | "lead.interested" | "meeting.booked" | "meeting.canceled"
    | "lead.upsert" | "record.changed" | "unsubscribe" | "bounce" | "unknown";
  occurredAt: string; person?: Person; company?: Company; raw: unknown;
}
export interface InboundRequest { headers: Record<string, string>; rawBody: string; pathToken?: string }

export interface Connector {
  manifest: ConnectorManifest;
  /** Cheap credential check, e.g. Calendly GET /users/me, Instantly GET /campaigns?limit=1 */
  validate(cfg: Record<string, string>): Promise<Result<{ accountLabel: string }>>;
  crm?: CrmAdapter; outreach?: OutreachAdapter; enrich?: EnrichAdapter;
  notify?: NotifyAdapter; calendar?: CalendarAdapter;
  /** Verify signature/token and normalize. Must be pure + fast (<2s); heavy work goes to a job queue. */
  parseInbound?(req: InboundRequest, secret: string): Result<InboundEvent[]>;
  /** For tools that support it (Instantly, Attio, lemlist, Cal.com, Calendly-paid): register our inbound URL. */
  registerWebhook?(publicUrl: string, events: InboundEvent["type"][]): Promise<Result<{ webhookId: string }>>;
  /** Polling fallback when no public URL / plan lacks webhooks. */
  poll?(since: Date): Promise<Result<InboundEvent[]>>;
}

// ---------- Shared runtime (one implementation for all connectors) ----------
export interface HttpRunner {
  request<T>(c: ConnectorId, init: { method: string; url: string; headers?: Record<string, string>;
    body?: unknown; bucket?: string; idempotencyKey?: string }): Promise<Result<T>>;
  // token-bucket per (connector, bucket); honors Retry-After (seconds or HTTP-date);
  // exp. backoff w/ jitter on 429/5xx; never retries 400/401/403/422; redacts api_key & secret URLs in logs
}
export interface OutboundWebhook {           // Standard Webhooks
  send(endpoint: { url: string; secret: `whsec_${string}` },
       evt: { type: string; data: unknown }): Promise<void>; // persisted outbox; schedule 5s,5m,30m,2h,5h,10h,14h,20h,24h; 410 => disable
}
```

## Sources

**HubSpot**
- [Companies guide](https://developers.hubspot.com/docs/api-reference/crm-companies-v3/guide)
- [Companies 2026-09 guide](https://developers.hubspot.com/docs/api-reference/latest/crm/objects/companies/guide)
- [Associations guide](https://developers.hubspot.com/docs/api-reference/crm-associations-v4/guide)
- [Usage guidelines](https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines)
- [Search guide](https://developers.hubspot.com/docs/api-reference/search/guide)
- [Contacts guide](https://developers.hubspot.com/docs/api-reference/crm-contacts-v3/guide)
- [Deals guide](https://developers.hubspot.com/docs/api-reference/crm-deals-v3/guide)
- [Pipelines 2026-09 guide](https://developers.hubspot.com/docs/api-reference/latest/crm/pipelines/guide)
- [Pipelines v3 guide](https://developers.hubspot.com/docs/api-reference/crm-pipelines-v3/guide)
- [Private apps](https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview)
- [Migration guide](https://developers.hubspot.com/docs/api-reference/legacy/migration-guide)
- [Date-based versioning changelog](https://developers.hubspot.com/changelog/introducing-date-based-api-versioning)

**Attio**
- [Upsert record](https://docs.attio.com/rest-api/endpoint-reference/records/upsert-a-record.md)
- [Create entry](https://docs.attio.com/rest-api/endpoint-reference/entries/create-an-entry-add-record-to-list.md)
- [Upsert entry by parent](https://docs.attio.com/rest-api/endpoint-reference/entries/upsert-a-list-entry-by-parent.md)
- [Create note](https://docs.attio.com/rest-api/endpoint-reference/notes/create-a-note.md)
- [Rate limiting](https://docs.attio.com/rest-api/guides/rate-limiting.md)
- [Authentication](https://docs.attio.com/rest-api/guides/authentication.md)
- [Webhooks](https://docs.attio.com/rest-api/guides/webhooks.md)
- [Generate API key](https://attio.com/help/reference/apps/generating-an-api-key)

**Pipedrive**
- [Organizations](https://developers.pipedrive.com/docs/api/v1/Organizations)
- [Persons](https://developers.pipedrive.com/docs/api/v1/Persons)
- [Deals](https://developers.pipedrive.com/docs/api/v1/Deals)
- [Pipelines](https://developers.pipedrive.com/docs/api/v1/Pipelines)
- [Authentication](https://pipedrive.readme.io/docs/core-api-concepts-authentication)
- [Rate limiting](https://pipedrive.readme.io/docs/core-api-concepts-rate-limiting)
- [v2 migration guide](https://pipedrive.readme.io/docs/pipedrive-api-v2-migration-guide)
- [Find API token](https://pipedrive.readme.io/docs/how-to-find-the-api-token)
- [Zapier note on v1 deprecation](https://help.zapier.com/hc/en-us/articles/44170499172237)
- [Make note on v1 → v2 transition](https://help.make.com/pipedrive-api-v1-to-v2-transition-by-july-31-2026.md)

**Instantly**
- [Bulk add leads](https://developer.instantly.ai/api-reference/lead/add-leads-in-bulk-to-a-campaign-or-list.md)
- [List campaigns](https://developer.instantly.ai/api-reference/campaign/list-campaign.md)
- [Rate limit](https://developer.instantly.ai/getting-started/rate-limit.md)
- [Authorization](https://developer.instantly.ai/getting-started/authorization.md)
- [Quickstart](https://developer.instantly.ai/quickstart.md)
- [Webhook events](https://developer.instantly.ai/guides/webhook-events.md)
- [Create webhook](https://developer.instantly.ai/api-reference/webhook/create-webhook.md)

**Smartlead**
- [Add leads](https://api.smartlead.ai/reference/add-leads-to-a-campaign-by-id)
- [List campaigns](https://api.smartlead.ai/reference/list-campaigns)
- [Rate limits](https://api.smartlead.ai/guides/rate-limits)
- [Authentication](https://api.smartlead.ai/authentication)
- [Lead management](https://api.smartlead.ai/guides/lead-management)
- [Webhooks](https://api.smartlead.ai/core/webhooks)

**lemlist**
- [Create lead in campaign](https://developer.lemlist.com/api-reference/endpoints/leads/create-lead-in-campaign.md)
- [Get campaigns](https://developer.lemlist.com/api-reference/endpoints/campaigns/get-many-campaigns.md)
- [Rate limits](https://developer.lemlist.com/api-reference/getting-started/rate-limits.md)
- [Authentication](https://developer.lemlist.com/api-reference/getting-started/authentication.md)
- [Add webhook](https://developer.lemlist.com/api-reference/endpoints/webhooks/add-webhook.md)

**Apollo**
- [People API search](https://docs.apollo.io/reference/people-api-search)
- [Organization enrichment](https://docs.apollo.io/reference/organization-enrichment)
- [Add contacts to sequence](https://docs.apollo.io/reference/add-contacts-to-sequence)
- [Create contact](https://docs.apollo.io/reference/create-a-contact)
- [People enrichment](https://docs.apollo.io/reference/people-enrichment)
- [Create API key](https://docs.apollo.io/docs/create-api-key)
- [Search sequences](https://docs.apollo.io/reference/search-for-sequences)
- [Email accounts](https://docs.apollo.io/reference/get-a-list-of-email-accounts)
- [Rate limits](https://docs.apollo.io/reference/rate-limits)

**Clay**
- [Webhook guide](https://university.clay.com/docs/webhook-integration-guide)
- [HTTP API overview](https://university.clay.com/docs/http-api-integration-overview)
- [Pricing](https://www.clay.com/pricing)
- [Sources overview](https://clay.com/university/guide/sources-overview)
- [ZoomInfo review of the Clay API](https://pipeline.zoominfo.com/sales/clay-api)

**Slack**
- [Incoming webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks)
- [Rate limits](https://docs.slack.dev/apis/web-api/rate-limits)
- [Blocks](https://docs.slack.dev/reference/block-kit/blocks)
- [Section block](https://docs.slack.dev/reference/block-kit/blocks/section-block)
- [Header block](https://docs.slack.dev/reference/block-kit/blocks/header-block)

**Automation and webhook signing**
- [Zapier webhooks](https://help.zapier.com/hc/en-us/articles/8496288690317-Trigger-Zaps-from-webhooks)
- [Make webhooks](https://help.make.com/webhooks)
- [n8n Webhook node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)
- [Standard Webhooks spec](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)

**Calendars**
- [Cal.com bookings](https://cal.com/docs/api-reference/v2/bookings/get-all-bookings)
- [Cal.com API intro](https://cal.com/docs/api-reference/v2/introduction)
- [Cal.com webhooks](https://cal.com/docs/developing/guides/automation/webhooks)
- [Cal.com prefill](https://cal.com/help/bookings/prefill-fields)
- [Calendly PAT](https://developer.calendly.com/docs/authentication/how-to-authenticate-with-personal-access-tokens.md)
- [Calendly FAQ](https://developer.calendly.com/docs/getting-started/frequently-asked-questions)
- [Calendly webhooks](https://developer.calendly.com/receive-data-from-scheduled-events-in-real-time-with-webhook-subscriptions)
- [Calendly prefill](https://help.calendly.com/hc/en-us/articles/31619360031383)

**Email**
- [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Gmail compose URL](https://til.simonwillison.net/google/gmail-compose-url)
- [Gmail URL length report](https://github.com/codeforboston/maple/issues/1964)
- [Outlook deeplink thread](https://learn.microsoft.com/en-us/answers/questions/4619953/want-to-pre-populate-to-cc-subject-body-by-passing)
- [Exchange SMTP AUTH (MC786329)](https://portal.changepilot.cloud/MC786329)

**Muse**
- [Meta Muse launch (TechRepublic)](https://www.techrepublic.com/article/news-meta-muse-ai-agent-us-launch/)
- [Meta Muse launch (PBS)](https://www.pbs.org/newshour/nation/meta-launches-personal-ai-agent-muse-to-help-with-everyday-tasks)
- [SalesRobot Muse](https://www.salesrobot.co/muse)