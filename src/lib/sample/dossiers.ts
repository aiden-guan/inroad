import type { Dossier } from "@/lib/domain/types";
import type { Clock } from "./clock";
import { CLAIM, PERSON, RUN, THEME } from "./ids";

/** Three full dossiers, each fact tied to evidence in accounts.ts. Fresh for 7 days from generation. */

export function northwindDossier(c: Clock): Dossier {
  return {
    generatedAt: c.at(-2, "16:22"),
    staleAfter: c.d(5),
    runId: RUN.dossierNorthwind,
    snapshot: {
      plainDescription: "Observability for Kubernetes teams, billed per GB of logs and metrics ingested.",
      descriptionEvidenceIds: ["ev_nw_pricing"],
      stage: "Series B",
      funding: {
        round: "Series B",
        amountUsd: 38_000_000,
        date: c.d(-58),
        useOfFunds: "Move enterprise customers to consumption contracts; open a European region",
        evidenceId: "ev_nw_fund",
      },
      headcount: { value: "About 150", method: "team_page" },
      hq: "New York, NY",
      jurisdiction: "US",
    },
    facts: [
      { text: "Prices per GB ingested, with committed-use discounts on annual plans.", evidenceIds: ["ev_nw_pricing"] },
      { text: `Launched committed-use plans with quarterly true-ups on ${c.label(-34)}.`, evidenceIds: ["ev_nw_commit"] },
      { text: "The Revenue Accountant posting says the hire will \"own usage-to-invoice reconciliation each month\".", evidenceIds: ["ev_nw_jd"] },
      { text: "Usage streams through Kafka into ClickHouse; billing analytics are modeled in dbt.", evidenceIds: ["ev_nw_jd_data"] },
      { text: `Marcus Lindqvist joined as VP Finance on ${c.label(-44)}.`, evidenceIds: ["ev_nw_vp"] },
      { text: "Raised $38M Series B; stated use is moving enterprise customers to consumption contracts.", evidenceIds: ["ev_nw_fund"] },
      { text: "Dana Okafor described a five-day usage tie-out that still ends in an unexplained adjustment.", evidenceIds: ["ev_nw_dana_roundtable"] },
    ],
    committee: [
      { role: "economic_buyer", likelyTitles: ["VP Finance", "CFO"], personIds: [PERSON.marcus] },
      { role: "champion", likelyTitles: ["Controller"], personIds: [PERSON.dana] },
      { role: "technical_approver", likelyTitles: ["Head of Data"], personIds: [PERSON.sofia] },
    ],
    painHypotheses: [
      {
        pain: "\"Own usage-to-invoice reconciliation\" is now a whole job, and it's done by hand in exports today.",
        valueThemeId: THEME.close,
        evidenceIds: ["ev_nw_jd", "ev_nw_dana_roundtable"],
        confidence: "high",
      },
      {
        pain: "Quarterly true-ups on committed-use plans add lines the monthly tie-out doesn't catch.",
        valueThemeId: THEME.leakage,
        evidenceIds: ["ev_nw_commit", "ev_nw_fund"],
        confidence: "medium",
      },
      {
        pain: "A new VP Finance will want a close the auditor can trace line by line.",
        valueThemeId: THEME.audit,
        evidenceIds: ["ev_nw_vp"],
        confidence: "medium",
      },
    ],
    angles: [
      {
        id: "ang_nw_consumption",
        title: "Consumption contracts break the close first",
        signal: "$38M Series B to move enterprise customers to consumption contracts, plus committed-use plans with quarterly true-ups.",
        interpretation: "Every committed-use contract adds a quarterly true-up line to reconcile against raw ingest.",
        pressure: "The first true-ups land on a close that already takes Dana five days.",
        pov: "Hiring a revenue accountant moves the spreadsheet to a new owner; the unexplained variance stays.",
        proof: { claimId: CLAIM.designPartner },
        ask: "Is reconciling true-ups part of the new revenue accountant's first 90 days?",
        evidenceIds: ["ev_nw_fund", "ev_nw_commit", "ev_nw_dana_roundtable"],
        bestFor: "economic_buyer",
        strength: 5,
      },
      {
        id: "ang_nw_hire",
        title: "The reconciliation hire inherits a black box",
        signal: "Revenue Accountant posting: \"own usage-to-invoice reconciliation each month\".",
        interpretation: "The tie-out is big enough to justify a hire, and it's manual.",
        pressure: "Whoever takes the role inherits Dana's spreadsheet and dbt models nobody in finance can read.",
        pov: "The reconciliation script usually outlives the analyst who wrote it, and the next hire inherits a black box.",
        proof: { credential: "Built Tollgate's metering-to-invoice pipeline for five years" },
        ask: "Is the new hire taking over Dana's process, or building a new one with Data?",
        evidenceIds: ["ev_nw_jd", "ev_nw_jd_data"],
        bestFor: "champion",
        strength: 4,
      },
    ],
    discoveryOpeners: [
      { q: "Walk me through last month's usage tie-out, from the export to the journal entry.", evidenceId: "ev_nw_dana_roundtable" },
      { q: "The posting says the revenue accountant will \"own usage-to-invoice reconciliation\". Is that taking over your spreadsheet, or something new?", evidenceId: "ev_nw_jd" },
      { q: "What changes in the close when the first committed-use contracts true up?", evidenceId: "ev_nw_commit" },
    ],
    risks: [
      "Sofia's team already models billing in dbt and may prefer to extend it.",
      "Marcus may fund the revenue accountant hire instead of a tool.",
      "Sofia is in Lisbon; EU data handling may come up in security review.",
    ],
    unknowns: ["Which billing system rates committed-use overages", "Audit firm and audit date", "Whether the finance tools budget covers a pilot this half"],
    recommendation: {
      move: "warm_intro",
      personId: PERSON.marcus,
      why: "Dana offered to walk Marcus through it. Let her forward the recap rather than emailing him cold.",
    },
  };
}

