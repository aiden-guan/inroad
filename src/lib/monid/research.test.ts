import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeConnector } from "@/lib/connectors";
import { emptyWorkspace, replaceWorkspace, setSecrets } from "@/lib/store/workspace";
import { POST, GET } from "@/app/api/integrations/monid/research/route";
import { creatorResults, previewResearch, refreshResearch, researchHistory, startResearch } from "./research";
import { CITATION_PLATFORMS, type ResearchInput } from "./types";

const fetcher = vi.fn<typeof fetch>();
const KEY = "monid_live_private_test_key";
const creators: ResearchInput = { kind: "creators", query: "skincare creator", country: "US", limit: 10 };
const citations: ResearchInput = { kind: "citations", domain: "example.com", country: "US" };
const PRICE = { type: "PER_RESULT", amount: { value: 0.0003, currency: "USD" as const } };
let workspaceId: string;
const reply = (body: unknown, status = 200) => fetcher.mockResolvedValueOnce(Response.json(body, { status }));
function inspected(input = creators, price = PRICE) {
  const creator = input.kind === "creators";
  return {
    provider: creator ? "apify" : "ahrefs", endpoint: creator ? "/apidojo/tiktok-scraper" : "/site-explorer/ai-responses-count", price,
    input: { [creator ? "body" : "queryParams"]: { properties: Object.fromEntries((creator ? ["keywords", "maxItems", "location"] : ["target", "select", "mode", "country", "protocol", "date", "output"]).map((p) => [p, {}])) } },
  };
}
const post = (body: unknown) => POST(new Request("http://localhost/api/integrations/monid/research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const run = (extra = {}) => ({ runId: "01MONIDRUN", provider: "apify", endpoint: "/apidojo/tiktok-scraper", status: "RUNNING", ...extra });

beforeEach(async () => {
  workspaceId = randomUUID();
  const ws = emptyWorkspace();
  ws.integrations.monid = { id: "monid", enabled: true, config: { workspaceId } };
  await replaceWorkspace(ws);
  setSecrets("monid", { key: KEY });
  fetcher.mockReset(); vi.stubGlobal("fetch", fetcher);
});

describe("Monid provider", () => {
  it("validates a key with the documented free identity call", async () => {
    reply({ workspace: { workspaceId, name: "My workspace" } });
    const result = await makeConnector("monid", KEY).validate();
    expect(result.ok && result.value).toEqual({ accountLabel: "My workspace", config: { workspaceId } });
    expect(fetcher.mock.calls[0][0]).toBe("https://api.monid.ai/v1/auth/whoami");
    expect(fetcher.mock.calls[0][1]?.body).toBeUndefined();
  });
  it("previews schema and live pricing without starting paid work", async () => {
    reply(inspected());
    const response = await post({ action: "preview", input: creators });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ value: { price: PRICE } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("https://api.monid.ai/v1/inspect");
    expect(researchHistory()).toEqual([]);
  });
  it("submits one bounded keyword in composite input and deduplicates repeated request IDs", async () => {
    reply(inspected()); reply(run(), 202);
    const id = randomUUID();
    const response = await post({ action: "run", input: creators, requestId: id, price: PRICE, maxCost: 1 });
    expect(response.status).toBe(200);
    const sent = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(sent).toEqual({ provider: "apify", endpoint: "/apidojo/tiktok-scraper", input: { body: { keywords: [creators.query], maxItems: 10, location: "US" } }, maxCost: 1 });
    const again = await startResearch(creators, id, 1, PRICE);
    expect(again.ok && again.value.runId).toBe("01MONIDRUN");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(await (await GET()).json())).not.toContain(KEY);
  });
  it("prevents two simultaneous identical requests from starting two paid runs", async () => {
    fetcher.mockImplementation(async (url) => Response.json(String(url).endsWith("/inspect") ? inspected() : run()));
    const id = randomUUID();
    await Promise.all([startResearch(creators, id, 1, PRICE), startResearch(creators, id, 1, PRICE)]);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/run"))).toHaveLength(1);
  });
  it("stops before billing if pricing or required input fields changed", async () => {
    reply(inspected(creators, { ...PRICE, amount: { value: 1, currency: "USD" } }));
    expect((await startResearch(creators, randomUUID(), 1, PRICE)).ok).toBe(false);
    reply({ ...inspected(), input: { body: { properties: { keywords: {} } } } });
    expect((await previewResearch(creators)).ok).toBe(false);
    expect(fetcher.mock.calls.every(([url]) => String(url).endsWith("/inspect"))).toBe(true);
  });
  it("keeps an unknown timeout outcome and never resubmits it automatically", async () => {
    reply(inspected()); fetcher.mockRejectedValueOnce(new DOMException("Timed out", "TimeoutError"));
    const id = randomUUID();
    const result = await startResearch(creators, id, 1, PRICE);
    expect(result.ok && result.value.status).toBe("UNKNOWN");
    expect(result.ok && result.value.error).toContain("may have started");
    await startResearch(creators, id, 1, PRICE);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("captures a completed provider error even on a non-2xx HTTP response", async () => {
    reply(inspected()); reply(run({ status: "COMPLETED", providerResponse: { httpStatus: 500 }, output: { error: "provider unavailable" } }), 500);
    const result = await startResearch(creators, randomUUID(), 1, PRICE);
    expect(result.ok && result.value.status).toBe("COMPLETED");
    expect(result.ok && result.value.error).toContain("provider returned 500");
    expect(result.ok && result.value.creators).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("handles blocked runs without polling or presenting success", async () => {
    reply(inspected()); reply(run({ status: "BLOCKED", controls: [{ controlType: "WORKSPACE_RUN_CAP" }] }));
    const id = randomUUID();
    const result = await startResearch(creators, id, 1, PRICE);
    expect(result.ok && result.value.error).toContain("WORKSPACE_RUN_CAP");
    await refreshResearch(id);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("polls an existing run and stores only normalized public creator fields and actual cost", async () => {
    reply(inspected()); reply(run());
    const id = randomUUID();
    await startResearch(creators, id, 1, PRICE);
    reply(run({ status: "COMPLETED", providerResponse: { httpStatus: 200 }, billing: { reportedCost: { currency: "USD", value: 600, unit: "MICRO_DOLLAR" } }, output: [{ channel: { username: "creator", name: "Creator", followers: 100, email: "private@example.com" }, title: "A source post", views: 1000, likes: 50, postPage: "https://www.tiktok.com/@creator/video/123", private: "discard" }] }));
    const result = await refreshResearch(id);
    expect(result.ok && result.value.costUsd).toBe(0.0006);
    expect(result.ok && result.value.creators?.[0]).toMatchObject({ handle: "creator", views: 1000, followers: 100 });
    expect(JSON.stringify(result)).not.toMatch(/private@example.com|discard/);
    expect(fetcher.mock.calls[2][0]).toBe("https://api.monid.ai/v1/runs/01MONIDRUN");
  });
  it("cannot regress a completed run when an older poll finishes late", async () => {
    reply(inspected()); reply(run());
    const id = randomUUID();
    await startResearch(creators, id, 1, PRICE);
    let finishOlder!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>((resolve) => { finishOlder = resolve; }));
    const older = refreshResearch(id);
    await vi.waitFor(() => expect(finishOlder).toBeTypeOf("function"));
    reply(run({ status: "COMPLETED", providerResponse: { httpStatus: 200 }, output: [] }));
    expect((await refreshResearch(id)).ok).toBe(true);
    finishOlder(Response.json(run()));
    const result = await older;
    expect(result.ok && result.value.status).toBe("COMPLETED");
    expect(researchHistory().find((r) => r.id === id)?.status).toBe("COMPLETED");
  });
  it("keeps platform citation counts separate with a dated whole-domain scope", async () => {
    reply(inspected(citations));
    reply(run({ provider: "ahrefs", endpoint: "/site-explorer/ai-responses-count", status: "COMPLETED", providerResponse: { httpStatus: 200 }, output: { ai_responses_count: Object.fromEntries(CITATION_PLATFORMS.map((p, i) => [p, { citations: i, pages: 1 }])) } }));
    const result = await startResearch(citations, randomUUID(), 1, PRICE);
    expect(result.ok && result.value.citations).toHaveLength(7);
    const body = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(body.input.queryParams).toMatchObject({ target: "example.com", mode: "subdomains", protocol: "both", country: "us", date: new Date().toISOString().slice(0, 10), select: CITATION_PLATFORMS.join(",") });
  });
  it("rejects cross-workspace polling, arbitrary endpoints and sample billing", async () => {
    reply(inspected()); reply(run());
    const id = randomUUID();
    await startResearch(creators, id, 1, PRICE);
    const ws = emptyWorkspace();
    ws.integrations.monid = { id: "monid", enabled: true, config: { workspaceId: "another-workspace" } };
    await replaceWorkspace(ws);
    expect(researchHistory()).toEqual([]);
    expect((await refreshResearch(id)).ok).toBe(false);
    expect((await post({ action: "run", input: { kind: "arbitrary", endpoint: "/send-email" }, requestId: randomUUID(), price: PRICE, maxCost: 1 })).status).toBe(400);
    await replaceWorkspace({ ...ws, sample: true });
    expect((await startResearch(creators, randomUUID(), 1, PRICE)).ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("deduplicates creators by strongest returned post and does not follow arbitrary links", () => {
    const data = creatorResults([{ channel: { username: "person" }, views: 10 }, { channel: { username: "person" }, views: 100, postPage: "https://attacker.example/" }]);
    expect(data).toHaveLength(1);
    expect(data?.[0].views).toBe(100);
    expect(data?.[0].postUrl).toBeUndefined();
    expect(creatorResults({ error: "bad data" })).toBeNull();
  });
});
