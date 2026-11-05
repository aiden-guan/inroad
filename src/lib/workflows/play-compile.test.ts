import { describe, expect, it } from "vitest";
import { sampleWorkspace } from "@/lib/sample";
import { SAMPLE_PLAY } from "@/lib/sample/plays";
import { currentVersion } from "@/lib/plays/recipes";
import { NOW } from "@/test/factories";
import { runOffline, startMockModel, userText } from "@/test/offline-workflow";
import playCompile from "./play-compile";

/** "Describe a play", run offline against the mock model: the recipe, what it can't run, and what reached the model. */
const mock = startMockModel();

describe("Describe a play", () => {
  it("turns the sentence into a draft recipe on the cheap tier, with the workspace's personas and criteria in the schema", async () => {
    const ws = sampleWorkspace(NOW);
    const sentence = "When a company in our ICP posts a RevOps or billing role and we have no open deal, draft a note to the hiring manager that references the role.";
    const { result } = await runOffline(playCompile, { sentence }, ws);
    const { id, fires } = result as { id: string; fires: number };
    const cp = ws.customPlays![id];
    expect(cp).toMatchObject({ sentence, origin: "sentence", versions: [], unsupported: [] });
    expect(cp.draft).toMatchObject({
      name: "RevOps or billing hire, no open deal",
      trigger: { signals: ["jd_names_pain", "first_hire", "hiring"], keywords: ["revops", "revenue operations", "billing"] },
      audience: { tiers: ["A", "B"], deal: "none", personas: ["champion"] },
      action: { kind: "write" },
    });
    expect(cp.assumptions[0]).toContain("hiring manager");
    // Tallyhook and Mossbank: billing and RevOps hires with no deal.
    expect(fires).toBe(2);

    const req = mock.sent.find((r) => r.tools?.some((t) => t.name === "submit_recipe"))!;
    expect(req.model).toContain("haiku");
    expect(userText(req)).toContain("champion: Controller, Head of Revenue Accounting");
    expect(userText(req)).toContain("icp_usage_pricing · must · Prices on a usage metric");
    const schema = JSON.stringify(req.tools!.find((t) => t.name === "submit_recipe"));
    expect(schema).toContain("icp_usage_pricing");
    expect(schema).toContain("jd_names_pain");
  });

  it("names every part it can't run, adding what the model missed", async () => {
    const ws = sampleWorkspace(NOW);
    const sentence = "When a usage-priced company that raised more than $20M visits our pricing page, write to the CFO within 14 days.";
    const { result } = await runOffline(playCompile, { sentence }, ws);
    const cp = ws.customPlays![(result as { id: string }).id];
    expect(cp.unsupported.map((u) => u.phrase)).toEqual(["visits our pricing page", "raised more than"]);
    expect(cp.unsupported[1].nearest).toContain("Series B");
    expect(cp.draft?.trigger.withinDays).toBe(14);
  });

  it("rewriting a running play's sentence leaves unsaved changes, not a new version", async () => {
    const ws = sampleWorkspace(NOW);
    const { result } = await runOffline(playCompile, { sentence: "When a usage-priced company posts a billing role and has no open deal, research it first.", id: SAMPLE_PLAY }, ws);
    expect((result as { id: string }).id).toBe(SAMPLE_PLAY);
    const cp = ws.customPlays![SAMPLE_PLAY];
    expect(cp.versions).toHaveLength(2);
    expect(currentVersion(cp)?.version).toBe(2);
    expect(cp.draft?.action.kind).toBe("research");
  });
});
