import { addDays } from "@/lib/domain/ids";
import type {
  Account,
  Activity,
  CompanySnapshot,
  ConsumerModel,
  Deal,
  Dossier,
  DraftStep,
  Foundation,
  GrowthWeek,
  LintResult,
  Meeting,
  Move,
  OutreachPackage,
  Partner,
  Person,
  Signal,
  Workspace,
} from "@/lib/domain/types";
import { emptyWorkspace } from "@/lib/store/workspace";

/**
 * Small builders for test workspaces. Every record gets the fields its type requires and nothing
 * more, so a test only spells out what it is about.
 */

/** Tuesday 20 Oct 2026, 09:30 local time (the suite runs in America/Los_Angeles, see vitest.config.mts). */
export const NOW = new Date(2026, 9, 20, 9, 30);
export const TODAY = "2026-10-20";

/** Local calendar date `n` days from TODAY. */
export const day = (n: number) => addDays(TODAY, n);

/** Local wall-clock time on the date `n` days from TODAY, as an ISO timestamp. */
export function at(n: number, hhmm = "10:00"): string {
  const [y, m, d] = day(n).split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  return new Date(y, m - 1, d, h, min).toISOString();
}

export function cleanLint(): LintResult {
  return { passed: true, violations: [], stats: { words: 0, fkGrade: 0, you: 0, iWe: 0, questionMarks: 0, links: 0 } };
}

export function makeWorkspace(patch: Partial<Workspace> = {}): Workspace {
  return { ...emptyWorkspace(), ...patch };
}

export function makeAccount(domain: string, patch: Partial<Account> = {}): Account {
  return {
    domain,
    name: domain.split(".")[0].replace(/^./, (c) => c.toUpperCase()),
    status: "tracked",
    source: "manual",
    addedAt: at(-30),
    fitScore: 80,
    tier: "A",
    criteria: [],
    signals: [],
    whyNow: null,
    whyNowScore: 0,
    peopleIds: [],
    warmPathCount: 0,
    watch: true,
    ...patch,
  };
}

export function makePerson(id: string, accountDomain: string, patch: Partial<Person> = {}): Person {
  return {
    id,
    accountDomain,
    name: `${id.replace(/^per_/, "").replace(/^./, (c) => c.toUpperCase())} Example`,
    title: "Controller",
    email: `${id.replace(/^per_/, "")}@${accountDomain}`,
    evidenceIds: [],
    confidence: "high",
    mayHaveLeft: false,
    contactPaths: [],
    jurisdiction: "US",
    doNotContact: false,
    ...patch,
  };
}

export function makeStep(step: number, patch: Partial<DraftStep> = {}): DraftStep {
  return {
    step,
    personalizedSpans: [],
    sendOn: TODAY,
    thread: step === 1 ? "new" : "reply",
    subject: step === 1 ? "usage tiers and close" : null,
    body: `Step ${step} body.`,
    frame: "4t",
    evidenceIds: [],
    claimIds: [],
    lint: cleanLint(),
    status: "draft",
    ...patch,
  };
}

export function makePackage(id: string, accountDomain: string, patch: Partial<OutreachPackage> = {}): OutreachPackage {
  return {
    id,
    mode: "cold",
    accountDomain,
    createdAt: at(-1),
    steps: [makeStep(1)],
    alternates: [],
    blockers: [],
    warnings: [],
    ...patch,
  };
}

export function makeDeal(id: string, accountDomain: string, patch: Partial<Deal> = {}): Deal {
  return {
    id,
    accountDomain,
    name: accountDomain,
    stage: "talking",
    stageHistory: [{ stage: "talking", at: at(-10) }],
    source: "signal_cold",
    contacts: [],
    meetingIds: [],
    createdAt: at(-10),
    updatedAt: at(-1),
    lastActivityAt: at(-1),
    ...patch,
  };
}

export function makeActivity(id: string, patch: Partial<Activity> = {}): Activity {
  return { id, at: at(-1), kind: "note", summary: id, ...patch };
}

export function makeMeeting(id: string, dealId: string, patch: Partial<Meeting> = {}): Meeting {
  return { id, dealId, title: "Call", startsAt: at(0, "14:00"), attendees: [], ...patch };
}

export function makeMove(id: string, patch: Partial<Move> = {}): Move {
  return {
    id,
    createdAt: at(0, "08:00"),
    dueOn: TODAY,
    kind: "question",
    title: id,
    why: "",
    minutes: 2,
    evidenceIds: [],
    priority: 35,
    rule: "today.question",
    status: "open",
    ...patch,
  };
}

