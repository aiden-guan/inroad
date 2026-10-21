import type {
  Asset,
  Caps,
  ChannelPlan,
  Claim,
  CompanySnapshot,
  Connector,
  Evidence,
  Foundation,
  Goal,
  ObjectionCard,
  PovItem,
  SenderIdentity,
  VoiceCard,
  Workspace,
} from "@/lib/domain/types";
import { evidence } from "./build";
import type { Clock } from "./clock";
import { ASSET, CLAIM, CONNECTOR, CRITERION, DOMAIN, PERSONA, POV, RUN, THEME } from "./ids";

/** The day Priya hired her Head of GTM. Everything else in the sample happens after it. */
export const HIRED_DAYS_AGO = 24;

export function companyEvidence(c: Clock): Evidence[] {
  const read = c.at(-HIRED_DAYS_AGO, "10:03");
  const site = (path: string) => `https://${DOMAIN.ledgerline}${path}`;
  return [
    evidence("ev_ll_home", {
      claim: "Ledgerline matches metered usage events to invoice lines for finance teams.",
      quote: "Ledgerline matches every metered usage event to the invoice line it ended up on, so finance can close the month without exporting usage into spreadsheets.",
      url: site("/"),
      sourceType: "first_party",
      retrievedAt: read,
      runId: RUN.foundation,
    }),
    evidence("ev_ll_who", {
      claim: "Built for controllers and revenue accountants at usage-priced companies.",
      quote: "Built for controllers and revenue accountants at companies that bill on usage.",
      url: site("/"),
      sourceType: "first_party",
      retrievedAt: read,
      runId: RUN.foundation,
    }),
    evidence("ev_ll_alternatives", {
      claim: "The site positions against CSV exports, spreadsheets and one-off reconciliation scripts.",
      quote: "No more CSV exports, VLOOKUPs or a reconciliation script only one analyst understands.",
      url: site("/"),
      sourceType: "first_party",
      retrievedAt: read,
      runId: RUN.foundation,
    }),
    evidence("ev_ll_pricing", {
      claim: "Pricing is a paid 30-day pilot credited to an annual contract quoted on billed volume.",
      quote: "Start with a 30-day paid pilot, credited in full to your first annual contract. Annual plans are quoted on billed usage volume.",
      url: site("/pricing"),
      sourceType: "first_party",
      retrievedAt: read,
      runId: RUN.foundation,
    }),
    evidence("ev_ll_about", {
      claim: "Priya Raman built the metering-to-invoice pipeline at Tollgate for five years.",
      quote: "Priya Raman spent five years building the metering-to-invoice pipeline at Tollgate before starting Ledgerline.",
      url: site("/about"),
      sourceType: "first_party",
      retrievedAt: read,
      runId: RUN.foundation,
    }),
    evidence("ev_ll_design_partners", {
      claim: "Ledgerline is recruiting design partners who reconcile usage in spreadsheets.",
      quote: "We're working with a small group of design partners on their month-end close. Apply if you bill on usage and reconcile in spreadsheets today.",
      url: site("/design-partners"),
      sourceType: "first_party",
      retrievedAt: read,
      runId: RUN.foundation,
    }),
    evidence("ev_ll_security", {
      claim: "Ledgerline reads usage with read-only credentials; SOC 2 Type I audit in progress.",
      quote: "Ledgerline reads usage from your warehouse with read-only credentials and never writes to your billing system. SOC 2 Type I audit in progress.",
      url: site("/security"),
      sourceType: "first_party",
      retrievedAt: read,
      runId: RUN.foundation,
    }),
    evidence("ev_ll_catch_rate", {
      claim: "The homepage says Ledgerline catches 98% of billing mismatches before invoices go out.",
      quote: "Catch 98% of usage-to-invoice mismatches before the invoice run.",
      url: site("/"),
      sourceType: "first_party",
      retrievedAt: read,
      confidence: "low",
      runId: RUN.foundation,
    }),
    evidence("ev_ll_wrenfield_close", {
      claim: "Wrenfield's first close on Ledgerline: usage reconciliation in 6 hours, down from 4 days.",
      quote: "Ava's numbers from Wrenfield's first close with us: usage reconciliation took 6 hours, down from 4 days the month before. She's fine with us sharing it without the name.",
      url: site("/"),
      sourceType: "user_input",
      retrievedAt: c.at(-17, "09:20"),
    }),
  ];
}

