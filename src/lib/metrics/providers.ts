import "server-only";
import { z } from "zod";
import { request } from "@/lib/connectors/http";
import { fail, ok, type ConnectorConfig, type Result } from "@/lib/connectors/types";
import { metricConfig, type PolarSettings, type PostHogSettings, type StripeSettings } from "./config";
import type { MetricProviderId, MetricSnapshot } from "./types";

const DAY = 86_400_000;
const count = z.number().int().nonnegative().safe();
const numericCount = z.union([count, z.string().regex(/^\d+$/).transform(Number).pipe(count)]);
const customer = z.union([z.string().min(1), z.object({ id: z.string().min(1) })]).nullable();
const customerId = (value: z.infer<typeof customer>) => typeof value === "string" ? value : value?.id;

function malformed(name: string) {
  return fail("upstream", `${name} returned incomplete metrics. Your last successful figures have been kept. Try syncing again.`);
}

/** Escapes a string literal for HogQL/ClickHouse, including backslashes before quotes. */
function literal(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

async function posthog(key: string, cfg: PostHogSettings, now: Date): Promise<Result<MetricSnapshot>> {
  if (!key.startsWith("phx_")) return fail("validation", "Use a PostHog personal API key (phx_…), not the public project API key.");
  const at = now.toISOString();
  const end = `toDateTime(${literal(at.slice(0, 19).replace("T", " "))}, 'UTC')`;
  const eventFilter = cfg.activityEvent ? `AND event = ${literal(cfg.activityEvent)}` : "";
  const identified = cfg.identifiedOnly ? "AND properties.$is_identified = true" : "";
  const sql = `SELECT uniqExactIf(person_id, timestamp >= ${end} - INTERVAL 1 DAY), uniqExactIf(person_id, timestamp >= ${end} - INTERVAL 7 DAY), uniqExact(person_id) FROM events WHERE timestamp >= ${end} - INTERVAL 30 DAY AND timestamp < ${end} ${eventFilter} ${identified}`;
  const response = await request({
    tool: "PostHog", method: "POST",
    url: `https://${cfg.region}.posthog.com/api/projects/${cfg.projectId}/query/`,
    headers: { authorization: `Bearer ${key}` },
    body: { query: { kind: "HogQLQuery", query: sql }, name: "Inroad active users", async: false },
    secrets: [key], timeoutMs: 25_000, retries: 1,
  });
  if (!response.ok) return response;
  const parsed = z.object({ results: z.array(z.tuple([numericCount, numericCount, numericCount])).length(1) }).safeParse(response.value);
  if (!parsed.success) return malformed("PostHog");
  const values = parsed.data.results[0];
  const activity = cfg.activityEvent ? `the “${cfg.activityEvent}” event` : "any event";
  return ok({
    provider: "posthog", syncedAt: at, windowStart: new Date(now.getTime() - 30 * DAY).toISOString(), windowEnd: at,
    accountLabel: `Project ${cfg.projectId} · ${cfg.region.toUpperCase()}`, environment: "live",
    metrics: [1, 7, 30].map((days, i) => ({
      key: `active_${days}d`, label: "Active users", value: values[i], period: days === 1 ? "24 hours" : `${days} days`,
      definition: `Unique PostHog people who performed ${activity} in the preceding ${days === 1 ? "24 hours" : `${days} days`}${cfg.identifiedOnly ? ", with $is_identified=true on the event" : ", including anonymous visitors"}.`,
    })),
    notes: [cfg.identifiedOnly ? "Identified activity only. Your app must call PostHog identify() for signed-in users; otherwise these counts may be zero." : "Includes anonymous visitors. These counts are not a count of registered accounts.", `Activity: ${cfg.activityEvent || "all events"}. Rolling windows end at the sync time; internal and bot traffic follow your event instrumentation.`],
  });
}

const Charge = z.object({
  id: z.string().min(1), created: count, currency: z.string().regex(/^[a-z]{3}$/),
  paid: z.boolean(), captured: z.boolean(), amount_captured: count, amount_refunded: count, customer,
});
const Subscription = z.object({ id: z.string().min(1), customer, status: z.string() });

/** Complete pagination or an error: never present the first page as an account's total. */
async function stripeList<T>(key: string, resource: string, params: Record<string, string>, schema: z.ZodType<T>): Promise<Result<T[]>> {
  const data: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const query = new URLSearchParams({ ...params, limit: "100", ...(cursor ? { starting_after: cursor } : {}) });
    const response = await request({ tool: "Stripe", url: `https://api.stripe.com/v1/${resource}?${query}`, headers: { authorization: `Bearer ${key}`, "Stripe-Version": "2026-10-28.endive" }, secrets: [key], retries: 1 });
    if (!response.ok) return response;
    const parsed = z.object({ data: z.array(schema.and(z.object({ id: z.string().min(1) }))), has_more: z.boolean() }).safeParse(response.value);
    if (!parsed.success) return malformed("Stripe");
    for (const item of parsed.data.data) {
      if (seen.has(item.id)) return malformed("Stripe");
      seen.add(item.id);
      data.push(item);
    }
    if (!parsed.data.has_more) return ok(data);
    const last = parsed.data.data.at(-1)?.id;
    if (!last || last === cursor) return malformed("Stripe");
    cursor = last;
  }
  return fail("upstream", "Stripe returned more than 10,000 records. The sync was stopped instead of saving an incomplete total. Your previous figures are kept.");
}

