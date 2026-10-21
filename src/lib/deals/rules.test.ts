import { describe, expect, it } from "vitest";
import type { ContactPath, Deal, QualificationCard } from "@/lib/domain/types";
import { TODAY, at, day, makeAccount, makeDeal } from "@/test/factories";
import {
  type ScoredField,
  clampScore,
  computeQualification,
  detectCallType,
  emptyCard,
  hasDatedNextStep,
  jurisdictionOf,
  looksLikeTranscript,
  mapToMarkdown,
  missingCriteria,
  newDeal,
  nextStage,
  rankPaths,
  scoreOf,
  scoresFrom,
  stageCriteria,
  wordCount,
} from "./rules";

const scores = (pain: 0 | 1 | 2, rest: 0 | 1 | 2): Record<ScoredField, 0 | 1 | 2> => ({ pain, spend: rest, criticalEvent: rest, champion: rest, economicBuyer: rest, fit: rest });

/** A card with every field captured, and the champion tested. */
function fullCard(): QualificationCard {
  const card = emptyCard();
  for (const key of Object.keys(card) as (keyof QualificationCard)[]) card[key] = { ...card[key], value: "captured", status: "captured" };
  card.champion.championStatus = "tested";
  card.economicBuyer.engaged = true;
  Object.assign(card.criticalEvent, { date: "2026-12-31", consequence: "Audit finding" });
  card.pain.impact = "Two analysts for five days a month";
  return card;
}

describe("qualification", () => {
  it("qualifies at 8 of 12 with a dated next step", () => {
    expect(computeQualification(scores(2, 1), true)).toMatchObject({ total: 7, qualified: false });
    expect(computeQualification(scores(2, 1), false).icpFit).toBe(1);
    const eight = { ...scores(2, 1), spend: 2 as const };
    expect(computeQualification(eight, true)).toMatchObject({ total: 8, qualified: true });
    expect(computeQualification(eight, false).qualified).toBe(false);
  });

  it("round-trips scores, mapping fit to icpFit", () => {
    const q = computeQualification({ ...scores(1, 0), fit: 2 }, true);
    expect(scoresFrom(q)).toEqual({ ...scores(1, 0), fit: 2 });
    expect(scoreOf(q, "fit")).toBe(2);
    expect(scoreOf(undefined, "pain")).toBe(0);
    expect(scoresFrom(undefined)).toEqual(scores(0, 0));
  });

  it("keeps each score honest with what was captured", () => {
    const card = fullCard();
    expect((Object.keys(scores(0, 0)) as ScoredField[]).map((f) => clampScore(f, card, 2))).toEqual([2, 2, 2, 2, 2, 2]);
    // Nothing captured scores 0.
    expect(clampScore("pain", emptyCard(), 2)).toBe(0);
    // Partial capture tops out at 1.
    card.spend.status = "partial";
    expect(clampScore("spend", card, 2)).toBe(1);
    // Only a tested champion is a 2; no champion is a 0.
    card.champion.championStatus = "coach";
    expect(clampScore("champion", card, 2)).toBe(1);
    card.champion.championStatus = "none";
    expect(clampScore("champion", card, 2)).toBe(0);
    // A buyer who hasn't engaged, or an event without a date and consequence, is a 1.
    card.economicBuyer.engaged = false;
    expect(clampScore("economicBuyer", card, 2)).toBe(1);
    delete card.criticalEvent.consequence;
    expect(clampScore("criticalEvent", card, 2)).toBe(1);
    expect(clampScore("criticalEvent", card, 1)).toBe(1);
  });

  it("only counts a next step dated today or later", () => {
    expect(hasDatedNextStep({ date: TODAY }, TODAY)).toBe(true);
    expect(hasDatedNextStep({ date: day(-1) }, TODAY)).toBe(false);
    expect(hasDatedNextStep(undefined, TODAY)).toBe(false);
  });
});