export function companySnapshot(): CompanySnapshot {
  return {
    name: "Ledgerline",
    domain: DOMAIN.ledgerline,
    plainOneLiner: "Ledgerline matches usage data to invoices so finance teams close the month without spreadsheets.",
    whoItsFor: "Controllers and revenue accountants at B2B software companies that bill on usage.",
    howYouCharge: {
      model: "custom_quote",
      isPublic: false,
      summary: "Paid 30-day pilot credited to an annual contract; annual quoted on billed usage volume.",
    },
    proof: [
      { kind: "founder_credential", text: "Priya built the metering-to-invoice pipeline at Tollgate for five years.", evidenceId: "ev_ll_about" },
      { kind: "metric", text: "A design partner cut usage reconciliation from 4 days to 6 hours in their first close.", evidenceId: "ev_ll_wrenfield_close" },
    ],
    alternatives: [
      { name: "Spreadsheet exports and VLOOKUPs", kind: "status_quo" },
      { name: "In-house dbt or SQL scripts", kind: "in_house" },
      { name: "Another revenue accountant", kind: "hire" },
      { name: "Meterbook", kind: "competitor" },
      { name: "Closewise", kind: "competitor" },
    ],
    stage: "design_partners",
    messagingIssues: [
      {
        issue: "The headline names the mechanism, not the outcome a controller wants.",
        quote: "Event-level usage matching for modern billing stacks.",
        fix: "Lead with the close: \"Close usage-billed revenue in hours, not days.\"",
      },
      {
        issue: "An unproven number on the homepage.",
        quote: "Catch 98% of usage-to-invoice mismatches before the invoice run.",
        fix: "Replace it with the design partner's 4 days to 6 hours, or remove it until a customer confirms it.",
      },
    ],
    coverage: "good",
    tech: ["Next.js", "PostgreSQL", "Python"],
    chips: [
      { key: "what", label: "What you do", text: "Matches metered usage to invoice lines so finance can close without spreadsheets", evidenceIds: ["ev_ll_home"], confidence: "high" },
      { key: "who", label: "Who it's for", text: "Controllers and revenue accountants at usage-priced B2B software companies", evidenceIds: ["ev_ll_who"], confidence: "high" },
      { key: "pricing", label: "How you charge", text: "Paid 30-day pilot credited to annual; annual quoted on billed volume", evidenceIds: ["ev_ll_pricing"], confidence: "high" },
      { key: "proof", label: "Proof", text: "One paid design partner; you built Tollgate's metering-to-invoice pipeline", evidenceIds: ["ev_ll_about", "ev_ll_wrenfield_close"], confidence: "medium" },
      { key: "alternatives", label: "What buyers do instead", text: "Spreadsheet exports, in-house dbt scripts, billing-platform reports", evidenceIds: ["ev_ll_alternatives"], confidence: "medium" },
      { key: "stage", label: "Stage", text: "Design partners: applications open, first partner paid", evidenceIds: ["ev_ll_design_partners"], confidence: "high", corrected: true },
    ],
    founderNote: "We have one paid design partner and want five paid pilots in the next 12 weeks.",
  };
}

export function goalFor(c: Clock): Goal {
  return {
    target: 5,
    targetLabel: "paid pilots or design partners",
    byDate: c.d(12 * 7 - HIRED_DAYS_AGO),
    longArcCustomers: 20,
    winRate: 0.25,
    discoveryToQualified: 0.5,
    meetingRate: 0.04,
    conversationsPerWeek: 10,
  };
}

export const CAPS: Caps = { firstTouchesPerWeek: 25, firstTouchesPerDayMax: 20, contactsPerAccountPerWeek: 2, monthlyBudgetUsd: 40 };

