import { describe, expect, it } from "vitest";
import { applyAction } from "@/lib/domain/actions";
import type { Deal, Workspace } from "@/lib/domain/types";
import { parseCsv } from "@/lib/network/csv";
import { TODAY, at, day, makeDeal, makePerson, makeWorkspace } from "@/test/factories";
import {
  autoMapDeals,
  dateOrder,
  dealImportActions,
  defaultStageMap,
  guessStage,
  parseAmount,
  parseContacts,
  parseDate,
  parseForecast,
  planDealImport,
  stageValues,
} from "./deal-import";
import { computeForecast, dealGaps } from "./forecast";
import { dealRisks } from "./risk";
import { quarterOf, revenueStats } from "./stats";
import { pipelineXray } from "./xray";

const Q4 = quarterOf(TODAY);
const AT = "2026-10-20T16:41:07.512Z";

/** A HubSpot deals export, the way its export dialog writes one with associated records. */
const HUBSPOT = [
  "Record ID,Deal Name,Deal Stage,Amount,Close Date,Create Date,Associated Company,Associated Contact,Next Step,Next Activity Date,Last Activity Date,Forecast category",
  `101,Acme expansion,Contract sent,"$48,000.00",${day(25)},2026-08-03,Acme (acme.com),Dana Okafor (dana@acme.com);Marcus Lee (marcus@acme.com),Order form review,${day(4)},${day(-2)},Commit`,
  `102,Globex pilot,Presentation scheduled,30000,${day(-6)},2026-09-01,Globex,Ann Wu (ann@globex.io),,,${day(-30)},Best case`,
  `103,Initech,Appointment scheduled,,${day(40)},2026-10-10,Initech (initech.com),,Send the security pack,,${day(-1)},Pipeline`,
  `104,Hooli,Closed won,"$22,000",${day(-9)},2026-07-15,Hooli (hooli.xyz),,,,,`,
  `105,Pied Piper,Closed lost,10000,${day(-3)},2026-06-01,Pied Piper (piedpiper.com),,,,,`,
  `106,Vandelay,Closed won,15000,2026-06-30,2026-03-01,Vandelay (vandelay.com),,,,,`,
  `107,No domain deal,Qualified to buy,9000,${day(30)},2026-10-01,Soylent,,,,,`,
  `108,Acme second,Qualified to buy,5000,${day(60)},2026-10-01,Acme (acme.com),,,,,`,
].join("\n");

function plan(csv: string, ws: Workspace = makeWorkspace()) {
  const parsed = parseCsv(csv);
  const mapping = autoMapDeals(parsed.headers);
  const stages = defaultStageMap(stageValues(parsed, mapping));
  return { parsed, mapping, stages, plan: planDealImport(ws, parsed, mapping, stages, Q4) };
}

function imported(csv: string, ws: Workspace = makeWorkspace()) {
  const p = plan(csv, ws).plan;
  for (const a of dealImportActions(ws, p, { at: AT, from: "deals.csv" })) applyAction(ws, a);
  return { ws, plan: p, deal: (name: string) => Object.values(ws.deals).find((d) => d.name === name)! };
}

