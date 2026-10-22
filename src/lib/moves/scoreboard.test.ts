import { describe, expect, it } from "vitest";
import type { Workspace } from "@/lib/domain/types";
import { sampleWorkspace } from "@/lib/sample";
import { planMath } from "@/components/playbook/model";
import { applyAction } from "@/lib/domain/actions";
import type { ChannelPlan, Foundation } from "@/lib/domain/types";
import { NOW, TODAY, at, day, makeAccount, makeActivity, makeDeal, makeMeeting, makePackage, makePerson, makeStep, makeWorkspace } from "@/test/factories";
import { computeMoves } from "./rules";
import {
  coldQuotaLeft,
  computeScoreboard,
  conversationsBetween,
  conversationsTarget,
  counters,
  dealsMissingNextStep,
  goalWins,
  isColdFirstTouch,
  introAsksTarget,
  isQualified,
  sampleLabel,
} from "./scoreboard";

/** `n` cold first touches sent `daysAgo` days ago, each to its own person and package. */
function coldTouches(ws: Workspace, n: number, daysAgo: number, prefix = "c") {
  for (let i = 0; i < n; i++) {
    const id = `${prefix}${i}`;
    ws.outreach[`pkg_${id}`] = makePackage(`pkg_${id}`, `${id}.example`, { personId: `per_${id}`, steps: [makeStep(1, { status: "sent", sentAt: at(-daysAgo) })] });
    ws.activities.push(makeActivity(`act_${id}`, { kind: "touch_sent", personId: `per_${id}`, accountDomain: `${id}.example`, at: at(-daysAgo), draftRef: { packageId: `pkg_${id}`, step: 1 } }));
  }
}

describe("computeScoreboard", () => {
  it("summarizes the sample week", () => {
    expect(computeScoreboard(sampleWorkspace(NOW), NOW)).toEqual({
      weekOf: "2026-10-19",
      conversations: [1, 10],
      firstTouches: [0, 25],
      replies: 2,
      positiveReplies: 1,
      meetingsBooked: 2,
      qualifiedDeals: 3,
      dealsMissingNextStep: 2,
      goalProgress: [2, 5],
      introAsks: [0, 4],
      qualifiedPipelineUsd: 84000,
    });
  });

  it("hides the reply rate below 20 people and shows it from 20", () => {
    const ws = makeWorkspace();
    coldTouches(ws, 19, 7);
    expect(computeScoreboard(ws, NOW).replyRate).toBeUndefined();
    coldTouches(ws, 1, 7, "d");
    for (const i of [0, 1, 2, 3, 4]) ws.activities.push(makeActivity(`act_r${i}`, { kind: "reply_received", personId: `per_c${i}`, at: at(-5) }));
    expect(computeScoreboard(ws, NOW).replyRate).toEqual({ value: 0.25, n: 20 });
  });

  it("shows dollar pipeline only once a price has been quoted", () => {
    const ws = makeWorkspace({ deals: { d: makeDeal("d", "a.example", { stage: "pilot", amountUsd: 20000 }) } });
    expect(computeScoreboard(ws, NOW)).not.toHaveProperty("qualifiedPipelineUsd");
    ws.deals.d.priceQuotes = [{ at: day(-2), amountUsd: 18000 }];
    expect(computeScoreboard(ws, NOW).qualifiedPipelineUsd).toBe(20000);
    delete ws.deals.d.amountUsd;
    expect(computeScoreboard(ws, NOW).qualifiedPipelineUsd).toBe(18000);
  });
});

