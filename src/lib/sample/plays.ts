import type { Account, Evidence, Move, Person, Signal, Workspace } from "@/lib/domain/types";
import type { CustomPlay } from "@/lib/plays/recipe-types";
import { normalizeRecipe } from "@/lib/plays/recipes";
import { evidence, fitScore, tierFor, whyNowScore } from "./build";
import type { Clock } from "./clock";
import { CRITERION, DOMAIN, PERSON, RUN } from "./ids";

/**
 * The play Priya wrote on her Head of GTM's first afternoon: "RevOps or billing hire, no open deal". It found
 * Saltmarsh's billing-engineer posting the next day (that cold email became the discovery call), was edited
 * a week ago to catch revenue-accounting posts too, and today it fires on two companies nothing else covers:
 * B-tier prospects whose first RevOps and billing hires the built-in plays rank below the A accounts. Two of
 * its cards were skipped as "not relevant now" this week; one more and the play offers a longer cooldown.
 */

export const SAMPLE_PLAY = "cp_revops_hire";
const TALLYHOOK = "tallyhook.example";
const MOSSBANK = "mossbank.example";
const IRIS = "per_iris_navarro";
const KENJI = "per_kenji_watanabe";

function jobPost(c: Clock, id: string, domain: string, e: { claim: string; quote: string; path: string; days: number }): Evidence {
  return evidence(id, { claim: e.claim, quote: e.quote, url: `https://${domain}${e.path}`, sourceType: "job_post", publishedAt: c.d(-e.days), retrievedAt: c.at(-2, "09:17"), runId: RUN.discovery });
}

function signal(ev: Evidence, id: string, type: Signal["type"], headline: string, implication: string): Signal {
  return { id, type, headline, date: ev.publishedAt!, url: ev.url, host: ev.host, evidenceId: ev.id, strength: 3, usableInOutreach: true, implication };
}

type Met = Account["criteria"][number]["met"];
const met = (usage: Met, size: Met, warehouse: Met, funded: Met, finance: Met, pricingChange: Met): Account["criteria"] =>
  (
    [
      [CRITERION.usage, usage],
      [CRITERION.size, size],
      [CRITERION.warehouse, warehouse],
      [CRITERION.funded, funded],
      [CRITERION.finance, finance],
      [CRITERION.pricingChange, pricingChange],
    ] as const
  ).map(([criterionId, m]) => ({ criterionId, met: m }));

function person(id: string, accountDomain: string, name: string, title: string, role: Person["role"], evidenceId: string): Person {
  return { id, accountDomain, name, title, role, evidenceIds: [evidenceId], confidence: "medium", mayHaveLeft: false, contactPaths: [], jurisdiction: "US", doNotContact: false, source: "ats_search" };
}

/** The recipe as it ran from day one, and as it runs now. */
const V1 = normalizeRecipe({
  name: "RevOps or billing hire, no open deal",
  trigger: { signals: ["jd_names_pain", "first_hire"], withinDays: 45, keywords: ["revops", "revenue operations", "billing"] },
  audience: { tiers: ["A", "B"], deal: "none", personas: ["champion", "economic_buyer"], criteria: [CRITERION.usage] },
  guardrails: { cooldownDays: 30, maxPerWeek: 5 },
  action: { kind: "write", angle: "Reference the role they posted and the usage reconciliation it will inherit." },
  measure: "meeting",
});
const V2 = normalizeRecipe({ ...V1, trigger: { ...V1.trigger, signals: ["jd_names_pain", "first_hire", "hiring"], keywords: [...V1.trigger.keywords, "revenue", "reconcil"] } });

