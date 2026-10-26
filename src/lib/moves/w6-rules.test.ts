import { describe, expect, it } from "vitest";
import { applyAction } from "@/lib/domain/actions";
import type { Brief, Move, ReviewProposal, Workspace } from "@/lib/domain/types";
import { sampleWorkspace } from "@/lib/sample";
import { NOW, TODAY, at, day, makeAccount, makeActivity, makeDeal, makeMeeting, makePackage, makePerson, makeSignal, makeStep, makeWorkspace } from "@/test/factories";
import { closeOutMinutes, computeMoves } from "./rules";

/** The W6 rules that were missing: stalled and slipping deals, the close-out time, assets, rooms and the weekly post. */

const ofRule = (moves: Move[], rule: string) => moves.filter((m) => m.rule === `today.${rule}`);
const tuesday = (hh: number, mm = 0) => new Date(2026, 9, 20, hh, mm);
const acme = "acme.example";

/** An open qualified deal at Acme whose next step is `stepIn` days out and whose last activity was `quietFor` days ago. */
function deal(stepIn: number, quietFor: number, patch: Partial<Workspace> = {}): Workspace {
  return makeWorkspace({
    accounts: { [acme]: makeAccount(acme, { status: "in_pipeline", dealId: "deal_acme", peopleIds: ["per_ana", "per_bo"] }) },
    people: { per_ana: makePerson("per_ana", acme, { name: "Ana Lima" }), per_bo: makePerson("per_bo", acme) },
    deals: {
      deal_acme: makeDeal("deal_acme", acme, {
        stage: "qualified",
        nextStep: { what: "Security review with their CTO", date: day(stepIn), buyerAgreed: true },
        contacts: [{ personId: "per_ana" }, { personId: "per_bo" }],
        updatedAt: at(-quietFor),
        lastActivityAt: at(-quietFor),
      }),
    },
    ...patch,
  });
}

describe("stalled deals with a dated step ahead", () => {
  it("asks for a check-in after more than a week of quiet", () => {
    const m = ofRule(computeMoves(deal(10, 9), NOW), "stalled");
    expect(m.map((x) => [x.id, x.title, x.priority])).toEqual([[`mv_stalled_deal_acme_${day(-9)}`, "Check in with Acme: quiet for 9 days", 55 * 1.2]]);
    expect(m[0].why).toBe("Qualified · “Security review with their CTO” on Oct 30 · one line that re-confirms it");
  });

  it("stays quiet for a week, for a step two days out, with a call booked, or after any touch at the company", () => {
    expect(ofRule(computeMoves(deal(10, 7), NOW), "stalled")).toEqual([]);
    expect(ofRule(computeMoves(deal(2, 9), NOW), "stalled")).toEqual([]);
    const booked = deal(10, 9, { meetings: { m: makeMeeting("m", "deal_acme", { startsAt: at(5) }) } });
    expect(ofRule(computeMoves(booked, NOW), "stalled")).toEqual([]);
    const touched = deal(10, 9, { activities: [makeActivity("t", { kind: "touch_sent", accountDomain: acme, personId: "per_ana", at: at(-2) })] });
    expect(ofRule(computeMoves(touched, NOW), "stalled")).toEqual([]);
  });

  it("leaves an overdue or missing step to the next-step card", () => {
    expect(ofRule(computeMoves(deal(-1, 9), NOW), "stalled")).toEqual([]);
    expect(ofRule(computeMoves(deal(-1, 9), NOW), "next_step")).toHaveLength(1);
  });
});