// Stripe charge amounts use these zero-decimal currencies; ISK and UGX still use two-decimal API amounts.
const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "vnd", "vuv", "xaf", "xof", "xpf"]);
const THREE_DECIMAL = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);
export function stripeMajorUnits(amount: number, currency: string): number {
  return amount / (ZERO_DECIMAL.has(currency) ? 1 : THREE_DECIMAL.has(currency) ? 1000 : 100);
}

async function stripe(key: string, cfg: StripeSettings, now: Date): Promise<Result<MetricSnapshot>> {
  if (!/^(rk|sk)_(live|test)_/.test(key)) return fail("validation", "Use a Stripe restricted API key (rk_live_… or rk_test_…), not a publishable key.");
  const at = now.toISOString();
  const start = new Date(now.getTime() - 30 * DAY).toISOString();
  const charges = await stripeList(key, "charges", { "created[gte]": String(Math.floor(Date.parse(start) / 1000)), "created[lt]": String(Math.floor(now.getTime() / 1000)) }, Charge);
  if (!charges.ok) return charges;
  const subs = await stripeList(key, "subscriptions", { status: "active" }, Subscription);
  if (!subs.ok) return subs;
  const customers = new Set<string>();
  const currencies = new Set<string>();
  let collected = 0;
  for (const charge of charges.value) {
    if (!charge.paid || !charge.captured || charge.created * 1000 < Date.parse(start) || charge.created * 1000 >= now.getTime()) continue;
    const net = Math.max(0, charge.amount_captured - charge.amount_refunded);
    if (net > 0) currencies.add(charge.currency);
    if (charge.currency !== cfg.currency) continue;
    collected += net;
    const id = customerId(charge.customer);
    if (net > 0 && id) customers.add(id);
  }
  const subscribers = new Set(subs.value.filter((s) => s.status === "active").map((s) => customerId(s.customer)).filter(Boolean));
  const excluded = [...currencies].filter((c) => c !== cfg.currency);
  const currency = cfg.currency.toUpperCase();
  return ok({
    provider: "stripe", syncedAt: at, windowStart: start, windowEnd: at,
    accountLabel: `Stripe · ${currency}`, environment: key.includes("_test_") ? "test" : "live",
    metrics: [
      { key: "collected_30d", label: "Collected revenue", value: stripeMajorUnits(collected, cfg.currency), currency, period: "30 days", definition: `Captured ${currency} payments created in the last 30 days, less refunds on those payments as of sync. Before Stripe fees; includes taxes. This is collected cash, not recognized revenue or MRR.` },
      { key: "paying_customers_30d", label: "Paying customers", value: customers.size, period: "30 days", definition: `Distinct Stripe customer IDs with a positive, refund-adjusted ${currency} payment in the last 30 days. Guest payments without a customer ID are excluded.` },
      { key: "subscribed_customers", label: "Subscribed customers", value: subscribers.size, period: "Current", definition: "Distinct customer IDs with an active subscription, across all currencies. Includes free plans; excludes trialing, past-due, paused and canceled subscriptions. Multiple subscriptions count as one customer." },
    ],
    notes: [`Payments are reported in ${currency} only. No exchange-rate conversions are applied.`, ...(excluded.length ? [`Payments in ${excluded.map((c) => c.toUpperCase()).sort().join(", ")} are excluded from revenue and paying-customer counts. Change the reporting currency to view them.`] : []), "Refunds on payments created before the 30-day window are outside this cash-collection figure."],
  });
}

