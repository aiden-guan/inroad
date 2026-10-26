import { describe, expect, it } from "vitest";
import { applyAction } from "@/lib/domain/actions";
import type { Debrief, Workspace } from "@/lib/domain/types";
import { computeMoves } from "@/lib/moves/rules";
import { NOW, at, makeAccount, makeActivity, makeDeal, makeMeeting, makePackage, makePerson, makeWorkspace } from "@/test/factories";
import { debriefReferrals, referralLeads, structuredReferrals } from "./referrals";

/**
 * gtm-7 / spec-13: "Who else should I talk to?" is a mandatory question on every call. The names a
 * debrief hears must become leads the founder can write to in one click, and stay on Today until
 * they do, instead of a line of text.
 */

const NW = "northwind.example";
const KESTREL = "kestrel.example";

function debrief(patch: Partial<Debrief> = {}): Debrief {
  return {
    source: "transcript",
    quotes: [{ id: "q1", speaker: "Marcus Lindqvist", text: "Talk to Priya at Kestrel, she rebuilt their close last year." }],
    card: {} as Debrief["card"],
    qualification: { pain: 0, spend: 0, criticalEvent: 0, champion: 0, economicBuyer: 0, icpFit: 0, total: 0, qualified: false },
    stageSuggestion: null,
    nextStep: null,
    noNextStepWarning: true,
    recap: { subject: "", body: "" },
    committeeUpdates: [],
    tasks: [],
    newObjections: [],
    customerWords: [],
    referrals: ["Priya Shah at Kestrel", "Sam"],
    referralPeople: [
      { name: "Priya Shah", company: "Kestrel", quote: "Talk to Priya at Kestrel, she rebuilt their close last year." },
      { name: "Sam Ortiz" },
    ],
    toConfirm: [],
    coaching: [],
    generatedAt: at(-1, "15:00"),
    ...patch,
  };
}

/** A call with Dana (champion) and Marcus at Northwind yesterday, whose debrief named two people. */
function afterTheCall(d: Debrief = debrief()): Workspace {
  const ws = makeWorkspace({ onboarding: { status: "hired" } });
  ws.accounts[NW] = makeAccount(NW, { name: "Northwind", peopleIds: ["per_dana", "per_marcus"], dealId: "deal_nw", status: "in_pipeline" });
  ws.people.per_dana = makePerson("per_dana", NW, { name: "Dana Okafor", role: "champion" });
  ws.people.per_marcus = makePerson("per_marcus", NW, { name: "Marcus Lindqvist", role: "economic_buyer" });
  ws.deals.deal_nw = makeDeal("deal_nw", NW, { contacts: [{ personId: "per_dana" }, { personId: "per_marcus" }], meetingIds: ["mtg_1"], nextStep: { what: "Pilot terms", date: "2026-10-27", buyerAgreed: true } });
  ws.meetings.mtg_1 = makeMeeting("mtg_1", "deal_nw", { startsAt: at(-1, "14:00"), attendees: [{ personId: "per_dana", name: "Dana Okafor" }, { personId: "per_marcus", name: "Marcus Lindqvist" }], debrief: d });
  return ws;
}

describe("debrief referrals", () => {
  it("keeps the model's referrals structured, quoting only verified quotes", () => {
    const quotes = new Map([["q1", "Talk to Priya."]]);
    expect(
      structuredReferrals(
        [
          { name: " Priya Shah ", company: "Kestrel", quoteId: "q1" },
          { name: null, company: "Halcyon", quoteId: "q_missing" },
          { name: " ", company: null, quoteId: null },
          { name: "priya shah", company: "kestrel", quoteId: null },
        ],
        quotes,
      ),
    ).toEqual([{ name: "Priya Shah", company: "Kestrel", quote: "Talk to Priya." }, { company: "Halcyon" }]);
  });

  it("reads older debriefs that only kept 'Name at Company'", () => {
    expect(debriefReferrals(debrief({ referralPeople: undefined }))).toEqual([{ name: "Priya Shah", company: "Kestrel" }, { name: "Sam" }]);
  });

  it("resolves who suggested them, their company and whether they're on file", () => {
    const ws = afterTheCall();
    const [priya, sam] = referralLeads(ws, ws.meetings.mtg_1);
    // Kestrel isn't on file yet: the founder adds it first. Marcus said it (the quote's speaker).
    expect(priya).toMatchObject({ name: "Priya Shah", company: "Kestrel", referrerId: "per_marcus", acted: false, index: 0 });
    expect(priya.domain).toBeUndefined();
    // No company named: the referrer's company. No quote: the champion suggested them.
    expect(sam).toMatchObject({ name: "Sam Ortiz", domain: NW, referrerId: "per_dana", acted: false });

    ws.accounts[KESTREL] = makeAccount(KESTREL, { name: "Kestrel" });
    expect(referralLeads(ws, ws.meetings.mtg_1)[0].domain).toBe(KESTREL);
  });

  it("counts a lead as handled once there's a draft or a touch since the call, or they're on the deal or do-not-contact", () => {
    const lead = (fn: (ws: Workspace) => void) => {
      const ws = afterTheCall();
      ws.accounts[KESTREL] = makeAccount(KESTREL, { name: "Kestrel", peopleIds: ["per_priya"] });
      ws.people.per_priya = makePerson("per_priya", KESTREL, { name: "Priya Shah" });
      fn(ws);
      return referralLeads(ws, ws.meetings.mtg_1)[0];
    };
    expect(lead(() => {})).toMatchObject({ personId: "per_priya", acted: false, drafted: false });
    // A draft is not a note sent: the row keeps it open, the cold-draft card carries it on Today.
    expect(lead((ws) => (ws.outreach.out_1 = makePackage("out_1", KESTREL, { personId: "per_priya", createdAt: at(0) })))).toMatchObject({ acted: false, drafted: true });
    // A draft from before the call doesn't count.
    expect(lead((ws) => (ws.outreach.out_1 = makePackage("out_1", KESTREL, { personId: "per_priya", createdAt: at(-5) }))).drafted).toBe(false);
    expect(lead((ws) => ws.activities.push(makeActivity("act_0", { at: at(0), kind: "touch_sent", personId: "per_priya" }))).acted).toBe(true);
    expect(lead((ws) => ws.activities.push(makeActivity("act_1", { at: at(0), kind: "linkedin_dm", personId: "per_priya" }))).acted).toBe(true);
    expect(lead((ws) => (ws.people.per_priya.doNotContact = true)).acted).toBe(true);
    expect(lead((ws) => ws.deals.deal_nw.contacts.push({ personId: "per_priya" })).acted).toBe(true);
  });

  it("remembers the company the founder added for a referral, even under another name", () => {
    const ws = afterTheCall(debrief({ referralPeople: undefined }));
    ws.accounts["kestrellabs.example"] = makeAccount("kestrellabs.example", { name: "Kestrel Labs Inc" });
    expect(referralLeads(ws, ws.meetings.mtg_1)[0].domain).toBeUndefined();
    applyAction(ws, { type: "meeting.patchDebrief", id: "mtg_1", generatedAt: ws.meetings.mtg_1.debrief!.generatedAt, patch: { referralDomain: { index: 0, domain: "kestrellabs.example" } } });
    expect(ws.meetings.mtg_1.debrief!.referralPeople?.[0]).toEqual({ name: "Priya Shah", company: "Kestrel", domain: "kestrellabs.example" });
    expect(referralLeads(ws, ws.meetings.mtg_1)[0].domain).toBe("kestrellabs.example");
  });
});

