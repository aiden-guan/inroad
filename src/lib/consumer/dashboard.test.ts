import { describe, expect, it } from "vitest";
import { consumerWorkspace } from "@/test/factories";
import { applyAction } from "@/lib/domain/actions";
import { GrowthDashboardSchema, growthCardOptions, moveGrowthCard, readGrowthDashboard } from "./dashboard";

describe("Growth dashboard preferences", () => {
  it("keeps deliberately empty layouts empty and preserves connections when hiding everything", () => {
    const ws = consumerWorkspace();
    ws.integrations.posthog = { id: "posthog", enabled: true, config: { projectId: "42" } };
    const before = structuredClone(ws.integrations);
    applyAction(ws, { type: "growth.dashboard", layout: { cards: [] } });
    expect(readGrowthDashboard(ws).cards).toEqual([]);
    expect(ws.integrations).toEqual(before);
  });
  it("moves cards across the grid without losing their widths or hidden-card choices", () => {
    const cards = [{ id: "waitlist", wide: true }, { id: "metric:posthog:active_7d", wide: false }, { id: "weekly", wide: true }];
    const moved = moveGrowthCard(cards, "weekly", "waitlist");
    expect(moved).toEqual([cards[2], cards[0], cards[1]]);
    expect(cards[0].id).toBe("waitlist");
    expect(moveGrowthCard(cards, "missing", "waitlist")).toBe(cards);
  });
  it("offers each active-user window and defaults to weekly activity alongside the waitlist", () => {
    const ws = consumerWorkspace();
    expect(growthCardOptions(ws).filter((o) => o.group === "PostHog").map((o) => o.description)).toEqual(["24 hours", "7 days", "30 days"]);
    expect(readGrowthDashboard(ws).cards.slice(0, 2).map((c) => c.id)).toEqual(["waitlist", "metric:posthog:active_7d"]);
  });
  it("rejects duplicate, oversized and unknown layouts before mutating the workspace", () => {
    for (const cards of [[{ id: "waitlist", wide: false }, { id: "waitlist", wide: true }], [{ id: "secrets", wide: false }], Array.from({ length: 51 }, (_, i) => ({ id: `metric:posthog:test_${i}`, wide: false }))]) {
      expect(GrowthDashboardSchema.safeParse({ cards }).success).toBe(false);
      const ws = consumerWorkspace();
      expect(() => applyAction(ws, { type: "growth.dashboard", layout: { cards } })).toThrow();
      expect(ws.growthDashboard).toBeUndefined();
    }
  });
});
