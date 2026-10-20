import type { Deal, Debrief, Field, ID, Meeting, MeetingBrief, MutualActionPlan, Qualification, QualificationCard, Stage } from "@/lib/domain/types";
import { GRACE_BACK_IN_DAYS } from "./accounts";
import { upcomingToday, type Clock } from "./clock";
import { DEAL, DOMAIN, MEETING, PERSON } from "./ids";

/** Verbatim lines from yesterday's Northwind call (transcript), reused on the deal card. */
const Q = {
  nw1: "Usage tie-out took us five days last close, and we still booked a forty-thousand-dollar adjustment we couldn't explain.",
  nw2: "The first committed-use true-ups hit at quarter-end. I don't want to be explaining variances to the auditor after that.",
  nw3: "Honestly, the revenue accountant we're hiring is mostly to run that export.",
  nw4: "If it saves us that hire, I can approve it out of the finance tools budget.",
  nw5: "I'll walk Marcus through the pilot terms, and I'll pull Sofia in for the data access piece.",
  nw6: "Sofia owns the warehouse. She'll want read-only and no changes to her pipelines.",
  nw7: "Security review is usually two weeks with us, so send the questionnaire early.",
  nw8: "Can we get Sofia on a call early next week?",
};

/* ───────────── Small builders ───────────── */

const field = (value: string | null, quotes: string[], status: Field["status"]): Field => ({ value, quotes, status });

// The card's champion status matches Person.champion, so the board and the sheet agree.
type ChampionStatus = NonNullable<QualificationCard["champion"]["championStatus"]>;
const championField = (f: Field, name: string, championStatus: ChampionStatus): QualificationCard["champion"] => ({ ...f, name, championStatus });

function qualification(pain: 0 | 1 | 2, spend: 0 | 1 | 2, criticalEvent: 0 | 1 | 2, champion: 0 | 1 | 2, economicBuyer: 0 | 1 | 2, icpFit: 0 | 1 | 2, hasDatedNextStep: boolean): Qualification {
  const total = pain + spend + criticalEvent + champion + economicBuyer + icpFit;
  return { pain, spend, criticalEvent, champion, economicBuyer, icpFit, total, qualified: total >= 8 && hasDatedNextStep };
}

function history(c: Clock, ...steps: [Stage, number, string][]): Deal["stageHistory"] {
  return steps.map(([stage, n, hhmm]) => ({ stage, at: c.at(n, hhmm) }));
}

function map(c: Clock, targetIn: number, goal: string, rows: [string, MutualActionPlan["milestones"][number]["ownerSide"], string | undefined, number, MutualActionPlan["milestones"][number]["status"]][]): MutualActionPlan {
  return {
    targetDate: c.d(targetIn),
    goal,
    milestones: rows.map(([step, ownerSide, ownerName, due, status], i) => ({ id: `ms_${i + 1}`, step, ownerSide, ownerName, due: c.d(due), status })),
  };
}

/** Offsets the deals and meetings share, so copy that names a date agrees with the calendar. */
export function pipelineDates(c: Clock) {
  const deepDive = c.next([2, 3, 4], 4);
  const roiReview = Math.min(c.next([2, 3, 4], GRACE_BACK_IN_DAYS), 13);
  const slotA = c.next([2, 3, 4]);
  const slotB = c.next([2, 3, 4], slotA);
  return { deepDive, roiReview, slotA, slotB, pilotEnds: 14, trueUps: 72 };
}

/* ───────────── Deals ───────────── */

