import { describe, expect, it } from "vitest";
import { makeCompany } from "@/test/factories";
import { emptyWorkspace } from "@/lib/store/workspace";
import type { IntegrationState } from "@/lib/domain/types";
import type { MetricSnapshot } from "@/lib/metrics/types";
import { currentMetrics, historyFor, observedChange, recordDaily, recordProviderHistory } from "./metrics";

const NOW = new Date("2026-10-30T19:00:00.000Z");
const state = (): IntegrationState => ({ id: "posthog", enabled: true, connectedAt: "2026-10-20T12:00:00.000Z", config: { projectId: "12", region: "us", activityEvent: "", identifiedOnly: true, apiKey: "MUST_NOT_LEAK" } });
const snapshot = (value = 100, at = NOW.toISOString()): MetricSnapshot => ({ provider: "posthog", syncedAt: at, windowStart: at, windowEnd: at, accountLabel: "Our app", environment: "live", metrics: [{ key: "active_7d", label: "Active users", value, period: "7 days", definition: "Unique identified people with recorded activity." }], notes: [] });
function fixture() { const ws = { ...emptyWorkspace(), company: makeCompany({ market: "consumer" }) }; ws.integrations.posthog = state(); ws.businessMetrics = { posthog: snapshot() }; return ws; }

describe("source-bound metric history", () => {
  it("stores only public descriptors and daily observations, preserving the first baseline", () => {
    const ws = fixture();
    recordProviderHistory(ws, snapshot(80, "2026-10-20T12:00:00.000Z"), state());
    recordProviderHistory(ws, snapshot(90, "2026-10-20T13:00:00.000Z"), state());
    recordProviderHistory(ws, snapshot(95, "2026-10-20T14:00:00.000Z"), state());
    recordProviderHistory(ws, snapshot(), state());
    const reading = currentMetrics(ws, NOW)[0]; const history = historyFor(ws, reading);
    expect(history.points.map((p) => p.value)).toEqual([80, 95, 100]);
    expect(JSON.stringify(ws.metricHistory)).not.toContain("MUST_NOT_LEAK");
    expect(observedChange(history, reading)).toMatchObject({ delta: 5, baseline: 95, since: "2026-10-20T14:00:00.000Z" });
  });

  it.each(["projectId", "activityEvent", "identifiedOnly", "metricConnectionId"])("separates a change to %s instead of comparing different definitions or accounts", (field) => {
    const ws = fixture();
    recordProviderHistory(ws, snapshot(80, "2026-10-20T12:00:00.000Z"), state());
    ws.integrations.posthog!.config[field] = field === "identifiedOnly" ? false : "changed";
    const reading = currentMetrics(ws, NOW)[0];
    expect(historyFor(ws, reading).points).toEqual([]);
    expect(observedChange(historyFor(ws, reading), reading)).toBeNull();
  });

  it("normalizes legacy defaults so the first successful sync doesn't invalidate existing goals", () => {
    const ws = fixture();
    delete ws.integrations.posthog!.config.region; delete ws.integrations.posthog!.config.identifiedOnly;
    const before = currentMetrics(ws, NOW)[0].id;
    ws.integrations.posthog!.config.region = "us"; ws.integrations.posthog!.config.identifiedOnly = true;
    ws.integrations.posthog!.config.metricConnectionId = `legacy:posthog:${ws.integrations.posthog!.connectedAt}`;
    expect(currentMetrics(ws, NOW)[0].id).toBe(before);
  });

  it("does not compare different currencies, periods, definitions or test environments", () => {
    const ws = fixture(); const first = currentMetrics(ws, NOW)[0].id;
    for (const patch of [{ currency: "EUR" }, { period: "30 days" }, { definition: "Anonymous users included" }]) {
      ws.businessMetrics!.posthog = snapshot();
      Object.assign(ws.businessMetrics!.posthog.metrics[0], patch);
      expect(currentMetrics(ws, NOW)[0].id).not.toBe(first);
    }
    ws.businessMetrics!.posthog = { ...snapshot(), environment: "test" };
    expect(currentMetrics(ws, NOW)[0]).toMatchObject({ test: true });
    expect(currentMetrics(ws, NOW)[0].id).not.toBe(first);
  });

  it("keeps stale/error data visibly qualified and omits disconnected sources", () => {
    const ws = fixture(); ws.businessMetrics!.posthog = snapshot(100, "2026-10-25T12:00:00.000Z");
    expect(currentMetrics(ws, NOW)[0].problem).toContain("24 hours");
    ws.integrations.posthog!.lastError = { at: NOW.toISOString(), message: "Permission expired" };
    expect(currentMetrics(ws, NOW)[0].problem).toBe("Permission expired");
    ws.integrations.posthog!.enabled = false;
    expect(currentMetrics(ws, NOW)).toEqual([]);
  });

  it("flags impossible source clocks and drops nonfinite values", () => {
    const ws = fixture(); ws.businessMetrics!.posthog = snapshot(100, "2026-11-01T12:00:00.000Z");
    expect(currentMetrics(ws, NOW)[0].problem).toContain("source time");
    ws.businessMetrics!.posthog = snapshot(NaN);
    expect(currentMetrics(ws, NOW)).toEqual([]);
  });

  it("never invents percentages from zero or negative baselines, or from an empty history", () => {
    const ws = fixture(); const reading = currentMetrics(ws, NOW)[0];
    expect(observedChange({ ...reading, points: [] }, reading)).toBeNull();
    for (const value of [0, -100]) expect(observedChange({ ...reading, points: [{ at: "2026-10-20T12:00:00.000Z", value }] }, reading)?.percent).toBeNull();
  });

  it("ignores out-of-order or invalid readings without mutating earlier points", () => {
    const points = [{ at: NOW.toISOString(), value: 10 }];
    expect(recordDaily(points, { at: "2026-10-20T12:00:00.000Z", value: 0 })).toEqual(points);
    expect(recordDaily(points, { at: "invalid", value: 0 })).toEqual(points);
    expect(recordDaily(points, { at: NOW.toISOString(), value: Infinity })).toEqual(points);
  });
});
