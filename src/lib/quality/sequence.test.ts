import { describe, expect, it } from "vitest";
import type { DraftStep } from "@/lib/domain/types";
import { TODAY, at, day, makeActivity, makePackage, makeStep } from "@/test/factories";
import { dueOn, nextFollowUp, recentFirstTouch, repliedSinceFirstTouch, senderOwnsSequence, sequenceOwnerName } from "./sequence";

/** A cold package to Ana whose step 1 went out `daysAgo` days ago, plus any later steps. */
const cold = (daysAgo: number, later: DraftStep[] = []) =>
  makePackage("pkg", "acme.example", { personId: "per_ana", createdAt: at(-daysAgo - 1), steps: [makeStep(1, { status: "sent", sentAt: at(-daysAgo) }), ...later] });

describe("dueOn", () => {
  it("schedules step 2 three days and step 3 eight days after step 1", () => {
    const pkg = cold(10);
    expect([1, 2, 3, 4].map((n) => dueOn(pkg, n))).toEqual([day(-10), day(-7), day(-2), null]);
    expect(dueOn(makePackage("draft", "acme.example"), 2)).toBeNull();
  });
});

describe("recentFirstTouch", () => {
  it("finds a step 1 sent in the last 60 days", () => {
    expect(recentFirstTouch(cold(60), TODAY)?.step).toBe(1);
    expect(recentFirstTouch(cold(61), TODAY)).toBeUndefined();
    expect(recentFirstTouch(makePackage("draft", "acme.example"), TODAY)).toBeUndefined();
  });
});

describe("repliedSinceFirstTouch", () => {
  it("is true only for a reply from the same person after step 1", () => {
    const pkg = cold(5);
    const reply = (personId: string, n: number) => makeActivity("r", { kind: "reply_received", personId, at: at(n) });
    expect(repliedSinceFirstTouch(pkg, [reply("per_ana", -2)])).toBe(true);
    expect(repliedSinceFirstTouch(pkg, [reply("per_ana", -6)])).toBe(false);
    expect(repliedSinceFirstTouch(pkg, [reply("per_bo", -2)])).toBe(false);
  });
});

describe("sequencer ownership", () => {
  it("hands follow-ups to the sequencer once a package is pushed or exported", () => {
    const pkg = cold(5);
    expect(senderOwnsSequence(pkg)).toBe(false);
    pkg.pushedTo = [{ integrationId: "csv", at: at(-5) }];
    expect(senderOwnsSequence(pkg)).toBe(true);
    expect(sequenceOwnerName(pkg)).toBe("your sequencer");
    pkg.pushedTo.push({ integrationId: "instantly", at: at(-4) });
    expect(sequenceOwnerName(pkg)).toBe("Instantly");
  });
});

describe("nextFollowUp", () => {
  it("returns the next step, its date, and whether it is due or drafted", () => {
    expect(nextFollowUp(cold(2), TODAY)).toEqual({ step: 2, dueOn: day(1), due: false, drafted: false });
    expect(nextFollowUp(cold(4, [makeStep(2)]), TODAY)).toEqual({ step: 2, dueOn: day(-1), due: true, drafted: true });
    expect(nextFollowUp(cold(9, [makeStep(2, { status: "sent", sentAt: at(-6) })]), TODAY)).toEqual({ step: 3, dueOn: day(-1), due: true, drafted: false });
  });

  it("returns null once the sequence is over or paused", () => {
    expect(nextFollowUp(cold(12, [makeStep(2, { status: "sent" }), makeStep(3, { status: "sent" })]), TODAY)).toBeNull();
    expect(nextFollowUp(cold(4, [makeStep(2, { status: "cancelled_by_reply" })]), TODAY)).toBeNull();
    expect(nextFollowUp(cold(4, [makeStep(2, { status: "skipped" })]), TODAY)).toBeNull();
    expect(nextFollowUp(cold(4), TODAY, [makeActivity("r", { kind: "reply_received", personId: "per_ana", at: at(-1) })])).toBeNull();
    expect(nextFollowUp({ ...cold(4), pushedTo: [{ integrationId: "smartlead", at: at(-4) }] }, TODAY)).toBeNull();
    expect(nextFollowUp({ ...cold(4), mode: "linkedin" }, TODAY)).toBeNull();
    expect(nextFollowUp(makePackage("draft", "acme.example"), TODAY)).toBeNull();
  });
});