export function deals(c: Clock): Record<ID, Deal> {
  const t = pipelineDates(c);

  const northwindCard: QualificationCard = {
    pain: field("Usage tie-out takes five days each close and still ends in an adjustment nobody can explain.", [Q.nw1], "captured"),
    spend: field("Budgeting a revenue accountant hire mostly to run the usage export.", [Q.nw3], "partial"),
    criticalEvent: { ...field("First committed-use true-ups land at quarter-end, ahead of the audit.", [Q.nw2], "captured"), date: c.d(t.trueUps) },
    champion: championField(field("Dana will walk Marcus through pilot terms and bring in Sofia for data access.", [Q.nw5], "captured"), "Dana Okafor", "tested"),
    economicBuyer: { ...field("Marcus can approve from the finance tools budget if it replaces the hire.", [Q.nw4], "partial"), name: "Marcus Lindqvist" },
    fit: field("Usage-priced, warehouse-metered, about 150 people, controller-owned close.", [], "captured"),
    decisionProcess: field("Marcus approves; security review takes about two weeks; Sofia signs off on read-only access.", [Q.nw4, Q.nw6, Q.nw7], "captured"),
  };

  const lumenwireCard: QualificationCard = {
    pain: field("Usage tie-out took 5 days last close; 2.1% of billed revenue unexplained.", ["Ethan: five days on the usage tie-out, and two point one percent we can't explain."], "captured"),
    spend: field("A contractor rebuilds the reconciliation workbook every quarter.", ["Ethan: we pay a contractor every quarter to rebuild the workbook."], "captured"),
    criticalEvent: { ...field("Board wants variance under half a percent before the annual audit.", ["Grace: the board wants that under half a percent before the audit."], "partial"), date: c.d(48) },
    champion: championField(field("Ethan signed the success criteria and runs the pilot.", ["Ethan: I'll own the numbers and present them to Grace."], "captured"), "Ethan Brooks", "tested"),
    economicBuyer: { ...field("Grace Liu agreed the $36,000 annual if the criteria are met.", ["Grace: if it hits both numbers, $36,000 is fine."], "captured"), name: "Grace Liu" },
    fit: field("Usage-priced, warehouse-metered, revenue accounting team of four.", [], "captured"),
    decisionProcess: field("Grace signs; legal review is one week on their paper.", ["Grace: legal turns our paper around in a week."], "captured"),
  };

  const rowanstackCard: QualificationCard = {
    pain: field("Tom rebuilds the usage reconciliation spreadsheet every month; three days per close.", ["Tom: three days a month, and I rebuild the sheet every time."], "captured"),
    spend: field("Considering a second billing ops hire.", ["Nadia: the alternative is another headcount on Tom's team."], "captured"),
    criticalEvent: { ...field("First financial statement audit next year; auditors will ask for a usage trail.", ["Nadia: our auditors will ask how every usage invoice ties out."], "captured"), date: c.d(90) },
    champion: championField(field("Tom brought Nadia in and walked her through the demo himself.", ["Tom: I showed Nadia the variance view on Friday."], "captured"), "Tom Becker", "tested"),
    economicBuyer: { ...field("Nadia owns the budget and the decision.", ["Nadia: this is my budget and my call."], "captured"), name: "Nadia Haddad" },
    fit: field("Usage-priced and warehouse-metered; no recent pricing change.", [], "partial"),
    decisionProcess: field("Nadia signs after counsel reviews the order form; no procurement team.", ["Nadia: counsel reviews, then I sign. No procurement."], "captured"),
  };

  const saltmarshCard: QualificationCard = {
    pain: field("Month-end takes about a week; GPU-second usage is the slowest part.", ["(notes) Leo: month-end takes about a week, GPU-seconds are the slowest part."], "partial"),
    spend: field(null, [], "not_covered"),
    criticalEvent: { ...field(null, [], "not_covered") },
    champion: championField(field("Leo is friendly but couldn't say who signs.", ["(notes) Leo didn't know who would sign for a tool like this."], "partial"), "Leo Marchetti", "coach"),
    economicBuyer: { ...field(null, [], "not_covered") },
    fit: field("Usage-priced per GPU-second; metering in-house; controller owns the close.", [], "captured"),
    decisionProcess: field(null, [], "not_covered"),
  };

  const list: Deal[] = [
    {
      id: DEAL.northwind,
      accountDomain: DOMAIN.northwind,
      name: "Northwind Metrics",
      stage: "qualified",
      stageHistory: history(c, ["talking", -13, "10:05"], ["qualified", -1, "12:31"]),
      source: "event",
      nextStep: { what: "Technical deep-dive with Sofia Reyes on read-only warehouse access", date: c.d(t.deepDive), buyerAgreed: true },
      contacts: [
        { personId: PERSON.dana, role: "champion" },
        { personId: PERSON.marcus, role: "economic_buyer" },
        { personId: PERSON.sofia, role: "technical_approver" },
      ],
      qualification: qualification(2, 1, 2, 2, 1, 2, true),
      card: northwindCard,
      map: northwindMap(c),
      meetingIds: [MEETING.northwindDiscovery, MEETING.northwindYesterday, MEETING.northwindDeepDive],
      notes: "Came from the roundtable. No price quoted yet: quote after the deep-dive, inside Marcus's sign-off limit.",
      createdAt: c.at(-13, "10:05"),
      updatedAt: c.at(-1, "12:31"),
      lastActivityAt: c.ago(95),
    },
    {
      id: DEAL.lumenwire,
      accountDomain: DOMAIN.lumenwire,
      name: "Lumenwire",
      stage: "pilot",
      stageHistory: history(c, ["talking", -52, "15:00"], ["qualified", -38, "17:10"], ["pilot", -16, "11:30"]),
      source: "signal_cold",
      amountUsd: 36_000,
      closeDate: c.d(21),
      nextStep: { what: "Mid-pilot check-in with Ethan", date: c.today, buyerAgreed: true },
      contacts: [
        { personId: PERSON.ethan, role: "champion" },
        { personId: PERSON.grace, role: "economic_buyer" },
      ],
      qualification: qualification(2, 2, 1, 2, 2, 2, true),
      card: lumenwireCard,
      map: map(c, 21, "Annual contract signed before the pilot fee credit expires", [
        ["Pilot success criteria signed", "both", "Ethan Brooks", -17, "done"],
        ["Pilot kickoff; ROI review slot agreed", "both", "Priya Raman", -16, "done"],
        ["Read-only warehouse access granted", "buyer", "Ethan Brooks", -14, "done"],
        ["Mid-pilot check-in", "both", "Ethan Brooks", 0, "todo"],
        ["ROI review with Grace: criteria vs baseline", "both", "Grace Liu", t.roiReview, "todo"],
        ["Order form sent", "seller", "Priya Raman", t.roiReview + 1, "todo"],
        ["Order form signed", "buyer", "Grace Liu", 21, "todo"],
      ]),
      priceQuotes: [{ at: c.d(-30), amountUsd: 36_000, outcome: "accepted" }],
      pilot: {
        criteria: `By ${c.label(t.pilotEnds)}, using Ledgerline on all metered SMS and voice usage for the US entity, Lumenwire will move unexplained usage variance from 2.1% to under 0.3% of billed revenue and cut the usage tie-out from 5 days to 1, measured by Ethan Brooks on the next month-end close. If met, Lumenwire moves to the annual plan at $36,000 starting ${c.label(21)}.`,
        feeUsd: 7_500,
        paid: true,
        startedOn: c.d(-16),
        endsOn: c.d(t.pilotEnds),
      },
      meetingIds: [MEETING.lumenwireKickoff, MEETING.lumenwireToday],
      notes: "Pilot fee is credited to the annual. Grace signs; don't discuss conversion terms without her.",
      createdAt: c.at(-52, "15:00"),
      updatedAt: c.at(-1, "09:40"),
      lastActivityAt: c.at(-1, "09:40"),
    },
    {
      id: DEAL.rowanstack,
      accountDomain: DOMAIN.rowanstack,
      name: "Rowanstack",
      stage: "proposal",
      stageHistory: history(c, ["talking", -41, "13:00"], ["qualified", -27, "16:45"], ["proposal", -9, "12:15"]),
      source: "network",
      amountUsd: 48_000,
      closeDate: c.d(10),
      nextStep: { what: "Nadia sends redlines from counsel", date: c.d(-2), buyerAgreed: true },
      contacts: [
        { personId: PERSON.nadia, role: "economic_buyer" },
        { personId: PERSON.tom, role: "champion" },
      ],
      qualification: qualification(2, 2, 2, 2, 2, 1, true),
      card: rowanstackCard,
      map: map(c, 10, "Signed before Rowanstack's audit prep starts", [
        ["Proposal walkthrough with Nadia and Tom", "both", "Priya Raman", -9, "done"],
        ["Price agreed: $48,000 for a case study and signature date", "both", "Nadia Haddad", -9, "done"],
        ["Security questionnaire returned", "seller", "Priya Raman", -6, "done"],
        ["Redlines back from counsel", "buyer", "Nadia Haddad", -2, "todo"],
        ["Final order form", "seller", "Priya Raman", 5, "todo"],
        ["Order form signed", "buyer", "Nadia Haddad", 10, "todo"],
        ["Kickoff on the first close", "both", "Tom Becker", 14, "todo"],
      ]),
      priceQuotes: [
        { at: c.d(-20), amountUsd: 54_000, outcome: "pushback" },
        { at: c.d(-9), amountUsd: 48_000 },
      ],
      proposal: { body: rowanstackProposal(c), generatedAt: c.at(-10, "15:20") },
      meetingIds: [MEETING.rowanstackProposal],
      notes: "Dropped from $54K to $48K in exchange for a case study and a signature by the close date.",
      createdAt: c.at(-41, "13:00"),
      updatedAt: c.at(-3, "10:20"),
      lastActivityAt: c.at(-3, "10:20"),
    },
    {
      id: DEAL.saltmarsh,
      accountDomain: DOMAIN.saltmarsh,
      name: "Saltmarsh Compute",
      stage: "talking",
      stageHistory: history(c, ["talking", -17, "11:05"]),
      source: "signal_cold",
      contacts: [{ personId: PERSON.leo, role: "champion" }],
      qualification: qualification(1, 0, 0, 1, 0, 2, false),
      card: saltmarshCard,
      meetingIds: [MEETING.saltmarshDiscovery],
      notes: "Ended the first call with \"send me some info\". No next step booked.",
      createdAt: c.at(-17, "11:05"),
      updatedAt: c.at(-6, "14:20"),
      lastActivityAt: c.at(-6, "16:10"),
    },
    {
      id: DEAL.wrenfield,
      accountDomain: DOMAIN.wrenfield,
      name: "Wrenfield",
      stage: "won",
      stageHistory: history(c, ["talking", -75, "10:00"], ["qualified", -62, "14:00"], ["pilot", -48, "10:00"], ["won", -19, "16:30"]),
      source: "network",
      amountUsd: 30_000,
      closeDate: c.d(-19),
      contacts: [{ personId: PERSON.ava, role: "champion" }],
      qualification: qualification(2, 1, 2, 2, 2, 2, true),
      priceQuotes: [{ at: c.d(-50), amountUsd: 30_000, outcome: "accepted" }],
      pilot: {
        criteria: `By ${c.label(-19)}, using Ledgerline on all tracked-event usage, Wrenfield will cut the usage tie-out from 4 days to under 1, measured by Ava Whitman on the month-end close. If met, Wrenfield moves to the annual plan at $30,000.`,
        feeUsd: 6_000,
        paid: true,
        startedOn: c.d(-48),
        endsOn: c.d(-19),
      },
      meetingIds: [],
      notes: "First design partner. Paid $6,000 upfront, credited to the $30,000 annual. Ava agreed to reference calls.",
      createdAt: c.at(-75, "10:00"),
      updatedAt: c.at(-19, "16:30"),
      lastActivityAt: c.at(-14, "13:00"),
    },
    {
      id: DEAL.quillfeather,
      accountDomain: DOMAIN.quillfeather,
      name: "Quillfeather",
      stage: "lost",
      stageHistory: history(c, ["talking", -34, "09:30"], ["lost", -15, "17:00"]),
      source: "signal_cold",
      contacts: [{ personId: PERSON.ben, role: "technical_approver" }],
      qualification: qualification(1, 0, 0, 0, 0, 2, false),
      lossReason: "build",
      meetingIds: [MEETING.quillfeatherTechnical],
      notes: "Ben's team will extend their dbt models. Never reached finance; no controller yet. Revisit after their first audit.",
      createdAt: c.at(-34, "09:30"),
      updatedAt: c.at(-15, "17:00"),
      lastActivityAt: c.at(-15, "17:00"),
    },
  ];
  return Object.fromEntries(list.map((d) => [d.id, d]));
}