describe("reading a CRM export", () => {
  it("maps HubSpot, Salesforce and Pipedrive columns by their own names", () => {
    expect(autoMapDeals(parseCsv(HUBSPOT).headers)).toMatchObject({ name: 1, stage: 2, amount: 3, closeDate: 4, created: 5, company: 6, contacts: 7, nextStep: 8, nextStepDate: 9, lastActivity: 10, forecast: 11, domain: null });
    const sf = autoMapDeals(["Opportunity Name", "Account Name", "Stage", "Amount", "Close Date", "Next Step", "Created Date", "Last Activity", "Lead Source", "Forecast Category"]);
    expect(sf).toMatchObject({ name: 0, company: 1, stage: 2, amount: 3, closeDate: 4, nextStep: 5, created: 6, lastActivity: 7, source: 8, forecast: 9 });
    const pd = autoMapDeals(["Deal - Title", "Deal - Value", "Deal - Currency of Value", "Deal - Stage", "Deal - Status", "Deal - Expected close date", "Deal - Organization", "Organization - Website", "Deal - Next activity date"]);
    expect(pd).toMatchObject({ name: 0, amount: 1, currency: 2, stage: 3, status: 4, closeDate: 5, company: 6, domain: 7, nextStepDate: 8 });
  });

  it("reads stage names from the common pipelines, and says when it's guessing", () => {
    const read = (s: string) => guessStage(s).stage;
    expect(["Appointment scheduled", "Qualified to buy", "Presentation scheduled", "Decision maker bought-in", "Contract sent", "Closed won", "Closed lost"].map(read)).toEqual(["talking", "qualified", "qualified", "proposal", "proposal", "won", "lost"]);
    expect(["Prospecting", "Needs Analysis", "Id. Decision Makers", "Proposal/Price Quote", "Negotiation/Review"].map(read)).toEqual(["talking", "qualified", "qualified", "proposal", "proposal"]);
    expect(["Lead", "In Progress", "Won 🎉", "Lost", "Demo Scheduled", "Proposal Made", "Pilot", "On hold", "closedwon", "contractsent"].map(read)).toEqual(["talking", "qualified", "won", "lost", "qualified", "proposal", "pilot", "skip", "won", "proposal"]);
    expect(guessStage("Stage 3")).toEqual({ stage: "qualified", sure: false });
    expect(guessStage("Contract sent").sure).toBe(true);
  });

  it("reads amounts, currencies and dates the way tools write them", () => {
    expect(parseAmount("$48,000.00")).toEqual({ value: 48_000, currency: "USD" });
    expect(parseAmount("48.000,50 €")).toEqual({ value: 48_001, currency: "EUR" });
    expect(parseAmount("USD 12,500")).toEqual({ value: 12_500, currency: "USD" });
    expect(parseAmount("45k").value).toBe(45_000);
    expect(parseAmount("1.2M").value).toBe(1_200_000);
    expect(parseAmount("0").value).toBeUndefined();
    expect(parseAmount("TBD").value).toBeUndefined();
    expect(parseDate("2026-11-30 14:00")).toBe("2026-11-30");
    expect(parseDate("11/30/2026")).toBe("2026-11-30");
    expect(parseDate("30.11.2026", "dmy")).toBe("2026-11-30");
    expect(parseDate("Nov 30, 2026")).toBe("2026-11-30");
    expect(parseDate("30 November 2026")).toBe("2026-11-30");
    expect(parseDate("02/30/2026")).toBeUndefined();
    expect(dateOrder(["03/04/2026", "25/04/2026"])).toBe("dmy");
    expect(dateOrder(["03/04/2026", "04/25/2026"])).toBe("mdy");
    expect(parseContacts("Dana Okafor (dana@acme.com); Marcus <marcus@acme.com>")).toEqual([{ name: "Dana Okafor", email: "dana@acme.com" }, { name: "Marcus", email: "marcus@acme.com" }]);
    expect(parseContacts("a@x.io, b@x.io")).toEqual([{ email: "a@x.io" }, { email: "b@x.io" }]);
    expect(parseContacts("Jane Doe, Sam Lee")).toEqual([{ name: "Jane Doe" }, { name: "Sam Lee" }]);
    expect(["Commit", "Best Case", "Pipeline", "Omitted", "Closed"].map(parseForecast)).toEqual(["commit", "best_case", "pipeline", "omitted", undefined]);
  });
});

describe("planning the import", () => {
  it("brings in open deals and this quarter's wins, and says why each other row stayed out", () => {
    const { plan: p } = plan(HUBSPOT);
    expect(p.deals.map((d) => d.name)).toEqual(["Acme expansion", "Globex pilot", "Initech", "Hooli"]);
    expect(p.open).toEqual({ count: 3, usd: 78_000, unpriced: 1 });
    expect(p.won).toEqual({ count: 1, usd: 22_000 });
    expect(Object.fromEntries(p.skipped.map((s) => [s.line, s.reason]))).toEqual({ 6: "lost", 7: "won_earlier", 8: "no_company", 9: "duplicate" });
    // Globex had no website, so its contact's work email named the company.
    expect(p.deals.find((d) => d.name === "Globex pilot")?.domain).toBe("globex.io");
    expect(p.absent).toMatchObject({ created: false, activity: false, contacts: false, stageDate: true, source: true });
  });

  it("leaves off amounts in another currency instead of reading them as dollars", () => {
    const { plan: p } = plan(["Deal,Website,Stage,Amount,Currency", "Euro deal,euro.de,Qualified,40000,EUR", "Dollar deal,usd.com,Qualified,40000,USD"].join("\n"));
    expect(p.deals.map((d) => [d.name, d.amountUsd, d.otherCurrency])).toEqual([["Euro deal", undefined, "EUR"], ["Dollar deal", 40_000, undefined]]);
    expect(p.otherCurrency).toBe(1);
  });

  it("doesn't import a company that already has an open deal, so a second drop is harmless", () => {
    const first = imported(HUBSPOT);
    const again = plan(HUBSPOT, first.ws).plan;
    expect(again.deals).toEqual([]);
    // The four it brought in, and Acme's smaller second deal, which now meets Acme's open one.
    expect(again.skipped.filter((s) => s.reason === "existing").map((s) => s.line)).toEqual([2, 3, 4, 5, 9]);
  });

  it("takes a stage name the founder remapped", () => {
    const { parsed, mapping, stages } = plan(HUBSPOT);
    const p = planDealImport(makeWorkspace(), parsed, mapping, { ...stages, "appointment scheduled": "skip" }, Q4);
    expect(p.skipped.find((s) => s.line === 4)?.reason).toBe("left_out");
  });
});

