import { describe, expect, it } from "vitest";
import { applyAction, type Action } from "@/lib/domain/actions";
import { addBusinessDays, todayISO } from "@/lib/domain/ids";
import type { Move, Workspace } from "@/lib/domain/types";
import { makeAccount, makeActivity, makeMeeting, makePackage, makePerson, makeStep, makeWorkspace } from "@/test/factories";
import { awaitingOutcome, bookingLoops, bookingNudge, gmailSearchLinks, searchDays } from "./replies";
import { computeMoves, mergeMoves, visibleMoves } from "./rules";

/**
 * gtm-1: a positive reply the founder answers with times must stay tracked until a call is booked or
 * the founder closes it out. The audit's scratch test found nothing about the person after day 8,
 * after marking "no reply", or on day 15. These walk the same path.
 */

const d = (month: number, day: number, hh = 9, mm = 30) => new Date(2026, month - 1, day, hh, mm);
const iso = (month: number, day: number, hh = 10) => d(month, day, hh, 0).toISOString();
const DOMAIN = "northwind.example";

/** Dana got a cold first touch on Oct 6 and said yes on Mon Oct 12; the reply draft offers two times. */
function yesFromDana(intent: "positive" | "info_request" = "positive"): Workspace {
  const ws = makeWorkspace({ onboarding: { status: "hired" } });
  ws.founder = { name: "Priya Raman", availability: "Tue–Thu 10–4 PT" };
  ws.accounts[DOMAIN] = makeAccount(DOMAIN, { name: "Northwind", peopleIds: ["per_dana"] });
  ws.people.per_dana = makePerson("per_dana", DOMAIN, { name: "Dana Okafor" });
  ws.outreach.out_cold = makePackage("out_cold", DOMAIN, { personId: "per_dana", createdAt: iso(10, 6, 9), steps: [makeStep(1, { status: "sent", sentAt: iso(10, 6) })] });
  ws.activities.push(
    makeActivity("act_first", { at: iso(10, 6), kind: "touch_sent", personId: "per_dana", accountDomain: DOMAIN, channel: "email", draftRef: { packageId: "out_cold", step: 1 } }),
    makeActivity("act_yes", { at: iso(10, 12), kind: "reply_received", personId: "per_dana", accountDomain: DOMAIN, channel: "email", sentiment: intent === "positive" ? "positive" : "neutral", body: "Sure, happy to chat next week." }),
  );
  ws.outreach.out_reply = makePackage("out_reply", DOMAIN, {
    mode: "reply",
    personId: "per_dana",
    createdAt: iso(10, 12, 11),
    steps: [makeStep(1, { thread: "reply", subject: null, body: "Thanks Dana. Tuesday 10am or Wednesday 2pm?" })],
    reply: { text: "Sure, happy to chat next week.", intent, summary: "", receivedAt: iso(10, 12) },
    replyAction: intent === "positive" ? "book" : "draft",
  });
  return ws;
}

const approve: Action = { type: "outreach.approveStep", packageId: "out_reply", step: 1, at: iso(10, 12, 11), activityId: "act_answer" };
const about = (moves: Move[], personId = "per_dana") => moves.filter((m) => m.ref?.kind === "person" && m.ref.id === personId);
const ofRule = (moves: Move[], rule: string) => moves.filter((m) => m.rule === `today.${rule}`);

describe("answering a yes", () => {
  it("opens a deal at Talking whose next step is booking the call, and Undo takes it back", () => {
    const ws = yesFromDana();
    ws.accounts[DOMAIN].status = "tracked";
    applyAction(ws, approve);
    const deal = ws.deals.deal_out_reply;
    expect(deal).toMatchObject({ stage: "talking", accountDomain: DOMAIN, contacts: [{ personId: "per_dana" }], nextStep: { what: "Book the call with Dana", date: "2026-10-14", buyerAgreed: false } });
    expect(ws.accounts[DOMAIN]).toMatchObject({ dealId: deal.id, status: "in_pipeline" });
    expect(ws.activities.find((a) => a.id === "act_answer")?.dealId).toBe(deal.id);

    applyAction(ws, { type: "outreach.unapproveStep", packageId: "out_reply", step: 1, activityId: "act_answer" });
    expect(ws.deals.deal_out_reply).toBeUndefined();
    expect(ws.accounts[DOMAIN].dealId).toBeUndefined();
    expect(ws.accounts[DOMAIN].status).toBe("tracked");
  });

  it("adds them to an open deal instead of opening a second one, and leaves 'send me info' without a deal", () => {
    const ws = yesFromDana();
    ws.deals.deal_open = { id: "deal_open", accountDomain: DOMAIN, name: "Northwind", stage: "qualified", stageHistory: [], source: "signal_cold", contacts: [], meetingIds: [], createdAt: iso(10, 1), updatedAt: iso(10, 1), lastActivityAt: iso(10, 1) };
    ws.accounts[DOMAIN].dealId = "deal_open";
    applyAction(ws, approve);
    expect(Object.keys(ws.deals)).toEqual(["deal_open"]);
    expect(ws.deals.deal_open.contacts).toEqual([{ personId: "per_dana", role: undefined }]);

    const info = yesFromDana("info_request");
    applyAction(info, approve);
    expect(info.deals).toEqual({});
  });
});

