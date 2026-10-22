import { describe, expect, it } from "vitest";
import type { Workspace } from "@/lib/domain/types";
import { at, day, makeAccount, makeDossier, makePerson, makeSignal, makeWorkspace } from "@/test/factories";
import { runOffline, startMockModel, userText } from "@/test/offline-workflow";
import compose from "./compose";

/**
 * While a message bet runs, cold first touches alternate arms: the composer writes each draft to its arm and stamps
 * it, so every send can be counted per arm. Runs against the mock model, offline.
 */
const mock = startMockModel();

function workspace(): Workspace {
  const ws = makeWorkspace();
  ws.evidence.ev_jd = {
    id: "ev_jd",
    claim: "Acme is hiring a founding finance engineer",
    quote: "Own ledger reconciliation in your first 90 days",
    url: "https://jobs.ashbyhq.com/acme/1",
    host: "jobs.ashbyhq.com",
    sourceType: "job_post",
    publishedAt: day(-3),
    retrievedAt: at(-1),
    confidence: "high",
  };
  ws.accounts["acme.example"] = makeAccount("acme.example", {
    name: "Acme",
    signals: [makeSignal("sig_jd", { type: "first_hire", evidenceId: "ev_jd" })],
    dossier: makeDossier({
      angles: [{ id: "ang_1", title: "First finance hire", signal: "Hiring a founding finance engineer", interpretation: "", pressure: "", pov: "", proof: null, ask: "", evidenceIds: ["ev_jd"], bestFor: "champion", strength: 4 }],
    }),
    peopleIds: ["per_dana", "per_sam"],
  });
  ws.people.per_dana = makePerson("per_dana", "acme.example", { role: "champion" });
  ws.people.per_sam = makePerson("per_sam", "acme.example", { role: "champion" });
  ws.briefs["2026-10-12:friday"] = {
    date: "2026-10-16",
    kind: "friday",
    greeting: "",
    matters: [],
    generatedAt: at(-4),
    proposals: [
      {
        id: "prop_bet",
        kind: "message_bet",
        title: "Next month's bet",
        detail: "",
        bet: { variable: "The ask: their view vs a call", control: "ask for their view in one line", variant: "ask for 15 minutes", why: "", dimension: "cta" },
        status: "applied",
        decidedAt: new Date().toISOString(),
      },
    ],
  };
  return ws;
}

describe("compose with a running message bet", () => {
  it("writes each first touch to the arm with fewer drafts and stamps it", async () => {
    const ws = workspace();
    const first = await runOffline(compose, { domain: "acme.example", personId: "per_dana", mode: "cold" }, ws);
    const pkg1 = ws.outreach[(first.result as { packageId: string }).packageId];
    expect(pkg1.steps[0]).toMatchObject({ bet: { id: "prop_bet", arm: "control" }, signalType: "first_hire" });
    const drafting = mock.sent.find((r) => r.tools?.some((t) => t.name === "submit_draft"))!;
    expect(userText(drafting)).toContain('<message_bet arm="control">');
    expect(userText(drafting)).toContain("CONTROL arm: ask for their view in one line");

    mock.sent.length = 0;
    const second = await runOffline(compose, { domain: "acme.example", personId: "per_sam", mode: "cold" }, ws);
    const pkg2 = ws.outreach[(second.result as { packageId: string }).packageId];
    expect(pkg2.steps[0].bet).toEqual({ id: "prop_bet", arm: "variant" });
    expect(userText(mock.sent.find((r) => r.tools?.some((t) => t.name === "submit_draft"))!)).toContain("VARIANT arm: ask for 15 minutes");
  });

  it("leaves drafts alone when no bet runs", async () => {
    const ws = workspace();
    ws.briefs["2026-10-12:friday"].proposals![0].status = "dismissed";
    const run = await runOffline(compose, { domain: "acme.example", personId: "per_dana", mode: "cold" }, ws);
    const pkg = ws.outreach[(run.result as { packageId: string }).packageId];
    expect(pkg.steps[0].bet).toBeUndefined();
    expect(mock.sent.map(userText).join("\n")).not.toContain("<message_bet");
  });
});
