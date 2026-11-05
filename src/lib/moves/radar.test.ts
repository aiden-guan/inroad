import { describe, expect, it } from "vitest";
import { applyAction } from "@/lib/domain/actions";
import type { Workspace } from "@/lib/domain/types";
import { defaultRemindOn } from "@/lib/replies/remind";
import { sampleWorkspace } from "@/lib/sample";
import { PERSON } from "@/lib/sample/ids";
import { NOW, TODAY, at, day, makeAccount, makeActivity, makeDeal, makeMeeting, makePackage, makePerson, makeStep, makeWorkspace } from "@/test/factories";
import { bumpText, radarMoves, stepNudge, waitingOn } from "./radar";
import { computeMoves, mergeMoves, visibleMoves } from "./rules";

const acme = "acme.io";

/** Ana at Acme, with an open deal, and one recap sent `daysAgo` with a reminder for `remindIn` days after. */
function thread(opts: { sentDaysAgo?: number; remindOn?: string | null; extra?: Partial<Workspace> } = {}): Workspace {
  const sent = at(-(opts.sentDaysAgo ?? 6), "16:00");
  return makeWorkspace({
    accounts: { [acme]: makeAccount(acme, { status: "in_pipeline", dealId: "deal_acme", peopleIds: ["per_ana"] }) },
    people: { per_ana: makePerson("per_ana", acme, { name: "Ana Lima" }) },
    deals: { deal_acme: makeDeal("deal_acme", acme, { stage: "talking", contacts: [{ personId: "per_ana" }], lastActivityAt: sent }) },
    activities: [makeActivity("act_recap", { kind: "touch_sent", personId: "per_ana", accountDomain: acme, channel: "email", at: sent, summary: "Recap to Ana Lima", ...(opts.remindOn !== undefined ? { remindOn: opts.remindOn } : {}) })],
    ...opts.extra,
  });
}

describe("defaultRemindOn", () => {
  it("follows the sequence's spacing for steps 1 and 2, else four working days", () => {
    const cold = makePackage("pkg", acme, { steps: [makeStep(1), makeStep(2, { sendOn: day(3) })] });
    expect(defaultRemindOn(cold, { step: 1 }, at(0))).toBe(day(3));
    const noDraft = makePackage("pkg2", acme, { steps: [makeStep(1)] });
    expect(defaultRemindOn(noDraft, { step: 1 }, at(0))).toBe(day(3));
    const reply = makePackage("pkg3", acme, { mode: "reply" });
    // Tuesday + 4 working days = Monday.
    expect(defaultRemindOn(reply, { step: 1 }, at(0))).toBe(day(6));
    expect(defaultRemindOn(makePackage("pkg4", acme, { mode: "warm_intro" }), { step: 1 }, at(0))).toBeNull();
    expect(defaultRemindOn(makePackage("pkg5", acme, { pushedTo: [{ integrationId: "instantly", at: at(0) }] }), { step: 1 }, at(0))).toBeNull();
  });

  it("is set on the send when a draft is marked sent, and can be turned off", () => {
    const ws = thread();
    ws.outreach.pkg = makePackage("pkg", acme, { mode: "reply", personId: "per_ana", steps: [makeStep(1, { thread: "reply", subject: null })] });
    applyAction(ws, { type: "outreach.approveStep", packageId: "pkg", step: 1, at: at(0), activityId: "act_sent" });
    expect(ws.activities.find((a) => a.id === "act_sent")?.remindOn).toBe(day(6));
    applyAction(ws, { type: "activity.setRemind", id: "act_sent", on: null });
    expect(ws.activities.find((a) => a.id === "act_sent")?.remindOn).toBeNull();
  });
});