describe("stage exit criteria", () => {
  const met = (deal: Deal, stage: Deal["stage"]) => Object.fromEntries(stageCriteria(stage, deal, TODAY).map((c) => [c.key, c.met]));

  it("talking: a meeting booked or held", () => {
    expect(met(makeDeal("d", "a.example"), "talking")).toEqual({ "talking.meeting": false });
    expect(met(makeDeal("d", "a.example", { meetingIds: ["m"] }), "talking")).toEqual({ "talking.meeting": true });
  });

  it("qualified: pain with impact, a critical event, a champion, 8 of 12 and a dated next step", () => {
    const empty = makeDeal("d", "a.example");
    expect(missingCriteria("qualified", empty, TODAY).map((c) => c.key)).toEqual(["qualified.pain", "qualified.event", "qualified.champion", "qualified.score", "qualified.nextStep"]);
    expect(stageCriteria("qualified", empty, TODAY).find((c) => c.key === "qualified.score")?.hint).toBe("Now 0 of 12.");
    const ready = makeDeal("d", "a.example", {
      card: fullCard(),
      qualification: computeQualification(scores(2, 1), true),
      nextStep: { what: "Pilot scoping", date: day(2), buyerAgreed: true },
    });
    expect(missingCriteria("qualified", ready, TODAY).map((c) => c.key)).toEqual(["qualified.score"]);
    ready.qualification = computeQualification({ ...scores(2, 1), spend: 2 }, true);
    expect(missingCriteria("qualified", ready, TODAY)).toEqual([]);
    // An untested champion is enough to qualify; a coach is not.
    ready.card!.champion.championStatus = "coach";
    expect(missingCriteria("qualified", ready, TODAY).map((c) => c.key)).toEqual(["qualified.champion"]);
  });

  it("pilot: written criteria, a fee and an ROI review, ticked by the founder", () => {
    const deal = makeDeal("d", "a.example", { pilot: { criteria: "Variance under 0.3%", paid: true, feeUsd: 7500 } });
    expect(met(deal, "pilot")).toEqual({ "pilot.criteria": false, "pilot.fee": true, "pilot.roi": false });
    deal.checklist = { "pilot.criteria": true, "pilot.roi": true };
    expect(missingCriteria("pilot", deal, TODAY)).toEqual([]);
    expect(stageCriteria("pilot", deal, TODAY).every((c) => c.manual)).toBe(true);
  });

  it("proposal: sent, the economic buyer engaged, and an agreed plan", () => {
    const deal = makeDeal("d", "a.example", { checklist: { "proposal.sent": true, "proposal.map": true } });
    expect(met(deal, "proposal")).toEqual({ "proposal.sent": true, "proposal.eb": false, "proposal.map": false });
    deal.qualification = computeQualification({ ...scores(1, 1), economicBuyer: 2 }, true);
    deal.map = { targetDate: day(30), goal: "Signed by Dec 1", milestones: [{ id: "m1", step: "Security review", ownerSide: "buyer", due: day(10), status: "todo" }] };
    expect(missingCriteria("proposal", deal, TODAY)).toEqual([]);
  });

  it("won, lost and nurture each need one thing", () => {
    const deal = makeDeal("d", "a.example");
    expect([met(deal, "won"), met(deal, "lost"), met(deal, "nurture")]).toEqual([{ "won.signed": false }, { "lost.reason": false }, { "nurture.date": false }]);
    Object.assign(deal, { checklist: { "won.signed": true }, lossReason: "timing", nurtureUntil: day(60) });
    expect([met(deal, "won"), met(deal, "lost"), met(deal, "nurture")]).toEqual([{ "won.signed": true }, { "lost.reason": true }, { "nurture.date": true }]);
  });

  it("walks the board in order and stops at won", () => {
    expect(["talking", "qualified", "pilot", "proposal", "won", "lost"].map((s) => nextStage(s as Deal["stage"]))).toEqual(["qualified", "pilot", "proposal", "won", null, null]);
  });
});

describe("newDeal", () => {
  it("starts at Talking and names the source after where the account came from", () => {
    const deal = newDeal(makeAccount("acme.example", { name: "Acme", source: "founder_network" }), "deal_1", at(0));
    expect(deal).toMatchObject({ id: "deal_1", name: "Acme", stage: "talking", stageHistory: [{ stage: "talking", at: at(0) }], source: "network", contacts: [], meetingIds: [] });
    const sources = (["referral", "integration", "yc_directory"] as const).map((source) => newDeal(makeAccount("a.example", { source }), "d", at(0)).source);
    expect(sources).toEqual(["referral", "inbound", "signal_cold"]);
  });
});