describe("close dates that slip", () => {
  it("counts a push only when the date moves later, and raises the deal at two", () => {
    const ws = deal(4, 1);
    const move = (closeDate: string) => applyAction(ws, { type: "deal.update", id: "deal_acme", patch: { closeDate }, at: at(0) });
    move(day(20)); // first set: not a push
    move(day(10)); // pulled in: not a push
    move(day(30));
    expect(ws.deals.deal_acme.closeDatePushes).toBe(1);
    expect(ofRule(computeMoves(ws, NOW), "slipped")).toEqual([]);
    move(day(45));
    expect(ws.deals.deal_acme.closeDatePushes).toBe(2);
    const [m] = ofRule(computeMoves(ws, NOW), "slipped");
    expect(m).toMatchObject({ id: "mv_slipped_deal_acme_2", title: "Acme's close date has slipped 2 times", priority: 55 * 1.2 });
    expect(m.why).toBe("Qualified · now Dec 4 · ask what changed and who else has to say yes");
  });
});

describe("the close-out time", () => {
  it("reads the founder's setting, falling back to 16:30", () => {
    expect(closeOutMinutes(makeWorkspace())).toBe(16 * 60 + 30);
    const ws = makeWorkspace();
    ws.founder.closeOutTime = "14:15";
    expect(closeOutMinutes(ws)).toBe(14 * 60 + 15);
    ws.founder.closeOutTime = "25:00";
    expect(closeOutMinutes(ws)).toBe(16 * 60 + 30);
  });

  it("folds the deals into one close-out card at the founder's time", () => {
    const ws = sampleWorkspace(NOW);
    expect(ofRule(computeMoves(ws, tuesday(15)), "close_out")).toEqual([]);
    applyAction(ws, { type: "founder.update", patch: { closeOutTime: "14:30" } });
    expect(ofRule(computeMoves(ws, tuesday(15)), "close_out").map((m) => m.id)).toEqual([`mv_closeout_${TODAY}`]);
    applyAction(ws, { type: "founder.update", patch: { closeOutTime: "18:00" } });
    expect(ofRule(computeMoves(ws, tuesday(17)), "close_out")).toEqual([]);
  });
});

describe("assets a draft offers", () => {
  const offer = "Would a one-pager on how others handle the month-end close be useful?";
  function drafts(patch: Partial<Workspace> = {}): Workspace {
    return makeWorkspace({
      accounts: { [acme]: makeAccount(acme), "beta.example": makeAccount("beta.example") },
      outreach: {
        a: makePackage("a", acme, { steps: [makeStep(1, { body: offer })] }),
        b: makePackage("b", "beta.example", { steps: [makeStep(1, { body: "Happy to send the teardown we wrote on usage billing." })] }),
      },
      ...patch,
    });
  }

  it("raises one card per kind of asset that doesn't exist yet", () => {
    const moves = ofRule(computeMoves(drafts(), NOW), "asset");
    expect(moves.map((m) => [m.id, m.title, m.href])).toEqual([
      ["mv_asset_one_pager", "Make the one-pager your Acme draft offers", "/playbook?new=one_pager"],
      ["mv_asset_insight", "Make the teardown your Beta draft offers", "/playbook?new=insight"],
    ]);
    const two = drafts();
    two.outreach.c = makePackage("c", "beta.example", { steps: [makeStep(1, { body: "Want me to send a one pager?" })] });
    expect(ofRule(computeMoves(two, NOW), "asset").find((m) => m.id === "mv_asset_one_pager")).toMatchObject({ title: "2 drafts offer a one-pager you don't have yet", subjectIds: ["a", "c"] });
  });

  it("stands down once an approved asset exists, the draft attaches one, or the offer is gone", () => {
    const asset = { id: "ast", kind: "one_pager" as const, title: "One-pager", body: "x", createdAt: at(-1), updatedAt: at(-1), approved: true };
    expect(ofRule(computeMoves(drafts({ assets: [asset] }), NOW), "asset").map((m) => m.id)).toEqual(["mv_asset_insight"]);
    const attached = drafts();
    attached.outreach.a.steps[0].assetId = "ast_draft";
    attached.outreach.b.steps[0].body = "Is usage billing on your list this quarter?";
    expect(ofRule(computeMoves(attached, NOW), "asset")).toEqual([]);
  });
});

