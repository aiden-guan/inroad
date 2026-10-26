import { describe, expect, it } from "vitest";
import { applyAction } from "@/lib/domain/actions";
import type { ReviewProposal } from "@/lib/domain/types";
import { buildRevision } from "@/lib/playbook/revision";
import { sampleWorkspace } from "@/lib/sample";
import { NOW, at } from "@/test/factories";
import { applyLabel, proposalActions } from "./proposals";

/** Accepting a suggested playbook change applies it through the reducer and records the decision; nothing applies itself. */
describe("revise_foundation proposals", () => {
  function setup() {
    const ws = sampleWorkspace(NOW);
    const revision = buildRevision(ws.foundation!, { target: "messaging.oneLiner", op: "set", text: "Tollgate closes usage billing in two days, not nine." })!;
    const p: ReviewProposal = { id: "prop_rev", kind: "revise_foundation", title: "One-liner", detail: "Three calls named the nine-day close.", revision, status: "open" };
    ws.briefs["2026-11-02:monthly"] = { date: "2026-11-02", kind: "monthly", greeting: "", matters: [], generatedAt: at(0), reviewKind: "monthly", reviewRunId: "run_month", proposals: [p] };
    return { ws, p };
  }

  it("accepts into a new version tagged with the run that proposed it", () => {
    const { ws, p } = setup();
    expect(applyLabel(p)).toBe("Accept");
    const v = ws.foundation!.version;
    for (const a of proposalActions(p, ws, "2026-11-02")!) applyAction(ws, a);
    expect(ws.foundation!.messaging.oneLiner).toBe("Tollgate closes usage billing in two days, not nine.");
    expect(ws.foundationHistory?.at(-1)).toMatchObject({ version: v, source: "monthly", runId: "run_month" });
    expect(ws.briefs["2026-11-02:monthly"].proposals![0].status).toBe("applied");
  });

  it("can't be applied once the founder edited that part", () => {
    const { ws, p } = setup();
    ws.foundation!.messaging.oneLiner = "The founder's own words.";
    expect(proposalActions(p, ws, "2026-11-02")).toBeNull();
  });
});
