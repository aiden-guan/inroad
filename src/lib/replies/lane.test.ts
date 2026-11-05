import { describe, expect, it } from "vitest";
import type { Workspace } from "@/lib/domain/types";
import { computeMoves, mergeMoves, visibleMoves } from "@/lib/moves/rules";
import { deskLayout } from "@/lib/moves/desk";
import { sampleWorkspace } from "@/lib/sample";
import { PERSON } from "@/lib/sample/ids";
import { NOW, TODAY, at, day, makeAccount, makeActivity, makeMove, makePerson, makeWorkspace } from "@/test/factories";
import { dueLabel, laneRow, laneRows } from "./lane";

const acme = "acme.io";

function inbox(replies: { id: string; body?: string; at?: string; sentiment?: "positive" | "ooo" | "unsubscribe"; person?: string }[]): Workspace {
  const ws = makeWorkspace({
    founder: { name: "Priya Raman", email: "priya@ledgerline.example" },
    accounts: { [acme]: makeAccount(acme, { peopleIds: ["per_ana", "per_bo"] }) },
    people: { per_ana: makePerson("per_ana", acme, { name: "Ana Lima" }), per_bo: makePerson("per_bo", acme, { name: "Bo Chen" }) },
    activities: [makeActivity("act_sent", { kind: "touch_sent", personId: "per_ana", accountDomain: acme, at: at(-3), summary: "First note to Ana", body: "Ana, quick question about your close." })],
  });
  for (const r of replies) {
    ws.activities.push(makeActivity(r.id, { kind: "reply_received", personId: r.person ?? "per_ana", accountDomain: acme, at: r.at ?? at(-1, "11:00"), body: r.body, sentiment: r.sentiment }));
  }
  return ws;
}
const rowsOf = (ws: Workspace) => laneRows(ws, deskLayout(visibleMoves(mergeMoves({}, computeMoves(ws, NOW), TODAY), TODAY), ws).replies, NOW);

describe("laneRow", () => {
  it("carries how the reply reads, the cue, when it's due, and the note it answered", () => {
    const ws = inbox([{ id: "act_q", body: "Hi Priya,\nCan it cover EU data residency? Our team is in Lisbon." }]);
    const [row] = rowsOf(ws);
    expect(row).toMatchObject({ name: "Ana Lima", company: "Acme", read: { intent: "info_request", by: "code" }, dueOn: day(-1), dueIn: -1, touch: { id: "act_sent" } });
    expect(row.snippet).toBe("Can it cover EU data residency? Our team is in Lisbon.");
    expect(row.actions.map((a) => a.id)).toEqual(["draft", "tomorrow", "handled"]);
    expect(dueLabel(row)).toBe("1 day late");
  });

  it("offers to add the person a referral names, from their address", () => {
    const ws = inbox([{ id: "act_ref", body: "Not me. Talk to Nora Vance (nora@acme.io), our Controller." }]);
    const [row] = rowsOf(ws);
    expect(row.read.intent).toBe("referral");
    expect(row.referral).toMatchObject({ name: "Nora Vance", email: "nora@acme.io", title: "Controller", domain: acme });
    expect(row.actions.map((a) => a.label)).toEqual(["Add Nora and draft a note", "Thank Ana", "Handled"]);
    ws.people.per_nora = makePerson("per_nora", acme, { name: "Nora Vance", email: "nora@acme.io" });
    expect(rowsOf(ws)[0].actions[0].label).toBe("Draft a note to Nora");
  });

  it("holds an out-of-office to its return date and names who covers", () => {
    const ws = inbox([{ id: "act_ooo", body: "I'm out of the office until Thursday. For anything urgent, contact Bo Chen.", at: at(-1, "09:00") }]);
    const [row] = rowsOf(ws);
    expect(row).toMatchObject({ read: { intent: "ooo" }, backOn: day(2), delegate: "Bo Chen", dueOn: null });
    expect(row.actions[0]).toMatchObject({ id: "hold", until: day(2) });
  });

  it("dates a not now from their words, or two months out (and says it's a default)", () => {
    const named = rowsOf(inbox([{ id: "act_nn", body: "Not a priority right now. Check back next quarter." }]))[0];
    expect(named).toMatchObject({ revisitOn: "2027-01-04", revisitGuessed: false });
    expect(named.actions[0]).toMatchObject({ id: "revisit", until: "2027-01-04" });
    const bare = rowsOf(inbox([{ id: "act_nn2", body: "Not the right time for us." }]))[0];
    expect(bare.revisitGuessed).toBe(true);
  });

  it("asks only to suppress an opt-out, and nothing once they're suppressed", () => {
    const ws = inbox([{ id: "act_stop", body: "Please remove me from your list.", sentiment: "unsubscribe" }]);
    expect(rowsOf(ws)[0].actions.map((a) => a.id)).toEqual(["suppress"]);
    ws.suppression.push({ id: "sup", email: "ana@acme.io", reason: "unsubscribe", at: at(0) });
    expect(rowsOf(ws)[0]).toMatchObject({ suppressed: true, actions: [{ id: "handled", label: "Done" }] });
  });

  it("is null when the reply it answered is gone", () => {
    expect(laneRow(makeWorkspace(), makeMove("mv", { kind: "reply", activityId: "act_gone" }), NOW)).toBeNull();
  });
});

describe("laneRows", () => {
  it("puts what's late first, then what's due, then what only needs a decision", () => {
    const ws = inbox([
      { id: "act_ooo", body: "Out of office until Monday.", person: "per_bo", at: at(-1, "08:00") },
      { id: "act_yes", body: "Yes, let's talk.", at: at(0, "08:00") },
    ]);
    ws.people.per_cy = makePerson("per_cy", acme, { name: "Cy Ode" });
    ws.activities.push(makeActivity("act_old", { kind: "reply_received", personId: "per_cy", accountDomain: acme, at: at(-2, "10:00"), body: "Sounds interesting, send me pricing?" }));
    expect(rowsOf(ws).map((r) => r.reply.id)).toEqual(["act_old", "act_yes", "act_ooo"]);
  });
});

describe("the sample", () => {
  it("opens with a question, a referral and an out-of-office in the lane", () => {
    const ws = sampleWorkspace(NOW);
    const rows = rowsOf(ws);
    expect(rows.map((r) => [r.person?.id, r.read.intent])).toEqual([
      [PERSON.dana, "info_request"],
      [PERSON.sam, "referral"],
      [PERSON.grace, "ooo"],
    ]);
    expect(rows[1].referral).toMatchObject({ name: "Nora Vance", email: "nora.vance@cinderpath.example", title: "Revenue Accounting Manager" });
  });
});
