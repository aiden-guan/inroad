import { describe, expect, it } from "vitest";
import { applyAction } from "@/lib/domain/actions";
import type { Move } from "@/lib/domain/types";
import { sampleWorkspace } from "@/lib/sample";
import { DEAL, DOMAIN, MEETING } from "@/lib/sample/ids";
import { NOW, TODAY, at, day, makeAccount, makeActivity, makeDeal, makeMeeting, makeMove, makeSignal, makeWorkspace } from "@/test/factories";
import { deskLayout, deskProgress, nextUp, progressLine } from "./desk";
import { northStar } from "./north-star";
import { todayCounts } from "./nav-counts";
import { TOP_MOVES, computeMoves, mergeMoves, visibleMoves } from "./rules";
import { deskSnapshot, sinceFacts, sinceLabel } from "./since";

const byId = (list: Move[]) => Object.fromEntries(list.map((m) => [m.id, m]));

describe("deskLayout", () => {
  it("puts replies in the lane, keeps the top five, and never folds an overdue move under Later", () => {
    const moves = [
      makeMove("reply", { kind: "reply", activityId: "act_r", priority: 100 }),
      ...Array.from({ length: 7 }, (_, i) => makeMove(`m${i}`, { priority: 90 - i })),
      makeMove("late", { priority: 10, overdueDays: 3 }),
    ];
    const ws = makeWorkspace({ activities: [makeActivity("act_r", { kind: "reply_received" })] });
    const desk = deskLayout(moves, ws);
    expect(desk.replies.map((m) => m.id)).toEqual(["reply"]);
    expect(desk.top.map((m) => m.id)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    expect(desk.overdue.map((m) => m.id)).toEqual(["late"]);
    expect(desk.later.map((m) => m.id)).toEqual(["m5", "m6"]);
    expect(desk.top).toHaveLength(TOP_MOVES);
    // A reply card whose reply is gone is an ordinary card.
    expect(deskLayout(moves, makeWorkspace()).replies).toEqual([]);
  });

  it("is what the sidebar counts as ready", () => {
    const moves = byId([makeMove("reply", { kind: "reply", activityId: "act_r" }), ...Array.from({ length: 7 }, (_, i) => makeMove(`m${i}`)), makeMove("late", { overdueDays: 1, priority: 1 })]);
    const ws = makeWorkspace({ activities: [makeActivity("act_r", { kind: "reply_received" })] });
    expect(todayCounts(moves, TODAY, ws)).toEqual({ ready: 1 + TOP_MOVES + 1, later: 2 });
  });
});

describe("deskProgress", () => {
  it("counts what the founder settled today against what's left, replies apart", () => {
    const ws = makeWorkspace();
    ws.moves = byId([makeMove("a"), makeMove("b"), makeMove("r", { kind: "reply" }), makeMove("old", { status: "done", settledAt: at(-1) }), makeMove("auto", { status: "done", autoDone: true, settledAt: at(0) })]);
    applyAction(ws, { type: "move.done", id: "a", at: at(0, "09:00") });
    applyAction(ws, { type: "move.snooze", id: "r", until: day(1), at: at(0, "09:05") });
    const visible = visibleMoves(ws.moves, TODAY);
    const p = deskProgress(ws.moves, visible, TODAY);
    expect(p).toEqual({ done: 2, total: 3, replies: { done: 1, total: 1 } });
    expect(progressLine(p)).toBe("2 of 3 done · 1 reply cleared");
  });

  it("stamps a draft's card as settled when the draft is marked sent", () => {
    const ws = sampleWorkspace(NOW);
    ws.moves = mergeMoves(ws.moves, computeMoves(ws, NOW), TODAY, ws);
    const card = Object.values(ws.moves).find((m) => m.draft?.packageId && m.status === "open")!;
    applyAction(ws, { type: "outreach.approveStep", packageId: card.draft!.packageId, step: card.draft!.step, at: at(0, "09:40"), activityId: "act_new" });
    expect(ws.moves[card.id]).toMatchObject({ status: "done", settledAt: at(0, "09:40") });
  });
});

describe("nextUp", () => {
  it("names the next meeting, the next card due, and the next reminder, soonest first", () => {
    const ws = makeWorkspace({
      accounts: { "acme.io": makeAccount("acme.io", { dealId: "d" }) },
      deals: { d: makeDeal("d", "acme.io") },
      meetings: { m: makeMeeting("m", "d", { title: "Acme deep-dive", startsAt: at(2, "10:00"), attendees: [{ name: "Ana Lima" }] }) },
    });
    ws.moves = byId([makeMove("tomorrow", { title: "Follow up with Mei", dueOn: day(1) })]);
    const items = nextUp(ws, NOW);
    expect(items.map((i) => i.key)).toEqual(["mv:tomorrow", "mtg:m"]);
    expect(items[0]).toMatchObject({ when: "Tomorrow", text: "Follow up with Mei" });
    expect(items[1].text).toBe("Acme deep-dive with Ana");
  });
});

describe("northStar", () => {
  it("reads commit against the revenue target, the chance to hit it and the gap", () => {
    const ws = sampleWorkspace(NOW);
    const star = northStar(ws, NOW);
    expect(star.kind).toBe("revenue");
    expect(star.headline).toMatch(/^\$\d+K of \$\d+K committed$/);
    expect(star.details[0]).toMatch(/^\d+% to hit$/);
    expect(star.href).toBe("/revenue");
  });

  it("reads the goal and this week's conversations without a target", () => {
    const ws = makeWorkspace();
    expect(northStar(ws, NOW)).toMatchObject({ kind: "goal", headline: "0 of 5 paid pilots", details: ["0 of 10 conversations this week"] });
  });
});

describe("sinceFacts", () => {
  it("covers the last 24 hours from timestamps on a first visit", () => {
    const ws = sampleWorkspace(NOW);
    const since = sinceFacts(ws, null, NOW);
    expect(since.label).toBe("Since yesterday");
    const replies = since.facts.find((f) => f.kind === "replies")!;
    expect(replies.replyIds?.length).toBeGreaterThanOrEqual(2);
    expect(since.facts.some((f) => f.kind === "stage" && f.domain === DOMAIN.northwind)).toBe(true);
  });

  it("diffs against the last visit: meetings booked, moved and canceled, and new signals", () => {
    const ws = sampleWorkspace(NOW);
    const prev = deskSnapshot(ws, new Date(NOW.getTime() - 2 * 3_600_000));
    ws.meetings.mtg_new = makeMeeting("mtg_new", DEAL.saltmarsh, { title: "Saltmarsh second call", startsAt: at(2, "14:00") });
    ws.meetings[MEETING.northwindDeepDive] = { ...ws.meetings[MEETING.northwindDeepDive], startsAt: at(3, "11:00") };
    delete ws.meetings[MEETING.lumenwireToday];
    ws.accounts[DOMAIN.glassmoor].signals.push(makeSignal("sig_new", { headline: "Hiring a revenue accountant", strength: 3 }));
    const kinds = sinceFacts(ws, prev, NOW).facts.map((f) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(["booked", "moved", "canceled", "signals"]));
    expect(sinceFacts(ws, prev, NOW).label).toBe(`Since ${sinceLabel(prev.at, NOW)}`);
  });

  it("says nothing changed when nothing did", () => {
    const ws = sampleWorkspace(NOW);
    expect(sinceFacts(ws, deskSnapshot(ws, NOW), NOW).facts).toEqual([]);
  });
});