describe("counters", () => {
  it("counts cold first touches this week and today, and distinct people per account", () => {
    const ws = makeWorkspace();
    coldTouches(ws, 2, 0, "t"); // today
    coldTouches(ws, 3, 1, "m"); // Monday
    coldTouches(ws, 4, 3, "w"); // last week
    ws.activities.push(makeActivity("act_extra", { kind: "touch_sent", personId: "per_t0", accountDomain: "t0.example", at: at(0) }));
    const c = counters(ws, NOW);
    expect(c).toMatchObject({ weekStart: "2026-10-19", coldThisWeek: 5, coldToday: 2 });
    expect(c.peopleThisWeek.get("t0.example")).toEqual(new Set(["per_t0"]));
    expect(c.peopleThisWeek.has("w0.example")).toBe(false);
  });

  it("leaves out follow-ups, non-cold packages and touches marked not sent", () => {
    const ws = makeWorkspace({
      outreach: {
        cold: makePackage("cold", "a.example"),
        warm: makePackage("warm", "a.example", { mode: "warm_intro" }),
      },
    });
    const touch = (draftRef: { packageId: string; step: number }, outcome?: "not_sent") => makeActivity("a", { kind: "touch_sent", at: at(0), draftRef, outcome });
    expect(isColdFirstTouch(ws, touch({ packageId: "cold", step: 1 }))).toBe(true);
    expect(isColdFirstTouch(ws, touch({ packageId: "cold", step: 2 }))).toBe(false);
    expect(isColdFirstTouch(ws, touch({ packageId: "warm", step: 1 }))).toBe(false);
    expect(isColdFirstTouch(ws, touch({ packageId: "cold", step: 1 }, "not_sent"))).toBe(false);
  });

  it("allows the smaller of the weekly and daily headroom, never below zero", () => {
    const ws = makeWorkspace();
    ws.caps = { ...ws.caps, firstTouchesPerWeek: 5, firstTouchesPerDayMax: 3 };
    expect(coldQuotaLeft(ws, counters(ws, NOW))).toBe(3);
    coldTouches(ws, 3, 1);
    expect(coldQuotaLeft(ws, counters(ws, NOW))).toBe(2);
    coldTouches(ws, 4, 0, "t");
    expect(coldQuotaLeft(ws, counters(ws, NOW))).toBe(0);
  });
});

describe("pipeline counts", () => {
  it("counts a held meeting once, even when a meeting_held activity logs it too", () => {
    const ws = makeWorkspace({
      meetings: { m: makeMeeting("m", "d", { startsAt: at(-1, "10:00") }), future: makeMeeting("future", "d", { startsAt: at(1, "10:00") }) },
      activities: [
        makeActivity("same_day", { kind: "meeting_held", dealId: "d", at: at(-1, "11:00") }),
        makeActivity("other_day", { kind: "meeting_held", dealId: "d", at: at(0, "08:00") }),
        makeActivity("last_week", { kind: "meeting_held", dealId: "d", at: at(-3) }),
      ],
    });
    expect(conversationsBetween(ws, "2026-10-19", NOW)).toBe(2);
  });

  it("qualifies talking deals on score and a dated next step; later open stages are qualified", () => {
    const q = { pain: 2, spend: 1, criticalEvent: 1, champion: 2, economicBuyer: 1, icpFit: 1, total: 8, qualified: false } as const;
    const ws = makeWorkspace({
      deals: {
        scored: makeDeal("scored", "a.example", { qualification: q, nextStep: { what: "Demo", date: day(2), buyerAgreed: true } }),
        undated: makeDeal("undated", "a.example", { qualification: q }),
        flagged: makeDeal("flagged", "a.example", { qualification: { ...q, total: 5, qualified: true } }),
        pilot: makeDeal("pilot", "a.example", { stage: "pilot" }),
        lost: makeDeal("lost", "a.example", { stage: "lost", qualification: { ...q, qualified: true } }),
      },
    });
    expect(Object.keys(ws.deals).filter((id) => isQualified(ws, id))).toEqual(["scored", "flagged", "pilot"]);
  });

  it("counts won deals and paid pilots toward the goal", () => {
    const ws = makeWorkspace({
      deals: {
        won: makeDeal("won", "a.example", { stage: "won" }),
        paid: makeDeal("paid", "a.example", { stage: "pilot", pilot: { criteria: "", paid: true } }),
        unpaid: makeDeal("unpaid", "a.example", { stage: "proposal", pilot: { criteria: "", paid: false } }),
      },
    });
    expect(goalWins(ws)).toBe(2);
  });

  it("lists open deals whose next step is missing or past", () => {
    const ws = makeWorkspace({
      accounts: { "a.example": makeAccount("a.example") },
      deals: {
        none: makeDeal("none", "a.example"),
        past: makeDeal("past", "a.example", { nextStep: { what: "x", date: day(-1), buyerAgreed: false } }),
        today: makeDeal("today", "a.example", { nextStep: { what: "x", date: day(0), buyerAgreed: false } }),
        won: makeDeal("won", "a.example", { stage: "won" }),
      },
    });
    expect(dealsMissingNextStep(ws, day(0))).toEqual(["none", "past"]);
  });
});

