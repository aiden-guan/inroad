import { describe, expect, it, vi } from "vitest";
import type { AgentTool, RunOptions, RunResult } from "@/lib/ai/engine";
import type { Workspace } from "@/lib/domain/types";
import { emptyWorkspace } from "@/lib/store/workspace";
import { consumerWorkspace, makePartner } from "@/test/factories";
import type { WorkflowContext } from "./types";

// Child runs (discovery, partner search) would call the model: record them instead.
const started: { workflow: string; args: unknown }[] = [];
vi.mock("@/lib/runs/registry", () => ({
  startRun: vi.fn(async (def: { id: string }, args: unknown) => {
    started.push({ workflow: def.id, args });
    return { id: `run_${def.id}` };
  }),
  runSteps: () => [],
}));

const { default: foundation } = await import("./foundation");
const { default: partners } = await import("./partners");

type Script = (opts: Omit<RunOptions, "emit" | "signal">, call: number) => Promise<Partial<RunResult>>;

/** A workflow context over an in-memory workspace, with the model replaced by a script that calls the tools itself. */
function context<A>(ws: Workspace, args: A, script: Script) {
  const calls: Omit<RunOptions, "emit" | "signal">[] = [];
  const ctx: WorkflowContext<A> = {
    runId: "run_test",
    args,
    emit: () => {},
    signal: new AbortController().signal,
    agent: async <T,>(opts: Omit<RunOptions, "emit" | "signal">) => {
      calls.push(opts);
      const out = await script(opts, calls.length);
      return { result: undefined, text: "", messages: [], stopReason: "end_turn", usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 }, costUsd: 0, ...out } as unknown as RunResult<T>;
    },
    read: () => ws,
    mutate: async (fn) => fn(ws),
    noteFreeSignals: () => {},
  };
  return { ctx, calls };
}