/** The plan math, computed the way W1c does it: the goal is an output of capacity. */
function channelPlan(goal: Goal, caps: Caps): ChannelPlan {
  const weeks = 12;
  const qualifiedNeeded = Math.ceil(goal.target / goal.winRate);
  const discoveryCallsNeeded = Math.ceil(qualifiedNeeded / goal.discoveryToQualified);
  const coldContactsNeeded = Math.ceil(discoveryCallsNeeded / goal.meetingRate);
  const meetingsPerWeek = Math.round((discoveryCallsNeeded / weeks) * 10) / 10;
  const coldPerWeekIfAlone = Math.round(coldContactsNeeded / weeks);
  return {
    funnel: {
      qualifiedNeeded,
      discoveryCallsNeeded,
      coldContactsNeeded,
      perWeek: { conversations: goal.conversationsPerWeek, firstTouches: caps.firstTouchesPerWeek, introAsks: 4, meetings: meetingsPerWeek },
      warning: `Cold email alone would need ${coldContactsNeeded.toLocaleString("en-US")} first touches, ${coldPerWeekIfAlone} a week against your cap of ${caps.firstTouchesPerWeek}. The plan closes the gap with intros and rooms: ${caps.firstTouchesPerWeek} cold touches make about 1 meeting a week, 4 intro asks about 1.4, and one room a month about 1.`,
    },
    motions: [
      {
        motion: "warm_network",
        rank: 1,
        why: "Wrenfield started with someone who knew you and closed fastest. Two people in your network just moved to ICP companies.",
        weeklyTarget: "4 warm asks or DMs",
        firstActions: ["Message Lena Fischer about her move to Glassmoor", "Ask Ava Whitman for two controller intros", "Reply to Theo Grant's move to Hollowpine"],
      },
      {
        motion: "investor_intros",
        rank: 2,
        why: "Alder Street backs several usage-priced companies, and Claire has made two intros already. Targeted lists beat open asks.",
        weeklyTarget: "2 intro asks, each with a forwardable",
        firstActions: ["Send Claire the Ashgrove forwardable", "Send Rohan a list of 10 named targets"],
      },
      {
        motion: "signal_cold",
        rank: 3,
        why: "Job posts that name usage reconciliation produced your best cold replies; Lumenwire started that way. Send only with a dated signal and one of your POVs.",
        weeklyTarget: "Up to 25 first touches, max 2 people per company",
        firstActions: ["Approve the Fernwick draft", "Send the Driftglass follow-up"],
      },
      {
        motion: "exec_dinners",
        rank: 4,
        why: "The roundtable produced Northwind. Nine tracked companies are in New York and Alder Street will co-host a dinner.",
        weeklyTarget: "One room a month",
        firstActions: ["Book the venue for the New York dinner", "Send the second wave of invites with Claire"],
      },
      {
        motion: "communities",
        rank: 5,
        why: "Controllers ask how to close usage revenue in finance communities. Answer by hand, helpfully, with no pitch.",
        weeklyTarget: "2 helpful answers",
        firstActions: ["Answer one usage-close question in The Close Desk"],
      },
      {
        motion: "founder_content",
        rank: 6,
        why: "Your Tollgate years are the credential. Posts about late events make your name familiar before a cold email lands.",
        weeklyTarget: "2 posts",
        firstActions: ["Write up why the reconciliation script outlives the analyst"],
      },
    ],
  };
}

