import "server-only";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Client } from "pg";
import { z } from "zod";
import { request } from "@/lib/connectors/http";
import { isPrivateIp } from "@/lib/signals/http";
import { tableLabel, type WaitlistProvider, type WaitlistSource, type WaitlistTable } from "./types";

export class WaitlistError extends Error {}
const count = z.number().int().nonnegative().safe();
const tableSchema = z.object({ name: z.string().min(1).max(256), schema: z.string().min(1).max(256).optional() });
export const WaitlistConnectBody = z.object({ provider: z.enum(["convex", "postgres"]), credential: z.string().trim().min(8).max(5000), table: tableSchema.optional() });
const TABLE_LIMIT = 500;

/** Accept a copied environment assignment as well as its value. Never evaluate it. */
export function cleanCredential(raw: string): string {
  const value = raw.trim().replace(/^(?:export\s+)?(?:CONVEX_DEPLOY_KEY|DATABASE_URL|POSTGRES_URL)\s*=\s*/, "");
  return value.replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
}

export function convexConnection(raw: string) {
  const key = cleanCredential(raw);
  const match = /^(?:(?:prod|dev):)?([a-z0-9]+(?:-[a-z0-9]+)+)\|[^\s|]+$/.exec(key);
  if (!match || match[1].length > 100) throw new WaitlistError("Paste a Convex deploy key from your deployment's Settings → Deploy Key.");
  return { key, deployment: match[1], url: `https://${match[1]}.convex.cloud` };
}

async function convexQuery(raw: string, path: string, args: Record<string, unknown>): Promise<unknown> {
  const { key, url } = convexConnection(raw);
  const result = await request({ tool: "Convex", method: "POST", url: `${url}/api/query`, headers: { authorization: `Convex ${key}` }, body: { path, args: [args], format: "convex_encoded_json" }, secrets: [key], retries: 1, timeoutMs: 15_000 });
  if (!result.ok) {
    const code = result.error.code;
    throw new WaitlistError(code === "auth" ? "Convex couldn't read this connection. Paste a fresh deploy key." : code === "forbidden" ? "Give this Convex connection read access to your waitlist table." : code === "network" || code === "rate_limited" ? result.error.message : "Couldn't read your Convex waitlist. Check access to the deployment and try again.");
  }
  const response = z.object({ status: z.literal("success"), value: z.unknown() }).safeParse(result.value);
  if (!response.success) throw new WaitlistError("Convex couldn't read this waitlist. Check that the table still exists and this connection can read it.");
  return response.data.value;
}

export function postgresConnection(raw: string) {
  let url: URL;
  try { url = new URL(cleanCredential(raw)); } catch { throw new WaitlistError("Paste the PostgreSQL connection string from your database's Connect panel."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.password || url.pathname.length < 2 || /\[YOUR[-_]PASSWORD\]/i.test(raw)) throw new WaitlistError("Use a complete PostgreSQL connection string, including the database password.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || /\.(localhost|local|internal|lan|home|corp|example|test|invalid)$/.test(host) || (isIP(host) && isPrivateIp(host))) throw new WaitlistError("Use a hosted database address. Local and private network addresses aren't supported.");
  const port = Number(url.port || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new WaitlistError("The database connection has an invalid port.");
  return { host, port, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)) };
}

async function withPostgres<T>(raw: string, run: (client: Client) => Promise<T>): Promise<T> {
  let client: Client | undefined;
  try {
    const config = postgresConnection(raw);
    const addresses = await lookup(config.host, { all: true });
    if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) throw new WaitlistError("Use a publicly reachable hosted database address.");
    // Pin the checked IP while verifying the certificate against the original name.
    const address = addresses.find((a) => a.family === 4) ?? addresses[0];
    client = new Client({ ...config, host: address.address, ssl: { rejectUnauthorized: true, servername: config.host }, connectionTimeoutMillis: 8000, query_timeout: 10_000, statement_timeout: 8000, application_name: "Inroad waitlist (read only)" });
    client.on("error", () => { /* Active queries report failures; never log credentials. */ });
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '8s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    const result = await run(client);
    await client.query("ROLLBACK");
    return result;
  } catch (error) {
    if (error instanceof WaitlistError) throw error;
    const code = (error as { code?: string })?.code;
    throw new WaitlistError(code === "28P01" || code === "28000" ? "The database didn't accept this login. Copy a fresh connection string from its Connect panel." : code === "42501" ? "This database login needs SELECT access to your waitlist table." : code === "57014" ? "Counting this waitlist took too long. Try again in a moment." : "Couldn't read the database. Check the connection string, password and network access, then try again.");
  } finally {
    await client?.end().catch(() => undefined);
  }
}

