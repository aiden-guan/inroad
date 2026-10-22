import { beforeEach, describe, expect, it, vi } from "vitest";
import { todayISO } from "@/lib/domain/ids";
import { readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { at, makeAccount, makeDeal, makeDossier, makeMeeting, makePerson, makeSignal, makeWorkspace } from "@/test/factories";

const startRun = vi.fn(async (def: { id: string }, args: unknown) => ({ id: `run_${def.id}_${JSON.stringify(args)}` }));
const configured = { value: true };
vi.mock("@/lib/runs/registry", () => ({ startRun: (def: { id: string }, args: unknown) => startRun(def, args) }));
vi.mock("@/lib/ai/client", () => ({ isConfigured: () => configured.value }));
vi.mock("@/lib/hub", () => ({ briefData: () => ({}), emitHubEvent: async () => {} }));

const { prepareAfterRun, prepareToday } = await import("./prepare");

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

describe("prepareAfterRun", () => {
  beforeEach(() => {
    startRun.mockClear();
    configured.value = true;
  });

  it("starts a first-three company's draft as soon as its dossier lands, with no page open", async () => {
    const hiredAt = new Date(Date.now() - 3_600_000).toISOString();
    const evidence = { id: "ev_b", claim: "Hiring", quote: "Hiring", url: "https://jobs.example/1", host: "jobs.example", sourceType: "job_post" as const, retrievedAt: hiredAt, confidence: "high" as const };
    await replaceWorkspace(
      makeWorkspace({
        onboarding: { status: "hired", hiredAt, firstThree: ["beta.example"] },
        accounts: {
          "beta.example": makeAccount("beta.example", {
            peopleIds: ["per_bana"],
            signals: [makeSignal("s_b", { date: todayISO(), evidenceId: "ev_b" })],
            dossier: makeDossier({ generatedAt: new Date().toISOString(), recommendation: { move: "cold_email", personId: "per_bana", why: "A dated hire" } }),
          }),
        },
        people: { per_bana: makePerson("per_bana", "beta.example", { name: "Bana Ito" }) },
        evidence: { ev_b: evidence },
      }),
    );
    const run = { id: "run_d", workflow: "dossier" as const, title: "", ref: { kind: "account" as const, id: "beta.example" }, startedAt: at(0), status: "done" as const };
    const result = await prepareAfterRun(run);
    expect(startRun.mock.calls.filter(([def]) => def.id === "compose").map(([, args]) => args)).toEqual([{ domain: "beta.example", personId: "per_bana", mode: "cold" }]);
    expect(result?.aheadRunIds).toHaveLength(1);
    // Any other run, or a company outside the first three, leaves Today alone.
    startRun.mockClear();
    expect(await prepareAfterRun({ ...run, ref: { kind: "account", id: "other.example" } })).toBeNull();
    expect(startRun).not.toHaveBeenCalled();
  });
});