export function foundation(c: Clock, goal: Goal, caps: Caps): Foundation {
  return {
    version: 2,
    generatedAt: c.at(-HIRED_DAYS_AGO, "10:06"),
    confidence: "medium",
    positioning: {
      alternatives: [
        { name: "Spreadsheet exports and VLOOKUPs", kind: "status_quo", whyChosenToday: "Free, owned by the revenue accountant, and good enough while usage is small." },
        { name: "In-house dbt or SQL scripts", kind: "in_house", whyChosenToday: "The data team already models usage, so one more model looks cheaper than a vendor." },
        { name: "Another revenue accountant", kind: "hire", whyChosenToday: "Finance leaders know how to budget headcount; nobody has a line item for this." },
        { name: "Meterbook", kind: "competitor", whyChosenToday: "Teams re-platforming billing get its reconciliation report bundled in." },
        { name: "Closewise", kind: "competitor", whyChosenToday: "Controllers already run the close checklist there and want one tool for every reconciliation." },
      ],
      differentiators: [
        { capability: "Matches each raw usage event to the invoice line it landed on", vsAlternative: "Spreadsheets match monthly totals, so offsetting errors hide", status: "proven" },
        { capability: "Reads usage from the warehouse with read-only access; no billing migration", vsAlternative: "Meterbook reconciles only the usage that flows through Meterbook", status: "claimed" },
        { capability: "Explains each variance with its cause: late event, rating error or missing meter", vsAlternative: "Closewise flags a variance but stops at the total", status: "claimed" },
      ],
      valueThemes: [
        {
          id: THEME.close,
          theme: "Close in hours, not days",
          outcome: "The usage tie-out drops from days of exports to a same-day review.",
          proof: [{ text: "A design partner cut usage reconciliation from 4 days to 6 hours in their first close.", claimId: CLAIM.designPartner, evidenceId: "ev_ll_wrenfield_close" }],
          needsProof: false,
        },
        {
          id: THEME.leakage,
          theme: "Catch leakage before invoices go out",
          outcome: "Late, unrated and unbilled usage is flagged before the invoice run, not by a customer dispute.",
          proof: [],
          needsProof: true,
        },
        {
          id: THEME.audit,
          theme: "A trail your auditor will accept",
          outcome: "Every invoice line links back to the usage events behind it.",
          proof: [],
          needsProof: true,
        },
      ],
      bestFit: [
        "Bills on a usage metric that changes every month (GB, calls, minutes, GPU-seconds)",
        "Usage lives in a warehouse; invoices come from a separate billing system",
        "A controller owns the close and someone exports usage by hand",
        "Moving enterprise customers to committed-use or consumption contracts",
      ],
      category: {
        name: "Usage reconciliation for the month-end close",
        style: "big_fish_small_pond",
        why: "Controllers already buy close software. Owning the usage line inside the close is familiar enough to explain in one sentence and narrow enough to win.",
      },
    },
    icp: {
      hypothesis: {
        companyGroup: "Usage-priced B2B software companies with 50–300 people",
        role: "the controller",
        obstacle: "tying metered usage to invoices at month-end",
        cause: "usage lives in the warehouse while invoices come from a separate billing system",
        improvement: "usage reconciliation in hours instead of days, with every variance explained",
        sentence:
          "Usage-priced B2B software companies with 50–300 people, where the controller struggles to tie metered usage to invoices because usage lives in the warehouse and billing runs elsewhere; we cut usage reconciliation from days to hours.",
      },
      primarySegment: "Usage-priced infrastructure and API companies, Series A–C, 50–300 people",
      testSlices: ["AI inference and model APIs billed per token or GPU-second", "Companies moving enterprise customers to committed-use contracts"],
      criteria: [
        { id: CRITERION.usage, text: "Prices on a usage metric (GB, calls, minutes, seconds, rows)", kind: "firmographic", mustHave: true, detection: "site", status: "validated" },
        { id: CRITERION.size, text: "50–300 employees", kind: "firmographic", mustHave: true, detection: "site", status: "hypothesis" },
        { id: CRITERION.warehouse, text: "Usage is metered in their own pipeline or warehouse, separate from billing", kind: "technographic", mustHave: true, detection: "job_posts", status: "hypothesis" },
        { id: CRITERION.funded, text: "Raised a Series A–C in the last 24 months", kind: "firmographic", mustHave: false, detection: "form_d", status: "hypothesis" },
        { id: CRITERION.finance, text: "Has a controller or revenue accounting lead", kind: "situational", mustHave: false, detection: "job_posts", status: "hypothesis" },
        { id: CRITERION.pricingChange, text: "Changed pricing or added committed-use contracts in the last 6 months", kind: "situational", mustHave: false, detection: "press", status: "hypothesis" },
      ],
      antiIcp: [
        { text: "Seat-priced or flat-priced", reason: "There is no usage line to reconcile." },
        { text: "No one owns the close yet (founder does the books)", reason: "No owner for the problem means no buyer." },
        { text: "Not spending time or money on reconciliation today", reason: "Pain they don't pay for won't get a budget." },
        { text: "Requires SOC 2 Type II before a pilot", reason: "We can't pass that gate yet; Type I is in progress." },
        { text: "First-year contract under $2K", reason: "Too small for founder-led sales; self-serve later." },
      ],
      triggers: [
        { type: "jd_names_pain", windowDays: 60, implication: "The tie-out has outgrown the person doing it." },
        { type: "new_leader", windowDays: 90, implication: "New finance leaders audit the close in their first quarter." },
        { type: "funding", windowDays: 90, implication: "Money for enterprise contracts means more true-ups to reconcile." },
        { type: "launch", windowDays: 60, implication: "A new usage meter is a new line the old close never had." },
        { type: "champion_job_change", windowDays: 90, implication: "Someone who knows the problem now owns it somewhere new." },
        { type: "compliance_deadline", windowDays: 180, implication: "A first audit needs a trail from every invoice line to its usage." },
      ],
      segmentLockedAt: c.at(-HIRED_DAYS_AGO + 1, "09:12"),
    },
    personas: [
      {
        id: PERSONA.champion,
        role: "champion",
        titles: ["Controller", "Head of Revenue Accounting", "Revenue Accounting Manager", "Director of Billing Operations"],
        kpis: ["Days to close", "Unexplained revenue variance", "Audit adjustments"],
        pains: ["The usage export eats the first week of every close", "Variances booked as adjustments nobody can explain", "A reconciliation script only one analyst understands"],
        triggers: ["Moving customers to committed-use contracts", "First audit or a new audit firm", "Hiring a revenue accountant for usage"],
        objections: ["Our revenue accountant handles it in a spreadsheet", "We can't give a startup access to billing data"],
        wateringHoles: [
          { name: "The Close Desk", kind: "community", url: "https://closedesk.example" },
          { name: "Debits & Credits Weekly", kind: "newsletter", url: "https://debitsandcredits.example" },
        ],
        line: "Talk about the close: days lost to usage exports, variances nobody can explain, and the audit question you dread.",
      },
      {
        id: PERSONA.buyer,
        role: "economic_buyer",
        titles: ["CFO", "VP Finance", "Head of Finance"],
        kpis: ["Revenue leakage", "Forecast accuracy", "Audit readiness", "Finance headcount"],
        pains: ["Revenue billed late or never", "Hiring to keep up with a manual close", "Explaining usage revenue to auditors"],
        triggers: ["First 90 days in the role", "A raise tied to enterprise or consumption pricing", "Audit or IPO readiness work"],
        objections: ["Not a priority until after the audit", "We'd rather hire"],
        wateringHoles: [{ name: "Finance Leaders Roundtable", kind: "community", url: "https://financeleaders.example" }],
        line: "Talk money and risk: usage you billed late or never, and a close your auditor can trace.",
      },
      {
        id: PERSONA.technical,
        role: "technical_approver",
        titles: ["Head of Data", "Data Platform Lead", "Staff Data Engineer"],
        kpis: ["Pipeline reliability", "Ad-hoc requests from finance"],
        pains: ["Finance pulls the data team into every close", "Usage models drift from what billing actually rated"],
        triggers: ["Hiring analytics engineers for billing pipelines"],
        objections: ["We can build this in dbt", "Another vendor with warehouse access"],
        wateringHoles: [{ name: "Analytics Engineering Slack", kind: "community" }],
        line: "Talk effort and access: read-only, no pipeline changes, fewer close-week requests from finance.",
      },
    ],
    messaging: {
      oneLiner: "Ledgerline is usage reconciliation software that helps finance teams at usage-priced companies close the month in hours without exporting usage into spreadsheets.",
      themes: [
        { valueThemeId: THEME.close, headline: "Close usage revenue in hours, not days", vsAlternative: "Spreadsheet exports take the first week of every close" },
        { valueThemeId: THEME.leakage, headline: "Find unbilled usage before your customer finds the overbill", vsAlternative: "Billing-platform reports only see usage that reached billing" },
        { valueThemeId: THEME.audit, headline: "Every invoice line traces to its usage", vsAlternative: "Close software flags the variance but not the events behind it" },
      ],
      byPersona: [
        { personaId: PERSONA.champion, line: "Get the first week of the close back, and stop booking variances you can't explain." },
        { personaId: PERSONA.buyer, line: "Bill every unit you deliver, and hand the auditor a trail instead of a spreadsheet." },
        { personaId: PERSONA.technical, line: "Read-only access to the usage tables you already have. No pipeline changes, fewer finance tickets." },
      ],
      bySignal: [
        { signal: "jd_names_pain", implication: "A posting that names usage reconciliation means the tie-out has outgrown the person doing it." },
        { signal: "new_leader", implication: "A new finance leader usually audits the close in the first quarter; usage is the line they can't trace." },
        { signal: "funding", implication: "Money for enterprise or consumption contracts means more true-ups; the close breaks before billing does." },
        { signal: "launch", implication: "A move to usage pricing adds a meter the old close never had to reconcile." },
        { signal: "champion_job_change", implication: "Someone who ran usage billing before knows the problem and likely owns it now." },
        { signal: "compliance_deadline", implication: "A first audit means every usage-billed dollar needs a trail to the event behind it." },
      ],
      customerWords: [
        { phrase: "the usage export", source: "call" },
        { phrase: "an adjustment we couldn't explain", source: "call" },
        { phrase: "true-up", source: "call" },
        { phrase: "own usage-to-invoice reconciliation", source: "job_post" },
        { phrase: "tie out usage", source: "community" },
      ],
      bannedWords: ["AI-powered", "seamless", "leverage", "unlock", "solution", "single source of truth", "revolutionize"],
    },
    channelPlan: channelPlan(goal, caps),
    commercial: {
      structure: "paid_pilot",
      terms:
        "30-day paid pilot on one entity's usage, fee credited in full to the annual contract. Success metric and baseline in writing at kickoff; ROI review booked the same day. Then annual with a 60-day opt-out.",
      priceAnchor: "First annual contract $24K–60K for 50–300 people, about 10–20% of the close hours and leakage we remove. Pilot $5K–15K.",
      discountRule: "Discount only for something back: a case study, a reference call, a multi-year term or a signing date. Never for feedback.",
    },
    competitors: [
      {
        name: "Meterbook",
        domain: "meterbook.example",
        positioningQuote: "Usage billing that reconciles itself.",
        whenWeWin: "Usage lives in the warehouse and they're not re-platforming billing. Late events and manual true-ups never reach Meterbook.",
        whenWeLose: "They're migrating billing to Meterbook anyway and every meter will flow through it.",
        landmineQuestions: [
          "Does every usage event flow through your billing system, including ones that arrive after the invoice run?",
          "Who explains a variance when usage in the warehouse disagrees with what billing rated?",
        ],
      },
      {
        name: "Closewise",
        domain: "closewise.example",
        positioningQuote: "Every reconciliation, one close.",
        whenWeWin: "The controller needs the cause of a usage variance, not just its total.",
        whenWeLose: "The CFO wants one tool for every reconciliation and usage is a small share of revenue.",
        landmineQuestions: [
          "When the usage line doesn't tie, how do you find the events behind the difference?",
          "How long does the usage reconciliation step take inside your close checklist today?",
        ],
      },
    ],
    founderQuestions: [
      {
        id: "fq_why_yes",
        question: "Why did Wrenfield say yes, in their words?",
        whyItMatters: "The best-fit customer's reason is the ICP and the opening line.",
        affects: ["icp", "positioning"],
        answer: "Ava said the usage export took her first week of every close, and a customer had just disputed an overbilled invoice.",
        answeredAt: c.at(-HIRED_DAYS_AGO + 1, "09:05"),
      },
      {
        id: "fq_price",
        question: "What price have you quoted so far, and what happened?",
        whyItMatters: "Real quotes replace the starting price bands.",
        affects: ["pricing"],
        answer: "$36K annual to Lumenwire, accepted with the pilot fee credited. $48K to Rowanstack, waiting on redlines.",
        answeredAt: c.at(-8, "17:40"),
      },
      {
        id: "fq_network",
        question: "Who in your network has run finance at a usage-priced company?",
        whyItMatters: "One former controller as an advisor opens more doors than 100 cold emails.",
        affects: ["channel_plan"],
      },
      {
        id: "fq_sources",
        question: "Can you reconcile usage that only exists in billing exports, with no warehouse?",
        whyItMatters: "Decides whether warehouse-less companies stay in the ICP.",
        affects: ["icp"],
      },
      {
        id: "fq_soc2",
        question: "When will the SOC 2 Type I report be ready?",
        whyItMatters: "Two prospects asked; a date moves them out of the anti-ICP.",
        affects: ["icp", "pricing"],
      },
    ],
  };
}