describe("into the workspace", () => {
  it("writes only the dates the file had, and names the ones it didn't", () => {
    const { deal } = imported(HUBSPOT);
    const acme = deal("Acme expansion");
    expect(acme).toMatchObject({ stage: "proposal", amountUsd: 48_000, closeDate: day(25), nextStep: { what: "Order form review", date: day(4), buyerAgreed: false }, forecastCall: { category: "commit", note: "From deals.csv" } });
    expect(acme.stageHistory.map((h) => h.stage)).toEqual(["talking", "proposal"]);
    expect(acme.stageHistory[0].at).toBe(new Date(2026, 7, 3, 12).toISOString());
    // The file didn't say when it reached Proposal: the import time stands in, and is named.
    expect(acme.stageHistory[1].at).toBe(AT);
    expect(acme.imported).toEqual({ at: AT, from: "deals.csv", stage: "proposal", unknown: ["stage_date", "source"] });
    expect(acme.contacts).toHaveLength(2);
    // A next step without a date is a note, not a commitment on a calendar.
    expect(deal("Initech")).toMatchObject({ notes: "Next step from deals.csv, with no date: Send the security pack" });
    expect(deal("Initech").nextStep).toBeUndefined();
  });

  it("counts this quarter's wins as closed won and makes the company a customer", () => {
    const { ws, deal } = imported(HUBSPOT);
    const hooli = deal("Hooli");
    expect(hooli.stageHistory.map((h) => h.stage)).toEqual(["talking", "won"]);
    expect(ws.accounts["hooli.xyz"].status).toBe("customer");
    const f = computeForecast(ws, TODAY);
    expect(f.closedWon.usd).toBe(22_000);
    expect(f.calls).toHaveLength(3);
  });

  it("keeps imported wins out of the rates they'd flatter", () => {
    const { ws } = imported(HUBSPOT);
    const stats = revenueStats(ws, TODAY);
    // One win and none of the losses: the win rate stays the prior, not 100%.
    expect(stats.winRate).toMatchObject({ source: "prior", n: 0 });
    expect(stats.meetingToQualified.n).toBe(0);
    // The win's size is real, so it counts.
    expect(stats.avgDealUsd.raw).toBe(22_000);
  });

  it("doesn't read the import as new pipeline this month", () => {
    const { ws } = imported(["Deal,Website,Stage,Amount", "A,a.com,Qualified,10000", "B,b.com,Proposal,20000"].join("\n"));
    const f = computeForecast(ws, TODAY);
    expect(f.creation.deals).toBe(0);
    expect(Object.values(ws.deals).every((d) => d.imported?.unknown?.includes("created"))).toBe(true);
  });

  it("skips anyone who asked to be deleted, and reuses people already on file", () => {
    const ws = makeWorkspace({ suppression: [{ id: "sup_1", email: "dana@acme.com", reason: "requested_delete", at: at(-5) }] });
    ws.people.per_marcus = makePerson("per_marcus", "acme.com", { email: "marcus@acme.com" });
    const { deal } = imported(HUBSPOT, ws);
    const acme = deal("Acme expansion");
    expect(acme.contacts).toEqual([{ personId: "per_marcus" }]);
    expect(Object.values(ws.people).some((p) => p.email === "dana@acme.com")).toBe(false);
  });
});

describe("data quality on imported deals", () => {
  it("names what each open deal is missing, and counts the ones that have it all", () => {
    const { ws } = imported(HUBSPOT);
    const f = computeForecast(ws, TODAY);
    const gaps = Object.fromEntries(f.calls.map((c) => [c.deal.name, dealGaps(c, TODAY)]));
    // Acme has a date, an amount, a dated step and two people: complete.
    expect(gaps["Acme expansion"]).toEqual([]);
    expect(gaps["Globex pilot"]).toEqual(["close_passed", "next_step", "contacts"]);
    expect(gaps.Initech).toEqual(["amount", "next_step", "contacts"]);
    expect(f.dataTrust).toEqual({ score: 33, complete: 1, open: 3 });
  });
});