describe("room suggestions", () => {
  /** `n` tracked A-tier companies, each with a fresh signal of `type`, placed in `city`. */
  function tracked(n: number, type: "first_hire" | "funding", city?: string): Workspace {
    const ws = makeWorkspace();
    for (let i = 0; i < n; i++) {
      const d = `co${i}.example`;
      ws.accounts[d] = makeAccount(d, { signals: [makeSignal(`s${i}`, { type, date: day(-10) })], hqCity: city });
    }
    return ws;
  }

  it("suggests a roundtable when six tracked companies share a theme", () => {
    expect(ofRule(computeMoves(tracked(5, "first_hire"), NOW), "room")).toEqual([]);
    const [m] = ofRule(computeMoves(tracked(6, "first_hire"), NOW), "room");
    expect(m).toMatchObject({ id: "mv_room_2026-10-19", title: "Host a roundtable: 6 of your tracked companies are making a first hire for the job you do", href: "/events?new=1&kind=roundtable" });
  });

  it("suggests a dinner where eight are in one city, only with a co-host", () => {
    const ws = tracked(8, "funding", "New York, NY");
    ws.accounts["co0.example"].signals = [];
    ws.accounts["co1.example"].signals = [];
    ws.accounts["co2.example"].signals = [];
    expect(ofRule(computeMoves(ws, NOW), "room")).toEqual([]);
    ws.connectors = [{ id: "con_ivy", name: "Ivy Chen", relationship: "investor", introsMade: 0 }];
    const [m] = ofRule(computeMoves(ws, NOW), "room");
    // The planner opens as that dinner, with the co-host filled in the way its own chips name an investor.
    expect(m).toMatchObject({
      title: "Plan a dinner in New York: 8 of your target companies are there",
      why: "Ivy could co-host · 8–10 seats, open deals first",
      href: "/events?new=1&kind=dinner&city=New%20York&cohost=Ivy%20Chen's%20platform%20team",
    });
    // A customer who could host goes in by name; a won deal with no named host leaves the field to the founder.
    ws.connectors = [{ id: "con_dana", name: "Dana Kim", relationship: "customer", introsMade: 0 }];
    expect(ofRule(computeMoves(ws, NOW), "room")[0].href).toBe("/events?new=1&kind=dinner&city=New%20York&cohost=Dana%20Kim");
    ws.connectors = [];
    ws.deals.won = makeDeal("won", "co0.example", { stage: "won" });
    expect(ofRule(computeMoves(ws, NOW), "room")[0].href).toBe("/events?new=1&kind=dinner&city=New%20York");
  });

  it("stays quiet while a room is being planned", () => {
    const ws = tracked(6, "first_hire");
    ws.events.ev = { id: "ev", kind: "roundtable", title: "Roundtable", status: "planning", guests: {}, createdAt: at(-40) };
    expect(ofRule(computeMoves(ws, NOW), "room")).toEqual([]);
  });
});

describe("the weekly post", () => {
  const post = (patch: Partial<ReviewProposal> = {}): ReviewProposal => ({
    id: "prop_post",
    kind: "note",
    title: "Post draft: The script outlives its author",
    detail: "From your own material only.",
    text: "The script outlives its author\n\nBody.",
    post: true,
    status: "open",
    ...patch,
  });
  const review = (week: string, p: ReviewProposal): Record<string, Brief> => ({
    [`${week}:friday`]: { date: week, kind: "friday", greeting: "", matters: [], generatedAt: at(-4), reviewKind: "friday", proposals: [p] },
  });

  it("offers last Friday's post draft the week after, until it's copied or dismissed", () => {
    const [m] = ofRule(computeMoves(makeWorkspace({ briefs: review("2026-10-12", post()) }), NOW), "post");
    expect(m).toMatchObject({ id: "mv_post_prop_post", kind: "post", subjectIds: ["prop_post"], priority: 32 });
    expect(m.why).toBe("“The script outlives its author” · from your own material · optional");
    expect(ofRule(computeMoves(makeWorkspace({ briefs: review("2026-10-12", post({ status: "applied" })) }), NOW), "post")).toEqual([]);
    expect(ofRule(computeMoves(makeWorkspace({ briefs: review("2026-10-19", post()) }), NOW), "post")).toEqual([]);
    expect(ofRule(computeMoves(makeWorkspace({ briefs: review("2026-10-12", post({ post: undefined, title: "Call Dana back" })) }), NOW), "post")).toEqual([]);
  });
});

