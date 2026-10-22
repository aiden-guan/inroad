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
