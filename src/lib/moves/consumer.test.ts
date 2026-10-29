import { describe, expect, it } from "vitest";
import type { Move } from "@/lib/domain/types";
import { sampleWorkspace } from "@/lib/sample";
import { NOW, TODAY, at, consumerWorkspace, day, makeActivity, makePartner, makeWeek } from "@/test/factories";
import { computeMoves } from "./rules";
import { computeScoreboard, goalWins } from "./scoreboard";

const ofRule = (moves: Move[], rule: string) => moves.filter((m) => m.rule === `today.${rule}`);
const rules = (moves: Move[]) => new Set(moves.map((m) => m.rule.replace("today.", "")));
const LAST = "2026-10-12";

describe("consumer moves", () => {
  it("starts the week with the numbers, user conversations and finding where users gather", () => {
    const moves = computeMoves(consumerWorkspace(), NOW);
    const r = rules(moves);
    expect(r.has("growth_log")).toBe(true);
    expect(r.has("user_talks")).toBe(true);
    expect(r.has("partner_find")).toBe(true);
    // Business-only setup stays off a consumer Today.
    expect(r.has("import")).toBe(false);
    expect(r.has("discover")).toBe(false);
    expect(ofRule(moves, "user_talks")[0].title).toBe("Talk to 5 users this week");
  });

  it("puts a paid-spend hold near the top when retention is under the bar", () => {
    const ws = consumerWorkspace({ growthLog: [makeWeek(LAST, { signups: 120, retainedPct: 18, spendUsd: 500 })] });
    const moves = computeMoves(ws, NOW);
    const hold = ofRule(moves, "paid_hold")[0];
    expect(hold.title).toContain("Hold paid spend");
    expect(hold.priority).toBeGreaterThan(80);
    expect(rules(moves).has("growth_log")).toBe(false);
  });

  it("counts user conversations against the weekly target", () => {
    const ws = consumerWorkspace({ activities: [makeActivity("a1", { kind: "user_conversation", at: at(-1) }), makeActivity("a2", { kind: "user_conversation", at: at(0, "08:00") })] });
    expect(ofRule(computeMoves(ws, NOW), "user_talks")[0].title).toBe("Talk to 3 more users this week");
    for (let i = 3; i <= 5; i++) ws.activities.push(makeActivity(`a${i}`, { kind: "user_conversation", at: at(0, "08:30") }));
    expect(ofRule(computeMoves(ws, NOW), "user_talks")).toEqual([]);
    expect(computeScoreboard(ws, NOW).conversations[0]).toBe(5);
  });

  it("follows creators through one note, the follow-up a week later, and letting go", () => {
    const ws = consumerWorkspace({
      partners: {
        ptn_new: makePartner("ptn_new"),
        ptn_due: makePartner("ptn_due", { stage: "contacted", outreach: { channel: "dm", subject: null, body: "Hi", followUp: "Hi again", draftedAt: at(-9), sentOn: day(-8) } }),
        ptn_quiet: makePartner("ptn_quiet", { stage: "contacted", outreach: { channel: "dm", subject: null, body: "Hi", draftedAt: at(-30), sentOn: day(-25), followedUpOn: day(-15) } }),
        ptn_live: makePartner("ptn_live", { stage: "live", offer: { type: "gifted" }, stageHistory: [{ stage: "live", at: at(-2) }] }),
      },
    });
    const moves = computeMoves(ws, NOW);
    expect(ofRule(moves, "partner_draft").map((m) => m.subjectIds?.[0])).toEqual(["ptn_new"]);
    const follow = ofRule(moves, "partner_follow_up")[0];
    expect(follow).toMatchObject({ subjectIds: ["ptn_due"], overdueDays: 1 });
    expect(ofRule(moves, "partner_let_go").map((m) => m.subjectIds?.[0])).toEqual(["ptn_quiet"]);
    expect(ofRule(moves, "partner_disclosure").map((m) => m.subjectIds?.[0])).toEqual(["ptn_live"]);
  });

  it("caps new notes at five a week", () => {
    const partners = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`ptn_${i}`, makePartner(`ptn_${i}`)]));
    const ws = consumerWorkspace({ partners, activities: [makeActivity("s1", { kind: "partner_contacted", at: at(0, "08:00") }), makeActivity("s2", { kind: "partner_contacted", at: at(-1) })] });
    expect(ofRule(computeMoves(ws, NOW), "partner_draft")).toHaveLength(3);
  });

  it("asks for a readout when an experiment ends, and for referrals once retention holds", () => {
    const ws = consumerWorkspace({
      experiments: { exp_1: { id: "exp_1", stage: "activation", hypothesis: "Two-screen onboarding", change: "", metric: "First win", status: "running", startedOn: day(-14), endsOn: day(-1), createdAt: at(-14), updatedAt: at(-14) } },
      growthLog: [makeWeek(day(-22), { retainedPct: 72 }), makeWeek(day(-15), { retainedPct: 71 }), makeWeek(LAST, { signups: 80, retainedPct: 73, active: 260 })],
    });
    const moves = computeMoves(ws, NOW);
    expect(ofRule(moves, "experiment_readout")[0].title).toBe("Read out: Two-screen onboarding");
    expect(ofRule(moves, "referral_ask")).toHaveLength(1);
    expect(ofRule(moves, "pmf_survey")).toHaveLength(1);
    expect(ofRule(moves, "review_growth")).toHaveLength(1);
  });

  it("reports goal progress from the growth log", () => {
    const ws = consumerWorkspace({ growthLog: [makeWeek(day(-15), { active: 40 }), makeWeek(LAST, { active: 64 })] });
    expect(goalWins(ws)).toBe(64);
    expect(computeScoreboard(ws, NOW).goalProgress).toEqual([64, 100]);
  });

  it("is deterministic and gives each move a stable id", () => {
    const ws = consumerWorkspace({ partners: { ptn_a: makePartner("ptn_a") } });
    const a = computeMoves(ws, NOW);
    expect(computeMoves(ws, NOW)).toEqual(a);
    expect(new Set(a.map((m) => m.id)).size).toBe(a.length);
    expect(a.every((m) => m.dueOn >= TODAY)).toBe(true);
  });

  it("follows the market after a switch: the deal desk goes quiet, conversations in flight stay", () => {
    const business = sampleWorkspace(NOW);
    const before = rules(computeMoves(business, NOW));
    const ws = structuredClone(business);
    ws.company = { ...ws.company!, market: "consumer", consumerModel: "app" };
    const after = rules(computeMoves(ws, NOW));
    // New business work is gone: first touches, plays, warm paths, rooms and the pipeline reviews.
    for (const rule of ["signal", "cold_draft", "research", "discover", "event_nearby", "review_monday"]) {
      expect(before.has(rule)).toBe(true);
      expect(after.has(rule)).toBe(false);
    }
    expect(before.has("play") && !after.has("play")).toBe(true);
    // The growth loop takes their place.
    expect(after.has("growth_log")).toBe(true);
    // Replies and meetings the sample has in flight still show.
    for (const rule of ["reply", "meeting_prep"]) if (before.has(rule)) expect(after.has(rule)).toBe(true);
  });

  it("follows partners through for a business too, without the weekly nudge to find more", () => {
    const ws = sampleWorkspace(NOW);
    ws.partners = { ptn_pod: makePartner("ptn_pod", { kind: "podcast", platform: "podcast", name: "Finance Ops Weekly" }) };
    const moves = computeMoves(ws, NOW);
    expect(ofRule(moves, "partner_draft").map((m) => m.subjectIds?.[0])).toEqual(["ptn_pod"]);
    expect(rules(moves).has("partner_find")).toBe(false);
  });
});
