import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "@/lib/ai/client";
import * as engine from "@/lib/ai/engine";
import { providerById } from "@/lib/ai/providers";
import { emptyUsage, MODEL_IDS } from "@/lib/ai/models";
import { emptyWorkspace, readWorkspace, replaceWorkspace, setSecrets } from "@/lib/store/workspace";
import { monthKey } from "@/lib/domain/ids";
import { writeSettings } from "@/lib/store/settings";
import { readAutomation, resetAutomation } from "@/lib/automation/store";
import { clearSearchCache, saveSearchSetup } from "./search";
import { ResearchInput, researchMetrics, researchWeb } from "./research";
import { POST as track } from "@/app/api/research/track/route";
const hit = { url: "https://company.org/about", title: "Company", description: "Finance workflow software" };
beforeEach(async () => {
  setSecrets("hub", { search_tavily: null });
  await resetAutomation();
  await replaceWorkspace(emptyWorkspace());
  clearSearchCache();
  writeSettings({ search: undefined, researchRequests: undefined, browserRequests: undefined });
});
describe("the research service", () => {
  it("keeps query/result provenance, restores research history, and links accepted accounts to provider outcomes", async () => {
    saveSearchSetup({ provider: "tavily", key: "tavily-test-key" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ results: [hit] })));
    const result = await researchWeb(ResearchInput.parse({ query: "finance software" }));
    expect(result.results).toEqual([hit]);
    expect(readAutomation().sessions[0].receiptId).toBe(result.receiptId);
    const response = await track(
      new Request("http://localhost/api/research/track", {
        method: "POST",
        body: JSON.stringify({ receiptId: result.receiptId, url: hit.url, name: "Company", description: hit.description }),
      }),
    );
    expect(response.status).toBe(200);
    expect(readWorkspace().accounts["company.org"]).toMatchObject({
      source: "web_search",
      sourceDetail: "Tavily",
      sourceUrl: hit.url,
      fitScore: 0,
      watch: true,
    });
    expect(researchMetrics().find((r) => r.provider === "Tavily")).toMatchObject({ acceptedAccounts: 1, requests: 1, won: 0, unknownCost: 1 });
    const forged = await track(
      new Request("http://localhost/api/research/track", {
        method: "POST",
        body: JSON.stringify({ receiptId: result.receiptId, url: "https://invented.org", name: "Invented" }),
      }),
    );
    expect(forged.status).toBe(400);
    expect(readWorkspace().accounts["invented.org"]).toBeUndefined();
  });

  it("uses Claude's native search when available, rejects invented sources, and books the real model/search cost", async () => {
    vi.spyOn(client, "activeProvider").mockReturnValue({
      id: "anthropic",
      name: "Claude",
      kind: "anthropic",
      preset: providerById("anthropic")!,
      keySource: "env",
      baseUrl: "https://api.anthropic.com",
      models: MODEL_IDS,
      prices: {},
    });
    const agent = vi.spyOn(engine, "runAgent").mockImplementation(async (options) => {
      options.emit({ type: "search", query: "finance company websites" });
      options.emit({ type: "sources", sources: [{ url: hit.url, title: hit.title, host: "company.org" }] });
      return { result: { results: [hit, { ...hit, url: "https://invented.org" }] }, usage: { ...emptyUsage(), webSearches: 1 }, costUsd: 0.015 } as Awaited<
        ReturnType<typeof engine.runAgent>
      >;
    });
    const result = await researchWeb(ResearchInput.parse({ query: "finance" }));
    expect(result.provider).toBe("Claude web search");
    expect(result.results).toEqual([hit]);
    expect(result.queries).toEqual(["finance company websites"]);
    expect(readWorkspace().usage[monthKey()].costUsd).toBe(0.015);
    expect(readAutomation().receipts.find((r) => r.kind === "search")).toMatchObject({ costUsd: 0.015, requests: 1 });
    expect(agent).toHaveBeenCalledOnce();
  });

  it("doesn't silently use native search when an explicitly selected external connection is missing", async () => {
    writeSettings({ search: { provider: "connected", connectionId: crypto.randomUUID() } });
    await expect(researchWeb(ResearchInput.parse({ query: "finance" }))).rejects.toThrow(/Choose a search provider/);
  });

  it("rejects invalid dates and domains before contacting a provider", async () => {
    await expect(researchWeb(ResearchInput.parse({ query: "finance", since: "2026-02-31" }))).rejects.toThrow(/valid publication date/);
    await expect(researchWeb(ResearchInput.parse({ query: "finance", includeDomains: ["https://company.org/path"] }))).rejects.toThrow(/domains such as/);
  });
});