export function claims(c: Clock): Claim[] {
  return [
    {
      id: CLAIM.credential,
      text: "Priya spent five years building the metering-to-invoice pipeline at Tollgate.",
      kind: "credential",
      evidenceIds: ["ev_ll_about"],
      approved: true,
      permission: "public",
      createdAt: c.at(-HIRED_DAYS_AGO, "10:06"),
    },
    {
      id: CLAIM.designPartner,
      text: "A design partner cut month-end usage reconciliation from 4 days to 6 hours in their first close.",
      kind: "metric",
      evidenceIds: ["ev_ll_wrenfield_close"],
      approved: true,
      permission: "anonymized_only",
      createdAt: c.at(-17, "09:22"),
    },
    {
      id: CLAIM.catchRate,
      text: "Catches 98% of usage-to-invoice mismatches before the invoice run.",
      kind: "capability",
      evidenceIds: ["ev_ll_catch_rate"],
      approved: false,
      permission: "public",
      createdAt: c.at(-HIRED_DAYS_AGO, "10:06"),
    },
  ];
}

export function objections(c: Clock): ObjectionCard[] {
  return [
    {
      id: "obj_spreadsheet",
      objection: "Our revenue accountant handles it in a spreadsheet.",
      category: "status_quo",
      underlyingConcern: "Switching looks like more work than the pain they can see today.",
      clarifyingQ: "How long did the usage tie-out take last close, and what happened to the variance you couldn't explain?",
      response:
        "Most teams start there. A spreadsheet matches totals, so errors that offset each other disappear and the rest gets booked as an adjustment. We match each usage event to its invoice line. Want to run last month's close through it and compare?",
      walkAwayIf: "They issue a few hundred invoices a month and the variance is immaterial.",
      approved: true,
      timesHeard: 4,
      lastHeard: c.d(-6),
    },
    {
      id: "obj_build",
      objection: "Our data team can build this in dbt.",
      category: "build",
      underlyingConcern: "They doubt it's hard enough to pay for, and the data team owns the warehouse.",
      clarifyingQ: "Who maintains it after the person who builds it moves on, and who explains a variance to the auditor?",
      response:
        "They can build the match. The hard part is late events, re-rated usage and credits that land after the invoice run, and keeping that logic in step with billing. Our first design partner had a dbt model; it matched the easy lines and none of the exceptions.",
      walkAwayIf: "A data engineer is dedicated to billing and their model already handles late and re-rated events.",
      approved: true,
      timesHeard: 3,
      lastHeard: c.d(-15),
    },
    {
      id: "obj_security",
      objection: "We can't send billing data to a seed-stage startup.",
      category: "security",
      underlyingConcern: "A security review they'd own, and blame if revenue data leaks.",
      clarifyingQ: "What does your security team need to see to approve a read-only warehouse connection?",
      response:
        "We read usage with read-only warehouse credentials and never write to billing. Our SOC 2 Type I audit is in progress. I can send the security posture and a data-flow diagram today.",
      walkAwayIf: "They require SOC 2 Type II before any pilot.",
      approved: false,
      timesHeard: 2,
      lastHeard: c.d(-1),
    },
    {
      id: "obj_meterbook",
      objection: "Meterbook says its reconciliation report covers this.",
      category: "competitor",
      underlyingConcern: "They don't want two tools if one might do.",
      clarifyingQ: "Does all of your usage flow through Meterbook today, including events that arrive after the invoice run?",
      response:
        "If every event is rated in Meterbook, their report may be enough. We're for the usage that never reaches it: late events, manual true-ups and meters that live only in the warehouse.",
      walkAwayIf: "They're fully migrated to Meterbook with no warehouse-only meters.",
      approved: false,
      timesHeard: 1,
      lastHeard: c.d(-9),
    },
  ];
}

