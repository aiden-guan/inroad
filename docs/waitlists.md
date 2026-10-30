# Consumer waitlist tracking

Open **Growth → Waitlist** or **Integrations → Waitlist** in a consumer workspace. Choose your database and paste one credential. Inroad imports the total immediately when it finds one clearly named waitlist table. If several tables could be the waitlist, choose one by name. No custom endpoint, deployed function, SQL entry or signup import is required.

| Database | What to paste | How it is read |
| --- | --- | --- |
| Convex Cloud | A deployment key from the deployment's Settings → Deploy Key | The deployment and API URL are derived from the key. Convex's built-in table metadata and table-size queries return the table names and exact document count. |
| Supabase | A PostgreSQL connection string from Connect, including its database password | The session pooler is useful on IPv4 networks. Inroad discovers readable base tables and runs an exact count in a read-only transaction. |
| Neon | A PostgreSQL connection string from Connect | Uses the same read-only PostgreSQL adapter, including pooled connection strings. |
| Other hosted PostgreSQL | A complete `postgresql://…` or `postgres://…` connection string | Publicly reachable databases with a trusted TLS certificate are supported. |

Copied `CONVEX_DEPLOY_KEY=…`, `DATABASE_URL=…` and `POSTGRES_URL=…` assignments are accepted too; they are parsed as text, never evaluated. PostgreSQL API keys and Supabase publishable/secret keys are not database connection strings.

The automatic match recognizes names such as `waitlist`, `waitlist_signups`, `waitlist_entries`, `waitingList` and `early_access`. Inroad asks when several match, and never assumes that an unrelated `users` table is a waitlist. PostgreSQL system and Supabase-managed schemas are excluded from discovery. Connections exposing more than 500 tables need a database login scoped to the relevant tables.

## What the numbers mean

- **Total:** the number of rows or documents in the selected table visible to this connection. Database roles and row-level policies still apply. Each row should represent one signup. Inroad does not deduplicate email addresses, infer signup status, exclude invited people or combine tables.
- **Net change:** the current count minus an earlier observed count, with that observation's date shown. It includes additions and removals. It is not a count of new signups, and sparse observations are not described as a precise seven-day window.
- **History:** begins when the source is connected. The first observation and the latest daily counts are retained. The chart shows the most recent 31 observations for that database, role and table; it does not manufacture historical counts from today's total.
- **Target:** optional under Manage waitlist. It is separate from the product's active-user or paying-customer goal.

With a connected waitlist and no logged product-growth weeks, Growth puts the waitlist first and folds the product-growth forms under **Product growth, after launch**. Logging product growth opens those forms. Existing growth logs remain visible when both are being tracked. Business workspaces do not show waitlist setup, and switching markets retains the saved tracking data.

## Sync, access and storage

Inroad refreshes every 15 minutes while the app is open and visible. **Sync waitlist** retries immediately. Failed or incomplete reads keep the last successful total and display an error; a valid empty table is a real zero. Operations are serialized so disconnecting during a sync cannot re-enable the connection.

Only table metadata and aggregate counts are fetched. Individual signup records, email addresses and names are not downloaded. Convex requests use the built-in `_system/cli/tables` and `_system/cli/tableSize` queries also used by its CLI; no code is deployed to the connected app. These are platform APIs and can change independently of Inroad.

Use credentials restricted to the waitlist when the database supports it. A Convex deployment key may grant more access than Inroad uses. PostgreSQL requests run inside `BEGIN READ ONLY`, with statement and lock timeouts; Inroad does not modify schemas, policies, functions or signup data. TLS certificates are verified, the verified hostname is retained for TLS, and connections are pinned to a checked public IP. Connection-string options cannot disable verification or load local certificate files. Local/private database addresses are not supported.

Credentials live only in the existing local secrets store under `waitlist.credential`, with the store's owner-only permissions, and are never included in workspace/API responses. Non-secret source metadata, aggregate history, the target and sync status live under `workspace.waitlist`. Disconnecting removes the credential and keeps the history and target. Replacing a source keeps earlier history separately; rotating a password or Convex key for the same source continues its history.

## Local endpoints

- `POST /api/waitlist` with `{ provider: "convex" | "postgres", credential, table? }`: discover tables, request a named choice if needed, validate the first count, and save only after success.
- `PATCH /api/waitlist` with `{ goal: number | null }`: save or remove the optional target.
- `DELETE /api/waitlist`: disconnect and forget the credential.
- `POST /api/waitlist/sync`: refresh immediately.
- `POST /api/integrations/poll`: refresh due waitlists alongside other integrations.

These endpoints use Inroad's existing local socket, host and same-origin protections. They do not expose a public signup receiver.

Verification uses isolated test workspaces and mocked failures, plus actual count requests against a local Convex backend and actual query execution on a PostgreSQL engine with synthetic records. No private Convex, Supabase or Neon account data was used to validate this feature.

References: [Convex table-size query](https://github.com/get-convex/convex-backend/blob/main/npm-packages/system-udfs/convex/_system/cli/tableSize.ts), [Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [Neon connections](https://neon.com/docs/connect/connect-from-any-app), [node-postgres TLS](https://node-postgres.com/features/ssl).
