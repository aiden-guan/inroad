import type { Brief, Connection, RunStep, Workspace } from "@/lib/domain/types";
import { lintStep } from "@/lib/quality/context";
import { lintOption } from "@/lib/studio/receipts";
import { accountEvidence, accounts, GRACE_BACK_IN_DAYS, people } from "./accounts";
import { makeClock, timeLabel, upcomingToday, type Clock } from "./clock";
import {
  assets,
  CAPS,
  claims,
  companyEvidence,
  companySnapshot,
  connectors,
  founder,
  foundation,
  goalFor,
  HIRED_DAYS_AGO,
  objections,
  povs,
  sender,
  voice,
} from "./company";
import { connections, networkSummary } from "./connections";
import { events } from "./events";
import { intros } from "./intros";
import { DEAL, DOMAIN, MEETING, RUN } from "./ids";
import { activities, outreach } from "./outreach";
import { deals, meetings } from "./pipeline";
import { runs, runSteps, usage } from "./runs";
import { studio } from "./studio";

/**
 * Ledgerline: a fictional seed-stage startup that reconciles usage-billing data with invoices for finance
 * teams at usage-priced SaaS companies. Founder Priya Raman, ex-billing-infra engineer, three weeks after
 * hiring her Head of GTM. Every company is fictional and on the reserved `.example` TLD. Every date is
 * relative to `now`, so the sample always looks current.
 *
 * `moves` is left empty on purpose: Today computes them from this state.
 */
export function sampleWorkspace(now = new Date()): Workspace {
  return withLint(assemble(now));
}

/** Lints every draft exactly as the composer (and Studio) does, against the finished workspace. */
function withLint(ws: Workspace): Workspace {
  for (const piece of Object.values(ws.studio.pieces)) {
    for (const option of piece.options) option.lint = lintOption(ws, piece, option);
  }
  for (const pkg of Object.values(ws.outreach)) {
    for (const step of pkg.steps) {
      try {
        step.lint = lintStep(ws, pkg, step);
      } catch {
        // Keep the plain counts if the composer's lint can't run; the sample still loads.
      }
    }
  }
  return ws;
}

function assemble(now: Date): Workspace {
  const c = makeClock(now);
  const goal = goalFor(c);
  const f = foundation(c, goal, CAPS);
  const evidenceList = [...companyEvidence(c), ...accountEvidence(c)];
  const claimList = claims(c);
  const povList = povs(c);
  const peopleById = people(c);
  const accountsByDomain = accounts(c, f.icp.criteria, evidenceList);

  return {
    schemaVersion: 1,
    rev: 0,
    createdAt: c.at(-HIRED_DAYS_AGO, "09:58"),
    sample: true,
    onboarding: { status: "hired", hiredAt: c.at(-HIRED_DAYS_AGO, "10:07"), runId: RUN.foundation },
    founder: founder(),
    company: companySnapshot(),
    foundation: f,
    claims: claimList,
    objections: objections(c),
    povs: povList,
    assets: assets(c),
    studio: studio(c),
    network: networkSummary(c, connections(c)),
    voice: voice(c),
    sender: sender(c),
    goal,
    caps: CAPS,
    connectors: connectors(c),
    intros: intros(c),
    evidence: Object.fromEntries(evidenceList.map((e) => [e.id, e])),
    accounts: accountsByDomain,
    people: peopleById,
    deals: deals(c),
    meetings: meetings(c),
    outreach: outreach(c),
    activities: activities(c),
    moves: {},
    briefs: { [c.today]: brief(c) },
    events: events(c),
    integrations: {},
    webhooks: [],
    suppression: [
      { id: "sup_meterbook", domain: "meterbook.example", reason: "competitor", at: c.at(-HIRED_DAYS_AGO, "10:07") },
      { id: "sup_closewise", domain: "closewise.example", reason: "competitor", at: c.at(-HIRED_DAYS_AGO, "10:07") },
    ],
    runs: runs(c),
    usage: usage(c),
  };
}

function brief(c: Clock): Brief {
  const hour = c.now.getHours();
  const greeting = hour < 12 ? "Good morning, Priya." : hour < 17 ? "Good afternoon, Priya." : "Good evening, Priya.";
  return {
    date: c.today,
    kind: "daily",
    greeting,
    matters: [
      {
        text: `Lumenwire check-in at ${timeLabel(upcomingToday(c))}. Grace is out until ${c.weekday(GRACE_BACK_IN_DAYS)}, so book the ROI review with her before you hang up.`,
        ref: { kind: "meeting", id: MEETING.lumenwireToday },
      },
      {
        text: `Rowanstack's redlines were due ${c.label(-2)}. A one-line note to Nadia keeps the proposal from going quiet.`,
        ref: { kind: "deal", id: DEAL.rowanstack },
      },
      {
        text: "Lena Fischer, who ran billing infrastructure with you at Tollgate, now runs billing ops at Glassmoor. That's the warmest new path this week.",
        url: "https://linkedin.example/in/lena-fischer",
        ref: { kind: "account", id: DOMAIN.glassmoor },
      },
    ],
    generatedAt: c.ago(7),
    runId: RUN.brief,
  };
}

/** Rows for connections.json, matching `sampleWorkspace().network`. */
export function sampleConnections(now = new Date()): Connection[] {
  return connections(makeClock(now));
}

/** Step logs for runs.json, so the sample's recent runs replay in the work log. */
export function sampleRunSteps(now = new Date()): Record<string, RunStep[]> {
  return runSteps(makeClock(now));
}