export function povs(c: Clock): PovItem[] {
  return [
    {
      id: POV.blackBox,
      text: "The reconciliation script usually outlives the analyst who wrote it, and the next hire inherits a black box.",
      evidence: "From 30 calls with controllers at usage-priced companies this year",
      createdAt: c.at(-HIRED_DAYS_AGO + 1, "09:30"),
      uses: 3,
    },
    {
      id: POV.lateEvents,
      text: "Usage leakage is rarely a billing bug. It is an event that arrives after the invoice run, and nobody owns the gap.",
      evidence: "Five years running the metering-to-invoice pipeline at Tollgate",
      createdAt: c.at(-HIRED_DAYS_AGO + 1, "09:31"),
      uses: 2,
    },
    {
      id: POV.consumption,
      text: "Moving enterprise customers to committed-use contracts breaks the close before it breaks billing.",
      evidence: "Seen at 4 of the 6 companies we've talked to that made the switch",
      createdAt: c.at(-12, "18:05"),
      uses: 1,
    },
  ];
}

export function assets(c: Clock): Asset[] {
  const created = c.at(-20, "15:10");
  return [
    {
      id: ASSET.onePager,
      kind: "one_pager",
      title: "Ledgerline one-pager",
      approved: true,
      origin: "founder",
      createdAt: created,
      updatedAt: c.at(-6, "11:45"),
      body: `# Ledgerline
**Close usage-billed revenue in hours, not days.**

## The problem, in your words
> "The usage export takes the first week of every close, and we still book an adjustment we can't explain."

Usage lives in your warehouse. Invoices come out of your billing system. Every month someone exports both, matches totals in a spreadsheet and books the difference.

## What changes
- **Close in hours, not days.** A design partner cut month-end usage reconciliation from 4 days to 6 hours in their first close.
- **Catch leakage before invoices go out.** Late, unrated and unbilled usage is flagged before the invoice run. *In design-partner validation.*
- **A trail your auditor will accept.** Every invoice line links to the usage events behind it. *In design-partner validation.*

## How it works
1. **Connect read-only.** Ledgerline reads usage from your warehouse and invoices from your billing system. No pipeline changes.
2. **Match line by line.** Each usage event is matched to the invoice line it landed on, including credits and true-ups.
3. **Explain every variance.** Each mismatch comes with its cause and the events behind it, ready for the close review.

## What a pilot looks like
30 days on one entity's usage, paid, and credited in full to the annual contract. We agree the success metric and the baseline in writing at kickoff, and book the review with your finance lead the same day.

## Security
Read-only warehouse access; we never write to billing. SOC 2 Type I audit in progress. Full posture on request.

**Priya Raman**, Co-founder & CEO · priya@ledgerline.example`,
    },
    {
      id: ASSET.dpTerms,
      kind: "design_partner_terms",
      title: "Design partner terms",
      approved: true,
      origin: "founder",
      createdAt: created,
      updatedAt: created,
      body: `# Ledgerline design partner program

A design partner runs their real month-end close on Ledgerline while we build what they need. It is paid, time-boxed and ends in a decision.

## Terms
| | |
|---|---|
| **Length** | About 3 months (2–6), ending on a real close |
| **Fee** | 15% of the first-year contract value, paid upfront and credited to the annual contract |
| **Conversion** | Conversion date and annual price agreed in writing before kickoff |
| **Launch** | A named close where Ledgerline replaces the spreadsheet |

## What each side commits
**You name three people:**
- An executive sponsor (CFO or VP Finance) who attends kickoff and the conversion review
- A technical lead with read access to the usage tables
- A business lead (controller or revenue accounting) who runs the close

**We commit to:**
- A 60–90 minute kickoff to map your close, then a written recap within a day
- A 30-minute weekly standup: demo, feedback, open tasks on both sides, launch-date check
- Fixes for anything blocking your close within the week it's raised

## What we ask for in return
- Honest feedback in the weekly standup
- A reference call or case study if the close comes in on target, with your approval of every word

*Draft. Not legal advice. Have counsel review before signing.*`,
    },
    {
      id: ASSET.security,
      kind: "security",
      title: "Security posture",
      createdAt: created,
      updatedAt: c.at(-3, "16:30"),
      body: `# Ledgerline security posture

Founder-confirmed answers only. Anything marked **Ask us** isn't settled yet; we'll answer it directly.

| Area | Answer |
|---|---|
| SOC 2 Type I | Audit in progress, auditor engaged |
| SOC 2 Type II | Ask us |
| Data access | Read-only warehouse credentials scoped to usage tables; read-only billing API key |
| Writes to your systems | None. Ledgerline never writes to billing or the warehouse |
| Data retention | Match results and line references kept 13 months; raw usage rows are not stored |
| Hosting region | United States |
| EU hosting | Ask us |
| Encryption | TLS 1.2+ in transit, AES-256 at rest |
| SSO | Google sign-in today; SAML: Ask us |
| Subprocessors | List on request |
| Penetration test | Ask us |
| Incident notice | Within 72 hours of confirmation |

Questions: priya@ledgerline.example`,
    },
  ];
}

