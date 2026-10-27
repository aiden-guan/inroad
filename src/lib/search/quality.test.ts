import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalUrl, planQueries, rankResults } from "./quality";
import { clearSearchCache, searchWeb } from "./search";
import { resetAutomation, readAutomation } from "@/lib/automation/store";
import { writeSettings } from "@/lib/store/settings";
const provider = { id: "tavily" as const, name: "Tavily", key: "test-search-secret", keySource: "saved" as const };
const hit = { url: "https://company.org/about", title: "Finance leader", description: "A finance team is hiring" };
beforeEach(async () => {
  await resetAutomation();
  clearSearchCache();
  writeSettings({ search: undefined, researchRequests: undefined, browserRequests: undefined });
});
describe("research quality", () => {
  it("deduplicates tracking URLs, ranks distinctive title terms, and applies exact domain and date filters", () => {
    const rows = [
      { ...hit, url: `${hit.url}?utm_source=email#section` },
      { ...hit },
      { ...hit, url: "https://unrelatedcompany.org/", title: "Other", description: "Other" },
      { ...hit, url: "https://news.company.org/item", publishedAt: "2025-01-01T00:00:00Z" },
    ];
    expect(rankResults(rows, "finance leader", { includeDomains: ["company.org"], since: "2026-01-01" })).toEqual([hit]);
    expect(rankResults(rows, "finance", { excludeDomains: ["company.org"] }).map((r) => r.url)).toEqual(["https://unrelatedcompany.org/"]);
    expect(canonicalUrl("https://user:pass@company.org/")).toBeNull();
  });
  it("keeps long queries visible and splits only at word boundaries", () => {
    const query = "finance leaders at software companies building billing and payments platforms in Europe";
    const planned = planQueries(query, 45);
    expect(planned.join(" ")).toBe(query);
    expect(planned.every((q) => q.length <= 45)).toBe(true);
    expect(() => planQueries("a".repeat(129))).toThrow(/term exceeds/);
  });
  it("caches without crossing credentials, and refresh bypasses the cache", async () => {
    const fetch = vi.fn().mockImplementation(async () => Response.json({ results: [hit] }));
    vi.stubGlobal("fetch", fetch);
    await searchWeb(provider, "finance");
    await searchWeb(provider, "finance");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(readAutomation().receipts[0].cached).toBe(true);
    await searchWeb({ ...provider, key: "another-test-secret" }, "finance");
    await searchWeb(provider, "finance", 8, { fresh: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("coalesces identical concurrent lookups and reserves request limits atomically", async () => {
    writeSettings({ search: { provider: "tavily", dailyLimit: 1 } });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = vi.fn().mockImplementation(async () => {
      await gate;
      return Response.json({ results: [hit] });
    });
    vi.stubGlobal("fetch", fetch);
    const first = searchWeb(provider, "finance"),
      duplicate = searchWeb(provider, "finance");
    expect(await searchWeb(provider, "different query")).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    release();
    expect(await first).toEqual(await duplicate);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("passes native filters and aborts instead of switching to another vendor", async () => {
    const abort = new AbortController();
    const fetch = vi.fn().mockImplementation(async (_url, init) => {
      expect(JSON.parse(init.body)).toMatchObject({ include_domains: ["company.org"], exclude_domains: ["bad.org"], start_date: "2026-01-01" });
      abort.abort();
      throw new DOMException("Stopped", "AbortError");
    });
    vi.stubGlobal("fetch", fetch);
    expect(
      await searchWeb(provider, "finance", 8, { includeDomains: ["company.org"], excludeDomains: ["bad.org"], since: "2026-01-01", signal: abort.signal }),
    ).toMatchObject({ ok: false });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps the daily limit after operation history is cleared", async () => {
    writeSettings({ search: { provider: "tavily", dailyLimit: 1 } });
    const fetch = vi.fn().mockResolvedValue(Response.json({ results: [hit] }));
    vi.stubGlobal("fetch", fetch);
    expect((await searchWeb(provider, "finance")).ok).toBe(true);
    await resetAutomation();
    expect(await searchWeb(provider, "another query")).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
