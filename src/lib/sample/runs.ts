import { monthKey } from "@/lib/domain/ids";
import type { EntityRef, ISODateTime, ModelTierName, RunStep, RunSummary, UsageMonth, WorkflowId } from "@/lib/domain/types";
import type { Clock } from "./clock";
import { DOMAIN, EVENT, MEETING, PACKAGE, RUN } from "./ids";

interface RunSeed {
  id: string;
  workflow: WorkflowId;
  title: string;
  ref?: EntityRef;
  startedAt: ISODateTime;
  seconds: number;
  model: ModelTierName;
  sources?: number;
  searches?: number;
  fetches?: number;
  drafts?: number;
  tokens?: [input: number, output: number, cacheRead: number];
  costUsd: number;
  seen?: boolean;
}

function summary(c: Clock, r: RunSeed): RunSummary {
  const [inputTokens, outputTokens, cacheReadTokens] = r.tokens ?? [0, 0, 0];
  return {
    id: r.id,
    workflow: r.workflow,
    title: r.title,
    ref: r.ref,
    startedAt: r.startedAt,
    endedAt: c.plus(r.startedAt, r.seconds / 60),
    status: "done",
    receipt: {
      durationMs: r.seconds * 1000,
      sources: r.sources ?? 0,
      searches: r.searches ?? 0,
      fetches: r.fetches ?? 0,
      drafts: r.drafts ?? 0,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      costUsd: r.costUsd,
      model: r.model,
    },
    seen: r.seen ?? true,
  };
}

/** Recent runs, newest first. Each one ends with the receipt the founder saw. */
export function runs(c: Clock): RunSummary[] {
  const seeds: RunSeed[] = [
    { id: RUN.brief, workflow: "brief", title: "Today's brief", startedAt: c.ago(7), seconds: 38, model: "fast", sources: 6, tokens: [9_800, 640, 7_200], costUsd: 0.011 },
    { id: RUN.prep, workflow: "prep", title: "Prep: Lumenwire mid-pilot check-in", ref: { kind: "meeting", id: MEETING.lumenwireToday }, startedAt: c.ago(6), seconds: 84, model: "operator", sources: 7, searches: 2, fetches: 1, tokens: [28_400, 2_900, 18_200], costUsd: 0.072, seen: false },
    { id: RUN.composeFernwick, workflow: "compose", title: "Draft: Owen Park at Fernwick", ref: { kind: "draft", id: PACKAGE.fernwickCold }, startedAt: c.ago(5), seconds: 31, model: "operator", sources: 4, drafts: 1, tokens: [12_600, 1_100, 9_400], costUsd: 0.031, seen: false },
    { id: RUN.debrief, workflow: "debrief", title: "Debrief: Northwind follow-up", ref: { kind: "meeting", id: MEETING.northwindYesterday }, startedAt: c.at(-1, "11:51"), seconds: 47, model: "operator", tokens: [14_200, 3_100, 8_800], costUsd: 0.054 },
    { id: RUN.dossierFernwick, workflow: "dossier", title: "Dossier: Fernwick", ref: { kind: "account", id: DOMAIN.fernwick }, startedAt: c.at(-1, "16:39"), seconds: 112, model: "operator", sources: 9, searches: 3, fetches: 4, tokens: [41_000, 3_600, 22_000], costUsd: 0.118 },
    { id: RUN.enrich, workflow: "enrich", title: "Free signals for 13 companies", startedAt: c.at(-1, "07:56"), seconds: 130, model: "none", sources: 31, costUsd: 0 },
    { id: RUN.discovery, workflow: "discovery", title: "Finding companies: usage-priced APIs", startedAt: c.at(-2, "09:14"), seconds: 221, model: "operator", sources: 22, searches: 5, fetches: 3, tokens: [52_000, 4_800, 30_000], costUsd: 0.214 },
    { id: RUN.dossierNorthwind, workflow: "dossier", title: "Dossier: Northwind Metrics", ref: { kind: "account", id: DOMAIN.northwind }, startedAt: c.at(-2, "16:19"), seconds: 98, model: "operator", sources: 8, searches: 2, fetches: 4, tokens: [38_500, 3_400, 21_000], costUsd: 0.104 },
    { id: RUN.dossierDriftglass, workflow: "dossier", title: "Dossier: Driftglass", ref: { kind: "account", id: DOMAIN.driftglass }, startedAt: c.at(-4, "10:04"), seconds: 91, model: "operator", sources: 6, searches: 3, fetches: 2, tokens: [35_900, 3_100, 20_400], costUsd: 0.097 },
    { id: RUN.composeDriftglass, workflow: "compose", title: "Draft: Mei Tanaka at Driftglass", ref: { kind: "draft", id: PACKAGE.driftglassCold }, startedAt: c.at(-4, "10:12"), seconds: 29, model: "operator", sources: 3, drafts: 1, tokens: [11_900, 1_000, 9_100], costUsd: 0.028 },
    { id: RUN.network, workflow: "network", title: "Screening your network", startedAt: c.at(-5, "18:30"), seconds: 41, model: "fast", tokens: [18_000, 2_400, 0], costUsd: 0.019 },
    { id: RUN.review, workflow: "review", title: "Weekly pipeline review", ref: { kind: "playbook", id: "review:monday" }, startedAt: c.at(-8, "08:40"), seconds: 76, model: "operator", tokens: [24_000, 2_600, 14_000], costUsd: 0.064 },
    { id: RUN.dinner, workflow: "dinner_plan", title: "Planning the New York dinner", ref: { kind: "event", id: EVENT.dinner }, startedAt: c.at(-9, "14:02"), seconds: 150, model: "operator", sources: 9, searches: 3, fetches: 2, tokens: [47_000, 6_900, 18_000], costUsd: 0.142 },
    { id: RUN.foundation, workflow: "foundation", title: "Building your playbook", ref: { kind: "playbook", id: "foundation" }, startedAt: c.at(-24, "10:00"), seconds: 252, model: "strategist", sources: 14, searches: 3, fetches: 9, tokens: [96_000, 11_400, 40_000], costUsd: 0.62 },
  ];
  return seeds.map((r) => summary(c, r));
}