describe("pilot to paid", () => {
  /** A paid pilot at Acme with Ana as champion; `endsIn` days to its end date, a next step 6 days out. */
  function pilot(endsIn: number, patch: Partial<Workspace["deals"][string]> = {}, quietFor = 1): Workspace {
    const ws = deal(6, quietFor);
    Object.assign(ws.deals.deal_acme, {
      stage: "pilot",
      contacts: [{ personId: "per_ana", role: "champion" }, { personId: "per_bo" }],
      pilot: { criteria: "Close in 3 days", paid: true, feeUsd: 10000, startedOn: day(endsIn - 30), endsOn: day(endsIn) },
      ...patch,
    });
    return ws;
  }
  const pilotRules = (ws: Workspace) => computeMoves(ws, NOW).filter((m) => /pilot_|map_overdue/.test(m.rule));

  it("asks for the conversion once a pilot passes its end date, even with a future next step", () => {
    const [m] = pilotRules(pilot(-3));
    expect(m).toMatchObject({ id: `mv_pilot_convert_deal_acme_${day(-3)}`, title: "Ask Acme for the conversion decision", priority: 62 * 1.4 + 15, overdueDays: 3 });
    expect(m.why).toBe("Pilot ended Oct 17 · results against the success criteria, then the order form");
  });

  it("asks to book the ROI review in the last five days, until it's ticked or a review is on the calendar", () => {
    expect(pilotRules(pilot(6)).map((m) => m.rule)).toEqual([]);
    const [m] = pilotRules(pilot(4));
    expect(m).toMatchObject({ id: `mv_pilot_roi_deal_acme_${day(4)}`, title: "Book the ROI review with Ana", priority: 81.2 });
    expect(m.why).toBe("Acme's pilot ends Oct 24 · results vs the baseline, with the economic buyer");
    expect(pilotRules(pilot(4, { checklist: { "pilot.roi": true } }))).toEqual([]);
    const booked = pilot(4);
    booked.meetings.m = makeMeeting("m", "deal_acme", { title: "Pilot ROI review", startsAt: at(3) });
    expect(pilotRules(booked)).toEqual([]);
  });

  it("asks to book the ROI review at kickoff too, while the pilot is in its first three days", () => {
    /** A 30-day pilot that started `daysIn` days ago. */
    const kickoff = (daysIn: number, patch: Partial<Workspace["deals"][string]> = {}) => {
      const ws = pilot(30 - daysIn, patch);
      ws.deals.deal_acme.pilot!.startedOn = day(-daysIn);
      return ws;
    };
    const [m] = pilotRules(kickoff(1));
    expect(m).toMatchObject({ id: `mv_pilot_kickoff_deal_acme_${day(-1)}`, title: "Book the Acme ROI review now", priority: 50 * 1.4 });
    expect(m.why).toBe("Pilot started Oct 19 · ends Nov 18 · put the review on Ana's calendar at kickoff");
    expect(pilotRules(kickoff(0)).map((x) => x.rule)).toEqual(["today.pilot_kickoff"]);
    // Past the kickoff, ticked, or already on the calendar: nothing (the last-week card is the fallback).
    expect(pilotRules(kickoff(3))).toEqual([]);
    expect(pilotRules(kickoff(1, { checklist: { "pilot.roi": true } }))).toEqual([]);
    const booked = kickoff(1);
    booked.meetings.m = makeMeeting("m", "deal_acme", { title: "Results readout", startsAt: at(28) });
    expect(pilotRules(booked)).toEqual([]);
  });

  it("checks in every three quiet days while the pilot runs, instead of the week-long stall card", () => {
    expect(pilotRules(pilot(10, {}, 2))).toEqual([]);
    const ws = pilot(10, {}, 3);
    const [m] = pilotRules(ws);
    expect(m).toMatchObject({ id: `mv_pilot_checkin_deal_acme_${day(-3)}`, title: "Check in on the Acme pilot", priority: 63 });
    expect(m.why).toBe("Day 21 of 31 · quiet for 3 days · every 2–3 days keeps it on track");
    expect(ofRule(computeMoves(pilot(10, {}, 9), NOW), "stalled")).toEqual([]);
    // "I checked in" logs a note on the deal, which resets the clock.
    applyAction(ws, { type: "activity.log", activity: makeActivity("chk", { kind: "note", dealId: "deal_acme", at: at(0, "09:00") }) });
    expect(pilotRules(ws)).toEqual([]);
  });

  it("raises overdue plan steps, the founder's own first", () => {
    const map = {
      targetDate: day(20),
      goal: "Live on the close",
      milestones: [
        { id: "ms_roi", step: "ROI review meeting", ownerSide: "buyer" as const, due: day(-2), status: "todo" as const },
        { id: "ms_order", step: "Order form sent", ownerSide: "seller" as const, due: day(-1), status: "todo" as const },
        { id: "ms_done", step: "Kickoff", ownerSide: "both" as const, due: day(-20), status: "done" as const },
      ],
    };
    const [m] = pilotRules(pilot(10, { map })).filter((x) => x.rule === "today.map_overdue");
    expect(m).toMatchObject({ id: "mv_map_deal_acme_ms_order", title: "Do your overdue plan step for Acme: “Order form sent”", subjectIds: ["ms_roi", "ms_order"], overdueDays: 1 });
    expect(m.why).toBe("2 plan steps overdue · keep the owners and dates current with them");
    map.milestones[1].status = "done" as never;
    const [theirs] = pilotRules(pilot(10, { map })).filter((x) => x.rule === "today.map_overdue");
    expect(theirs.title).toBe("Check on Acme's plan: “ROI review meeting” was due Oct 18");
    // Their late step with the deal's own next step overdue: the next-step card already chases it.
    const chased = pilot(10, { map, nextStep: { what: "Redlines back", date: day(-2), buyerAgreed: true } });
    expect(computeMoves(chased, NOW).filter((x) => x.rule === "today.map_overdue")).toEqual([]);
  });

  it("shows one card for one late step: the call to log first, then the next step, never the same step twice", () => {
    // The sample's Lumenwire check-in was on Oct 20: the deal's next step and its plan step, both due that day.
    const ws = sampleWorkspace(new Date("2026-10-20T09:00:00-07:00"));
    const lumenwire = (now: Date) =>
      computeMoves(ws, now)
        .filter((m) => m.ref?.id === "deal_lumenwire" || m.ref?.id === "mtg_lumenwire_checkin")
        .filter((m) => /debrief|next_step|map_overdue/.test(m.rule))
        .map((m) => m.title);
    const wed = new Date("2026-10-21T10:00:00-07:00");
    // Not logged yet: logging it updates both, so the debrief card is the one card.
    expect(lumenwire(wed)).toEqual(["Log the Lumenwire call"]);
    // Logged, with the next step still the late check-in: one card for it, not a second for the plan step.
    ws.meetings.mtg_lumenwire_checkin.notesRaw = "Ethan: on track, two exceptions to review.";
    expect(lumenwire(wed)).toEqual(["Set a next step for Lumenwire"]);
  });

  it("covers the audit's case: a paid pilot ended three days ago with two overdue steps and a future next step", () => {
    const map = {
      targetDate: day(10),
      goal: "Convert",
      milestones: [
        { id: "a", step: "ROI review meeting", ownerSide: "both" as const, due: day(-2), status: "todo" as const },
        { id: "b", step: "Order form sent", ownerSide: "seller" as const, due: day(-1), status: "todo" as const },
      ],
    };
    expect(pilotRules(pilot(-3, { map })).map((m) => m.rule)).toEqual(["today.pilot_convert", "today.map_overdue"]);
  });
});
