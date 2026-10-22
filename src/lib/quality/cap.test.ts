import { describe, expect, it } from "vitest";
import type { Activity, GtmEvent, Guest, Workspace } from "@/lib/domain/types";
import { coldQuotaLeft, computeScoreboard, counters } from "@/lib/moves/scoreboard";
import { NOW, TODAY, at, makeActivity, makePackage, makeWorkspace } from "@/test/factories";
import { capUsage, coldFirstTouches, countsAgainstCap } from "./cap";

const guest = (id: string, patch: Partial<Guest> = {}): Guest => ({ id, title: "CFO", accountDomain: `${id}.example`, role: "prospect", score: 1, personalLine: "", status: "invited", personId: `per_${id}`, ...patch });

function dinner(guests: Guest[]): GtmEvent {
  return { id: "ev", kind: "dinner", title: "NYC dinner", status: "inviting", guests: Object.fromEntries(guests.map((g) => [g.id, g])), createdAt: at(-10) };
}

function desk(): Workspace {
  return makeWorkspace({
    outreach: {
      cold: makePackage("cold", "a.example"),
      cold2: makePackage("cold2", "b.example"),
      warm: makePackage("warm", "c.example", { mode: "warm_intro" }),
      li: makePackage("li", "d.example", { mode: "linkedin" }),
      follow: makePackage("follow", "e.example", { mode: "follow_up" }),
    },
    events: { ev: dinner([guest("g1"), guest("g2", { warmPath: "Ivy knows them" }), guest("g3")]) },
  });
}

const act = (id: string, patch: Partial<Activity>) => makeActivity(id, { at: at(0), ...patch });

describe("the cold cap counter", () => {
  it("counts each kind of cold first touch, and nothing else", () => {
    const ws = desk();
    const cases: [Activity, boolean][] = [
      [act("sent", { kind: "touch_sent", channel: "email", draftRef: { packageId: "cold", step: 1 } }), true],
      [act("pushed", { kind: "pushed", channel: "integration", draftRef: { packageId: "cold2", step: 1 } }), true],
      [act("step2", { kind: "touch_sent", channel: "email", draftRef: { packageId: "cold", step: 2 } }), false],
      [act("not_sent", { kind: "touch_sent", channel: "email", draftRef: { packageId: "cold", step: 1 }, outcome: "not_sent" }), false],
      [act("intro", { kind: "intro_requested", channel: "intro", draftRef: { packageId: "warm", step: 1 } }), false],
      [act("dm", { kind: "linkedin_dm", channel: "linkedin", draftRef: { packageId: "li", step: 1 } }), false],
      [act("followup", { kind: "touch_sent", channel: "email", draftRef: { packageId: "follow", step: 1 } }), false],
      [act("loose", { kind: "touch_sent", channel: "email" }), false],
      [act("invite", { kind: "event_invited", channel: "email", eventId: "ev", personId: "per_g1" }), true],
      [act("warm_invite", { kind: "event_invited", channel: "email", eventId: "ev", personId: "per_g2" }), false],
      [act("li_invite", { kind: "event_invited", channel: "linkedin", eventId: "ev", personId: "per_g3" }), false],
      [act("gone_invite", { kind: "event_invited", channel: "email", eventId: "ev", personId: "per_removed" }), false],
    ];
    for (const [a, counts] of cases) expect([a.id, countsAgainstCap(ws, a)]).toEqual([a.id, counts]);
  });

  it("counts a first touch pushed to a sequencer and later marked sent once, on the day it first went", () => {
    const ws = desk();
    ws.activities = [
      act("p", { kind: "pushed", channel: "integration", at: at(-1), draftRef: { packageId: "cold", step: 1 } }),
      act("s", { kind: "touch_sent", channel: "email", at: at(0), draftRef: { packageId: "cold", step: 1 } }),
    ];
    expect(coldFirstTouches(ws, { from: "2026-10-19" })).toBe(1);
    expect(coldFirstTouches(ws, { from: TODAY, until: TODAY })).toBe(0);
  });

  it("gives the gate, Today's quota and the scoreboard the same numbers", () => {
    const ws = desk();
    ws.caps = { ...ws.caps, firstTouchesPerWeek: 3, firstTouchesPerDayMax: 3 };
    ws.activities = [
      act("sent", { kind: "touch_sent", channel: "email", draftRef: { packageId: "cold", step: 1 } }),
      act("pushed", { kind: "pushed", channel: "integration", draftRef: { packageId: "cold2", step: 1 } }),
      act("invite", { kind: "event_invited", channel: "email", eventId: "ev", personId: "per_g1" }),
      act("last_week", { kind: "event_invited", channel: "email", eventId: "ev", personId: "per_g3", at: at(-3) }),
    ];
    expect(capUsage(ws, TODAY)).toEqual({ thisWeek: 3, today: 3, remainingWeek: 0, remainingToday: 0 });
    const c = counters(ws, NOW);
    expect([c.coldThisWeek, c.coldToday]).toEqual([3, 3]);
    expect(coldQuotaLeft(ws, c)).toBe(0);
    expect(computeScoreboard(ws, NOW).firstTouches).toEqual([3, 3]);
  });
});