export function usage(c: Clock): Record<string, UsageMonth> {
  const byWorkflow: UsageMonth["byWorkflow"] = {
    dossier: 1.31,
    discovery: 0.71,
    foundation: 0.62,
    compose: 0.46,
    prep: 0.38,
    debrief: 0.31,
    ask: 0.27,
    review: 0.21,
    brief: 0.19,
    asset: 0.16,
    dinner_plan: 0.14,
    network: 0.04,
  };
  const costUsd = Math.round(Object.values(byWorkflow).reduce((a, b) => a + (b ?? 0), 0) * 100) / 100;
  return { [monthKey(c.now)]: { costUsd, runs: 46, byWorkflow, freeSignals: 241 } };
}

/** Step logs for the runs the founder is most likely to open, so their work log replays. */
export function runSteps(c: Clock): Record<string, RunStep[]> {
  const log = (start: ISODateTime, rows: [number, RunStep["type"], string, string?][]): RunStep[] =>
    rows.map(([sec, type, text, url]) => ({ at: c.plus(start, sec / 60), type, text, ...(url ? { url, host: new URL(url).hostname } : {}) }));

  const r = Object.fromEntries(runs(c).map((x) => [x.id, x.startedAt]));
  return {
    [RUN.brief]: log(r[RUN.brief], [
      [0, "status", "Reading yesterday's activity and today's calendar"],
      [4, "action", "Ranked 9 open items by due date and deal stage"],
      [21, "writing", "Writing the three things that matter today"],
    ]),
    [RUN.prep]: log(r[RUN.prep], [
      [0, "status", "Reading the Lumenwire deal, pilot criteria and kickoff notes"],
      [6, "read", "lumenwire.example", "https://lumenwire.example/careers/revenue-systems-analyst"],
      [14, "search", "Lumenwire revenue systems analyst usage reconciliation"],
      [22, "search", "\"Ethan Brooks\" Lumenwire revenue accounting"],
      [31, "thinking", "The analyst posting could mean an internal build. Worth one direct question, not a landmine to avoid."],
      [52, "writing", "Writing the brief: agenda, six questions, two objections"],
    ]),
    [RUN.composeFernwick]: log(r[RUN.composeFernwick], [
      [0, "status", "Reading the Fernwick dossier and your POVs"],
      [5, "thinking", "Owen is the first controller; the analyst posting is the premise. Advice ask, no meeting request."],
      [18, "writing", "Drafting step 1 with the \"black box\" angle"],
      [27, "action", "Lint passed: 71 words, 1 question, no links"],
    ]),
    [RUN.dossierFernwick]: log(r[RUN.dossierFernwick], [
      [0, "status", "Reading fernwick.example"],
      [3, "read", "fernwick.example", "https://fernwick.example/"],
      [6, "read", "fernwick.example", "https://fernwick.example/blog/new-pricing"],
      [9, "read", "fernwick.example", "https://fernwick.example/careers/billing-analyst"],
      [13, "read", "fernwick.example", "https://fernwick.example/pricing/faq"],
      [24, "search", "Fernwick controller Owen Park"],
      [37, "search", "Fernwick Series A"],
      [49, "search", "Fernwick per-trace pricing"],
      [58, "read", "saasdispatch.example", "https://saasdispatch.example/news/fernwick-series-a"],
      [71, "thinking", "Series A is 140 days old: context only. The analyst posting and Owen's arrival are the reasons to write."],
      [92, "writing", "Writing the dossier: 6 facts, 2 angles, 3 openers"],
    ]),
    [RUN.debrief]: log(r[RUN.debrief], [
      [0, "status", "Reading the call transcript (31 minutes, 2 speakers)"],
      [9, "action", "Pulled 8 verbatim quotes"],
      [21, "thinking", "Marcus named the budget source and Dana offered to walk him through terms. That's a tested champion."],
      [34, "writing", "Scoring the card: 10 of 12, dated next step. Suggesting Qualified."],
    ]),
  };
}
