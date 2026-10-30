import { describe, expect, it } from "vitest";
import { sampleWorkspace } from "@/lib/sample";
import { NOW } from "@/test/factories";
import { instantAnswer } from "./ask";
import { createInitiative } from "@/lib/gtm/initiatives";

describe("instant answers about the number", () => {
  it("lists actual priorities and overdue commitments without intercepting advice questions", () => {
    const ws = sampleWorkspace(NOW);
    createInitiative(ws, { title: "Improve trial onboarding", owner: "Aiden", dueOn: "2020-01-01" }, NOW);
    for (const question of ["my priorities", "show my weekly plan", "what are our GTM priorities this week", "overdue initiatives"]) {
      const answer = instantAnswer(ws, question, NOW);
      expect(answer?.rows[0]).toMatchObject({ label: "Improve trial onboarding", href: "/revenue#gtm-initiatives" });
      expect(answer?.rows[0].detail).toContain("Aiden");
      expect(answer?.rows[0].detail).toContain("overdue");
    }
    expect(instantAnswer(ws, "what should our priorities be", NOW)).toBeNull();
  });
  it("calls the forecast from code, with the plan's headline", () => {
    const ws = sampleWorkspace(NOW);
    ws.revenue = { target: { amountUsd: 150_000, periodStart: "2026-10-01", periodEnd: "2026-12-31", label: "Q4 new ARR" } };
    for (const q of ["What's the forecast?", "will we hit the number", "pipeline coverage", "commit"]) {
      const a = instantAnswer(ws, q, NOW);
      expect(a?.rows[0]).toMatchObject({ label: "Target", detail: "$150K · Q4 new ARR" });
      expect(a?.rows.map((r) => r.label)).toEqual(expect.arrayContaining(["Commit", "Best case", "Rowanstack"]));
    }
  });

  it("lists risky deals worst first, with the fix", () => {
    const a = instantAnswer(sampleWorkspace(NOW), "which deals are at risk", NOW);
    expect(a?.title).toMatch(/open deals? (has|have) risks on file/);
    expect(a?.rows[0].detail).toMatch(/fix: /);
  });

  it("leaves judgment questions to the model", () => {
    expect(instantAnswer(sampleWorkspace(NOW), "how do I hit the number", NOW)).toBeNull();
  });
});