describe("waitingOn", () => {
  it("lists a send with a reminder until something comes back, due once the day comes", () => {
    const ws = thread({ remindOn: day(-1) });
    const [w] = waitingOn(ws, NOW);
    expect(w).toMatchObject({ personId: "per_ana", remindOn: day(-1), basis: "reminder", due: true, dealId: "deal_acme" });
    expect(waitingOn(thread({ remindOn: day(2) }), NOW)[0]).toMatchObject({ due: false });
  });

  it("stops waiting on a reply, a meeting held or booked, a bounce, or a reminder turned off", () => {
    const reply = makeActivity("act_r", { kind: "reply_received", personId: "per_ana", at: at(-1), body: "Thanks, looks right." });
    expect(waitingOn(thread({ remindOn: day(-1), extra: {} }), NOW)).toHaveLength(1);
    const withReply = thread({ remindOn: day(-1) });
    withReply.activities.push(reply);
    expect(waitingOn(withReply, NOW)).toEqual([]);
    const met = thread({ remindOn: day(-1) });
    met.meetings.m1 = makeMeeting("m1", "deal_acme", { startsAt: at(2, "10:00") });
    met.deals.deal_acme.meetingIds = ["m1"];
    expect(waitingOn(met, NOW)).toEqual([]);
    expect(waitingOn(thread({ remindOn: null }), NOW)).toEqual([]);
    const bounced = thread({ remindOn: day(-1) });
    bounced.activities[0].outcome = "bounced";
    expect(waitingOn(bounced, NOW)).toEqual([]);
  });

  it("keeps waiting through an out-of-office, held until they're back", () => {
    const ws = thread({ remindOn: day(-1) });
    ws.activities.push(makeActivity("act_ooo", { kind: "reply_received", personId: "per_ana", at: at(-2), sentiment: "ooo", body: "Out of office until Monday.", holdUntil: day(6) }));
    expect(waitingOn(ws, NOW)[0]).toMatchObject({ remindOn: day(6), heldUntil: day(6), due: false });
  });

  it("counts a live sequence's next step as the reminder", () => {
    const ws = thread();
    ws.outreach.pkg = makePackage("pkg", acme, { personId: "per_ana", steps: [makeStep(1, { status: "sent", sentAt: at(-3) }), makeStep(2)] });
    ws.activities = [makeActivity("act_t1", { kind: "touch_sent", personId: "per_ana", accountDomain: acme, at: at(-3), draftRef: { packageId: "pkg", step: 1 } })];
    expect(waitingOn(ws, NOW)[0]).toMatchObject({ basis: "sequence", remindOn: TODAY, due: true, packageId: "pkg", nextStep: 2 });
    // The sequence's own follow-up card covers it: no second card from the radar.
    expect(radarMoves(ws, NOW)).toEqual([]);
  });
});

