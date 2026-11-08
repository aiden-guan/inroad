import { generateKeyPairSync, verify } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSearchMetrics as fetchMetrics } from "./search-providers";
import { bingDate, searchWindow } from "./search-providers";
import { formatSearchMetric as formatMetric } from "./search-catalog";
import { searchConfig as metricConfig } from "./search-config";

const NOW = new Date("2026-11-08T01:00:00Z");
const fetcher = vi.fn<typeof fetch>();
const reply = (body: unknown, status = 200) => fetcher.mockResolvedValueOnce(Response.json(body, { status }));
beforeEach(() => { fetcher.mockReset(); vi.stubGlobal("fetch", fetcher); });

describe("search measurement windows", () => {
  it("uses Pacific calendar dates and equal 28-day periods across the DST boundary", () => {
    expect(searchWindow(NOW)).toEqual({ start: "2026-10-08", end: "2026-11-04", previousStart: "2026-09-10", previousEnd: "2026-10-07" });
    expect(bingDate("/Date(1316156400000-0700)/")).toBe("2011-09-16");
    expect(bingDate("/Date(0+0800)/")).toBe("1970-01-01");
    expect(bingDate("invalid")).toBeNull();
    expect(bingDate("2026-02-30")).toBeNull();
  });
  it("preserves rates, fractional positions and unavailable data", () => {
    expect(formatMetric(0.025, undefined, "percent")).toBe("2.5%");
    expect(formatMetric(3.75, undefined, "decimal")).toBe("3.75");
    expect(formatMetric(null)).toBe("—");
    expect(() => metricConfig("posthog-search", { projectId: "123", siteHost: "https://example.com/" })).toThrow();
    expect(() => metricConfig("google-search-console", { siteUrl: "https://user:password@example.com/" })).toThrow();
  });
});

