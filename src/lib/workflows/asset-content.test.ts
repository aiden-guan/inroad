import { beforeAll, describe, expect, it } from "vitest";
import type { Workspace } from "@/lib/domain/types";
import { sampleWorkspace } from "@/lib/sample";
import { NOW } from "@/test/factories";
import { runOffline, startMockModel, userText } from "@/test/offline-workflow";
import asset from "./asset";

/** Founder content through the asset workflow, offline against the mock: founder material in, code checks out. */
const mock = startMockModel();

let sample: Workspace;
beforeAll(() => {
  sample = sampleWorkspace(NOW);
});
const ws = () => {
  const w = structuredClone(sample);
  delete w.sample;
  for (const b of Object.values(w.briefs)) b.proposals = b.proposals?.filter((p) => !p.post);
  return w;
};

describe("asset workflow: founder content", () => {
  it("drafts a post from the founder's own material only, and checks it in code", async () => {
    const w = ws();
    const call = Object.values(w.meetings).find((m) => m.debrief)!;
    const { result, ws: after, events } = await runOffline(asset, { kind: "post", assetId: "ast_post", meetingId: call.id }, w);
    expect(result).toMatchObject({ assetId: "ast_post" });

    const req = mock.sent.find((r) => r.tools?.some((t) => t.name === "submit_asset"))!;
    const task = userText(req);
    expect(task).toContain("Write a post (kind: post).");
    expect(task).toContain("<founder_material>");
    expect(task).toContain("Start from this call:");
    for (const p of w.povs.slice(0, 2)) expect(task).toContain(`[${p.id}] Point of view:`);
    expect(JSON.stringify(req.system)).toContain("FOUNDER CONTENT");
    expect(events.some((e) => e.type === "action" && /only what you said/.test(e.text))).toBe(true);

    const saved = after.assets.find((a) => a.id === "ast_post")!;
    expect(saved).toMatchObject({ kind: "post", approved: false, origin: "agent" });
    // The mock's two-word body fails the post lint; the note is a gap for the founder, not a block.
    expect(saved.gaps?.some((g) => /Posts like this land best at 120–250/.test(g))).toBe(true);
  });

  it("refuses a second post in the same week before spending tokens, but rewrites the same one", async () => {
    const w = ws();
    const first = await runOffline(asset, { kind: "post", assetId: "ast_1" }, w);
    mock.sent.length = 0;
    await expect(runOffline(asset, { kind: "post", assetId: "ast_2" }, first.ws)).rejects.toThrow(/already drafted/);
    expect(mock.sent).toHaveLength(0);
    const again = await runOffline(asset, { kind: "post", assetId: "ast_1" }, first.ws);
    expect(again.ws.assets.filter((a) => a.kind === "post")).toHaveLength(1);
  });

  it("answers a community question, keeping the question for a fresh version", async () => {
    const w = ws();
    await expect(runOffline(asset, { kind: "community_answer", assetId: "ast_q" }, w)).rejects.toThrow(/question/);
    const brief = "Ask HN: How do you close usage revenue each month?\n\nAsked at https://news.ycombinator.com/item?id=1";
    const { ws: after } = await runOffline(asset, { kind: "community_answer", assetId: "ast_q", brief }, w);
    const req = mock.sent.find((r) => r.tools?.some((t) => t.name === "submit_asset"))!;
    expect(userText(req)).toContain("Founder's note: Ask HN: How do you close usage revenue each month?");
    expect(after.assets.find((a) => a.id === "ast_q")).toMatchObject({ kind: "community_answer", brief });
  });

  it("drafts a Show HN post and flags a title without the prefix", async () => {
    const { ws: after } = await runOffline(asset, { kind: "launch", assetId: "ast_l" }, ws());
    expect(after.assets.find((a) => a.id === "ast_l")?.gaps).toContain("Start the title with “Show HN:”.");
  });

  it("keeps founder content out of what outreach can offer", async () => {
    const w = ws();
    const { ws: after } = await runOffline(asset, { kind: "post", assetId: "ast_p" }, w);
    after.assets.find((a) => a.id === "ast_p")!.approved = true;
    const { companyContext } = await import("@/lib/ai/prompts/core");
    expect(companyContext(after)).not.toContain("ast_p");
  });
});