describe("radarMoves", () => {
  it("brings a due reminder back as a follow-up with a written bump, and covers the deal's next-step card", () => {
    const ws = thread({ remindOn: day(-1) });
    const [card] = radarMoves(ws, NOW);
    expect(card).toMatchObject({ id: "mv_remind_act_recap", kind: "follow_up", rule: "remind", title: "Follow up with Ana at Acme", subjectIds: ["deal_acme"], overdueDays: 1 });
    expect(card.why).toBe(`No reply to your recap since ${new Date(`${day(-6)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · the bump is written`);
    const moves = computeMoves(ws, NOW);
    expect(moves.some((m) => m.id === "mv_remind_act_recap")).toBe(true);
    expect(moves.some((m) => m.rule === "today.next_step" && m.ref?.id === "deal_acme")).toBe(false);
  });

  it("writes a bump that names the note and asks one question that fits", () => {
    const ws = thread({ remindOn: day(-1) });
    const text = bumpText(ws, waitingOn(ws, NOW)[0], TODAY);
    expect(text).toMatch(/^Hi Ana, following up on my recap from /);
    expect(text).toMatch(/Would a short call next week help settle the next step\?$/);
    ws.deals.deal_acme.nextStep = { what: "Security review with their CISO", date: day(3), buyerAgreed: true };
    expect(bumpText(ws, waitingOn(ws, NOW)[0], TODAY)).toMatch(/Are we still on for security review with their CISO on /);
  });

  it("brings a not-now back on its check-back day, once, until the founder writes", () => {
    const ws = thread();
    ws.activities.push(makeActivity("act_later", { kind: "reply_received", personId: "per_ana", at: at(-40), body: "Not now. Check back in a month.", holdUntil: day(-1) }));
    expect(radarMoves(ws, NOW).map((c) => c.id)).toEqual(["mv_checkback_act_later"]);
    ws.activities.push(makeActivity("act_wrote", { kind: "touch_sent", personId: "per_ana", at: at(0, "09:00") }));
    expect(radarMoves(ws, NOW)).toEqual([]);
  });
});

describe("stepNudge", () => {
  it("nudges the buyer on a late step they owe, and not on a step that was a meeting or is the founder's", () => {
    const ws = thread();
    ws.deals.deal_acme = { ...ws.deals.deal_acme, stage: "proposal", nextStep: { what: "Ana sends redlines from counsel", date: day(-2), buyerAgreed: true } };
    expect(stepNudge(ws, ws.deals.deal_acme, NOW)).toMatchObject({ person: { id: "per_ana" }, text: expect.stringMatching(/^Hi Ana, checking in on the redlines from counsel, which we had down for /) });
    ws.deals.deal_acme.nextStep = { what: "Send the order form", date: day(-2), buyerAgreed: true };
    expect(stepNudge(ws, ws.deals.deal_acme, NOW)).toBeNull();
    ws.deals.deal_acme.nextStep = { what: "Check-in call with Ana", date: day(-1), buyerAgreed: true };
    ws.meetings.m1 = makeMeeting("m1", "deal_acme", { startsAt: at(-1, "11:00") });
    ws.deals.deal_acme.meetingIds = ["m1"];
    expect(stepNudge(ws, ws.deals.deal_acme, NOW)).toBeNull();
  });

  it("turns the overdue next-step card into a nudge with the same id", () => {
    const ws = thread();
    ws.deals.deal_acme = { ...ws.deals.deal_acme, stage: "proposal", nextStep: { what: "Ana sends redlines from counsel", date: day(-2), buyerAgreed: true } };
    const card = computeMoves(ws, NOW).find((m) => m.id === `mv_nextstep_deal_acme_${day(-2)}`);
    expect(card).toMatchObject({ title: "Nudge Ana at Acme" });
    expect(card?.why).toMatch(/a one-line note keeps it moving$/);
  });
});

describe("snooze until they reply", () => {
  it("wakes a card as soon as that person writes back", () => {
    const ws = thread();
    ws.deals.deal_acme.nextStep = undefined;
    ws.deals.deal_acme.lastActivityAt = at(-3);
    ws.moves = mergeMoves({}, computeMoves(ws, NOW), TODAY, ws);
    const id = "mv_nextstep_deal_acme_none";
    applyAction(ws, { type: "move.snooze", id, until: day(30), at: at(0, "09:00"), untilReply: "per_ana" });
    ws.moves = mergeMoves(ws.moves, computeMoves(ws, NOW), TODAY, ws);
    expect(visibleMoves(ws.moves, TODAY).map((m) => m.id)).not.toContain(id);
    ws.activities.push(makeActivity("act_back", { kind: "reply_received", personId: "per_ana", at: at(0, "09:20") }));
    ws.moves = mergeMoves(ws.moves, computeMoves(ws, NOW), TODAY, ws);
    expect(ws.moves[id].status).toBe("open");
  });
});

describe("the sample", () => {
  it("has a reminder due on Leo's recap and two people waiting", () => {
    const ws = sampleWorkspace(NOW);
    const waiting = waitingOn(ws, NOW);
    expect(waiting.map((w) => w.personId).sort()).toEqual([PERSON.leo, PERSON.mei].sort());
    expect(radarMoves(ws, NOW).map((c) => c.title)).toEqual(["Follow up with Leo at Saltmarsh Compute"]);
  });
});
