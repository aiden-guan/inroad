import { beforeEach, describe, expect, it } from "vitest";
import { makeCompany, makeDeal } from "@/test/factories";
import { emptyWorkspace, readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import type { Workspace } from "@/lib/domain/types";
import { currentMetrics } from "./metrics";
import { createInitiative, updateInitiative } from "./initiatives";
import { initiativeProgress } from "./progress";
import { metricValue, weeklyPlan } from "./brief";
import { POST } from "@/app/api/gtm/initiatives/route";
import { PATCH } from "@/app/api/gtm/initiatives/[id]/route";

const NOW = new Date("2026-10-30T19:00:00.000Z");
function fixture(value = 0): Workspace {
  const ws = { ...emptyWorkspace(), company: makeCompany({ market: "consumer" }) };
  ws.integrations.posthog = { id: "posthog", enabled: true, connectedAt: "2026-10-20T12:00:00.000Z", config: { projectId: "12", region: "us", activityEvent: "", identifiedOnly: true } };
  ws.businessMetrics = { posthog: { provider: "posthog", syncedAt: NOW.toISOString(), windowStart: NOW.toISOString(), windowEnd: NOW.toISOString(), accountLabel: "Our app", environment: "live", metrics: [{ key: "active_7d", label: "Active users", value, period: "7 days", definition: "Unique identified people." }], notes: [] } };
  return ws;
}
const id = (ws: Workspace) => currentMetrics(ws, NOW)[0].id;
const setValue = (ws: Workspace, value: number, at = NOW.toISOString()) => { ws.businessMetrics!.posthog!.metrics[0].value = value; ws.businessMetrics!.posthog!.syncedAt = at; };

describe("measurable GTM initiatives", () => {
  it("starts with only a title, a default owner and a review date, without fabricating a metric", () => {
    const ws = fixture(); const item = createInitiative(ws, { title: "  Improve the welcome flow  " }, NOW);
    expect(item).toMatchObject({ title: "Improve the welcome flow", owner: "Me", dueOn: "2026-11-06", status: "active", market: "consumer", revisions: [], outcomes: [] });
    expect(item.measurement).toBeUndefined();
  });

  it("captures a real zero baseline and computes progress without a divide-by-zero rate", () => {
    const ws = fixture(); const item = createInitiative(ws, { title: "Get ten active users", metricId: id(ws), target: 10 }, NOW);
    expect(item.measurement?.baseline.value).toBe(0);
    setValue(ws, 5);
    expect(initiativeProgress(item, currentMetrics(ws, NOW), "2026-10-30")).toMatchObject({ delta: 5, percent: 50, targetMet: false });
    setValue(ws, 10);
    expect(initiativeProgress(item, currentMetrics(ws, NOW), "2026-10-30").targetMet).toBe(true);
    expect(item.status).toBe("active");
  });

  it("tracks decreasing targets in the right direction and caps visual progress", () => {
    const ws = fixture(100); const item = createInitiative(ws, { title: "Reduce a metric", metricId: id(ws), target: 50, direction: "decrease" }, NOW);
    setValue(ws, 75);
    expect(initiativeProgress(item, currentMetrics(ws, NOW), "2026-10-30")).toMatchObject({ percent: 50, targetMet: false });
    setValue(ws, 25);
    expect(initiativeProgress(item, currentMetrics(ws, NOW), "2026-10-30")).toMatchObject({ percent: 100, targetMet: true });
    setValue(ws, 125);
    expect(initiativeProgress(item, currentMetrics(ws, NOW), "2026-10-30").percent).toBe(0);
  });

  it("does not count stale, failed or pre-baseline observations as target attainment", () => {
    const ws = fixture(0); const item = createInitiative(ws, { title: "Reach ten", metricId: id(ws), target: 10 }, NOW);
    setValue(ws, 20, "2026-10-20T12:00:00.000Z");
    const progress = initiativeProgress(item, currentMetrics(ws, NOW), "2026-10-30");
    expect(progress.targetMet).toBe(false); expect(progress.percent).toBeUndefined();
    expect(progress.problem).toContain("older than the saved baseline");
    setValue(ws, 20); ws.integrations.posthog!.lastError = { at: NOW.toISOString(), message: "Permission expired" };
    expect(initiativeProgress(item, currentMetrics(ws, NOW), "2026-10-30").targetMet).toBe(false);
  });

  it("never silently borrows progress from a different account or filter", () => {
    const ws = fixture(); const item = createInitiative(ws, { title: "Reach ten", metricId: id(ws), target: 10 }, NOW);
    ws.integrations.posthog!.config.projectId = "99"; setValue(ws, 1000);
    const progress = initiativeProgress(item, currentMetrics(ws, NOW), "2026-10-30");
    expect(progress.current).toBeUndefined(); expect(progress.targetMet).toBe(false);
    expect(progress.problem).toContain("changed");
  });

  it("preserves prior goals and baselines when the owner deliberately edits or rebinds a metric", () => {
    const ws = fixture(10); const item = createInitiative(ws, { title: "Reach fifty", metricId: id(ws), target: 50 }, NOW);
    updateInitiative(ws, item.id, { target: 100 }, NOW);
    expect(item.revisions[0].measurement.target).toBe(50);
    expect(item.measurement?.baseline.value).toBe(10);
    ws.integrations.posthog!.config.projectId = "99"; setValue(ws, 200);
    updateInitiative(ws, item.id, { metricId: id(ws) }, NOW);
    expect(item.measurement?.baseline.value).toBe(200);
    expect(item.measurement?.target).toBeUndefined();
    expect(item.revisions[1].measurement.target).toBe(100);
    expect(item.revisions[1].measurement.baseline.value).toBe(10);
  });

  it("freezes completed readouts, makes repeated completion idempotent and keeps prior readouts on reopen", () => {
    const ws = fixture(10); const item = createInitiative(ws, { title: "Reach fifty", metricId: id(ws), target: 50 }, NOW);
    setValue(ws, 40); updateInitiative(ws, item.id, { status: "done", note: "Reviewed before launch" }, NOW);
    setValue(ws, 1000); updateInitiative(ws, item.id, { status: "done" }, NOW);
    expect(item.outcomes).toHaveLength(1);
    expect(initiativeProgress(item, currentMetrics(ws, NOW), "2026-10-30").current?.value).toBe(40);
    expect(() => updateInitiative(ws, item.id, { target: 5 }, NOW)).toThrow("Reopen");
    updateInitiative(ws, item.id, { status: "active" }, NOW);
    expect(initiativeProgress(item, currentMetrics(ws, NOW), "2026-10-30").current?.value).toBe(1000);
    expect(item.outcomes[0].current?.value).toBe(40);
  });

  it("records missing source quality at completion rather than manufacturing a result", () => {
    const ws = fixture(); const item = createInitiative(ws, { title: "Review it", metricId: id(ws) }, NOW);
    ws.integrations.posthog!.enabled = false;
    updateInitiative(ws, item.id, { status: "done" }, NOW);
    expect(item.outcomes[0]).toMatchObject({ problem: "Source unavailable at readout." });
    expect(item.outcomes[0].current).toBeUndefined();
  });

  it("can clear a target without clearing the measurement", () => {
    const ws = fixture(); const item = createInitiative(ws, { title: "Reach ten", metricId: id(ws), target: 10 }, NOW);
    updateInitiative(ws, item.id, { target: null }, NOW);
    expect(item.measurement?.baseline.value).toBe(0); expect(item.measurement?.target).toBeUndefined();
    expect(item.revisions[0].measurement.target).toBe(10);
  });

  it("marks only dates before today overdue and preserves initiatives across market switches", () => {
    const ws = fixture(); const item = createInitiative(ws, { title: "Review today", dueOn: "2026-10-30" }, NOW);
    expect(initiativeProgress(item, [], "2026-10-30").overdue).toBe(false);
    expect(initiativeProgress(item, [], "2026-10-31").overdue).toBe(true);
    ws.company!.market = "b2b";
    expect(() => updateInitiative(ws, item.id, { title: "Changed" }, NOW)).toThrow("current market");
    expect(ws.gtmInitiatives![item.id].title).toBe("Review today");
    ws.company!.market = "consumer"; updateInitiative(ws, item.id, { status: "parked" }, NOW);
    expect(initiativeProgress(item, [], "2026-10-31").overdue).toBe(false);
  });

  it.each([{ title: "" }, { title: "Bad", dueOn: "2026-02-30" }, { title: "Bad", target: -1 }, { title: "Bad", baseline: 999 }, { title: "Bad", status: "done" }])("rejects invalid or fabricated creation input (%j)", (body) => {
    const ws = fixture(); expect(() => createInitiative(ws, body, NOW)).toThrow(); expect(ws.gtmInitiatives).toBeUndefined();
  });

  it("rejects stale baseline capture and percentage targets above 100", () => {
    const ws = fixture(); ws.businessMetrics!.posthog!.syncedAt = "2026-10-01T12:00:00Z";
    expect(() => createInitiative(ws, { title: "Bad", metricId: id(ws) }, NOW)).toThrow("Sync");
    ws.company!.market = "b2b";
    for (let i = 0; i < 10; i++) ws.deals[`d${i}`] = makeDeal(`d${i}`, `${i}.com`, { stage: "proposal", stageHistory: [{ stage: "qualified", at: "2026-10-01T12:00:00Z" }, { stage: "proposal", at: "2026-10-05T12:00:00Z" }] });
    const rate = currentMetrics(ws, NOW).find((r) => r.key === "conversion_qualified")!;
    expect(rate.n).toBe(10);
    expect(() => createInitiative(ws, { title: "Bad", metricId: rate.id, target: 101 }, NOW)).toThrow("between 0 and 100");
  });

  it("deduplicates a retried create request without replacing its captured baseline", () => {
    const ws = fixture(10); const body = { title: "Reach fifty", metricId: id(ws), target: 50, requestId: "afbd631f-6975-45ec-a784-1ad56d572c36" };
    const first = createInitiative(ws, body, NOW); setValue(ws, 20);
    expect(createInitiative(ws, body, NOW)).toBe(first);
    expect(Object.keys(ws.gtmInitiatives!)).toHaveLength(1);
    expect(first.measurement?.baseline.value).toBe(10);
    expect(() => createInitiative(ws, { ...body, title: "Different" }, NOW)).toThrow("different details");
  });
});

describe("initiative API and weekly handoff", () => {
  it("preserves currency minor units and distinguishes percentages from counts", () => {
    expect(metricValue(1.234, { currency: "KWD" })).toBe("KWD\u00a01.234");
    expect(metricValue(1234, { currency: "JPY" })).toBe("JPY\u00a01,234");
    expect(metricValue(60.25, { unit: "percent" })).toBe("60.3%");
    expect(metricValue(1234, {})).toBe("1,234");
  });
  beforeEach(async () => { await replaceWorkspace(fixture()); });
  it("persists through the API and rejects unknown IDs and fabricated progress", async () => {
    const request = (body: unknown) => new Request("http://localhost/api/gtm/initiatives", { method: "POST", body: JSON.stringify(body) });
    const response = await POST(request({ title: "One priority" }));
    expect(response.status).toBe(200); const { id: saved } = await response.json();
    expect(readWorkspace().gtmInitiatives?.[saved].title).toBe("One priority");
    expect((await PATCH(request({ status: "parked" }), { params: Promise.resolve({ id: saved }) })).status).toBe(200);
    expect((await PATCH(request({ currentValue: 999 }), { params: Promise.resolve({ id: saved }) })).status).toBe(400);
    expect((await PATCH(request({ status: "done" }), { params: Promise.resolve({ id: "gtm_missing" }) })).status).toBe(404);
  });

  it("copies fixed reviewed values, visible quality and causal limits", () => {
    const ws = fixture(10); const item = createInitiative(ws, { title: "Better | signup", metricId: id(ws), target: 50 }, NOW);
    setValue(ws, 40); updateInitiative(ws, item.id, { status: "done" }, NOW); setValue(ws, 9999);
    const report = weeklyPlan(ws, currentMetrics(ws, NOW), NOW);
    expect(report).toContain("10 → 40"); expect(report).not.toContain("9,999");
    expect(report).toContain("Better \\| signup"); expect(report).toContain("do not establish");
  });

  it("uses local week boundaries for completed work around UTC midnight", () => {
    const ws = fixture();
    const sunday = createInitiative(ws, { title: "Sunday work" }, new Date("2026-11-02T07:30:00Z"));
    updateInitiative(ws, sunday.id, { status: "done" }, new Date("2026-11-02T07:30:00Z"));
    const monday = createInitiative(ws, { title: "Monday work" }, new Date("2026-11-02T08:30:00Z"));
    updateInitiative(ws, monday.id, { status: "done" }, new Date("2026-11-02T08:30:00Z"));
    const report = weeklyPlan(ws, [], new Date("2026-11-02T20:00:00Z"));
    expect(report).toContain("Monday work"); expect(report).not.toContain("Sunday work");
  });
});
