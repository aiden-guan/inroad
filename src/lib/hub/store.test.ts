import { describe, expect, it } from "vitest";
import type { InboundLogEntry } from "./types";
import { mutateHub, readHub, recentInbound } from "./store";

/** The inbound log is shared by every tool that sends events; each tool's own last events survive the others' bursts. */

const event = (n: number, source: string, status: InboundLogEntry["status"] = "ok"): InboundLogEntry => ({
  id: `in_${source}_${n}`,
  source,
  at: new Date(Date.UTC(2026, 9, 20, 12, 0, 0) - n * 60_000).toISOString(),
  status,
  summary: "1 company",
  counts: { accounts: 1, people: 0, activities: 0, meetings: 0, skipped: 0 },
});

describe("the inbound log", () => {
  it("keeps the newest events plus each source's own last ones, newest first", () => {
    // Newest first: a 50-row Clay push after one Calendly booking and an older duplicate from Calendly.
    const events = [...Array.from({ length: 50 }, (_, i) => event(i, "clay")), event(50, "calendly"), event(51, "calendly", "duplicate"), event(52, "hubspot")];
    const kept = recentInbound(events, 40, 2);
    expect(kept.slice(0, 40)).toEqual(events.slice(0, 40));
    expect(kept.slice(40).map((e) => e.id)).toEqual(["in_calendly_50", "in_hubspot_52"]);
    expect(recentInbound(events.slice(0, 3), 40)).toEqual(events.slice(0, 3));
  });

  it("doesn't let a burst from one tool drop another tool's last event from hub.json", async () => {
    await mutateHub((hub) => {
      hub.inbound = [event(500, "calendly")];
    });
    for (let i = 0; i < 3; i++) {
      await mutateHub((hub) => {
        hub.inbound.unshift(...Array.from({ length: 60 }, (_, j) => event(400 - i * 60 - j, "clay")));
      });
    }
    const inbound = readHub().inbound;
    expect(inbound.filter((e) => e.source === "clay")).toHaveLength(100);
    expect(inbound.at(-1)?.id).toBe("in_calendly_500");
  });
});