const tool = (opts: Omit<RunOptions, "emit" | "signal">, name: string): AgentTool => {
  const t = opts.tools?.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}; got ${opts.tools?.map((x) => x.name).join(", ")}`);
  return t;
};

const CONSUMER_BET = {
  positioning: {
    alternatives: [
      { name: "Doing nothing", kind: "status_quo", whyChosenToday: "Free and familiar" },
      { name: "A free couch-to-5K app", kind: "competitor", whyChosenToday: "It's free" },
    ],
    differentiators: [{ capability: "Plans that adjust after a missed run", vsAlternative: "A free couch-to-5K app", status: "claimed" }],
    valueThemes: [{ theme: "Finish the plan", outcome: "Run a first 5K without quitting in week 3", needsProof: true }],
    bestFit: ["New runners who quit a plan before"],
    category: { name: "Running app", style: "head_to_head", why: "People search for running apps" },
  },
  icp: {
    hypothesis: { companyGroup: "First-time runners", role: "Someone three weeks into a plan", obstacle: "quitting", cause: "plans don't adjust", improvement: "a plan they finish", sentence: "First-time runners quit in week 3 because plans don't adjust; we help them finish." },
    primarySegment: "Couch-to-5K runners",
    testSlices: [],
    criteria: [{ text: "Asks for beginner plans on r/C25K", kind: "behavioral", mustHave: false, detection: "community", status: "hypothesis", howToTest: "Count first-week signups from there" }],
    antiIcp: [{ text: "Marathon runners", reason: "They have coaches" }],
    triggers: [{ type: "seasonal", windowDays: 45, implication: "New Year plans start" }],
    confirmIf: "Week-4 retention above 40% for this audience",
    killIf: "Most users stop in week 1",
  },
  personas: [
    {
      role: "user",
      titles: ["new runners"],
      kpis: ["finish a 5K"],
      pains: ["quits in week 3"],
      triggers: ["New Year"],
      objections: ["another subscription"],
      wateringHoles: [{ name: "r/C25K", kind: "community", url: null }],
      line: "Talk about finishing, not speed.",
    },
  ],
  messaging: {
    oneLiner: "Pacely is the running app for first-time runners who want to finish a 5K without quitting.",
    themes: [{ valueTheme: 1, headline: "Finish the plan", vsAlternative: "A free couch-to-5K app" }],
    byPersona: [{ persona: 1, line: "Talk about finishing." }],
    bySignal: [{ signal: "seasonal", implication: "New Year plans start" }],
    customerWords: [],
    bannedWords: [],
    hooks: ["I quit every running plan in week 3"],
  },
  growth: {
    northStar: { metric: "Weekly runners who finish a planned run", why: "Counts runs done, not installs" },
    activation: { event: "Finishes the first planned run", withinDays: 3, howToTest: "Compare week-4 retention of finishers" },
    cadence: "weekly",
    primaryLoop: { kind: "word_of_mouth", how: "Runners bring running friends" },
    firstHundred: ["r/C25K, one helpful answer a day"],
  },
  questions: [{ question: "Where did your first 100 users come from?", whyItMatters: "That's the channel to double", affects: ["channel_plan"] }],
};

const SNAPSHOT = {
  name: "Pacely",
  plainOneLiner: "A running plan app for first-time runners.",
  whoItsFor: "People training for a first 5K",
  howYouCharge: { model: "flat", isPublic: true, summary: "Free for 7 days, then $9.99 a month" },
  proof: [],
  alternatives: [{ name: "Doing nothing", kind: "status_quo" }],
  stage: "early_revenue",
  messagingIssues: [],
  coverage: "thin",
  market: "consumer",
  consumerModel: "app",
};

describe("the consumer playbook (foundation)", () => {
  it("writes a consumer bet with a growth model, consumer defaults and a creator search", async () => {
    started.length = 0;
    const ws = emptyWorkspace();
    const { ctx, calls } = context(ws, { note: "A running plan app for first-time runners. 400 beta users from r/C25K." }, async (opts) => {
      if (opts.tier === "fast") return { result: SNAPSHOT };
      const save = tool(opts, "submit_section");
      await save.run!(save.schema.parse({ positioning: CONSUMER_BET.positioning }));
      await save.run!(save.schema.parse({ icp: CONSUMER_BET.icp, personas: CONSUMER_BET.personas }));
      await save.run!(save.schema.parse({ messaging: CONSUMER_BET.messaging, growth: CONSUMER_BET.growth, questions: CONSUMER_BET.questions }));
      return { result: { confidence: "medium", note: null } };
    });
    await foundation.run(ctx);

    // The bet was written with the consumer prompts.
    const bet = calls.find((c) => c.tier === "strategist")!;
    expect((bet.system as string[])[0]).toContain("early-stage consumer company");
    expect((bet.system as string[])[1]).toContain("CONSUMER FOUNDATION RULES");

    expect(ws.company).toMatchObject({ market: "consumer", consumerModel: "app", marketSource: "site" });
    expect(ws.goal).toMatchObject({ metric: "active_users", target: 100 });
    const f = ws.foundation!;
    expect(f.channelPlan.motions[0].motion).toBe("user_conversations");
    expect(f.commercial.structure).toBe("free_trial");
    expect(f.icp.employeeBand).toBeUndefined();
    expect(f.icp.antiIcp.map((a) => a.text)).toEqual(expect.arrayContaining(["Marathon runners", "Children under 13, unless it's built for them"]));
    expect(f.personas[0]).toMatchObject({ role: "user", wateringHoles: [{ name: "r/C25K", kind: "community" }] });
    expect(f.messaging.hooks).toEqual(["I quit every running plan in week 3"]);
    // The strategist writes the product-specific growth model; code fills the retention bar.
    expect(f.growth).toMatchObject({ northStar: { metric: "Weekly runners who finish a planned run" }, retention: { metric: "w4", target: 40, good: 70 } });
    expect(ws.onboarding.sections?.growth).toBeTruthy();
    // Who to talk to first: creators and communities, found once the segments landed.
    expect(started).toEqual([{ workflow: "partners", args: { mode: "find", count: 6, source: "onboarding" } }]);
    expect(ws.onboarding.discoveryRunId).toBe("run_partners");
  });

  it("keeps the business bet when the founder says they sell to businesses", async () => {
    started.length = 0;
    const ws = emptyWorkspace();
    const { ctx, calls } = context(ws, { note: "A running app for corporate wellness teams at large employers.", market: "b2b" as const }, async (opts) => {
      if (opts.tier === "fast") return { result: SNAPSHOT };
      return { result: { confidence: "low", note: null } };
    });
    await foundation.run(ctx);
    expect(ws.company).toMatchObject({ market: "b2b", marketSource: "founder" });
    expect(ws.company?.consumerModel).toBeUndefined();
    const bet = calls.find((c) => c.tier === "strategist")!;
    expect((bet.system as string[])[1]).toContain("FOUNDATION RULES (the first bet: positioning, ideal customer");
    expect(ws.foundation!.channelPlan.motions.map((m) => m.motion)).toContain("warm_network");
  });
});

describe("creators and communities (partners)", () => {
  it("keeps only partners whose link appeared in this run's search results", async () => {
    const ws = consumerWorkspace({ partners: { ptn_old: makePartner("ptn_old", { handle: "@old", platform: "tiktok" }) } });
    const { ctx } = context(ws, { mode: "find" as const, count: 5 }, async () => ({
      messages: [{ role: "assistant", content: [{ type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://www.reddit.com/r/C25K/", title: "r/C25K" }, { type: "web_search_result", url: "https://www.tiktok.com/@old", title: "old" }] }] }] as never,
      result: {
        partners: [
          { kind: "community", name: "r/C25K", platform: "reddit", handle: "r/C25K", url: "https://reddit.com/r/C25K", audience: "Couch-to-5K runners", fit: "Beginners ask for plan advice every day", segment: 1 },
          { kind: "creator", name: "Invented Creator", platform: "youtube", handle: "@invented", url: "https://youtube.com/@invented", audience: null, fit: "Never appeared in a search result", segment: null },
          { kind: "creator", name: "Old", platform: "tiktok", handle: "@old", url: "https://www.tiktok.com/@old", audience: null, fit: "Already on the list and seen", segment: null },
        ],
      },
    }));
    const out = await partners.run(ctx);
    expect(out).toEqual({ added: 1, dropped: 2 });
    const added = Object.values(ws.partners!).find((p) => p.name === "r/C25K")!;
    expect(added).toMatchObject({ kind: "community", stage: "shortlist", source: "agent", sourceUrl: "https://reddit.com/r/C25K" });
    // An audience number is never stored from the agent.
    expect(added.followers).toBeUndefined();
  });

  it("revises a draft once when it breaks the consumer rules", async () => {
    const ws = consumerWorkspace({ partners: { ptn_maya: makePartner("ptn_maya", { offer: { type: "flat_fee", amountUsd: 250 } }) } });
    const prompts: string[] = [];
    const { ctx } = context(ws, { mode: "draft" as const, partnerId: "ptn_maya" }, async (opts, call) => {
      const last = opts.messages.at(-1)!;
      prompts.push(typeof last.content === "string" ? last.content : JSON.stringify(last.content));
      return call === 1
        ? { result: { subject: null, body: "Love your channel. Leave us a 5-star review and we'll pay $250.", followUp: "Any thoughts on this?", needsSpecific: true, gaps: [] } }
        : {
            result: {
              subject: null,
              body: "Your week-one videos are what our first users watch. I'm Maya, I built Pacely for first-time runners. We'd pay $250 for one honest video, within 7 days of posting, marked #ad. Want to try it?",
              followUp: "Happy to send the plan first so you can try a week before deciding.",
              needsSpecific: false,
              gaps: [],
            },
          };
    });
    const out = (await partners.run(ctx)) as { passed: boolean; drafts: number };
    expect(prompts[1]).toContain("REVIEW_INCENTIVE");
    expect(out).toMatchObject({ drafts: 1, passed: true });
    expect(ws.partners!.ptn_maya.outreach).toMatchObject({ channel: "dm", subject: null });
    expect(ws.partners!.ptn_maya.outreach!.body).toContain("#ad");
  });
});
