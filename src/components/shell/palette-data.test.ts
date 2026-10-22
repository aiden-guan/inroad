import { describe, expect, it } from "vitest";
import type { Connector, Workspace } from "@/lib/domain/types";
import { NOW, TODAY, at, makeAccount, makeActivity, makeDeal, makeMeeting, makePerson, makeWorkspace } from "@/test/factories";
import { connectorChoices, connectorTargets, dealCandidates, proposalDeals, repliesToCheck, reviewThisWeek, upcomingMeetings, writeTargets } from "./palette-data";

function workspace(): Workspace {
  const ws = makeWorkspace();
  ws.accounts["northwind.io"] = makeAccount("northwind.io", { name: "Northwind", dealId: "deal_n", status: "in_pipeline", fitScore: 60, oneLiner: "Usage billing for fintech" });
  ws.accounts["pave.io"] = makeAccount("pave.io", { name: "Pave", fitScore: 90, watch: false, status: "new", oneLiner: "Payments infrastructure" });
  ws.accounts["lumen.io"] = makeAccount("lumen.io", { name: "Lumen", fitScore: 70 });
  ws.accounts["gone.io"] = makeAccount("gone.io", { name: "Gone", status: "disqualified" });
  ws.deals.deal_n = makeDeal("deal_n", "northwind.io", { stage: "qualified" });
  ws.deals.deal_l = makeDeal("deal_l", "lumen.io", { stage: "lost" });
  ws.people.per_dana = makePerson("per_dana", "northwind.io", { name: "Dana Kim" });
  ws.people.per_pat = makePerson("per_pat", "pave.io", { name: "Pat Lee" });
  ws.people.per_lou = makePerson("per_lou", "lumen.io", { name: "Lou Park" });
  ws.people.per_dnc = makePerson("per_dnc", "lumen.io", { name: "Dee Noh", doNotContact: true });
  ws.people.per_gone = makePerson("per_gone", "gone.io", { name: "Gil One" });
  return ws;
}

describe("writeTargets", () => {
  it("puts people in a live deal and on tracked companies first, and leaves out who can't be written to", () => {
    expect(writeTargets(workspace()).map((t) => t.person.id)).toEqual(["per_dana", "per_lou", "per_pat"]);
  });
});

describe("upcomingMeetings", () => {
  it("lists today's and the next two weeks' meetings without a debrief, soonest first", () => {
    const ws = workspace();
    ws.meetings.m_late = makeMeeting("m_late", "deal_n", { startsAt: at(10, "15:00") });
    ws.meetings.m_today = makeMeeting("m_today", "deal_n", { startsAt: at(0, "08:00") });
    ws.meetings.m_far = makeMeeting("m_far", "deal_n", { startsAt: at(20) });
    ws.meetings.m_past = makeMeeting("m_past", "deal_n", { startsAt: at(-1) });
    ws.meetings.m_done = makeMeeting("m_done", "deal_n", { startsAt: at(1), debrief: {} as never });
    const out = upcomingMeetings(ws, NOW);
    expect(out.map((m) => m.meeting.id)).toEqual(["m_today", "m_late"]);
    expect(out[0]).toMatchObject({ domain: "northwind.io", company: "Northwind" });
  });
});

describe("connectors", () => {
  const claire: Connector = { id: "con_c", name: "Claire Donovan", relationship: "investor", reach: ["pave.io", "fintech"], introsMade: 1 };
  const ava: Connector = { id: "con_a", name: "Ava Whitman", relationship: "advisor", introsMade: 0, lastAskedOn: TODAY };
  const conn: Connector = { id: "con_x", name: "Someone Inside", relationship: "connection", introsMade: 0 };

  it("offers the ones ready for an ask first, never a bare LinkedIn path", () => {
    const ws = workspace();
    ws.connectors = [ava, claire, conn];
    expect(connectorChoices(ws, TODAY).map((c) => [c.connector.id, c.ledger.status])).toEqual([
      ["con_c", "ready"],
      ["con_a", "resting"],
    ]);
  });

  it("ranks the companies their reach names, then by topic, then by fit, and skips live deals", () => {
    const ws = workspace();
    const targets = connectorTargets(ws, claire).map((t) => [t.account.domain, t.reach]);
    expect(targets).toEqual([
      ["pave.io", "exact"],
      ["lumen.io", null],
    ]);
  });
});

describe("deals", () => {
  it("offers live deals for a pilot proposal, closest to a proposal first", () => {
    const ws = workspace();
    ws.deals.deal_p = makeDeal("deal_p", "pave.io", { stage: "proposal" });
    expect(proposalDeals(ws).map((d) => d.id)).toEqual(["deal_p", "deal_n"]);
  });

  it("offers companies without a live deal to start one, the most recently active first", () => {
    const ws = workspace();
    ws.activities.push(makeActivity("a1", { accountDomain: "lumen.io", at: at(-1) }));
    expect(dealCandidates(ws).map((a) => a.domain)).toEqual(["lumen.io", "pave.io"]);
  });
});

describe("repliesToCheck", () => {
  it("counts the people Check replies would ask about", () => {
    const ws = workspace();
    expect(repliesToCheck(ws, NOW)).toBe(0);
    ws.activities.push(makeActivity("t1", { kind: "touch_sent", personId: "per_pat", accountDomain: "pave.io", channel: "email", at: at(-2) }));
    expect(repliesToCheck(ws, NOW)).toBe(1);
  });
});

describe("reviewThisWeek", () => {
  it("knows a review of that kind was written this week, so the palette opens it instead of paying again", () => {
    const ws = workspace();
    expect(reviewThisWeek(ws, "monday", NOW)).toBe(false);
    ws.briefs["2026-10-19"] = { date: "2026-10-19", reviewKind: "monday", review: "Pipeline is thin." } as Workspace["briefs"][string];
    expect(reviewThisWeek(ws, "monday", NOW)).toBe(true);
    expect(reviewThisWeek(ws, "friday", NOW)).toBe(false);
    // Last week's doesn't count.
    const old = makeWorkspace();
    old.briefs["2026-10-12"] = { date: "2026-10-12", reviewKind: "monday", review: "Old." } as Workspace["briefs"][string];
    expect(reviewThisWeek(old, "monday", NOW)).toBe(false);
  });
});
