# Connected business metrics

Open **Integrations → What tracks your business?** to connect PostHog, Stripe or Polar. Inroad checks access and imports the first snapshot before saving the connection. Figures appear above the deal forecast on **Revenue**, and above the weekly history on **Growth** for consumer companies.

| Provider | What is imported | Setup |
| --- | --- | --- |
| PostHog Cloud (US/EU) | Unique active people over rolling 24-hour, 7-day and 30-day windows | Numeric project ID and a personal API key with `query:read` for that project. Choose an activity event; `$pageview` is the default. |
| Stripe | Refund-adjusted cash collected and distinct paying customer IDs over 30 days, plus distinct customers with active subscriptions | Restricted key with Charges and Subscriptions read access. Choose the reporting currency. Test keys are supported and labeled. |
| Polar | Reported revenue over 30 UTC calendar dates, MRR and active subscriptions | Organization ID and an organization access token with `metrics:read`. Uses the live Polar API. |

## How sync works

- A full first import validates every permission the integration needs.
- The existing connector poller checks once a minute while Inroad is open in a visible tab. Each metric provider is due every 15 minutes. It also refreshes overdue data when the tab becomes visible again.
- **Sync now** refreshes immediately; **Edit connection** changes project, region, event, currency or credentials. Editing requires pasting the key again; it is never sent back to the browser.
- Authentication and permission failures back off for an hour. Other failures back off for 15 minutes. Manual sync can retry sooner.
- A failed or incomplete response keeps the last successful snapshot and displays the error. A real, complete empty result is displayed as zero.
- Per-provider operations are serialized, so disconnecting during a sync cannot re-enable a connection. Disconnect removes its key and hides that provider's metrics; its last aggregate snapshot is retained on disk.
- Sample workspaces never connect to or poll real providers.

This is local app polling, not a hosted background scheduler. Nothing refreshes while Inroad is closed. Syncing uses ordinary provider API calls, with no model inference; provider API limits and charges still apply.

## Metric definitions

**PostHog:** Counts `person_id`, which avoids counting one identified person once per device ID. By default, counts only selected events carrying `$is_identified=true`; your app must call `identify()` for signed-in users. Turn that option off to include anonymous people. A blank activity event includes all events. Internal traffic, bots and background events depend on your instrumentation; there is no inferred count of registered accounts. Only PostHog Cloud is supported in this version.

**Stripe:** Cash collected is the captured amount of payments created inside the rolling 30-day window, less refunds on those same payments as of sync. It is before processor fees and includes taxes. Refunds on older payments fall outside this figure. It is not accounting revenue or MRR. Paying customers are unique customer IDs attached to positive, refund-adjusted payments in the selected currency; guest payments contribute revenue but not customer count. Subscribed customers are unique customer IDs with active subscriptions across currencies, including free plans, excluding trialing, past-due, paused and canceled subscriptions.

Stripe lists are fully paginated. If a page fails, repeats IDs or exceeds the 100-page limit (up to 10,000 records per list), the import fails rather than publishing an incomplete total. Payments in other currencies are explicitly noted as excluded; currencies are never added together or converted. Minor-unit conversion handles zero- and three-decimal currencies, including Stripe's special ISK/UGX charge conventions.

**Polar:** Uses the metrics API's `revenue`, `monthly_recurring_revenue` and `active_subscriptions` totals. Money is converted from cents to USD. The revenue window spans 30 UTC calendar dates including the current partial day. Subscription count is not distinct client count. MRR uses Polar's own definition.

Each figure exposes its definition, reporting window and source in the UI. Provider figures are never summed across providers, and never overwrite the deal forecast, manually maintained deal records or logged growth weeks. Rolling activity windows are not complete calendar-week retention cohorts; growth history and retention readings remain separate.

## Storage and endpoints

Keys live in the existing local `.data/secrets.json` store with mode `0600`, outside the browser-visible workspace. Non-secret settings live under `workspace.integrations`; aggregate snapshots live under `workspace.businessMetrics`. Individual customer IDs and event payloads are only used in memory during aggregation and are not stored in snapshots. Provider hosts are fixed in the adapters; neither a custom host nor a redirect can receive a key.

- `POST /api/metrics/{posthog|stripe|polar}` — validate, import and save `{ key, config }`.
- `DELETE /api/metrics/{id}` — forget credentials and disable the connection.
- `POST /api/metrics/{id}/sync` — refresh one connected provider.
- `POST /api/integrations/poll` — automatically refresh providers that are due alongside existing CRM and sequencer polling.

These routes use the app's existing local-host and same-origin request protections. This feature does not add a public integration endpoint.

Provider references: [PostHog query API](https://posthog.com/docs/api/query), [PostHog personal API keys](https://posthog.com/docs/api/personal-api-keys), [Stripe charges](https://docs.stripe.com/api/charges/list), [Stripe subscriptions](https://docs.stripe.com/api/subscriptions/list), [Stripe currency rules](https://docs.stripe.com/currencies), [Polar metrics](https://polar.sh/docs/api-reference/metrics/get).
