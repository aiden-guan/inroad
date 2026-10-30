# Connected business metrics

Open **Integrations → What tracks your business?** to connect PostHog, Stripe or Polar. Figures appear on **Revenue** and **Growth** automatically.

Consumer companies can also [track a waitlist from Convex, Supabase, Neon or another hosted PostgreSQL database](waitlists.md) directly on Growth or in Integrations.

| Provider | What is imported | Setup |
| --- | --- | --- |
| PostHog Cloud (US/EU) | Unique active people over rolling 24-hour, 7-day and 30-day windows | Click **Connect PostHog**, approve read-only access, and you're done. Region and projects are detected. If you have several projects, choose one by name. |
| Stripe | Refund-adjusted cash collected and distinct paying customer IDs over 30 days, plus distinct customers with active subscriptions | Paste one restricted key with Charges and Subscriptions read access. Pasting connects immediately. Currencies are detected and shown separately. Test keys are labeled. |
| Polar | Reported revenue over 30 UTC calendar dates, MRR and active subscriptions | Paste one organization access token with `metrics:read`. Pasting connects immediately. The token already identifies its organization; no organization ID or extra scopes are needed. |

PostHog's optional **Use an API key instead** accepts a personal key with `project:read` and `query:read`; it also discovers the region and projects. Existing personal-key connections keep working. New connections count all recorded activity from identified users by default. Existing activity filters are preserved.

## How sync works

- A full first import validates every permission the integration needs.
- The existing connector poller checks once a minute while Inroad is open in a visible tab. Each metric provider is due every 15 minutes. It also refreshes overdue data when the tab becomes visible again.
- **Sync now** refreshes immediately. **Change connection** switches the account. **Customize metrics (optional)** changes an activity filter, whether to include anonymous visitors, or a currency limit after connection; it reuses saved credentials without asking for the key again.
- PostHog sign-in uses its region-agnostic OAuth server, dynamic public-client registration and authorization code flow with S256 PKCE. Expiring access tokens refresh automatically. Only `project:read` and `query:read` are requested. In the updated Mac app, a completed connection brings Inroad's window forward.
- Authentication and permission failures back off for an hour. Other failures back off for 15 minutes. Manual sync can retry sooner.
- A failed or incomplete response keeps the last successful snapshot and displays the error. A real, complete empty result is displayed as zero.
- Per-provider operations are serialized, so disconnecting during a sync cannot re-enable a connection. Disconnect removes credentials, cancels pending PostHog sign-ins and attempts to revoke an OAuth refresh token. The last aggregate snapshot is retained on disk.
- Sample workspaces never connect to or poll real providers.

This is local app polling, not a hosted background scheduler. Nothing refreshes while Inroad is closed. Syncing uses ordinary provider API calls, with no model inference; provider API limits and charges still apply.

## Metric definitions

**PostHog:** Counts `person_id`, which avoids counting one identified person once per device ID. New connections count any event carrying `$is_identified=true`; your app must identify signed-in users in PostHog. Optional preferences can include anonymous people or limit activity to one event. Internal traffic, bots and background events depend on your instrumentation; there is no inferred count of registered accounts. Only PostHog Cloud is supported.

**Stripe:** Cash collected is the captured amount of payments created inside the rolling 30-day window, less refunds on those same payments as of sync. It is before processor fees and includes taxes. Refunds on older payments fall outside this figure. It is not accounting revenue or MRR. Paying customers are unique customer IDs attached to positive, refund-adjusted payments in the selected currency; guest payments contribute revenue but not customer count. Subscribed customers are unique customer IDs with active subscriptions across currencies, including free plans, excluding trialing, past-due, paused and canceled subscriptions.

Stripe lists are fully paginated. If a page fails, repeats IDs or exceeds the 100-page limit (up to 10,000 records per list), the import fails rather than publishing an incomplete total. By default, every currency gets its own revenue figure and customer counts deduplicate across currencies. If an optional currency limit is selected, other currencies are explicitly noted as excluded. Currencies are never added together or converted. Minor-unit conversion handles zero- and three-decimal currencies, including Stripe's special ISK/UGX charge conventions.

**Polar:** Uses the metrics API's `revenue`, `monthly_recurring_revenue` and `active_subscriptions` totals. Money is converted from cents to USD. The revenue window spans 30 UTC calendar dates including the current partial day. Subscription count is not distinct client count. MRR uses Polar's own definition.

Each figure exposes its definition, reporting window and source in the UI. Provider figures are never summed across providers, and never overwrite the deal forecast, manually maintained deal records or logged growth weeks. Rolling activity windows are not complete calendar-week retention cohorts; growth history and retention readings remain separate.

## Storage and endpoints

Keys and OAuth access/refresh tokens live in the existing local `.data/secrets.json` store with mode `0600`, outside the browser-visible workspace. OAuth state and PKCE verifiers are single-use, held server-side and expire after 15 minutes. Status responses expose only progress and project choices. The callback is a loopback-only navigation at `/connect/posthog/callback`, verifies state and PKCE, never embeds credentials, and serves a restrictive content-security policy and no-referrer header. Ordinary API origin/socket protections remain intact.

Non-secret settings live under `workspace.integrations`; aggregate snapshots live under `workspace.businessMetrics`. Individual customer IDs and event payloads are only used in memory during aggregation and are not stored in snapshots. Provider hosts are fixed in the adapters; arbitrary pagination hosts are rejected.

- `POST /api/metrics/{posthog|stripe|polar}` — validate, import and save `{ key, config }`.
- `POST /api/metrics/posthog/oauth` — start browser sign-in; `GET ?flowId=…` checks progress and `DELETE ?flowId=…` cancels it.
- `POST /api/metrics/posthog/connect` — discover projects with a personal key or choose a named project after authorization.
- `PATCH /api/metrics/{id}` — change optional preferences using saved credentials.
- `DELETE /api/metrics/{id}` — forget credentials and disable the connection.
- `POST /api/metrics/{id}/sync` — refresh one connected provider.
- `POST /api/integrations/poll` — automatically refresh providers that are due alongside existing CRM and sequencer polling.

These routes use the app's existing local-host and same-origin request protections. This feature does not add a public integration endpoint.

Provider references: [PostHog OAuth](https://posthog.com/docs/api/oauth), [PostHog query API](https://posthog.com/docs/api/query), [PostHog personal API keys](https://posthog.com/docs/api/personal-api-keys), [Stripe charges](https://docs.stripe.com/api/charges/list), [Stripe subscriptions](https://docs.stripe.com/api/subscriptions/list), [Stripe currency rules](https://docs.stripe.com/currencies), [Polar metrics](https://polar.sh/docs/api-reference/metrics/get).
