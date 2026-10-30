import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMetrics, stripeMajorUnits } from "./providers";
import { metricConfig } from "./config";
import { formatMetric } from "./catalog";

const NOW = new Date("2026-10-29T18:00:00Z");
const PROJECT = { projectId: "123", region: "eu", activityEvent: "$pageview", identifiedOnly: true };
const ORG = "1dbfc517-0bbf-4301-9ba8-555ca42b9737";
const fetcher = vi.fn<typeof fetch>();
const reply = (body: unknown, status = 200) => fetcher.mockResolvedValueOnce(Response.json(body, { status }));
const charge = (id: string, extra = {}) => ({ id, created: NOW.getTime() / 1000 - 3600, currency: "usd", paid: true, captured: true, amount_captured: 10000, amount_refunded: 0, customer: "cus_1", ...extra });
const sub = (id: string, customer = "cus_1", status = "active") => ({ id, customer, status });

beforeEach(() => { fetcher.mockReset(); vi.stubGlobal("fetch", fetcher); });

describe("PostHog metrics", () => {
  it("queries the selected cloud region and project, with identity deduplication and rolling windows", async () => {
    reply({ results: [["5", 18, 42]] });
    const result = await fetchMetrics("posthog", "phx_private_key", PROJECT, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.metrics.map((m) => m.value)).toEqual([5, 18, 42]);
    expect(result.value.windowStart).toBe("2026-09-29T18:00:00.000Z");
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://eu.posthog.com/api/projects/123/query/");
    expect(init?.headers).toMatchObject({ authorization: "Bearer phx_private_key" });
    const body = JSON.parse(String(init?.body));
    expect(body.async).toBe(false);
    expect(body.query.kind).toBe("HogQLQuery");
    expect(body.query.query).toContain("uniqExact(person_id)");
    expect(body.query.query).toContain("properties.$is_identified = true");
    expect(body.query.query).toContain("AND event = '$pageview'");
    expect(body.query.query).toContain("timestamp < toDateTime('2026-10-29 18:00:00', 'UTC')");
    expect(JSON.stringify(result.value)).not.toContain("phx_private_key");
  });

  it("allows all events and anonymous users only when explicitly selected", async () => {
    reply({ results: [[0, 0, 0]] });
    const result = await fetchMetrics("posthog", "phx_private_key", { ...PROJECT, activityEvent: "", identifiedOnly: false }, NOW);
    expect(result.ok).toBe(true);
    const query = JSON.parse(String(fetcher.mock.calls[0][1]?.body)).query.query;
    expect(query).not.toContain("AND event =");
    expect(query).not.toContain("$is_identified");
  });

  it("escapes an activity event rather than treating it as SQL", async () => {
    reply({ results: [[1, 1, 1]] });
    await fetchMetrics("posthog", "phx_private_key", { ...PROJECT, activityEvent: "it's \\ done" }, NOW);
    const query = JSON.parse(String(fetcher.mock.calls[0][1]?.body)).query.query;
    expect(query).toContain("AND event = 'it\\'s \\\\ done'");
  });

  it.each([{ results: [] }, { results: [[null, 3, 4]] }, { results: [[-1, 3, 4]] }, { results: [[1, 2]] }, { query_status: { complete: false } }])("rejects incomplete or invalid results (%j) instead of manufacturing zeroes", async (body) => {
    reply(body);
    expect((await fetchMetrics("posthog", "phx_private_key", PROJECT, NOW)).ok).toBe(false);
  });

  it("rejects a public ingestion key without making a request", async () => {
    expect((await fetchMetrics("posthog", "phc_public_key", PROJECT, NOW)).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("validates the project path and strips arbitrary hosts and secrets from settings", async () => {
    expect(() => metricConfig("posthog", { ...PROJECT, projectId: "../users" })).toThrow();
    expect(metricConfig("posthog", { ...PROJECT, host: "http://localhost", key: "sensitive" })).toEqual(PROJECT);
    await expect(fetchMetrics("posthog", "phx_private_key", { ...PROJECT, region: "http://localhost" }, NOW)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Stripe metrics", () => {
  it("detects currencies automatically, retains all revenue and counts each customer once", async () => {
    reply({ data: [charge("ch_usd"), charge("ch_eur", { currency: "eur" })], has_more: false });
    reply({ data: [], has_more: false });
    const result = await fetchMetrics("stripe", "rk_live_private_key", {}, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.metrics.filter((m) => m.label === "Collected revenue").map((m) => [m.currency, m.value])).toEqual([["EUR", 100], ["USD", 100]]);
    expect(result.value.metrics.find((m) => m.key === "paying_customers_30d")?.value).toBe(1);
    expect(result.value.notes.join(" ")).not.toContain("excluded");
  });
  it("paginates payments and subscriptions, adjusts refunds, deduplicates customers and excludes other currencies", async () => {
    reply({ data: [charge("ch_1"), charge("ch_2", { amount_refunded: 5000 }), charge("ch_eur", { currency: "eur" })], has_more: true });
    reply({ data: [charge("ch_unpaid", { paid: false }), charge("ch_uncaptured", { captured: false }), charge("ch_refunded", { amount_refunded: 10000 }), charge("ch_guest", { customer: null }), charge("ch_3", { customer: { id: "cus_2" } })], has_more: false });
    reply({ data: [sub("sub_1"), sub("sub_2")], has_more: true });
    reply({ data: [sub("sub_3", "cus_2"), sub("sub_trial", "cus_trial", "trialing")], has_more: false });
    const result = await fetchMetrics("stripe", "rk_live_private_key", { currency: "USD" }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.metrics.map((m) => m.value)).toEqual([350, 2, 2]);
    expect(result.value.metrics[0].currency).toBe("USD");
    expect(result.value.notes.join(" ")).toContain("EUR are excluded");
    const paymentUrl = new URL(String(fetcher.mock.calls[0][0]));
    expect(paymentUrl.origin).toBe("https://api.stripe.com");
    expect(paymentUrl.searchParams.get("created[gte]")).toBe(String(NOW.getTime() / 1000 - 30 * 86400));
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get("starting_after")).toBe("ch_eur");
    expect(new URL(String(fetcher.mock.calls[3][0])).searchParams.get("starting_after")).toBe("sub_2");
    expect(result.value.environment).toBe("live");
    expect(JSON.stringify(result.value)).not.toMatch(/cus_1|ch_1|rk_live_private_key/);
    expect(fetcher.mock.calls.every(([, init]) => !init?.body)).toBe(true);
  });

  it("labels test data and treats a complete empty response as a real zero", async () => {
    reply({ data: [], has_more: false }); reply({ data: [], has_more: false });
    const result = await fetchMetrics("stripe", "rk_test_private_key", {}, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.value.environment).toBe("test"); expect(result.value.metrics.map((m) => m.value)).toEqual([0, 0, 0]); }
  });

  it("does not silently publish a truncated first page or a repeated cursor", async () => {
    reply({ data: [charge("ch_1")], has_more: true });
    reply({ data: [charge("ch_1")], has_more: true });
    expect((await fetchMetrics("stripe", "rk_live_private_key", {}, NOW)).ok).toBe(false);
  });

  it("fails rather than publishing a partial total when a later page is forbidden", async () => {
    reply({ data: [charge("ch_1")], has_more: true });
    reply({ error: { message: "No permission rk_live_private_key" } }, 403);
    const result = await fetchMetrics("stripe", "rk_live_private_key", {}, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) { expect(result.error.code).toBe("forbidden"); expect(result.error.message).not.toContain("rk_live_private_key"); }
  });

  it("stops at its page limit without passing off 10,000 records as the total", async () => {
    for (let i = 0; i < 100; i++) reply({ data: [charge(`ch_${i}`)], has_more: true });
    const result = await fetchMetrics("stripe", "rk_live_private_key", {}, NOW);
    expect(result.ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(100);
  });

  it.each([[12345, "usd", 123.45], [12345, "jpy", 12345], [12345, "kwd", 12.345], [12300, "isk", 123]])("uses Stripe's minor-unit rules for %s %s", (amount, currency, expected) => {
    expect(stripeMajorUnits(amount as number, currency as string)).toBe(expected);
  });

  it("preserves three-decimal currencies when displaying money", () => {
    expect(formatMetric(12.345, "KWD")).toContain("12.345");
    expect(formatMetric(12345, "JPY")).not.toContain(".00");
  });
});

describe("Polar metrics", () => {
  it("uses the token's organization without asking for an organization ID or broader read scopes", async () => {
    reply({ totals: { revenue: 0, monthly_recurring_revenue: 0, active_subscriptions: 0 } });
    expect((await fetchMetrics("polar", "polar_oat_private_key", {}, NOW)).ok).toBe(true);
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.has("organization_id")).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("uses a scoped organization query, 30 UTC calendar dates and provider-native MRR", async () => {
    reply({ totals: { revenue: 123456, monthly_recurring_revenue: 234500, active_subscriptions: 19 } });
    const result = await fetchMetrics("polar", "polar_oat_private_key", { organizationId: ORG }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.metrics.map((m) => m.value)).toEqual([1234.56, 2345, 19]);
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.origin).toBe("https://api.polar.sh");
    expect(url.searchParams.get("organization_id")).toBe(ORG);
    expect(url.searchParams.get("start_date")).toBe("2026-09-30");
    expect(url.searchParams.get("end_date")).toBe("2026-10-29");
    expect(url.searchParams.getAll("metrics")).toEqual(["revenue", "monthly_recurring_revenue", "active_subscriptions"]);
  });

  it("rejects missing aggregates rather than replacing the previous metrics with zero", async () => {
    reply({ totals: { revenue: 123 } });
    expect((await fetchMetrics("polar", "polar_oat_private_key", { organizationId: ORG }, NOW)).ok).toBe(false);
  });
});