export function fernwickDossier(c: Clock): Dossier {
  return {
    generatedAt: c.at(-1, "16:42"),
    staleAfter: c.d(6),
    runId: RUN.dossierFernwick,
    snapshot: {
      plainDescription: "Evaluation and monitoring for LLM apps in production, priced per 1,000 traces.",
      descriptionEvidenceIds: ["ev_fw_pricing"],
      stage: "Series A",
      funding: { round: "Series A", amountUsd: 14_000_000, date: c.d(-140), evidenceId: "ev_fw_series_a" },
      headcount: { value: "About 70", method: "team_page" },
      hq: "New York, NY",
      jurisdiction: "US",
    },
    facts: [
      { text: `Moved from seat plans to pricing per 1,000 traces on ${c.label(-50)}, with overage billed monthly.`, evidenceIds: ["ev_fw_pricing"] },
      { text: `Owen Park joined as the first Controller on ${c.label(-36)}.`, evidenceIds: ["ev_fw_owen"] },
      { text: "The Billing Analyst posting asks the hire to \"reconcile metered trace usage to invoices every month\".", evidenceIds: ["ev_fw_jd"] },
      { text: "Owen publishes his own email for questions about invoices on the new plans.", evidenceIds: ["ev_fw_email"] },
      { text: "About 70 people, based in New York.", evidenceIds: ["ev_fw_team"] },
      { text: "Raised a $14M Series A. Older than 90 days, so it's context, not a reason to write.", evidenceIds: ["ev_fw_series_a"] },
    ],
    committee: [
      { role: "champion", likelyTitles: ["Controller"], personIds: [PERSON.owen] },
      { role: "economic_buyer", likelyTitles: ["CEO", "COO"], personIds: [] },
      { role: "technical_approver", likelyTitles: ["Head of Data Engineering", "Staff Engineer, Billing"], personIds: [] },
    ],
    painHypotheses: [
      {
        pain: "\"Reconcile metered trace usage to invoices every month\" is now a full role, done by hand.",
        valueThemeId: THEME.close,
        evidenceIds: ["ev_fw_jd"],
        confidence: "high",
      },
      {
        pain: "Per-trace overage billed monthly means traces that arrive late miss the invoice run.",
        valueThemeId: THEME.leakage,
        evidenceIds: ["ev_fw_pricing"],
        confidence: "medium",
      },
    ],
    angles: [
      {
        id: "ang_fw_black_box",
        title: "The analyst hire inherits a black box",
        signal: "Billing Analyst posting: reconcile metered trace usage to invoices every month.",
        interpretation: "The tie-out is manual and large enough to justify a hire, right after a pricing change.",
        pressure: "Owen is the first controller; whatever the analyst inherits becomes the close.",
        pov: "The reconciliation script usually outlives the analyst who wrote it, and the next hire inherits a black box.",
        proof: { claimId: CLAIM.credential },
        ask: "Is the analyst taking over a process you built, or starting one from scratch?",
        evidenceIds: ["ev_fw_jd", "ev_fw_owen"],
        bestFor: "champion",
        strength: 5,
      },
      {
        id: "ang_fw_late_traces",
        title: "Late traces fall between two invoices",
        signal: "Seat plans replaced by per-trace pricing with monthly overage.",
        interpretation: "Traces that arrive after the invoice run belong to neither month's invoice.",
        pressure: "Overage disputes land on the controller, not engineering.",
        pov: "Usage leakage is rarely a billing bug. It is an event that arrives after the invoice run, and nobody owns the gap.",
        proof: { claimId: CLAIM.credential },
        ask: "When a trace lands after the invoice run, which month does it bill in?",
        evidenceIds: ["ev_fw_pricing"],
        bestFor: "champion",
        strength: 3,
      },
    ],
    discoveryOpeners: [
      { q: "Walk me through last month's close for the trace overage line, from export to journal entry.", evidenceId: "ev_fw_pricing" },
      { q: "The billing analyst posting says \"investigate every variance before the books close\". How do variances get investigated today?", evidenceId: "ev_fw_jd" },
      { q: "Now that you're the first controller, who decides on finance tools: you or the CEO?", evidenceId: "ev_fw_owen" },
    ],
    risks: ["About 70 people; the CEO may still sign every purchase.", "Per-trace pricing is new, so invoice volume may still be small."],
    unknowns: ["Billing system in use", "Invoices per month", "Whether the billing analyst role is filled"],
    recommendation: {
      move: "cold_email",
      personId: PERSON.owen,
      why: "Owen publishes his own email for billing questions, and the analyst posting names the exact pain.",
    },
  };
}