describe("contact paths and jurisdiction", () => {
  it("ranks a warm path first and a guessed address last before LinkedIn, verified first within a kind", () => {
    const p = (kind: ContactPath["kind"], verified = false): ContactPath => ({ kind, value: `${kind}${verified ? "+" : ""}`, verified, founderConfirmed: false });
    const ranked = rankPaths([p("linkedin"), p("pattern_guess"), p("published_email"), p("pattern_guess", true), p("warm_intro"), p("role_inbox")]);
    expect(ranked.map((x) => x.value)).toEqual(["warm_intro", "published_email", "role_inbox", "pattern_guess+", "pattern_guess", "linkedin"]);
  });

  it("reads jurisdiction from a stated location", () => {
    const cases: [string | null, string][] = [
      ["London, UK", "UK"],
      ["Toronto, Ontario", "CA"],
      ["Lisbon, Portugal", "EU"],
      ["Berlin", "EU"],
      ["Austin, TX", "US"],
      ["San Francisco Bay Area", "US"],
      ["Singapore", "other"],
      [null, "unknown"],
    ];
    expect(cases.map(([loc]) => jurisdictionOf(loc))).toEqual(cases.map(([, j]) => j));
  });
});

describe("meetings", () => {
  it("decides the call type from the title, the stage and prior calls", () => {
    expect(detectCallType("Pricing and order form", "qualified", 2)).toBe("negotiation");
    expect(detectCallType("Weekly sync", "proposal", 2)).toBe("negotiation");
    expect(detectCallType("Pilot check-in", "pilot", 3)).toBe("pilot_review");
    expect(detectCallType("Security review", "qualified", 1)).toBe("technical");
    expect(detectCallType("Product demo", "talking", 1)).toBe("demo");
    expect(detectCallType("Intro", "talking", 0)).toBe("first_discovery");
    expect(detectCallType("Intro", "talking", 1)).toBe("follow_up");
    expect(detectCallType("Weekly sync", "pilot", 4)).toBe("pilot_review");
  });

  it("tells a transcript from the founder's notes", () => {
    const transcript = ["Priya: Thanks for making time.", "Ethan: Of course.", "Priya: How does close work today?", "Ethan: Five days of spreadsheets.", "Priya: Who owns that?"].join("\n");
    const stamped = ["[00:01] hello", "[00:05] so close takes", "[00:09] five days", "[00:12] and then"].join("\n");
    const notes = ["Ethan runs close", "five days of spreadsheets", "wants it under one", "next step: pilot scoping"].join("\n");
    expect(looksLikeTranscript(transcript)).toBe(true);
    expect(looksLikeTranscript(stamped)).toBe(true);
    expect(looksLikeTranscript(notes)).toBe(false);
    expect(looksLikeTranscript("Priya: hi\nEthan: hi")).toBe(false);
  });

  it("exports a mutual action plan the buyer can review", () => {
    const md = mapToMarkdown(
      {
        targetDate: "2026-12-01",
        goal: "Live on the US entity",
        milestones: [
          { id: "1", step: "Security | legal review", ownerSide: "buyer", ownerName: "Nadia", due: "2026-11-02", status: "done" },
          { id: "2", step: "Order form", ownerSide: "seller", due: "2026-11-09", status: "blocked" },
          { id: "3", step: "Kickoff", ownerSide: "both", due: "2026-11-16", status: "todo" },
        ],
      },
      "Rowanstack",
      "Ledgerline",
    );
    expect(md.split("\n")).toEqual([
      "# Rowanstack + Ledgerline: mutual action plan",
      "",
      "Goal: Live on the US entity",
      "Target date: 2026-12-01",
      "",
      "| # | Milestone | Owner | Due | Status |",
      "|---|---|---|---|---|",
      "| 1 | Security / legal review | Nadia (Rowanstack) | 2026-11-02 | Done |",
      "| 2 | Order form | Ledgerline | 2026-11-09 | Blocked |",
      "| 3 | Kickoff | Both | 2026-11-16 | To do |",
      "",
      "Draft for us to review together. Edit anything that's wrong.",
    ]);
  });

  it("counts words", () => {
    expect(wordCount("  one two\nthree ")).toBe(3);
    expect(wordCount("")).toBe(0);
  });
});