function northwindMap(c: Clock): MutualActionPlan {
  const t = pipelineDates(c);
  return map(c, 60, "Ledgerline live before Northwind's first committed-use true-ups", [
    ["Discovery recap confirmed", "both", "Dana Okafor", -1, "done"],
    ["Security questionnaire and data-flow diagram sent", "seller", "Priya Raman", 1, "todo"],
    ["Technical deep-dive: read-only warehouse access", "both", "Sofia Reyes", t.deepDive, "todo"],
    ["Security review complete", "buyer", "Marcus Lindqvist", 19, "todo"],
    ["Pilot success criteria and fee signed", "both", "Dana Okafor", 21, "todo"],
    ["Pilot kickoff; ROI review booked the same day", "both", "Dana Okafor", 24, "todo"],
    ["ROI review and conversion decision", "buyer", "Marcus Lindqvist", 54, "todo"],
    ["Order form signed", "buyer", "Marcus Lindqvist", 60, "todo"],
  ]);
}

function rowanstackProposal(c: Clock): string {
  return `# Rowanstack + Ledgerline: proposal

## Context
In Tom's words: "three days a month, and I rebuild the sheet every time." Rowanstack's first financial statement audit is next year, and Nadia expects the auditors to ask how every usage invoice ties out.

## Success criteria
By ${c.label(75)}, using Ledgerline on all row-sync usage, Rowanstack will cut the usage tie-out from 3 days to under 1 and give the auditor a line-level trail for every usage invoice, measured by Tom Becker on the first close after go-live.

## Scope
- All metered row-sync usage from the warehouse, matched to invoices from the billing system
- Variance explanations for every unmatched line
- Read-only access only; no changes to Rowanstack's pipelines

## Timeline
| Step | Date |
|---|---|
| Order form signed | ${c.label(10)} |
| Kickoff | ${c.label(14)} |
| First close on Ledgerline | ${c.label(45)} |
| Review against the success criteria | ${c.label(75)} |

## Fee
Annual plan: **$48,000**, billed annually, with a 60-day opt-out. Reduced from $54,000 in exchange for a published case study and a signature by ${c.label(10)}.

## Owners
- Rowanstack: Nadia Haddad (decision), Tom Becker (close owner)
- Ledgerline: Priya Raman

## Order form
| | |
|---|---|
| Parties | Rowanstack and Ledgerline |
| Term | 12 months from the start date, 60-day opt-out |
| Fee | $48,000 per year |
| Start date | ${c.label(14)} |
| Success criteria | As above |
| Agreed by (Rowanstack) | ______________________ |
| Agreed by (Ledgerline) | ______________________ |

*Draft. Not legal advice. Have counsel review before signing.*`;
}