async function polar(key: string, cfg: PolarSettings, now: Date): Promise<Result<MetricSnapshot>> {
  if (!key.startsWith("polar_oat_")) return fail("validation", "Use a Polar organization access token (polar_oat_…).");
  const at = now.toISOString();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 29 * DAY).toISOString();
  const params = new URLSearchParams({ start_date: start.slice(0, 10), end_date: at.slice(0, 10), interval: "day", timezone: "UTC", organization_id: cfg.organizationId });
  for (const metric of ["revenue", "monthly_recurring_revenue", "active_subscriptions"]) params.append("metrics", metric);
  const response = await request({ tool: "Polar", url: `https://api.polar.sh/v1/metrics/?${params}`, headers: { authorization: `Bearer ${key}` }, secrets: [key], retries: 1 });
  if (!response.ok) return response;
  const parsed = z.object({ totals: z.object({ revenue: z.number().finite(), monthly_recurring_revenue: z.number().finite().nonnegative(), active_subscriptions: count }) }).safeParse(response.value);
  if (!parsed.success) return malformed("Polar");
  const totals = parsed.data.totals;
  return ok({
    provider: "polar", syncedAt: at, windowStart: start, windowEnd: at,
    accountLabel: `Organization ${cfg.organizationId}`, environment: "live",
    metrics: [
      { key: "revenue_30d", label: "Revenue", value: totals.revenue / 100, currency: "USD", period: "30 days · UTC", definition: "Polar's reported revenue total over 30 UTC calendar dates, including today. Currency values are converted from cents to USD." },
      { key: "mrr", label: "Monthly recurring revenue", value: totals.monthly_recurring_revenue / 100, currency: "USD", period: "Current", definition: "Monthly recurring revenue reported by Polar's metrics API for the end of this date range. Uses Polar's subscription and currency definitions." },
      { key: "active_subscriptions", label: "Active subscriptions", value: totals.active_subscriptions, period: "Current", definition: "Active subscriptions reported by Polar. This counts subscriptions, not distinct clients; one client can hold several." },
    ],
    notes: ["Polar reports these money metrics in USD. Revenue uses UTC calendar dates, including the current partial day; MRR and active subscriptions are current values."],
  });
}

/** Every endpoint is fixed to the provider's official API host. Keys never travel to arbitrary URLs. */
export async function fetchMetrics(id: MetricProviderId, key: string, rawConfig: ConnectorConfig, now = new Date()): Promise<Result<MetricSnapshot>> {
  const cfg = metricConfig(id, rawConfig);
  if (id === "posthog") return posthog(key, cfg as PostHogSettings, now);
  if (id === "stripe") return stripe(key, cfg as StripeSettings, now);
  return polar(key, cfg as PolarSettings, now);
}
