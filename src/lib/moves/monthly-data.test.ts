import { describe, expect, it } from "vitest";
import type { Debrief, Foundation, Workspace } from "@/lib/domain/types";
import { NOW, at, makeAccount, makeDeal, makeMeeting, makeWorkspace } from "@/test/factories";
import { hiringReadiness, lastRefreshAt, monthlyData, pricingLog, refreshInputs, refreshOffer, settledRefresh } from "./monthly-data";

const field = (value: string | null) => ({ value, quotes: [], status: value ? ("captured" as const) : ("not_covered" as const) });

function debrief(generatedAt: string, patch: Partial<Debrief> = {}): Debrief {
  return {
    source: "transcript",
    quotes: [{ id: "q1", speaker: "Dana", text: "Our close takes nine days because usage lives in two systems" }],
    card: { pain: field("Nine-day close"), spend: field(null), criticalEvent: field(null), champion: field(null), economicBuyer: field(null), fit: field("Bills on usage"), decisionProcess: field(null) },
    qualification: { pain: 2, spend: 0, criticalEvent: 0, champion: 0, economicBuyer: 0, icpFit: 2, total: 4, qualified: false },
    stageSuggestion: null,
    nextStep: null,
    noNextStepWarning: false,
    recap: { subject: "", body: "" },
    committeeUpdates: [],
    tasks: [],
    newObjections: [],
    customerWords: ["month-end fire drill"],
    referrals: [],
    toConfirm: [],
    coaching: [],
    generatedAt,
    ...patch,
  };
}

function workspace(): Workspace {
  const ws = makeWorkspace({ foundation: { version: 2, generatedAt: at(-40), personas: [], positioning: { bestFit: [] }, icp: { criteria: [], hypothesis: { sentence: "" } }, messaging: {}, founderQuestions: [] } as unknown as Foundation });
  ws.accounts["acme.example"] = makeAccount("acme.example", { name: "Acme" });
  ws.deals.deal_acme = makeDeal("deal_acme", "acme.example", { name: "Acme" });
  return ws;
}

function addCall(ws: Workspace, id: string, generatedAt: string, patch: Partial<Debrief> = {}) {
  ws.meetings[id] = makeMeeting(id, "deal_acme", { startsAt: generatedAt, debrief: debrief(generatedAt, patch) });
  ws.deals.deal_acme.meetingIds.push(id);
}

describe("refresh offer", () => {
  it("counts calls since the last revision, and offers after five or a won deal", () => {
    const ws = workspace();
    expect(lastRefreshAt(ws)).toBe(at(-40));
    for (let i = 0; i < 4; i++) addCall(ws, `m${i}`, at(-20 + i));
    expect(refreshOffer(ws)).toMatchObject({ calls: 4, won: 0, offered: false });
    addCall(ws, "m4", at(-10));
    expect(refreshOffer(ws)).toMatchObject({ calls: 5, offered: true });
    // A refresh resets the count.
    ws.briefs["2026-10-15:refresh:run_1"] = { date: "2026-10-15", kind: "refresh", greeting: "", matters: [], generatedAt: at(-5), reviewKind: "refresh" };
    expect(refreshOffer(ws)).toMatchObject({ calls: 0, offered: false });
    ws.deals.deal_acme.stage = "won";
    ws.deals.deal_acme.stageHistory.push({ stage: "won", at: at(-1) });
    expect(refreshOffer(ws)).toMatchObject({ won: 1, offered: true });
  });
});

describe("settledRefresh", () => {
  it("is the newest rebuild when it changed nothing, so the answer can be shown after the offer goes", () => {
    const ws = workspace();
    expect(settledRefresh(ws)).toBeNull();
    const review = "No changes: 2 calls don't contradict the bet.";
    ws.briefs["2026-10-15:refresh:run_1"] = { date: "2026-10-15", kind: "refresh", greeting: "", matters: [], generatedAt: at(-5), review, reviewKind: "refresh", proposals: [] };
    expect(settledRefresh(ws)?.review).toBe(review);
    expect(refreshOffer(ws).offered).toBe(false);
    // A rebuild with changes to decide isn't settled.
    ws.briefs["2026-10-15:refresh:run_1"].proposals = [{ id: "p1", kind: "revise_foundation", status: "open" } as never];
    expect(settledRefresh(ws)).toBeNull();
    ws.briefs["2026-10-15:refresh:run_1"].proposals = [];
    // A monthly review since is the newest revision now.
    ws.briefs["2026-10-18:monthly"] = { date: "2026-10-18", kind: "monthly", greeting: "", matters: [], generatedAt: at(-2), reviewKind: "monthly" };
    expect(settledRefresh(ws)).toBeNull();
  });
});