// Only table metadata and aggregate counts leave the database. No signup records are fetched.
export const TABLES_SQL = `SELECT table_schema AS schema, table_name AS name FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('information_schema', 'auth', 'storage', 'realtime', 'extensions', 'vault', 'supabase_functions', 'supabase_migrations') AND table_schema NOT LIKE 'pg_%' ORDER BY table_schema, table_name LIMIT 501`;
export const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;
export function countSql(table: WaitlistTable): string {
  if (!table.schema) throw new WaitlistError("Choose a table from the database.");
  return `SELECT count(*)::text AS total FROM ${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`;
}

export async function discoverTables(provider: WaitlistProvider, credential: string): Promise<WaitlistTable[]> {
  let tables: WaitlistTable[];
  if (provider === "convex") {
    const value = await convexQuery(credential, "_system/cli/tables:default", { paginationOpts: { cursor: null, numItems: 500 } });
    const parsed = z.object({ page: z.array(tableSchema), isDone: z.literal(true) }).safeParse(value);
    if (!parsed.success) throw new WaitlistError("Convex returned an incomplete table list. Try again.");
    tables = parsed.data.page;
  } else {
    const result = await withPostgres(credential, (client) => client.query(TABLES_SQL));
    const parsed = z.array(tableSchema).safeParse(result.rows);
    if (!parsed.success) throw new WaitlistError("The database returned an incomplete table list. Try again.");
    tables = parsed.data;
  }
  if (tables.length > TABLE_LIMIT) throw new WaitlistError("This connection can see more than 500 tables. Use a database login scoped to your waitlist.");
  if (!tables.length) throw new WaitlistError("No readable tables found. Give this connection read access to your waitlist table.");
  return tables.sort((a, b) => tableLabel(a).localeCompare(tableLabel(b)));
}

export async function readWaitlist(provider: WaitlistProvider, credential: string, table: WaitlistTable): Promise<{ source: WaitlistSource; total: number }> {
  let value: unknown;
  let databaseId: string;
  let brand: string;
  if (provider === "convex") {
    if (table.schema) throw new WaitlistError("Choose a Convex table from the list.");
    const connection = convexConnection(credential);
    databaseId = connection.deployment;
    brand = "Convex";
    value = await convexQuery(credential, "_system/cli/tableSize:default", { tableName: table.name });
  } else {
    const connection = postgresConnection(credential);
    databaseId = `${connection.host}:${connection.port}/${connection.database}/${connection.user}`;
    brand = /(?:^|\.)supabase\.(?:co|com)$/.test(connection.host) ? "Supabase" : /(?:^|\.)neon\.tech$/.test(connection.host) ? "Neon" : "Postgres";
    const result = await withPostgres(credential, (client) => client.query(countSql(table)));
    value = result.rows.length === 1 && typeof result.rows[0].total === "string" && /^\d+$/.test(result.rows[0].total) ? Number(result.rows[0].total) : undefined;
  }
  const parsed = count.safeParse(value);
  if (!parsed.success) throw new WaitlistError("The database returned an incomplete count. Your last successful total has been kept.");
  const id = createHash("sha256").update(JSON.stringify([provider, databaseId, table.schema ?? "", table.name])).digest("hex").slice(0, 24);
  return { source: { id, provider, label: `${brand} · ${tableLabel(table)}`, table }, total: parsed.data };
}