/* ───────────── Meetings ───────────── */



function northwindDebrief(c: Clock): Debrief {
  const t = pipelineDates(c);
  const quotes = [
    { id: "q1", speaker: "Dana Okafor", text: Q.nw1 },
    { id: "q2", speaker: "Marcus Lindqvist", text: Q.nw2 },
    { id: "q3", speaker: "Dana Okafor", text: Q.nw3 },
    { id: "q4", speaker: "Marcus Lindqvist", text: Q.nw4 },
    { id: "q5", speaker: "Dana Okafor", text: Q.nw5 },
    { id: "q6", speaker: "Dana Okafor", text: Q.nw6 },
    { id: "q7", speaker: "Marcus Lindqvist", text: Q.nw7 },
    { id: "q8", speaker: "Dana Okafor", text: Q.nw8 },
  ];
  const deal = deals(c)[DEAL.northwind];
  return {
    source: "transcript",
    quotes,
    card: deal.card!,
    qualification: deal.qualification!,
    stageSuggestion: {
      to: "qualified",
      criteriaMet: ["Pain and impact captured", "Critical event with a date", "Champion identified and tested", "Score 10 of 12", "Dated next step agreed"],
      criteriaMissing: [],
    },
    nextStep: { what: "Technical deep-dive with Sofia Reyes on read-only warehouse access", date: c.d(t.deepDive), buyerAgreed: true },
    noNextStepWarning: false,
    recap: {
      subject: "Northwind + Ledgerline: recap and next steps",
      body: `Dana, Marcus, thanks for the time today.

What I heard:
- "${Q.nw1}"
- The first committed-use true-ups land at quarter-end, ahead of the audit.
- The revenue accountant you're hiring is mostly there to run the usage export.

What we agreed:
- Technical deep-dive with Sofia on ${c.weekday(t.deepDive)} ${c.label(t.deepDive)} at 10am ET, on read-only warehouse access.
- I'll send the security questionnaire answers and a data-flow diagram by ${c.label(1)}.

Open items:
- Dana: last month's usage export and invoice register (anonymized is fine) by ${c.label(4)}.
- Marcus: whether the finance tools budget covers a paid pilot this half.

Did I miss or misstate anything?`,
    },
    committeeUpdates: [{ name: "Sofia Reyes", title: "Head of Data", role: "technical_approver" }],
    map: northwindMap(c),
    pilotCriteria: `By ${c.label(54)}, using Ledgerline on usage for all committed-use customers, Northwind will cut the usage tie-out from 5 days to 1 and unexplained variance to under 0.5% of billed revenue, measured by Dana Okafor on the next month-end close. If met, Northwind moves to an annual plan at a price agreed before kickoff, starting ${c.label(60)}.`,
    tasks: [
      { what: "Send security questionnaire answers and a data-flow diagram", due: c.d(1), owner: "founder" },
      { what: "Share last month's usage export and invoice register", due: c.d(4), owner: "buyer" },
      { what: "Confirm Sofia for the deep-dive", due: c.d(2), owner: "buyer" },
    ],
    newObjections: ["Security review takes two weeks; they need the questionnaire early."],
    customerWords: ["the usage export", "an adjustment we couldn't explain", "true-ups"],
    referrals: [],
    toConfirm: ["Which billing system rates committed-use overages", "Whether the finance tools budget covers a pilot this half"],
    coaching: [
      "You asked 11 questions and talked about 45% of the time. Keep that range.",
      "Their dbt models came up in minute 38. Ask what they do today in the first 10 minutes.",
      "Next step booked on the call, with a date and an owner.",
    ],
    generatedAt: c.at(-1, "11:52"),
    appliedAt: c.at(-1, "12:31"),
  };
}