describe("the referral card on Today", () => {
  const card = (ws: Workspace, now = NOW) => computeMoves(ws, now).filter((m) => m.rule === "today.referrals");

  it("asks to write to everyone the call named, until each one is handled", () => {
    const ws = afterTheCall();
    expect(card(ws)).toEqual([
      expect.objectContaining({ id: "mv_referrals_mtg_1", kind: "first_touch", title: "Write to the 2 people they suggested", priority: 62, ref: { kind: "meeting", id: "mtg_1" }, href: `/companies?c=${encodeURIComponent(NW)}` }),
    ]);
    expect(card(ws)[0].why).toBe("Named on the Northwind call Oct 19 · a referral is the warmest first touch");

    // Sam is written to: one left, named with who suggested them.
    ws.people.per_sam = makePerson("per_sam", NW, { name: "Sam Ortiz" });
    ws.outreach.out_sam = makePackage("out_sam", NW, { personId: "per_sam", createdAt: at(0) });
    expect(card(ws).map((m) => m.title)).toEqual(["Write to Priya at Kestrel, Marcus's referral"]);

    ws.accounts[KESTREL] = makeAccount(KESTREL, { name: "Kestrel", peopleIds: ["per_priya"] });
    ws.people.per_priya = makePerson("per_priya", KESTREL, { name: "Priya Shah" });
    ws.outreach.out_priya = makePackage("out_priya", KESTREL, { personId: "per_priya", createdAt: at(0) });
    expect(card(ws)).toEqual([]);
  });

  it("hands a company named without a person to the company's own cards once it's on file", () => {
    const ws = afterTheCall(debrief({ referralPeople: [{ company: "Kestrel" }], referrals: ["Kestrel"] }));
    expect(card(ws).map((m) => m.title)).toEqual(["Add Kestrel, Dana's referral"]);
    ws.accounts[KESTREL] = makeAccount(KESTREL, { name: "Kestrel", source: "referral" });
    expect(card(ws)).toEqual([]);
  });

  it("lets a referral go quiet two weeks after the call", () => {
    expect(card(afterTheCall(), new Date(2026, 10, 3, 9, 30))).toEqual([]);
  });

  it("hands over to the draft at the same rank, so a busy day doesn't push the note to tomorrow", () => {
    const ws = afterTheCall(debrief({ referralPeople: [{ name: "Sam Ortiz" }], referrals: ["Sam Ortiz"] }));
    ws.accounts[NW].tier = "B";
    ws.people.per_sam = makePerson("per_sam", NW, { name: "Sam Ortiz", source: "referral", notes: "Referred by Marcus Lindqvist on the Oct 19 call" });
    ws.outreach.out_sam = makePackage("out_sam", NW, { personId: "per_sam", createdAt: at(0) });
    const moves = computeMoves(ws, NOW);
    expect(card(ws)).toEqual([]);
    expect(moves.find((m) => m.draft?.packageId === "out_sam")).toMatchObject({ title: "Write to Sam at Northwind", why: "Referred by Marcus Lindqvist on the Oct 19 call · draft ready", priority: 62 });
    // Any other cold draft keeps the cold-draft rank.
    ws.people.per_sam.source = "manual";
    expect(computeMoves(ws, NOW).find((m) => m.draft?.packageId === "out_sam")).toMatchObject({ why: "Draft ready", priority: 52 });
  });
});
