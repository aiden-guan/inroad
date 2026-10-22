import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAction } from "@/lib/domain/actions";
import { NOW, at, makeAccount, makeActivity, makeDossier, makePackage, makePerson, makeSignal, makeStep, makeWorkspace } from "@/test/factories";
import { runOffline, startMockModel, userText } from "@/test/offline-workflow";
import review from "./review";

/** The Friday learning review, run offline against the mock: what the founder reads and what the model is given. */
const mock = startMockModel();

function week() {
  const ws = makeWorkspace();
  ws.accounts["acme.example"] = makeAccount("acme.example", {
    signals: [makeSignal("sig_jd", { type: "first_hire", evidenceId: "ev_jd" })],
    dossier: makeDossier({ angles: [{ id: "ang_1", title: "First hire", signal: "Hiring a founding finance engineer", interpretation: "", pressure: "", pov: "", proof: null, ask: "", evidenceIds: ["ev_jd"], bestFor: "champion", strength: 4 }] }),
  });
  ws.people.per_dana = makePerson("per_dana", "acme.example", { role: "champion" });
  ws.people.per_li = makePerson("per_li", "acme.example", { role: "economic_buyer" });
  ws.outreach.out_1 = makePackage("out_1", "acme.example", { personId: "per_dana", angleId: "ang_1", steps: [makeStep(1, { frame: "founder_card", subject: "your first finance hire", angleId: "ang_1" })] });
  ws.outreach.out_li = makePackage("out_li", "acme.example", { mode: "linkedin", personId: "per_li", angleId: "ang_1", steps: [makeStep(1, { subject: null, frame: "mouse_trap" })] });
  applyAction(ws, { type: "outreach.approveStep", packageId: "out_1", step: 1, at: at(-1), activityId: "act_sent" });
  applyAction(ws, { type: "outreach.approveStep", packageId: "out_li", step: 1, at: at(-1), activityId: "act_li" });
  ws.activities.push(makeActivity("act_reply", { kind: "reply_received", personId: "per_dana", at: at(0, "08:00"), sentiment: "positive", body: "Yes, let's talk." }));
  return ws;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Friday learning review", () => {
  it("shows replies by angle, signal, persona, subject line and channel, and gives the model every breakdown", async () => {
    // The review reads "this week" off the clock; only Date is faked, so the mock's sockets and timers still run.
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const ws = week();
    await runOffline(review, { kind: "friday" }, ws);
    const saved = Object.entries(ws.briefs).find(([k]) => k.endsWith(":friday"))![1];
    expect(saved.review).toContain("## Replies by angle, signal, persona, subject line and channel (last 8 weeks)");
    expect(saved.review).toContain("| Subject names their trigger | 1 | 1 | 1 | anecdote |");
    expect(saved.review).toContain("| Channel: LinkedIn | 1 | 0 | 0 | anecdote |");
    expect(saved.review).toContain("| Persona: economic buyer | 1 | 0 | 0 | anecdote |");
    const req = mock.sent.find((r) => r.tools?.some((t) => t.name === "submit_learning_review"))!;
    expect(userText(req)).toContain("By channel:\n- email: 1 sent");
  });
});