function saltmarshDebrief(c: Clock): Debrief {
  const t = pipelineDates(c);
  const deal = deals(c)[DEAL.saltmarsh];
  const slot = (n: number, time: string) => `${c.weekday(n)} ${c.label(n)} at ${time} PT`;
  return {
    source: "founder_notes",
    quotes: [
      { id: "n1", text: "Leo said month-end takes about a week, and GPU-second usage is the slowest part." },
      { id: "n2", text: "Reserved-capacity contracts started this quarter; he isn't sure how overage will be reconciled." },
      { id: "n3", text: "He didn't know who would sign for a tool like this. Maybe the CEO." },
      { id: "n4", text: "Ended with: send me some info and I'll take a look." },
    ],
    card: deal.card!,
    qualification: deal.qualification!,
    stageSuggestion: null,
    nextStep: null,
    noNextStepWarning: true,
    recap: {
      subject: "Saltmarsh + Ledgerline: recap and next steps",
      body: `Leo, thanks for the time today.

My understanding:
- Month-end takes about a week, and GPU-second usage is the slowest part.
- Reserved-capacity contracts started this quarter, and overage reconciliation isn't settled yet.

You asked for more information. The quickest way to see if this fits is 30 minutes on last month's GPU-second tie-out with whoever owns the budget.

Did I miss or misstate anything?`,
    },
    schedulingEmail: {
      subject: "gpu-second close",
      body: `Leo, would ${slot(t.slotA, "11am")} or ${slot(t.slotB, "2pm")} work for 30 minutes? I'd like to walk through last month's GPU-second tie-out with you and whoever signs for finance tools.`,
    },
    committeeUpdates: [],
    tasks: [{ what: "Send the scheduling email with two times", due: c.d(-5), owner: "founder" }],
    newObjections: [],
    customerWords: ["GPU-seconds are the slowest part"],
    referrals: [],
    toConfirm: ["Whether Saltmarsh's usage lives in a warehouse or only in billing", "Who signs for finance tools"],
    coaching: [
      "This call has no dated next step. Treat it as a soft no until one is booked.",
      "Budget and decision process never came up. Ask who signs before the call ends.",
      "\"Send me some info\" is a polite exit. Answer with one question and two times.",
    ],
    generatedAt: c.at(-6, "14:10"),
    appliedAt: c.at(-6, "14:20"),
  };
}

