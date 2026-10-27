import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/search/research", () => ({ ResearchInput: { parse: (v: unknown) => v }, researchWeb: vi.fn() }));
vi.mock("@/lib/search/pages", () => ({ readResearchPage: vi.fn() }));
import { researchWeb } from "@/lib/search/research";
import { readResearchPage } from "@/lib/search/pages";
import { emptyWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { pollMonitors, removeMonitor, saveMonitor, stopAutomationRuns } from "./monitors";
import { readAutomation, resetAutomation, updateAutomation } from "./store";
const hit = (n: number) => ({ url: `https://company.org/news/${n}`, title: `Sales leader ${n}`, description: "A new sales leader joined" });
const response = (...ids: number[]) => ({
  query: "sales",
  queries: ["sales"],
  provider: "Test",
  results: ids.map(hit),
  warnings: [],
  receiptId: "test",
  durationMs: 1,
});
beforeEach(async () => {
  await stopAutomationRuns();
  await resetAutomation();
  await replaceWorkspace(emptyWorkspace());
  vi.mocked(researchWeb).mockReset();
  vi.mocked(readResearchPage).mockReset();
});
describe("persistent monitors", () => {
  it("baselines quietly, ignores reordered results, and alerts once per new source", async () => {
    const monitor = await saveMonitor({ name: "Sales leaders", kind: "topic", query: "new sales leader", keywords: ["sales"], intervalMinutes: 60 });
    vi.mocked(researchWeb).mockResolvedValue(response(1, 2));
    await pollMonitors({ forceId: monitor.id });
    expect(readAutomation().observations).toHaveLength(0);
    vi.mocked(researchWeb).mockResolvedValue(response(2, 1));
    await pollMonitors({ forceId: monitor.id });
    expect(readAutomation().observations).toHaveLength(0);
    vi.mocked(researchWeb).mockResolvedValue(response(1, 2, 3));
    await pollMonitors({ forceId: monitor.id });
    expect(readAutomation().observations).toHaveLength(1);
    expect(readAutomation().observations[0].urls).toEqual([hit(3).url]);
    vi.mocked(researchWeb).mockResolvedValue(response(3));
    await pollMonitors({ forceId: monitor.id });
    vi.mocked(researchWeb).mockResolvedValue(response(1, 2, 3));
    await pollMonitors({ forceId: monitor.id });
    expect(readAutomation().observations).toHaveLength(1);
  });

  it("keeps failures distinct from no change and recovers without a false alert", async () => {
    const monitor = await saveMonitor({ name: "News", kind: "topic", query: "company news" });
    vi.mocked(researchWeb).mockResolvedValue(response(1));
    await pollMonitors({ forceId: monitor.id });
    const baseline = readAutomation().monitors[0].fingerprint;
    vi.mocked(researchWeb).mockRejectedValue(new Error("Provider quota exhausted"));
    await pollMonitors({ forceId: monitor.id });
    expect(readAutomation().monitors[0]).toMatchObject({ fingerprint: baseline, failures: 1, lastError: "Provider quota exhausted" });
    expect(readAutomation().observations).toHaveLength(0);
    vi.mocked(researchWeb).mockResolvedValue(response(1));
    await pollMonitors({ forceId: monitor.id });
    expect(readAutomation().monitors[0].lastError).toBeUndefined();
    expect(readAutomation().observations).toHaveLength(0);
  });

  it("uses persistent leases, catches up once, and rejects overlapping checks", async () => {
    const monitor = await saveMonitor({ name: "Catch up", kind: "topic", query: "company news", intervalMinutes: 60 });
    await updateAutomation((data) => {
      data.monitors[0].nextRunAt = "2020-01-01T00:00:00Z";
    });
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.mocked(researchWeb).mockImplementation(async () => {
      await gate;
      return response(1);
    });
    const first = pollMonitors();
    await Promise.resolve();
    await Promise.resolve();
    expect(await pollMonitors()).toEqual({ checked: 0 });
    finish();
    await first;
    expect(readAutomation().monitors[0].id).toBe(monitor.id);
    expect(Date.parse(readAutomation().monitors[0].nextRunAt)).toBeGreaterThan(Date.now());
    expect(vi.mocked(researchWeb)).toHaveBeenCalledOnce();
  });

  it("tracks matching page text and ignores unrelated boilerplate", async () => {
    const monitor = await saveMonitor({ name: "Careers", kind: "page", query: "https://company.org/careers", keywords: ["sales"] });
    const page = (text: string) => ({
      url: monitor.query,
      title: "Careers",
      text,
      retrievedAt: new Date().toISOString(),
      provider: "Direct HTTP",
      method: "http" as const,
      warnings: [],
    });
    vi.mocked(readResearchPage).mockResolvedValue(page("Header one. Sales team hiring. Footer."));
    await pollMonitors({ forceId: monitor.id });
    vi.mocked(readResearchPage).mockResolvedValue(page("Header two. Sales team hiring. Footer changed."));
    await pollMonitors({ forceId: monitor.id });
    expect(readAutomation().observations).toHaveLength(0);
    vi.mocked(readResearchPage).mockResolvedValue(page("Header two. Sales team hired a new leader. Footer changed."));
    await pollMonitors({ forceId: monitor.id });
    expect(readAutomation().observations).toHaveLength(1);
    await removeMonitor(monitor.id);
    expect(readAutomation().monitors).toHaveLength(0);
    expect(readAutomation().observations).toHaveLength(0);
  });

  it("pauses schedules and does not run them in the sample workspace", async () => {
    const monitor = await saveMonitor({ name: "Paused", kind: "topic", query: "company news", enabled: false });
    expect(await pollMonitors({ forceId: monitor.id })).toEqual({ checked: 0 });
    await saveMonitor({ ...monitor, enabled: true }, monitor.id);
    await replaceWorkspace({ ...emptyWorkspace(), sample: true });
    expect(await pollMonitors()).toEqual({ checked: 0 });
    expect(vi.mocked(researchWeb)).not.toHaveBeenCalled();
  });
});