export function driftglassDossier(c: Clock): Dossier {
  return {
    generatedAt: c.at(-4, "10:06"),
    staleAfter: c.d(3),
    runId: RUN.dossierDriftglass,
    snapshot: {
      plainDescription: "Serverless vector database, billed per query and per GB stored.",
      descriptionEvidenceIds: ["ev_dg_pricing"],
      stage: "Series A",
      funding: {
        round: "Series A",
        amountUsd: 22_000_000,
        date: c.d(-47),
        useOfFunds: "Build an enterprise tier on committed-use contracts",
        evidenceId: "ev_dg_fund",
      },
      headcount: { value: "About 110", method: "team_page" },
      hq: "New York, NY",
      jurisdiction: "US",
    },
    facts: [
      { text: `Moved every plan to usage pricing on ${c.label(-18)}: per query plus per GB stored.`, evidenceIds: ["ev_dg_pricing"] },
      { text: "Raised a $22M Series A to build an enterprise tier on committed-use contracts.", evidenceIds: ["ev_dg_fund"] },
      { text: "Mei Tanaka is Director of Finance; about 110 people in New York.", evidenceIds: ["ev_dg_team"] },
    ],
    committee: [
      { role: "champion", likelyTitles: ["Director of Finance", "Controller"], personIds: [PERSON.mei] },
      { role: "economic_buyer", likelyTitles: ["CFO", "CEO"], personIds: [] },
      { role: "technical_approver", likelyTitles: ["Head of Data", "Staff Engineer, Billing"], personIds: [] },
    ],
    painHypotheses: [
      {
        pain: "Two meters, queries and storage, land on one invoice and reconcile from two exports.",
        valueThemeId: THEME.close,
        evidenceIds: ["ev_dg_pricing"],
        confidence: "medium",
      },
      {
        pain: "Committed-use enterprise contracts will add true-ups the monthly usage export never sees.",
        valueThemeId: THEME.leakage,
        evidenceIds: ["ev_dg_fund"],
        confidence: "medium",
      },
    ],
    angles: [
      {
        id: "ang_dg_two_meters",
        title: "Two meters on one invoice",
        signal: "Moved every plan to per-query and per-GB pricing.",
        interpretation: "Two meters rated differently usually reconcile from two exports.",
        pressure: "Their first full close on usage pricing is weeks away.",
        pov: "Usage leakage is rarely a billing bug. It is an event that arrives after the invoice run, and nobody owns the gap.",
        proof: { claimId: CLAIM.designPartner },
        ask: "Do you reconcile the storage meter the same way as queries today?",
        evidenceIds: ["ev_dg_pricing"],
        bestFor: "champion",
        strength: 4,
      },
      {
        id: "ang_dg_true_ups",
        title: "Committed-use true-ups nobody owns",
        signal: "Series A to build an enterprise tier on committed-use contracts.",
        interpretation: "Each commitment adds a true-up line the usage export never sees.",
        pressure: "Finance finds the gap at quarter-end, after invoices went out.",
        pov: "Moving enterprise customers to committed-use contracts breaks the close before it breaks billing.",
        proof: null,
        ask: "Is anyone on your team owning true-ups yet, or does that land on you?",
        evidenceIds: ["ev_dg_fund"],
        bestFor: "champion",
        strength: 3,
      },
    ],
    discoveryOpeners: [
      { q: "Walk me through how the storage meter gets from usage to the invoice today.", evidenceId: "ev_dg_pricing" },
      { q: "The Series A note mentions committed-use contracts. Who will own the true-ups?", evidenceId: "ev_dg_fund" },
    ],
    risks: ["Usage pricing is new; the pain may not have hit a close yet.", "No public sign of where usage is metered."],
    unknowns: ["Whether usage lives in a warehouse or only in billing", "Who signs: CFO or CEO", "A verified email for Mei"],
    recommendation: {
      move: "cold_email",
      personId: PERSON.mei,
      why: "Two dated signals and a clear owner. Her address is a guess you've confirmed, so send one email, then LinkedIn.",
    },
  };
}