/** Adds the play, its two new prospects and its history to the assembled sample. */
export function addSamplePlays(ws: Workspace, c: Clock): void {
  const criteria = ws.foundation?.icp.criteria ?? [];
  const thJob = jobPost(c, "ev_th_jd", TALLYHOOK, {
    claim: "Tallyhook's first RevOps Lead will own usage billing and quote-to-cash.",
    quote: "As our first RevOps hire, you will own usage billing and quote-to-cash, from metering exports to the invoice run.",
    path: "/careers/revops-lead",
    days: 21,
  });
  const mbJob = jobPost(c, "ev_mb_jd", MOSSBANK, {
    claim: "Mossbank is hiring its first Billing Operations Manager to reconcile usage exports with invoices.",
    quote: "Our first Billing Operations Manager will reconcile usage exports with invoices every month and own billing disputes.",
    path: "/jobs/billing-operations-manager",
    days: 26,
  });
  ws.evidence[thJob.id] = thJob;
  ws.evidence[mbJob.id] = mbJob;

  const seeds: Omit<Account, "fitScore" | "tier" | "whyNowScore">[] = [
    {
      domain: TALLYHOOK,
      name: "Tallyhook",
      oneLiner: "Payments API for vertical SaaS, billed per transaction.",
      status: "new",
      source: "ats_search",
      sourceDetail: "RevOps Lead posting",
      addedAt: c.at(-3, "09:20"),
      criteria: met("true", "true", "unknown", "true", "unknown", "unknown"),
      signals: [signal(thJob, "sig_th_jd", "jd_names_pain", "First RevOps hire to “own usage billing and quote-to-cash”", "Billing has outgrown whoever runs it today; the new lead will pick the tools.")],
      whyNow: "Hiring a first RevOps lead to own usage billing, with no finance owner named yet.",
      enrichment: {
        crawledAt: c.at(-1, "07:58"),
        title: "Tallyhook: payments for vertical SaaS",
        description: "Embedded payments for vertical software. Priced per transaction.",
        tech: ["Go", "PostgreSQL", "Kafka"],
        socials: { linkedin: "https://linkedin.example/company/tallyhook" },
        jobBoard: { provider: "greenhouse", token: "tallyhook" },
        openRoles: 5,
        rolesByTeam: [
          { team: "Revenue Operations", count: 1, titles: ["RevOps Lead"] },
          { team: "Engineering", count: 4, titles: ["Payments Engineer", "Senior Backend Engineer"] },
        ],
        news: [],
      },
      peopleIds: [IRIS],
      warmPathCount: 0,
      watch: false,
      hqCity: "Chicago, IL",
    },
    {
      domain: MOSSBANK,
      name: "Mossbank",
      oneLiner: "Managed ELT pipelines, priced per GB processed.",
      status: "tracked",
      source: "hn_hiring",
      sourceDetail: "HN Who's Hiring",
      addedAt: c.at(-9, "08:30"),
      criteria: met("true", "true", "true", "unknown", "true", "unknown"),
      signals: [signal(mbJob, "sig_mb_jd", "first_hire", "First Billing Operations Manager to “reconcile usage exports with invoices”", "The usage tie-out is about to get an owner, and owners pick tools early.")],
      whyNow: "Its first billing operations hire will reconcile usage exports with invoices.",
      enrichment: {
        crawledAt: c.at(-1, "07:58"),
        title: "Mossbank: managed ELT pipelines",
        description: "Managed ELT pipelines. Pay per GB processed.",
        tech: ["Python", "Snowflake", "dbt", "Airflow"],
        socials: { linkedin: "https://linkedin.example/company/mossbank" },
        jobBoard: { provider: "ashby", token: "mossbank" },
        openRoles: 3,
        rolesByTeam: [
          { team: "Finance", count: 1, titles: ["Billing Operations Manager"] },
          { team: "Engineering", count: 2, titles: ["Data Engineer"] },
        ],
        news: [],
      },
      peopleIds: [KENJI],
      warmPathCount: 0,
      watch: true,
      hqCity: "Denver, CO",
    },
  ];
  for (const seed of seeds) {
    const fit = fitScore(criteria, seed.criteria);
    const whyNow = whyNowScore(seed.signals, c.today, null);
    ws.accounts[seed.domain] = { ...seed, fitScore: fit, whyNowScore: whyNow, tier: tierFor(fit, whyNow) };
  }
  ws.people[IRIS] = person(IRIS, TALLYHOOK, "Iris Navarro", "Head of Finance", "economic_buyer", thJob.id);
  ws.people[KENJI] = person(KENJI, MOSSBANK, "Kenji Watanabe", "Controller", "champion", mbJob.id);

  const v1At = c.at(-21, "16:42");
  const v2At = c.at(-7, "10:15");
  const play: CustomPlay = {
    id: SAMPLE_PLAY,
    createdAt: c.at(-21, "16:40"),
    sentence: "When a usage-priced company posts a RevOps or billing role and we have no open deal, write to the controller or the finance lead about the role.",
    origin: "sentence",
    versions: [
      { version: 1, recipe: V1, at: v1At, note: "First version", source: "compiled" },
      { version: 2, recipe: V2, at: v2At, note: "Added any job post and the words “revenue” and “reconcil”: two revenue accounting posts were missed", source: "edit" },
    ],
    history: [
      { version: 1, at: v1At },
      { version: 2, at: v2At },
    ],
    unsupported: [],
    assumptions: ["Read “the finance lead” as your economic buyer persona (CFO, VP Finance, Head of Finance)."],
    dismissed: [],
  };
  ws.customPlays = { ...ws.customPlays, [SAMPLE_PLAY]: play };
  // v1 put Saltmarsh's billing-engineer posting in front of Priya the morning she wrote to Leo.
  const worked = c.at(-20, "08:55");
  ws.plays = { ...ws.plays, [SAMPLE_PLAY]: { enabled: true, updatedAt: v2At, runs: [{ at: worked, domains: [DOMAIN.saltmarsh] }], worked: { [DOMAIN.saltmarsh]: { at: worked, version: 1 } } } };

  // Two cards from v2 skipped as "not relevant now" (the third such skip makes the play offer a longer cooldown).
  const skipped = (domain: string, signalId: string, personId: string, days: number, title: string, why: string, url: string): Move => {
    const id = `mv_play_${`${SAMPLE_PLAY}:${domain}:${signalId}`.replace(/[^a-z0-9_.-]/gi, "_")}`;
    return { id, createdAt: c.at(-days, "08:05"), dueOn: c.d(-days), kind: "first_touch", title, why, minutes: 4, ref: { kind: "person", id: personId }, evidenceIds: [], priority: 50, rule: "today.play", status: "skipped", skipReason: "not_relevant_now", playId: SAMPLE_PLAY, source: { url, date: ws.accounts[domain]?.signals.find((s) => s.id === signalId)?.date }, href: `/companies?c=${encodeURIComponent(domain)}` };
  };
  const ag = ws.accounts[DOMAIN.ashgrove]?.signals.find((s) => s.id === "sig_ag_jd");
  const cp = ws.accounts[DOMAIN.cinderpath]?.signals.find((s) => s.id === "sig_cp_jd");
  for (const m of [
    ag && skipped(DOMAIN.ashgrove, ag.id, PERSON.rafael, 6, "Write to Rafael at Ashgrove Telematics", `${V2.name} · ${ag.headline}`, ag.url),
    cp && skipped(DOMAIN.cinderpath, cp.id, PERSON.sam, 3, "Write to Sam at Cinderpath", `${V2.name} · ${cp.headline}`, cp.url),
  ]) {
    if (m) ws.moves[m.id] = m;
  }
}