function lumenwireBrief(c: Clock): MeetingBrief {
  const t = pipelineDates(c);
  return {
    callType: "pilot_review",
    fiveMinuteSummary: `Day 16 of Lumenwire's 30-day paid pilot ($7,500, credited to a $36,000 annual). The criteria: unexplained usage variance under 0.3% of billed revenue and a one-day tie-out, measured by Ethan on the next close. Grace, the economic buyer, is out until ${c.weekday(GRACE_BACK_IN_DAYS)}, so today is a working check-in, not the decision. Leave with the ROI review on Grace's calendar.`,
    oneThingToLearn: "Will variance land under 0.3% by the close, and if not, what's in the way?",
    whatsNew: [
      { text: "Lumenwire posted a Revenue Systems Analyst role that mentions \"usage reconciliation tooling\".", url: "https://lumenwire.example/careers/revenue-systems-analyst", date: c.d(-10) },
      { text: `Grace Liu's auto-reply: out of office until ${c.weekday(GRACE_BACK_IN_DAYS)}.`, date: c.d(-1) },
    ],
    attendees: [
      {
        name: "Ethan Brooks",
        title: "Head of Revenue Accounting",
        background: ["Signed the pilot success criteria and owns the numbers", "Ran last close on spreadsheets: 5 days for the usage tie-out", "Came in through your cold email about their revenue accounting posting"],
        likelyWants: "Numbers that hold up when he presents them to Grace.",
      },
    ],
    goals: ["Check both success criteria against Ethan's numbers", "Agree what Grace needs to see to sign", "Book the ROI review with Grace before the pilot ends"],
    upfrontContract: "We have 30 minutes. I'd like to check both criteria against your numbers, hear what's slowing you down, and agree what Grace needs to see. If we're off track, let's say so today.",
    agenda: [
      { minutes: 5, block: "Where we are against the two criteria" },
      { minutes: 10, block: "Variance walk-through: the lines still unexplained" },
      { minutes: 5, block: "Blockers on your side and ours" },
      { minutes: 5, block: "What Grace needs to see at the ROI review" },
      { minutes: 5, block: "Book the ROI review and the conversion steps" },
    ],
    questions: [
      { q: "Where is unexplained variance today against the 0.3% target, on your numbers?", category: "success_criteria", why: "The conversion case rests on Ethan's number, not ours.", probe: "Which lines make up most of what's left?", mandatory: true },
      { q: "How long did the usage tie-out take this month, against 5 days at baseline?", category: "success_criteria", why: "Time saved is what Grace will weigh against $36,000.", probe: "Where did the remaining time go?", mandatory: true },
      { q: "What would Grace need to see to sign the annual on the date we agreed?", category: "decision", why: "She's the economic buyer and hasn't been on a call since kickoff.", probe: "Is there anyone else she'll ask before signing?", mandatory: true },
      { q: "The Revenue Systems Analyst posting mentions usage reconciliation tooling. Is that hire meant to run Ledgerline or build something in-house?", category: "competition", why: "An internal build is the main risk to conversion.", probe: "Who wrote that line in the posting?", mandatory: false },
      { q: "What has slowed you down: data access, time, or something in the matches?", category: "situation", why: "Fix blockers this week while the pilot has time left.", probe: "What would you cut from scope to hit the date?", mandatory: false },
      { q: `Can we book the ROI review with Grace now, for ${c.weekday(t.roiReview)} ${c.label(t.roiReview)}?`, category: "close", why: "A pilot without a booked review drifts into a free extension.", probe: "If not that day, which day the week she's back?", mandatory: true },
    ],
    objections: [
      {
        objection: "Our new analyst could build this internally.",
        response: "They can build the match. The hard part is late events, re-rated usage and credits that land after the invoice run, and keeping that logic in step with billing.",
      },
      { objection: "Grace won't decide until she's back.", response: "That's fine. Let's book the review with her now, so the decision happens before the pilot ends rather than after." },
    ],
    aboutUs60s:
      "Ledgerline matches each metered usage event to the invoice line it landed on and explains every variance, so finance closes usage revenue in hours. I spent five years building the metering-to-invoice pipeline at Tollgate. In this pilot we're proving two things on your data: variance under 0.3% of billed revenue and a one-day tie-out.",
    landmines: [
      "Don't discuss conversion pricing without Grace; the $36,000 was agreed with her.",
      "The analyst posting may mean an internal build. Ask; don't assume.",
      "Don't present Ethan's numbers for him. Let him read them out.",
    ],
    coaching: [
      "Let Ethan talk first; you're there to listen for blockers.",
      "If variance is above 0.3%, name it and agree a fix with a date.",
      "Don't hang up without the ROI review on Grace's calendar.",
    ],
    desiredNextStep: `ROI review with Grace and Ethan on ${c.weekday(t.roiReview)} ${c.label(t.roiReview)}, before the pilot ends on ${c.label(t.pilotEnds)}.`,
    generatedAt: c.ago(6),
  };
}