export function sender(c: Clock): SenderIdentity {
  return {
    name: "Priya Raman",
    title: "Co-founder & CEO",
    company: "Ledgerline",
    email: "priya@ledgerline.example",
    postalAddress: "450 Example Street, Suite 300, San Francisco, CA 94107",
    sendingDomain: DOMAIN.ledgerline,
    domainHealth: { spf: true, dkim: true, dmarc: "p=none", mx: "Google Workspace", checkedAt: c.at(-HIRED_DAYS_AGO, "10:04") },
  };
}

export function voice(c: Clock): VoiceCard {
  return {
    samples: [
      {
        kind: "email",
        text: "Ava, thanks for the time today. What I heard: the usage export takes your first week of close, and the dispute with your largest customer started there. Next step is a 60-minute kickoff Thursday with you and Jun. I'll send the data checklist tonight. Did I miss anything?\n\nPriya",
      },
      {
        kind: "email",
        text: "Hi Ethan, your revenue accounting team is hiring for usage reconciliation, and I spent five years on the other side of that problem at Tollgate. Before I build more, I'd like to understand how your close handles late usage. Would you give me 20 minutes of your view? Not a pitch.\n\nPriya",
      },
    ],
    summary: "Short sentences, contractions, lowercase subjects, one question per email, signs off \"Priya\". Never says \"leverage\", \"excited\" or \"touch base\".",
    signOff: "Priya",
    updatedAt: c.at(-20, "15:30"),
  };
}