export function makeSignal(id: string, patch: Partial<Signal> = {}): Signal {
  return {
    id,
    type: "first_hire",
    headline: "Hiring a founding finance engineer",
    date: day(-3),
    url: "https://jobs.ashbyhq.com/acme/1",
    host: "jobs.ashbyhq.com",
    strength: 2,
    usableInOutreach: true,
    implication: "Someone will own the reconciliation script.",
    ...patch,
  };
}

export function makeDossier(patch: Partial<Dossier> = {}): Dossier {
  return {
    generatedAt: at(-2),
    staleAfter: day(5),
    snapshot: { plainDescription: "Usage-priced API", stage: "Series A", jurisdiction: "US" },
    facts: [],
    committee: [{ role: "champion", likelyTitles: ["Controller"], personIds: [] }],
    painHypotheses: [],
    angles: [],
    discoveryOpeners: [],
    risks: [],
    unknowns: [],
    recommendation: { move: "cold_email", why: "Fresh hiring signal" },
    ...patch,
  };
}

/* ───────────────────────────── Consumer ───────────────────────────── */

export function makeCompany(patch: Partial<CompanySnapshot> = {}): CompanySnapshot {
  return {
    name: "Pacely",
    domain: "pacely.example",
    plainOneLiner: "A running coach app for beginners.",
    whoItsFor: "New runners training for a first 5K",
    howYouCharge: { model: "flat", isPublic: true, summary: "Free trial, then $9.99 a month" },
    proof: [],
    alternatives: [{ name: "Doing nothing", kind: "status_quo" }],
    stage: "early_revenue",
    messagingIssues: [],
    coverage: "good",
    chips: [],
    ...patch,
  };
}

/** The smallest playbook the consumer code reads: one segment with a watering hole, empty everything else. */
export function makeFoundation(patch: Partial<Foundation> = {}): Foundation {
  return {
    version: 1,
    generatedAt: at(-20),
    positioning: { alternatives: [], differentiators: [], valueThemes: [], bestFit: [], category: { name: "Running app", style: "head_to_head", why: "" } },
    icp: {
      hypothesis: { companyGroup: "New runners", role: "Someone training for a first 5K", obstacle: "quitting in week 3", cause: "plans are too hard", improvement: "a plan they finish", sentence: "New runners quit in week 3 because plans are too hard." },
      primarySegment: "First-5K runners",
      testSlices: [],
      criteria: [],
      antiIcp: [],
      triggers: [],
    },
    personas: [
      {
        id: "per_runner",
        role: "user",
        titles: ["new runners"],
        kpis: [],
        pains: [],
        triggers: [],
        objections: [],
        wateringHoles: [{ name: "r/C25K", kind: "community" }],
        line: "Talk about finishing, not speed.",
      },
    ],
    messaging: { oneLiner: "Pacely is the running app for first-5K runners.", themes: [], byPersona: [], bySignal: [], customerWords: [], bannedWords: [] },
    channelPlan: { funnel: { qualifiedNeeded: 0, discoveryCallsNeeded: 0, coldContactsNeeded: 0, perWeek: { conversations: 5, firstTouches: 5, introAsks: 0, meetings: 0 } }, motions: [] },
    commercial: { structure: "free_trial", terms: "", priceAnchor: "", discountRule: "" },
    competitors: [],
    founderQuestions: [],
    confidence: "low",
    ...patch,
  };
}

/** A hired consumer workspace (an app with a subscription by default). */
export function consumerWorkspace(patch: Partial<Workspace> = {}, model: ConsumerModel = "app"): Workspace {
  const base = makeWorkspace();
  return {
    ...base,
    onboarding: { status: "hired" },
    founder: { name: "Maya Chen" },
    company: makeCompany({ market: "consumer", consumerModel: model, marketSource: "founder" }),
    foundation: makeFoundation(),
    goal: { ...base.goal, metric: model === "dtc" ? "paying" : "active_users", target: 100, targetLabel: model === "dtc" ? "customers" : "weekly active users", userTalksPerWeek: 5 },
    ...patch,
  };
}

export function makeWeek(weekOf: string, patch: Partial<GrowthWeek> = {}): GrowthWeek {
  return { weekOf, signups: 50, source: "founder", loggedAt: at(0), ...patch };
}

export function makePartner(id: string, patch: Partial<Partner> = {}): Partner {
  return {
    id,
    kind: "creator",
    name: `${id.replace(/^ptn_/, "")} runs`,
    platform: "tiktok",
    handle: `@${id.replace(/^ptn_/, "")}`,
    fit: "Beginner runners, weekly training videos",
    source: "founder",
    stage: "shortlist",
    stageHistory: [{ stage: "shortlist", at: at(-10) }],
    createdAt: at(-10),
    updatedAt: at(-10),
    ...patch,
  };
}