export function meetings(c: Clock): Record<ID, Meeting> {
  const t = pipelineDates(c);
  const today = upcomingToday(c);
  const list: Meeting[] = [
    {
      id: MEETING.lumenwireToday,
      dealId: DEAL.lumenwire,
      title: "Lumenwire: mid-pilot check-in",
      startsAt: today,
      attendees: [{ personId: PERSON.ethan, name: "Ethan Brooks", title: "Head of Revenue Accounting" }],
      brief: lumenwireBrief(c),
    },
    {
      id: MEETING.northwindYesterday,
      dealId: DEAL.northwind,
      title: "Northwind: follow-up with Marcus",
      startsAt: c.at(-1, "11:00"),
      attendees: [
        { personId: PERSON.dana, name: "Dana Okafor", title: "Controller" },
        { personId: PERSON.marcus, name: "Marcus Lindqvist", title: "VP Finance" },
      ],
      notesRaw: [
        `[00:02:14] Dana Okafor: ${Q.nw1}`,
        `[00:06:40] Marcus Lindqvist: ${Q.nw2}`,
        `[00:09:03] Dana Okafor: ${Q.nw3}`,
        `[00:21:55] Marcus Lindqvist: ${Q.nw4}`,
        `[00:24:30] Dana Okafor: ${Q.nw5}`,
        `[00:25:02] Dana Okafor: ${Q.nw6}`,
        `[00:27:48] Marcus Lindqvist: ${Q.nw7}`,
        `[00:29:10] Dana Okafor: ${Q.nw8}`,
      ].join("\n"),
      debrief: northwindDebrief(c),
    },
    {
      id: MEETING.northwindDiscovery,
      dealId: DEAL.northwind,
      title: "Northwind: discovery",
      startsAt: c.at(-12, "15:00"),
      attendees: [{ personId: PERSON.dana, name: "Dana Okafor", title: "Controller" }],
      notesRaw:
        "Dana walked through the close. Usage export from ClickHouse, invoices from billing, VLOOKUP on customer ID, then an adjustment for whatever doesn't tie. Five days. Committed-use plans just launched. New VP Finance (Marcus) asking about audit readiness. She wants Marcus on the next call.",
    },
    {
      id: MEETING.northwindDeepDive,
      dealId: DEAL.northwind,
      title: "Northwind: technical deep-dive",
      startsAt: c.at(t.deepDive, "10:00"),
      attendees: [
        { personId: PERSON.dana, name: "Dana Okafor", title: "Controller" },
        { personId: PERSON.sofia, name: "Sofia Reyes", title: "Head of Data" },
      ],
    },
    {
      id: MEETING.saltmarshDiscovery,
      dealId: DEAL.saltmarsh,
      title: "Saltmarsh: discovery",
      startsAt: c.at(-6, "13:00"),
      attendees: [{ personId: PERSON.leo, name: "Leo Marchetti", title: "Controller" }],
      notesRaw:
        "Leo: month-end about a week, GPU-seconds slowest part. Reserved capacity launched this quarter, overage recon unclear. Didn't know who signs, maybe CEO. Ended with \"send me some info and I'll take a look\".",
      debrief: saltmarshDebrief(c),
    },
    {
      id: MEETING.lumenwireKickoff,
      dealId: DEAL.lumenwire,
      title: "Lumenwire: pilot kickoff",
      startsAt: c.at(-16, "10:00"),
      attendees: [
        { personId: PERSON.ethan, name: "Ethan Brooks", title: "Head of Revenue Accounting" },
        { personId: PERSON.grace, name: "Grace Liu", title: "CFO" },
      ],
      notesRaw: "Criteria signed: variance under 0.3% and a one-day tie-out on the next close. Ethan owns measurement. Read-only access by end of week. Grace agreed to a review before the pilot ends; date to set at the check-in.",
    },
    {
      id: MEETING.rowanstackProposal,
      dealId: DEAL.rowanstack,
      title: "Rowanstack: proposal walkthrough",
      startsAt: c.at(-9, "11:00"),
      attendees: [
        { personId: PERSON.nadia, name: "Nadia Haddad", title: "VP Finance" },
        { personId: PERSON.tom, name: "Tom Becker", title: "Director of Billing Operations" },
      ],
      notesRaw: "Walked through the proposal. Nadia accepted $48K for a case study and a signing date. Counsel to review the order form; Nadia said redlines within a week.",
    },
    {
      id: MEETING.quillfeatherTechnical,
      dealId: DEAL.quillfeather,
      title: "Quillfeather: technical call",
      startsAt: c.at(-20, "14:00"),
      attendees: [{ personId: PERSON.ben, name: "Ben Adler", title: "Head of Data" }],
      notesRaw: "Ben thinks his team can extend their dbt models to cover reconciliation. No controller; finance is one person. Never got to budget.",
    },
  ];
  return Object.fromEntries(list.map((m) => [m.id, m]));
}
