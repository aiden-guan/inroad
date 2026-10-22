import { beforeAll, describe, expect, it } from "vitest";
import { monthKey } from "@/lib/domain/ids";
import type { Workspace } from "@/lib/domain/types";
import { refreshInputs } from "@/lib/moves/monthly-data";
import { sampleWorkspace } from "@/lib/sample";
import { NOW, at } from "@/test/factories";
import { runOffline, startMockModel, userText } from "@/test/offline-workflow";
import { revisionProposals } from "./refresh";
import review from "./review";

/** The monthly loop: refresh suggestions are checked in code, and the whole run works offline against the mock. */
const mock = startMockModel();

let sample: Workspace;
beforeAll(() => {
  sample = sampleWorkspace(NOW);
});
const ws = () => {
  const w = structuredClone(sample);
  // Not the demo workspace for these runs, and a bet revised long ago so the sample's calls count as new.
  delete w.sample;
  w.foundation!.generatedAt = at(-60);
  for (const k of Object.keys(w.briefs)) if (w.briefs[k].reviewKind === "refresh" || w.briefs[k].reviewKind === "monthly") delete w.briefs[k];
  return w;
};

const change = (patch: Partial<Parameters<typeof revisionProposals>[1][number]>) => ({
  target: "icp.sentence" as const,
  op: "set" as const,
  refId: null,
  text: "Usage-priced API companies past $2M ARR whose controller still closes by hand; we cut close to two days.",
  reason: "Three calls named the nine-day close.",
  antiIcpReason: null,
  criterionKind: null,
  mustHave: null,
  detection: null,
  justificationIds: ["m1"],
  ...patch,
});

describe("revisionProposals", () => {
  it("turns cited changes into Accept/Reject proposals with their before and after", () => {
    const w = ws();
    const inputs = refreshInputs(w, NOW);
    const [p] = revisionProposals(w, [change({})], inputs, { max: 6 });
    expect(p).toMatchObject({ kind: "revise_foundation", title: "The ICP bet", status: "open", revision: { target: "icp.sentence", before: w.foundation!.icp.hypothesis.sentence } });
    expect(p.justification?.[0]).toContain("call");
  });

  it("drops changes nothing in the task supports", () => {
    const w = ws();
    const inputs = refreshInputs(w, NOW);
    const out = revisionProposals(
      w,
      [
        change({ justificationIds: ["m99"] }),
        // Validating a criterion needs 3 best-fit customers; the sample has fewer.
        change({ target: "icp.criterion", op: "validate", refId: w.foundation!.icp.criteria[0].id, text: null }),
        // Customer words must be verbatim from a transcript.
        change({ target: "messaging.customerWords", op: "add", text: "a phrase nobody said" }),
        change({ target: "persona.line", refId: "per_nobody" }),
      ],
      inputs,
      { max: 6 },
    );
    expect(inputs.customers).toBeLessThan(3);
    expect(out).toEqual([]);
  });

  it("keeps a light pass to the sections an answer affects, and to its cap", () => {
    const w = ws();
    const inputs = refreshInputs(w, NOW);
    const allowed = new Set(["messaging.oneLiner"]);
    expect(revisionProposals(w, [change({})], inputs, { allowed, max: 3 })).toEqual([]);
    expect(revisionProposals(w, [change({ target: "messaging.oneLiner", text: "Tollgate closes usage billing in two days." }), change({})], inputs, { max: 1 })).toHaveLength(1);
  });
});