describe("refreshInputs", () => {
  it("cites calls by id, quotes transcripts verbatim and marks notes as paraphrase", () => {
    const ws = workspace();
    addCall(ws, "m_t", at(-9));
    addCall(ws, "m_n", at(-8), { source: "founder_notes", quotes: [{ id: "q1", text: "Said the close is painful" }], customerWords: ["my paraphrase"] });
    const r = refreshInputs(ws, NOW);
    expect(r.calls).toBe(2);
    expect(r.block).toContain('m1.q1 Dana: "Our close takes nine days because usage lives in two systems"');
    expect(r.block).toContain("m2.q1 Founder's note: Said the close is painful");
    expect(r.quotes.get("m1.q1")).toContain("(Acme call)");
    // Customer words may only come from what buyers said verbatim.
    expect(r.verbatim).toContain("month-end fire drill");
    expect(r.verbatim).not.toContain("my paraphrase");
  });

  it("lists best-fit customers with how fast they bought", () => {
    const ws = workspace();
    ws.deals.deal_acme = makeDeal("deal_acme", "acme.example", { name: "Acme", stage: "won", createdAt: at(-30), stageHistory: [{ stage: "talking", at: at(-30) }, { stage: "won", at: at(-2) }] });
    const r = refreshInputs(ws, NOW);
    expect(r.customers).toBe(1);
    expect(r.block).toContain("w1 · Acme · won in 28 days");
  });
});

describe("pricing log", () => {
  it("logs quotes against outcomes and says when the band gives way", () => {
    const ws = workspace();
    expect(pricingLog(ws).note).toMatch(/^No price quoted yet/);
    ws.deals.deal_acme.priceQuotes = [{ at: "2026-09-01", amountUsd: 12000, outcome: "accepted" }];
    expect(pricingLog(ws)).toMatchObject({ quotes: 1, accepted: 1, note: "1 of 5 quotes logged. The starting band holds until there are 5." });
    ws.deals.deal_acme.priceQuotes.push(
      { at: "2026-09-08", amountUsd: 18000, outcome: "pushback" },
      { at: "2026-09-15", amountUsd: 20000, outcome: "lost" },
      { at: "2026-09-22", amountUsd: 15000, outcome: "pushback" },
      { at: "2026-09-29", amountUsd: 16000, outcome: "accepted" },
      { at: "2026-10-06", amountUsd: 14000 },
    );
    const log = pricingLog(ws);
    expect(log).toMatchObject({ quotes: 6, accepted: 2, pushback: 2, lost: 1, open: 1, median: 15500, low: 12000, high: 20000 });
    expect(log.note).toContain("median $15,500 ($12,000–$20,000)");
    expect(log.note).toContain("Most decided quotes met pushback");
  });
});

describe("hiring readiness", () => {
  function withDeals(ws: Workspace, won: number, lost: number, demos: number) {
    for (let i = 0; i < won; i++) ws.deals[`w${i}`] = makeDeal(`w${i}`, `w${i}.example`, { stage: "won" });
    for (let i = 0; i < lost; i++) ws.deals[`l${i}`] = makeDeal(`l${i}`, `l${i}.example`, { stage: "lost" });
    for (let i = 0; i < demos; i++) ws.meetings[`d${i}`] = makeMeeting(`d${i}`, "deal_acme", { startsAt: at(-3) });
  }

  it("stays out of the review until the founder is near the thresholds", () => {
    const ws = workspace();
    withDeals(ws, 6, 2, 30);
    expect(hiringReadiness(ws, NOW)).toBeNull();
  });

  it("says keep selling until every bar is met, then two founding AEs", () => {
    const ws = workspace();
    withDeals(ws, 7, 10, 20);
    const near = hiringReadiness(ws, NOW)!;
    expect(near.ready).toBe(false);
    expect(near.verdict).toMatch(/^Keep selling yourself for now: 7 of about 10 customers, 20 of about 50 demos, 41% win rate \(n=17\)/);
    expect(near.missing).toContain("an objection bank (3+ approved)");

    const ready = workspace();
    withDeals(ready, 10, 10, 50);
    ready.foundation = { ...ready.foundation!, icp: { ...ready.foundation!.icp, hypothesis: { sentence: "A bet." } }, messaging: { oneLiner: "One line." }, personas: [{ id: "p" }] } as unknown as Foundation;
    ready.objections = [1, 2, 3].map((i) => ({ id: `o${i}`, objection: "x", category: "timing", underlyingConcern: "", clarifyingQ: "", response: "", walkAwayIf: "", approved: true, timesHeard: 1 }));
    const r = hiringReadiness(ready, NOW)!;
    expect(r.ready).toBe(true);
    expect(r.verdict).toMatch(/^Ready to hire: two founding AEs/);
  });
});

describe("monthlyData", () => {
  it("finds the bet that ended unread and the one still running", () => {
    const ws = workspace();
    const bet = (id: string, decidedAt: string) => ({ id, kind: "message_bet" as const, title: "", detail: "", bet: { variable: "x", control: "a", variant: "b", why: "", dimension: "cta" as const }, status: "applied" as const, decidedAt });
    ws.briefs["2026-08-10:friday"] = { date: "2026-08-14", kind: "friday", greeting: "", matters: [], generatedAt: at(-60), proposals: [bet("prop_aug", "2026-08-14T17:00:00.000Z")] };
    ws.briefs["2026-10-12:friday"] = { date: "2026-10-16", kind: "friday", greeting: "", matters: [], generatedAt: at(-4), proposals: [bet("prop_oct", "2026-10-16T17:00:00.000Z")] };
    const d = monthlyData(ws, NOW);
    expect(d.month).toBe("2026-10");
    expect(d.ended?.bet.id).toBe("prop_aug");
    expect(d.running?.bet.id).toBe("prop_oct");
    expect(d.ended?.readout).toEqual({ control: { sent: 0, replies: 0, positive: 0 }, variant: { sent: 0, replies: 0, positive: 0 }, enough: false });
  });
});