describe("deal risk on imported deals", () => {
  it("asks for contacts instead of calling a deal single-threaded when the file had none", () => {
    const { ws, deal } = imported(["Deal,Website,Stage,Amount,Close date", `A,a.com,Proposal,10000,${day(20)}`].join("\n"));
    const a = deal("A");
    const risk = dealRisks(ws, a, revenueStats(ws, TODAY), TODAY).find((r) => r.code === "single_threaded");
    expect(risk).toMatchObject({ severity: "medium", label: "No contacts on file" });
  });

  it("says a stall counted from the import is a floor", () => {
    const { ws, deal } = imported(["Deal,Website,Stage,Amount", "A,a.com,Proposal,10000"].join("\n"));
    const a = deal("A");
    const later = day(30);
    const stalled = dealRisks(ws, a, revenueStats(ws, later), later).find((r) => r.code === "stalled");
    expect(stalled?.detail).toMatch(/^At least 30 days here, counted from the import/);
    const quiet = dealRisks(ws, a, revenueStats(ws, later), later).find((r) => r.code === "quiet");
    expect(quiet?.detail).toBe("No activity on file since the import, 30 days ago.");
  });
});

describe("the pipeline X-ray", () => {
  it("answers four questions about the open deals, each flagged deal with its fix", () => {
    const { ws } = imported(HUBSPOT);
    const x = pipelineXray(ws, TODAY);
    expect(x.open).toBe(3);
    const by = Object.fromEntries(x.checks.map((c) => [c.code, c]));
    // Globex and Initech have no dated step; Acme's is on the calendar. Largest first: Initech at the typical deal.
    expect(by.no_next_step.deals.map((d) => d.name)).toEqual(["Initech", "Globex pilot"]);
    expect(by.no_next_step.deals[0]).toMatchObject({ estimated: true, amountUsd: 35_000 });
    expect(by.close_passed.deals.map((d) => d.name)).toEqual(["Globex pilot"]);
    expect(by.close_passed.deals[0]).toMatchObject({ detail: expect.stringContaining("6 days ago"), fix: { label: expect.stringContaining("Re-confirm the date") } });
    // Globex is qualified with one contact; Initech is still Talking, so threading doesn't apply yet.
    expect(by.single_threaded.deals.map((d) => d.name)).toEqual(["Globex pilot"]);
    // Globex's last activity was 30 days ago.
    expect(by.stale.deals.map((d) => d.name)).toContain("Globex pilot");
    expect(x.checks.every((c) => c.deals.every((d) => d.fix.label && (d.fix.href || d.fix.ask)))).toBe(true);
    expect(by.no_next_step.usd).toBe(65_000);
    // Acme has two people at Proposal: thin, but not single-threaded.
    expect(x.clear).toBe(1);
  });

  it("says what it can't check when the file didn't have it", () => {
    const { ws } = imported(["Deal,Website,Stage,Amount", "A,a.com,Proposal,10000", "B,b.com,Qualified,20000"].join("\n"));
    const by = Object.fromEntries(pipelineXray(ws, TODAY).checks.map((c) => [c.code, c]));
    expect(by.single_threaded).toMatchObject({ deals: [], unknown: 2, unchecked: expect.stringContaining("No contacts") });
    expect(by.stale).toMatchObject({ deals: [], unknown: 2, unchecked: expect.stringContaining("No activity or stage dates") });
    // Absence of a next step is a fact on file, so it's flagged.
    expect(by.no_next_step.deals).toHaveLength(2);
  });

  it("reads deals tracked by hand the same way", () => {
    const ws = makeWorkspace({ deals: { q: makeDeal("q", "q.example", { stage: "qualified", amountUsd: 12_000, lastActivityAt: at(-20) }) as Deal } });
    const by = Object.fromEntries(pipelineXray(ws, TODAY).checks.map((c) => [c.code, c]));
    expect(by.stale.deals.map((d) => d.id)).toEqual(["q"]);
    expect(by.single_threaded.unknown).toBe(0);
    expect(pipelineXray(makeWorkspace(), TODAY)).toMatchObject({ open: 0, clear: 0 });
  });
});