describe("the review workflow, offline", () => {
  it("refresh: reads the calls, asks Opus at high effort and saves a refresh record", async () => {
    const w = ws();
    const { result } = await runOffline(review, { kind: "refresh" }, w);
    expect(result).toMatchObject({ kind: "refresh" });
    const req = mock.sent.find((r) => r.tools?.some((t) => t.name === "submit_refresh"))!;
    expect(req.model).toMatch(/opus/);
    expect((req as unknown as { output_config: { effort: string } }).output_config.effort).toBe("high");
    expect(userText(req)).toContain("<calls");
    expect(userText(req)).toContain("<best_fit_customers");
    const saved = Object.entries(w.briefs).find(([k]) => k.includes(":refresh:"));
    expect(saved?.[1]).toMatchObject({ kind: "refresh", reviewKind: "refresh", reviewRunId: "run_offline" });
  });

  it("a light pass after a pricing answer spends nothing", async () => {
    const w = ws();
    const q = w.foundation!.founderQuestions.find((x) => x.affects.length === 1 && x.affects[0] === "pricing") ?? w.foundation!.founderQuestions[0];
    q.affects = ["pricing"];
    q.answer = "We quoted $18K twice.";
    const { result } = await runOffline(review, { kind: "refresh", questionId: q.id }, w);
    expect(result).toEqual({ kind: "revise", proposals: 0 });
    expect(mock.sent).toHaveLength(0);
  });

  it("refresh: a model that gives nothing back fails the run and changes nothing, instead of saying the bet holds", async () => {
    const w = ws();
    const silent = (async () => ({ result: undefined, usage: {}, costUsd: 0 })) as never;
    await expect(runOffline(review, { kind: "refresh" }, w, { agent: silent })).rejects.toThrow("I couldn't finish rebuilding the bet. Nothing in your playbook changed");
    expect(Object.keys(w.briefs).some((k) => k.includes(":refresh:"))).toBe(false);
  });

  it("monthly: says the playbook part didn't finish when the model gives nothing back, and keeps the code-computed parts", async () => {
    const w = ws();
    const silent = (async () => ({ result: undefined, usage: {}, costUsd: 0 })) as never;
    await runOffline(review, { kind: "monthly" }, w, { agent: silent });
    const saved = w.briefs[`${monthKey()}:monthly`];
    expect(saved.review).toMatch(/I couldn't finish reading \d+ calls?.*, so nothing in your playbook changed/);
    expect(saved.review).toContain("## Pricing log");
  });

  it("monthly: a real run whose model never submits still saves the parts computed in code", async () => {
    const w = ws();
    // The first answer and both nudges come back as plain text: the engine gives up without a result.
    await mock.fault({ type: "no_submit", times: 3, when: { tool: "submit_monthly_review" } });
    const { result } = await runOffline(review, { kind: "monthly" }, w);
    expect(result).toMatchObject({ kind: "monthly" });
    expect(mock.sent.filter((r) => r.tools?.some((t) => t.name === "submit_monthly_review"))).toHaveLength(3);
    const saved = w.briefs[`${monthKey()}:monthly`];
    expect(saved.review).toMatch(/I couldn't finish reading \d+ calls?.*, so nothing in your playbook changed/);
    expect(saved.review).toContain("## Pricing log");
  });

  it("refresh: a real run whose model never submits says the playbook is unchanged", async () => {
    const w = ws();
    await mock.fault({ type: "no_submit", times: 3, when: { tool: "submit_refresh" } });
    const run = runOffline(review, { kind: "refresh" }, w);
    await expect(run).rejects.toThrow("I couldn't finish rebuilding the bet. Nothing in your playbook changed");
    await expect(run).rejects.toMatchObject({ code: "no_submit" });
    expect(Object.keys(w.briefs).some((k) => k.includes(":refresh:"))).toBe(false);
  });

  it("monthly: names the replies it read when there were no calls", async () => {
    const w = ws();
    for (const m of Object.values(w.meetings)) delete m.debrief;
    for (const d of Object.values(w.deals)) if (d.stage === "won" || d.pilot?.paid) d.stage = "talking";
    const replies = w.activities.filter((a) => a.kind === "reply_received" && a.body && a.at > w.foundation!.generatedAt).length;
    expect(replies).toBeGreaterThan(1);
    await runOffline(review, { kind: "monthly" }, w);
    // The mock's changes cite nothing real, so none survive.
    expect(w.briefs[`${monthKey()}:monthly`].review).toContain(`No changes: ${Math.min(replies, 10)} replies don't contradict the bet.`);
  });

  it("monthly: reads the ended bet as inconclusive and writes the pricing log", async () => {
    const w = ws();
    w.briefs["2026-08-10:friday"] = {
      date: "2026-08-14",
      kind: "friday",
      greeting: "",
      matters: [],
      generatedAt: at(-60),
      proposals: [{ id: "prop_aug", kind: "message_bet", title: "bet", detail: "", bet: { variable: "The ask", control: "their view", variant: "15 minutes", why: "", dimension: "cta" }, status: "applied", decidedAt: "2026-08-14T17:00:00.000Z" }],
    };
    await runOffline(review, { kind: "monthly" }, w);
    const saved = Object.entries(w.briefs).find(([k]) => k.endsWith(":monthly"));
    expect(saved?.[0]).toBe(`${monthKey()}:monthly`);
    expect(saved?.[1].review).toContain("## Pricing log");
    expect(saved?.[1].review).toContain("## The message bet");
    // The mock says "keep"; code keeps it inconclusive below 100 sends per arm.
    expect(w.briefs["2026-08-10:friday"].proposals![0].betReadout).toMatchObject({ verdict: "inconclusive" });
    expect(mock.sent.some((r) => r.tools?.some((t) => t.name === "submit_monthly_review"))).toBe(true);
  });
});