describe("the booking loop on Today", () => {
  /** Answered on Oct 12; each later step is replayed on a copy. */
  const answered = () => {
    const ws = yesFromDana();
    applyAction(ws, approve);
    return ws;
  };
  const desk = (ws: Workspace, now: Date) => {
    ws.moves = mergeMoves(ws.moves, computeMoves(ws, now), todayISO(now));
  };

  it("waits two working days, then asks for one nudge, and never shows a bare 'set a next step' beside it", () => {
    const ws = answered();
    expect(about(computeMoves(ws, d(10, 13)))).toEqual([]);
    expect(ofRule(computeMoves(ws, d(10, 13)), "next_step")).toEqual([]);
    const wed = computeMoves(ws, d(10, 14));
    expect(ofRule(wed, "reply_book")).toEqual([
      expect.objectContaining({ id: "mv_book_act_yes_0", kind: "follow_up", title: "Book Dana: said yes Oct 12, no time picked", priority: 81.4, subjectIds: ["deal_out_reply"], activityId: "act_yes" }),
    ]);
    // Day 8 (the audit's (a)): still there, overdue, and the deal's own next-step card stays out of the way.
    const tue = computeMoves(ws, d(10, 20));
    expect(ofRule(tue, "reply_book").map((m) => [m.id, m.overdueDays])).toEqual([["mv_book_act_yes_0", 6]]);
    expect(ofRule(tue, "next_step")).toEqual([]);
  });

  it("survives a 'no reply' mark in Check replies and the 14-day window", () => {
    const ws = answered();
    // (b) Marked N: the person is still on Today.
    applyAction(ws, { type: "activity.markOutcome", ids: ["act_answer"], outcome: "no_reply", at: iso(10, 20) });
    expect(ofRule(computeMoves(ws, d(10, 20)), "reply_book")).toHaveLength(1);
    // (c) Day 15 and beyond.
    expect(ofRule(computeMoves(ws, d(10, 27)), "reply_book")).toHaveLength(1);
  });

  it("keeps the answered thread in Check replies past 14 days, with a search that reaches back far enough", () => {
    const ws = answered();
    const nov2 = d(11, 2);
    const rows = awaitingOutcome(ws, nov2);
    expect(rows.map((r) => [r.personId, r.lastLabel, r.awaitingTime])).toEqual([["per_dana", "Your reply", true]]);
    const days = searchDays(rows, "2026-11-02");
    expect(days).toBe(22);
    expect(gmailSearchLinks(["dana@northwind.example"], undefined, days)[0].query).toBe("from:{dana@northwind.example} newer_than:22d");
    expect(computeMoves(ws, nov2).find((m) => m.kind === "check_replies")?.why).toBe("1 touch in 22 days · one Gmail search");
    // Without an open loop the old window holds: a booked call drops it from the search.
    applyAction(ws, { type: "meeting.upsert", meeting: makeMeeting("mtg_1", "deal_out_reply", { startsAt: iso(11, 4) }) });
    expect(awaitingOutcome(ws, nov2)).toEqual([]);
  });

  it("restarts the clock on each nudge, then asks to decide after two", () => {
    const ws = answered();
    const nudge = (id: string, at: string) => applyAction(ws, { type: "activity.log", activity: makeActivity(id, { at, kind: "touch_sent", personId: "per_dana", accountDomain: DOMAIN, channel: "email" }) });
    nudge("act_n1", iso(10, 20, 11));
    expect(bookingLoops(ws, d(10, 20, 12))[0]).toMatchObject({ nudges: 1, dueOn: addBusinessDays("2026-10-20", 3) });
    expect(ofRule(computeMoves(ws, d(10, 22)), "reply_book")).toEqual([]);
    expect(ofRule(computeMoves(ws, d(10, 23)), "reply_book").map((m) => [m.id, m.title])).toEqual([["mv_book_act_yes_1", "Book Dana: said yes Oct 12, no time picked"]]);
    nudge("act_n2", iso(10, 23, 11));
    expect(ofRule(computeMoves(ws, d(10, 28)), "reply_book").map((m) => [m.id, m.title])).toEqual([["mv_book_act_yes_2", "Decide on Dana at Northwind: book it, park it or let it go"]]);
  });

  it("keeps a card marked done off Today, and the next nudge brings the next one", () => {
    const ws = answered();
    desk(ws, d(10, 14));
    applyAction(ws, { type: "move.done", id: "mv_book_act_yes_0" });
    desk(ws, d(10, 15));
    expect(visibleMoves(ws.moves, "2026-10-15").map((m) => m.id)).not.toContain("mv_book_act_yes_0");
    applyAction(ws, { type: "activity.log", activity: makeActivity("act_n1", { at: iso(10, 15, 11), kind: "touch_sent", personId: "per_dana", accountDomain: DOMAIN, channel: "email" }) });
    desk(ws, d(10, 20));
    expect(visibleMoves(ws.moves, "2026-10-20").map((m) => m.id)).toContain("mv_book_act_yes_1");
  });

  it("closes when a call is booked or held, the deal is parked or lost, they say not now, or they're suppressed", () => {
    const close = (fn: (ws: Workspace) => void) => {
      const ws = answered();
      fn(ws);
      return ofRule(computeMoves(ws, d(10, 20)), "reply_book");
    };
    expect(close(() => {})).toHaveLength(1);
    expect(close((ws) => applyAction(ws, { type: "meeting.upsert", meeting: makeMeeting("mtg_1", "deal_out_reply", { startsAt: iso(10, 22) }) }))).toEqual([]);
    expect(close((ws) => ws.activities.push(makeActivity("act_held", { at: iso(10, 15), kind: "meeting_held", accountDomain: DOMAIN })))).toEqual([]);
    expect(close((ws) => applyAction(ws, { type: "deal.setStage", id: "deal_out_reply", stage: "nurture", nurtureUntil: "2026-12-01", at: iso(10, 19) }))).toEqual([]);
    expect(close((ws) => applyAction(ws, { type: "deal.setStage", id: "deal_out_reply", stage: "lost", lossReason: "went_dark", at: iso(10, 19) }))).toEqual([]);
    expect(close((ws) => applyAction(ws, { type: "deal.setNextStep", id: "deal_out_reply", nextStep: { what: "Call", date: "2026-10-27", buyerAgreed: true }, at: iso(10, 19) }))).toEqual([]);
    expect(close((ws) => ws.activities.push(makeActivity("act_later", { at: iso(10, 16), kind: "reply_received", personId: "per_dana", sentiment: "negative" })))).toEqual([]);
    expect(close((ws) => ws.suppression.push({ id: "sup", email: "dana@northwind.example", reason: "unsubscribe", at: iso(10, 16) }))).toEqual([]);
  });

  it("lets go of a loop with no deal everywhere: Today and Check replies stop chasing it, Undo brings it back", () => {
    const ws = yesFromDana("info_request");
    applyAction(ws, approve);
    expect(ws.deals).toEqual({});
    const nov2 = d(11, 2);
    expect(ofRule(computeMoves(ws, nov2), "reply_book")).toHaveLength(1);
    expect(awaitingOutcome(ws, nov2).map((r) => r.awaitingTime)).toEqual([true]);

    applyAction(ws, { type: "activity.closeLoop", id: "act_yes", at: iso(11, 2) });
    expect(bookingLoops(ws, nov2)).toEqual([]);
    expect(ofRule(computeMoves(ws, nov2), "reply_book")).toEqual([]);
    // Past 14 days, the answered thread leaves the search like any other touch.
    expect(awaitingOutcome(ws, nov2)).toEqual([]);
    // A later touch doesn't revive it either.
    applyAction(ws, { type: "activity.log", activity: makeActivity("act_later", { at: iso(11, 3), kind: "touch_sent", personId: "per_dana", accountDomain: DOMAIN, channel: "email" }) });
    expect(ofRule(computeMoves(ws, d(11, 10)), "reply_book")).toEqual([]);

    applyAction(ws, { type: "activity.closeLoop", id: "act_yes", at: null });
    expect(ofRule(computeMoves(ws, d(11, 10)), "reply_book")).toHaveLength(1);
  });

  it("covers LinkedIn answers and 'send me info' replies too", () => {
    const ws = yesFromDana("info_request");
    ws.activities.push(makeActivity("act_dm", { at: iso(10, 12, 12), kind: "linkedin_dm", personId: "per_dana", accountDomain: DOMAIN, channel: "linkedin" }));
    const [card] = ofRule(computeMoves(ws, d(10, 14)), "reply_book");
    expect(card).toMatchObject({ title: "Follow up with Dana: asked for info Oct 12, no call yet", priority: 74 });
    expect(card.subjectIds).toBeUndefined();
  });

  it("writes the nudge in code from the founder's availability", () => {
    const ws = answered();
    const [loop] = bookingLoops(ws, d(10, 14));
    expect(bookingNudge(ws, loop)).toBe("Hi Dana, picking this back up. I'm free Tue–Thu 10–4 PT. Does any time there work for 20 minutes?");
    ws.founder = { name: "Priya", schedulingUrl: "https://cal.example/priya" };
    expect(bookingNudge(ws, loop)).toBe("Hi Dana, picking this back up. Would Tuesday or Wednesday afternoon next week work for 20 minutes? Or grab a time that suits here: https://cal.example/priya");
  });
});
