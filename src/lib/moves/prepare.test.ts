import { beforeEach, describe, expect, it, vi } from "vitest";
import { todayISO } from "@/lib/domain/ids";
import { readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { makeAccount, makeDeal, makeMeeting, makeWorkspace } from "@/test/factories";

const startRun = vi.fn(async (def: { id: string }, args: unknown) => ({ id: `run_${def.id}_${JSON.stringify(args)}` }));
const configured = { value: true };
vi.mock("@/lib/runs/registry", () => ({ startRun: (def: { id: string }, args: unknown) => startRun(def, args) }));
vi.mock("@/lib/ai/client", () => ({ isConfigured: () => configured.value }));
vi.mock("@/lib/hub", () => ({ briefData: () => ({}), emitHubEvent: async () => {} }));

const { prepareToday } = await import("./prepare");

/** A deal at Acme with a call in two hours and no brief. Real clock: prepareToday reads `new Date()`. */
async function seed(patch: Parameters<typeof makeWorkspace>[0] = {}) {
  const inTwoHours = new Date(Date.now() + 2 * 3_600_000).toISOString();
  await replaceWorkspace(
    makeWorkspace({
      accounts: { "acme.example": makeAccount("acme.example", { dealId: "deal_acme", status: "in_pipeline" }) },
      deals: { deal_acme: makeDeal("deal_acme", "acme.example", { nextStep: { what: "Call", date: todayISO(), buyerAgreed: true } }) },
      meetings: { mtg_soon: makeMeeting("mtg_soon", "deal_acme", { startsAt: inTwoHours }) },
      ...patch,
    }),
  );
}

const preps = () => startRun.mock.calls.filter(([def]) => def.id === "prep").map(([, args]) => args);

describe("prepareToday prepares ahead", () => {
  beforeEach(() => {
    startRun.mockClear();
    configured.value = true;
  });

  it("starts the brief for a call in the next 24 hours once, and records the claim on today's brief", async () => {
    await seed();
    const first = await prepareToday();
    expect(preps()).toEqual([{ meetingId: "mtg_soon" }]);
    expect(first.aheadRunIds).toEqual([`run_prep_${JSON.stringify({ meetingId: "mtg_soon" })}`]);
    expect(readWorkspace().briefs[todayISO()].ahead).toEqual(["mtg:mtg_soon:none"]);
    // The next open (or a second tab) finds the claim and starts nothing.
    const again = await prepareToday();
    expect(again.aheadRunIds).toEqual([]);
    expect(preps()).toHaveLength(1);
  });

  it("never prepares ahead on the sample workspace or without a key", async () => {
    await seed({ sample: true });
    await prepareToday();
    configured.value = false;
    await seed();
    await prepareToday();
    expect(startRun.mock.calls.filter(([def]) => def.id === "prep" || def.id === "compose")).toEqual([]);
  });
});