describe("Google Search Console", () => {
  it("signs a read-only assertion to Google's fixed audience and imports property totals without leaking credentials", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const key = JSON.stringify({ type: "service_account", client_email: "metrics@project.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }), token_uri: "http://localhost/steal" });
    reply({ access_token: "google-access-secret" });
    reply({ rows: [{ clicks: 30, impressions: 1000, ctr: 0.03, position: 3.75 }] });
    reply({ rows: [{ clicks: 20, impressions: 500, ctr: 0.04, position: 4.5 }] });
    const result = await fetchMetrics("google-search-console", key, { siteUrl: "sc-domain:example.com" }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.metrics.map((m) => [m.value, m.previousValue])).toEqual([[30, 20], [1000, 500], [0.03, 0.04], [3.75, 4.5]]);
    expect(fetcher.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/token");
    const assertion = new URLSearchParams(String(fetcher.mock.calls[0][1]?.body)).get("assertion")!;
    const [header, claims, signature] = assertion.split(".");
    expect(verify("RSA-SHA256", Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({ scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: "https://oauth2.googleapis.com/token", exp: Math.floor(NOW.getTime() / 1000) + 3600 });
    expect(fetcher.mock.calls[1][0]).toContain("sites/sc-domain%3Aexample.com/searchAnalytics/query");
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ startDate: "2026-10-08", endDate: "2026-11-04", type: "web", dataState: "final", aggregationType: "byProperty", dimensions: [], rowLimit: 1 });
    expect(JSON.stringify(result.value)).not.toMatch(/private_key|google-access-secret|BEGIN PRIVATE/);
  });
  it("rejects malformed credentials before sending anything", async () => {
    expect((await fetchMetrics("google-search-console", "not JSON", { siteUrl: "sc-domain:example.com" }, NOW)).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Bing Webmaster Tools", () => {
  it("sums dated rows into separate periods and marks missing data as unavailable", async () => {
    reply({ d: [{ Date: "2026-11-04T00:00:00-08:00", Clicks: 10, Impressions: 100 }, { Date: "2026-10-10T00:00:00-07:00", Clicks: 20, Impressions: 200 }, { Date: "2026-10-07T00:00:00-07:00", Clicks: 5, Impressions: 50 }, { Date: "2026-11-07T00:00:00-08:00", Clicks: 999, Impressions: 9999 }] });
    const result = await fetchMetrics("bing-webmaster", "bing-secret-key", { siteUrl: "https://example.com/" }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.metrics.map((m) => [m.value, m.previousValue])).toEqual([[30, 5], [300, 50], [0.1, 0.1]]);
    expect(result.value.notes.join(" ")).toContain("2/28 current, 1/28 previous");
    expect(JSON.stringify(result.value)).not.toContain("bing-secret-key");
    expect(new URL(String(fetcher.mock.calls[0][0])).pathname).toBe("/webmaster/api.svc/json/GetRankAndTrafficStats");
    reply({ d: [] });
    const empty = await fetchMetrics("bing-webmaster", "bing-secret-key", { siteUrl: "https://example.com/" }, NOW);
    expect(empty.ok && empty.value.metrics.map((m) => m.value)).toEqual([null, null, null]);
  });
  it.each([{ d: [{ Date: "invalid", Clicks: 1, Impressions: 1 }] }, { d: [{ Date: "2026-11-01", Clicks: -1, Impressions: 10 }] }, { d: [{ Date: "2026-11-01", Clicks: 1, Impressions: 10 }, { Date: "2026-11-01", Clicks: 1, Impressions: 10 }] }, { ErrorCode: 4 }])("rejects malformed or duplicate rows instead of saving a partial total", async (body) => {
    reply(body);
    expect((await fetchMetrics("bing-webmaster", "bing-secret-key", { siteUrl: "https://example.com/" }, NOW)).ok).toBe(false);
  });
});

describe("PostHog SEO and AI acquisition", () => {
  const config = { projectId: "123", region: "eu", siteHost: "www.example.com", conversionEvent: "signup_completed" };
  it("uses session-entry attribution, includes anonymous sessions and compares complete UTC periods", async () => {
    reply({ results: [["current", "ChatGPT", "10", 2], ["current", "Perplexity", 5, 1], ["current", "Organic search", 20, 4], ["current", "Other", 100, 50], ["previous", "ChatGPT", 5, 1], ["previous", "Organic search", 10, 1]] });
    const result = await fetchMetrics("posthog-search", "phx_secret_key", config, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.metrics.map((m) => [m.value, m.previousValue])).toEqual([[15, 5], [3, 1], [0.2, 0.2], [20, 10], [4, 1], [0.2, 0.1]]);
    expect(result.value.windowEnd).toBe("2026-11-08T00:00:00.000Z");
    expect(result.value.breakdown?.find((r) => r.label === "ChatGPT")).toEqual({ label: "ChatGPT", sessions: 10, conversions: 2 });
    const sql = JSON.parse(String(fetcher.mock.calls[0][1]?.body)).query.query;
    expect(sql).toContain("FROM sessions s");
    expect(sql).toContain("s.$entry_current_url) = 'www.example.com'");
    expect(sql).toContain("s.session_id = c.sid");
    expect(sql).toContain("event = 'signup_completed'");
    expect(sql).toContain("'.chatgpt.com'");
    expect(sql).not.toContain("$is_identified");
    expect(sql.indexOf("'Perplexity'")).toBeLessThan(sql.indexOf("'Organic Search'"));
  });
  it("does not invent conversions or rates when no event is configured", async () => {
    reply({ results: [] });
    const result = await fetchMetrics("posthog-search", "phx_secret_key", { ...config, conversionEvent: "" }, NOW);
    expect(result.ok && result.value.metrics.map((m) => m.value)).toEqual([0, 0]);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).query.query).not.toContain("JOIN");
    reply({ results: [] });
    const withConversion = await fetchMetrics("posthog-search", "phx_secret_key", config, NOW);
    expect(withConversion.ok && withConversion.value.metrics[2].value).toBeNull();
  });
  it.each([{ results: [["current", "ChatGPT", 1, 2]] }, { results: [["current", "ChatGPT", 1, 0], ["current", "ChatGPT", 1, 0]] }, { query_status: { complete: false } }])("rejects impossible counts, duplicate groups and unfinished queries", async (body) => {
    reply(body);
    expect((await fetchMetrics("posthog-search", "phx_secret_key", config, NOW)).ok).toBe(false);
  });
});