export function connectors(c: Clock): Connector[] {
  return [
    {
      id: CONNECTOR.claire,
      name: "Claire Donovan",
      relationship: "investor",
      linkedinUrl: "https://linkedin.example/in/claire-donovan",
      email: "claire@alderstreet.example",
      company: "Alder Street Ventures",
      reach: ["Alder Street portfolio", "infra and API founders", "quayside.example"],
      notes: "Led the pre-seed. Prefers a forwardable note she can send unchanged.",
      lastAskedOn: c.d(-4),
      introsMade: 2,
      gives: [{ at: c.d(-20), what: "Sent her portfolio CEO our month-end close checklist" }],
    },
    {
      id: CONNECTOR.rohan,
      name: "Rohan Mehta",
      relationship: "angel",
      linkedinUrl: "https://linkedin.example/in/rohan-mehta",
      email: "rohan@mehta.example",
      reach: ["data infrastructure", "vector databases", "Rowanstack"],
      lastAskedOn: c.d(-19),
      introsMade: 1,
    },
    {
      id: CONNECTOR.ava,
      name: "Ava Whitman",
      relationship: "customer",
      linkedinUrl: "https://linkedin.example/in/ava-whitman",
      email: "ava@wrenfield.example",
      company: "Wrenfield",
      reach: ["controllers", "revenue accounting"],
      notes: "Design partner turned customer. Happy to take reference calls; ask at most monthly.",
      lastAskedOn: c.d(-6),
      introsMade: 1,
    },
    {
      id: CONNECTOR.ines,
      name: "Ines Duarte",
      relationship: "advisor",
      linkedinUrl: "https://linkedin.example/in/ines-duarte",
      email: "ines@duarte.example",
      reach: ["observability", "feature flags", "glassmoor.example"],
      notes: "Ex-VP Finance at a usage-priced infra company.",
      lastAskedOn: c.d(-6),
      introsMade: 0,
    },
  ];
}

export function founder(): Workspace["founder"] {
  return {
    name: "Priya Raman",
    title: "Co-founder & CEO",
    email: "priya@ledgerline.example",
    schedulingUrl: "https://cal.example/priya/20min",
    availability: "Tue–Thu 10–4 PT",
    linkedinPremium: false,
  };
}