describe("plan levers drive Today", () => {
  const funnel = (perWeek: Partial<ChannelPlan["funnel"]["perWeek"]>): Foundation =>
    ({ channelPlan: { funnel: { qualifiedNeeded: 0, discoveryCallsNeeded: 0, coldContactsNeeded: 0, perWeek: { conversations: 3, firstTouches: 25, introAsks: 6, meetings: 2.4, ...perWeek } }, motions: [] } }) as unknown as Foundation;

  it("chases the founder's intro asks, else the bet's channel plan, else 4", () => {
    const ws = makeWorkspace();
    expect(introAsksTarget(ws)).toBe(4);
    ws.foundation = funnel({ introAsks: 6 });
    expect(introAsksTarget(ws)).toBe(6);
    applyAction(ws, { type: "goal.update", patch: { introAsksPerWeek: 10 } });
    expect(introAsksTarget(ws)).toBe(10);
    // The Playbook's plan shows the number Today chases.
    expect(planMath(ws, TODAY).intro.perWeek).toBe(10);
    expect(computeScoreboard(ws, NOW).introAsks).toEqual([0, 10]);
  });

  it("keeps warm-path and connector cards up until the plan's number of asks, not 4", () => {
    const acme = "acme.example";
    const ws = makeWorkspace({
      accounts: {
        [acme]: makeAccount(acme, { warmPathCount: 2, peopleIds: ["per_ana"] }),
        "beta.example": makeAccount("beta.example", { fitScore: 70 }),
      },
      people: { per_ana: makePerson("per_ana", acme, { name: "Ana Lima" }) },
      connectors: [{ id: "con_ivy", name: "Ivy Chen", relationship: "investor", introsMade: 0, reach: ["beta.example"] }],
      activities: [0, 1, 2, 3].map((i) => makeActivity(`ask_${i}`, { kind: "intro_requested", at: at(-1) })),
    });
    const warm = () => computeMoves(ws, NOW).find((m) => m.id === `mv_warm_${acme}`)!;
    const connector = () => computeMoves(ws, NOW).filter((m) => m.rule === "today.connector");
    expect(warm().priority).toBe(40);
    expect(connector()).toEqual([]);
    applyAction(ws, { type: "goal.update", patch: { introAsksPerWeek: 10 } });
    expect(warm()).toMatchObject({ priority: 60 });
    expect(warm().why).toContain("4 of 10 intro asks this week");
    expect(connector().map((m) => m.why)).toEqual(["Investor · reaches “beta.example” · 4 of 10 intro asks this week"]);
  });

  it("aims Today at the conversations the founder picked in the Plan, over the bet's channel plan", () => {
    const ws = makeWorkspace({ foundation: funnel({ conversations: 3 }) });
    expect(conversationsTarget(ws)).toBe(3);
    // The default goal (10) isn't a choice; "Use 5" in the Plan is.
    applyAction(ws, { type: "goal.update", patch: { conversationsPerWeek: 5, conversationsChosenAt: at(0) } });
    expect(conversationsTarget(ws)).toBe(5);
    expect(computeScoreboard(ws, NOW).conversations).toEqual([0, 5]);
  });
});

describe("sampleLabel", () => {
  it("names how far a rate can be trusted", () => {
    expect([0, 19, 20, 99, 100].map(sampleLabel)).toEqual(["anecdote", "anecdote", "directional", "directional", "reliable"]);
  });
});
