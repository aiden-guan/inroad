import type { Deal, Debrief, Field, ID, Meeting, Qualification, QualificationCard, Workspace } from "@/lib/domain/types";
import { buyerVoice } from "@/lib/voice";
import { debriefedCalls, voiceFingerprint } from "@/lib/voice/corpus";
import type { BuyerVoiceState } from "@/lib/voice/types";
import type { Clock } from "./clock";
import { HIRED_DAYS_AGO } from "./company";
import { CLAIM, DEAL, PERSON } from "./ids";

/**
 * Buyer voice for Ledgerline: seven earlier calls, each with its transcript and a transcript-sourced debrief, on the
 * sample's existing deals and people. Calls from before Priya hired her Head of GTM were pasted in at onboarding
 * (debriefed then); the two since were debriefed the day they happened. Together with the Northwind and Saltmarsh
 * debriefs they make the patterns a real founder would see by now: the usage close eating days, building it
 * in-house, a security review early, NetSuite named by buyers but missing from the playbook.
 */

export const VOICE_MEETING = {
  larkspurDiscovery: "mtg_larkspur_discovery",
  wrenfieldDiscovery: "mtg_wrenfield_discovery",
  wrenfieldReview: "mtg_wrenfield_pilot_review",
  lumenwireDiscovery: "mtg_lumenwire_discovery",
  lumenwireScoping: "mtg_lumenwire_scoping",
  rowanstackDiscovery: "mtg_rowanstack_discovery",
  rowanstackPricing: "mtg_rowanstack_pricing",
  quillfeatherDiscovery: "mtg_quillfeather_discovery",
} as const;

type Line = [time: string, speaker: string, text: string];

const PRIYA = "Priya Raman";
const none = (): Field => ({ value: null, quotes: [], status: "not_covered" });
const field = (value: string, quotes: string[], status: Field["status"] = "captured"): Field => ({ value, quotes, status });

function card(parts: Partial<QualificationCard>): QualificationCard {
  return { pain: none(), spend: none(), criticalEvent: none(), champion: { ...none(), championStatus: "none" }, economicBuyer: none(), fit: none(), decisionProcess: none(), ...parts };
}

function score(s: Omit<Qualification, "total" | "qualified">, datedNextStep: boolean): Qualification {
  const total = s.pain + s.spend + s.criticalEvent + s.champion + s.economicBuyer + s.icpFit;
  return { ...s, total, qualified: total >= 8 && datedNextStep };
}

const transcript = (lines: Line[]) => lines.map(([t, who, text]) => `[${t}] ${who}: ${text}`).join("\n");

/** Quotes are the buyer lines chosen for the debrief, verbatim; ids follow the line order, as the debrief numbers them. */
function quotesOf(lines: Line[], pick: number[]): Debrief["quotes"] {
  return pick.map((i) => ({ id: `q${i + 1}`, speaker: lines[i][1], text: lines[i][2], kind: "verbatim" as const }));
}

interface CallSpec {
  id: ID;
  dealId: ID;
  title: string;
  startsAt: string;
  attendees: Meeting["attendees"];
  lines: Line[];
  /** Which lines the debrief quoted (0-based). */
  quoted: number[];
  card: QualificationCard;
  qualification: Qualification;
  recap: { subject: string; body: string };
  newObjections: string[];
  customerWords: string[];
  generatedAt: string;
  nextStep?: Debrief["nextStep"];
  tasks?: Debrief["tasks"];
  coaching?: string[];
  toConfirm?: string[];
  priceQuoted?: Debrief["priceQuoted"];
}

function meeting(s: CallSpec): Meeting {
  return {
    id: s.id,
    dealId: s.dealId,
    title: s.title,
    startsAt: s.startsAt,
    attendees: s.attendees,
    notesRaw: transcript(s.lines),
    debrief: {
      source: "transcript",
      quotes: quotesOf(s.lines, s.quoted),
      card: s.card,
      qualification: s.qualification,
      stageSuggestion: null,
      nextStep: s.nextStep ?? null,
      noNextStepWarning: !s.nextStep?.buyerAgreed,
      recap: s.recap,
      committeeUpdates: [],
      tasks: s.tasks ?? [],
      newObjections: s.newObjections,
      customerWords: s.customerWords,
      referrals: [],
      toConfirm: s.toConfirm ?? [],
      coaching: s.coaching ?? [],
      generatedAt: s.generatedAt,
      appliedAt: s.generatedAt,
      ...(s.priceQuoted ? { priceQuoted: s.priceQuoted } : {}),
    },
  };
}

/** When the founder pasted the older transcripts in, during the first morning (before the playbook was written). */
const imported = (c: Clock, minute: number) => c.at(-HIRED_DAYS_AGO, `10:0${Math.min(5, Math.max(0, minute))}`);

export function voiceMeetings(c: Clock): Record<ID, Meeting> {
  const larkspur: Line[] = [
    ["00:03:10", "Maya Okonkwo", "Our close is four days, and usage is most of it."],
    ["00:05:42", PRIYA, "What happens to the lines that don't tie?"],
    ["00:05:55", "Maya Okonkwo", "They become an adjustment. Nobody can explain them line by line, so we explain the total."],
    ["00:12:30", "Maya Okonkwo", "NetSuite already does this, supposedly. Our admin keeps saying the usage module covers it."],
    ["00:13:05", "Maya Okonkwo", "It covers the invoice. It doesn't tell me which events never made it onto one."],
    ["00:24:18", "Maya Okonkwo", "New finance tools are frozen until our next fiscal year, so anything we do starts in February."],
    ["00:25:40", "Maya Okonkwo", "Reconnect with me in January and I'll have the budget conversation."],
  ];
  const wrenfieldDiscovery: Line[] = [
    ["00:02:05", "Ava Whitman", "Our close takes nine days, and four of them are the usage tie-out."],
    ["00:04:30", "Ava Whitman", "Usage lands in Snowflake and never matches what Stripe invoiced."],
    ["00:07:12", "Ava Whitman", "Last month a customer disputed an overbilled invoice, and I couldn't show them the events behind it."],
    ["00:15:48", "Ava Whitman", "Our data team offered to build it in dbt, but they quoted a quarter, and I'd still be the one explaining it to the auditor."],
    ["00:21:20", "Ava Whitman", "If I could close usage in a day, I'd get my first week back."],
    ["00:28:02", PRIYA, "Would a paid pilot on last month's close be a fair test?"],
    ["00:28:20", "Ava Whitman", "Yes. I can approve a pilot myself if it's under ten thousand."],
  ];
  const wrenfieldReview: Line[] = [
    ["00:01:40", "Ava Whitman", "The tie-out took six hours this close instead of four days."],
    ["00:03:15", "Ava Whitman", "What sold me is the line-level trail. The auditor stopped asking for screenshots."],
    ["00:09:50", "Ava Whitman", "We found usage that never reached an invoice in the first week of the pilot."],
    ["00:16:30", "Ava Whitman", "I'll sign the annual if legal can turn the paper around this week."],
  ];
  const lumenwireDiscovery: Line[] = [
    ["00:02:30", "Ethan Brooks", "Five days on the usage tie-out, and two point one percent we can't explain."],
    ["00:06:10", "Ethan Brooks", "We pay a contractor every quarter to rebuild the workbook."],
    ["00:11:45", "Ethan Brooks", "Can't NetSuite do this? We already pay for it, and its usage billing module was supposed to cover this."],
    ["00:12:20", PRIYA, "It bills the usage it's given. The gap is the usage that never reaches it."],
    ["00:18:05", "Ethan Brooks", "Before anyone touches billing data, Grace will want a security review."],
    ["00:26:40", "Ethan Brooks", "I'll own the numbers and present them to Grace."],
  ];
  const lumenwireScoping: Line[] = [
    ["00:03:12", "Grace Liu", "The board wants that under half a percent before the audit."],
    ["00:08:40", "Grace Liu", "Why wouldn't our new analyst just build this? We're hiring one anyway."],
    ["00:09:30", "Ethan Brooks", "The analyst is for forecasting. Nobody wants to maintain another reconciliation script we wrote in-house."],
    ["00:15:05", "Grace Liu", "I need the security questionnaire before we connect anything to the warehouse."],
    ["00:22:18", "Grace Liu", "If it hits both numbers, $36,000 is fine."],
    ["00:23:40", "Grace Liu", "Legal turns our paper around in a week."],
  ];
  const rowanstackDiscovery: Line[] = [
    ["00:02:50", "Tom Becker", "Three days a month, and I rebuild the sheet every time."],
    ["00:05:35", "Tom Becker", "The Snowflake numbers never match what Stripe invoiced, and I'm the one who explains why."],
    ["00:13:10", "Tom Becker", "We looked at Meterbook last year. It only sees usage that flows through Meterbook, and half of ours doesn't."],
    ["00:19:45", "Tom Becker", "If this works, I'd stop being the person who knows how the spreadsheet works."],
  ];
  const rowanstackPricing: Line[] = [
    ["00:01:55", "Nadia Haddad", "This is my budget and my call."],
    ["00:04:20", "Nadia Haddad", "Our auditors will ask how every usage invoice ties out."],
    ["00:07:48", "Nadia Haddad", "The alternative is another headcount on Tom's team."],
    ["00:14:30", "Nadia Haddad", "Fifty-four is more than I planned for this year. Closewise quoted us less for the whole close."],
    ["00:18:12", "Nadia Haddad", "Counsel reviews, then I sign. No procurement."],
    ["00:20:40", "Tom Becker", "I showed Nadia the variance view on Friday."],
  ];
  const quillfeather: Line[] = [
    ["00:02:15", "Ben Adler", "Honestly, we'd build it in-house. It's a few dbt models on top of what we already have in Snowflake."],
    ["00:06:50", "Ben Adler", "Finance is one person right now, so there's nobody to own a tool like this."],
    ["00:12:35", "Ben Adler", "Security would want a review before any vendor reads our warehouse."],
    ["00:15:10", "Ben Adler", "Our usage is in Snowflake and the invoices are in Stripe, and they drift every month."],
  ];

  const specs: CallSpec[] = [
    {
      id: VOICE_MEETING.larkspurDiscovery,
      dealId: DEAL.larkspur,
      title: "Larkspur: discovery",
      startsAt: c.at(-169, "11:00"),
      attendees: [{ personId: PERSON.maya, name: "Maya Okonkwo", title: "Controller" }],
      lines: larkspur,
      quoted: [0, 2, 3, 4, 5, 6],
      card: card({
        pain: { ...field("A four-day close, mostly usage; unexplained lines booked as one adjustment.", [larkspur[0][2], larkspur[2][2]]), impact: "Four days each close" },
        criticalEvent: { ...field("New finance tools frozen until the next fiscal year.", [larkspur[5][2]], "partial") },
        champion: { ...field("Maya wants to fix it and asked to reconnect.", [larkspur[6][2]], "partial"), name: "Maya Okonkwo", championStatus: "untested" },
        fit: field("Usage-priced per tracked event; controller owns the close.", []),
        decisionProcess: field("Budget conversation in January for the next fiscal year.", [larkspur[6][2]], "partial"),
      }),
      qualification: score({ pain: 2, spend: 0, criticalEvent: 1, champion: 1, economicBuyer: 0, icpFit: 2 }, false),
      recap: {
        subject: "Larkspur + Ledgerline: recap",
        body: "Maya, thanks for the time.\n\nWhat I heard:\n- The close takes four days, and usage is most of it.\n- Lines that don't tie become one adjustment.\n- New finance tools wait for the next fiscal year.\n\nI'll reconnect in January as you suggested.\n\nDid I miss or misstate anything?",
      },
      newObjections: ["New finance tools are frozen until their next fiscal year.", "Thinks NetSuite's usage module already covers reconciliation."],
      customerWords: ["explain the total", "the usage module"],
      generatedAt: imported(c, 1),
      toConfirm: ["Whether NetSuite's usage module sees events that arrive after the invoice run"],
    },
    {
      id: VOICE_MEETING.wrenfieldDiscovery,
      dealId: DEAL.wrenfield,
      title: "Wrenfield: discovery",
      startsAt: c.at(-74, "10:00"),
      attendees: [{ personId: PERSON.ava, name: "Ava Whitman", title: "Controller" }],
      lines: wrenfieldDiscovery,
      quoted: [0, 1, 2, 3, 4, 6],
      card: card({
        pain: { ...field("A nine-day close; four days go to the usage tie-out, warehouse usage never matches billing, and a customer disputed an overbill.", [wrenfieldDiscovery[0][2], wrenfieldDiscovery[1][2], wrenfieldDiscovery[2][2]]), impact: "Four days each close" },
        spend: field("The data team quoted a quarter to build it.", [wrenfieldDiscovery[3][2]], "partial"),
        champion: { ...field("Ava owns the close and can approve a pilot.", [wrenfieldDiscovery[6][2]]), name: "Ava Whitman", championStatus: "tested" },
        economicBuyer: { ...field("Ava approves pilots under $10,000.", [wrenfieldDiscovery[6][2]], "partial"), name: "Ava Whitman" },
        fit: field("Usage-priced per tracked event; usage in Snowflake, invoices from Stripe.", []),
      }),
      qualification: score({ pain: 2, spend: 1, criticalEvent: 1, champion: 2, economicBuyer: 1, icpFit: 2 }, true),
      nextStep: { what: "Paid pilot on last month's close", date: c.d(-62), buyerAgreed: true, owner: "both" },
      recap: {
        subject: "Wrenfield + Ledgerline: recap and next steps",
        body: "Ava, thanks for the time today.\n\nWhat I heard:\n- The close takes nine days, and four of them are the usage tie-out.\n- Usage in Snowflake never matches what Stripe invoiced.\n- A customer disputed an overbilled invoice last month.\n\nWhat we agreed:\n- A paid pilot on last month's close.\n\nDid I miss or misstate anything?",
      },
      newObjections: ["Data team offered to build it in dbt; quoted a quarter."],
      customerWords: ["usage tie-out", "never matches what Stripe invoiced", "my first week back"],
      generatedAt: imported(c, 2),
    },
    {
      id: VOICE_MEETING.wrenfieldReview,
      dealId: DEAL.wrenfield,
      title: "Wrenfield: pilot review",
      startsAt: c.at(-21, "14:00"),
      attendees: [{ personId: PERSON.ava, name: "Ava Whitman", title: "Controller" }],
      lines: wrenfieldReview,
      quoted: [0, 1, 2, 3],
      card: card({
        pain: { ...field("The tie-out took four days before the pilot.", [wrenfieldReview[0][2]]), impact: "Four days down to six hours" },
        champion: { ...field("Ava will sign the annual.", [wrenfieldReview[3][2]]), name: "Ava Whitman", championStatus: "tested" },
        economicBuyer: { ...field("Ava signs once legal turns the paper around.", [wrenfieldReview[3][2]]), name: "Ava Whitman", engaged: true },
        decisionProcess: field("Legal reviews the paper this week; Ava signs.", [wrenfieldReview[3][2]]),
      }),
      qualification: score({ pain: 2, spend: 1, criticalEvent: 2, champion: 2, economicBuyer: 2, icpFit: 2 }, true),
      nextStep: { what: "Legal returns the paper; Ava signs the annual", date: c.d(-19), buyerAgreed: true, owner: "buyer" },
      recap: {
        subject: "Wrenfield + Ledgerline: pilot review",
        body: "Ava, thanks for the review today.\n\nWhat I heard:\n- The tie-out took six hours this close instead of four days.\n- The line-level trail is what sold you.\n\nWhat we agreed:\n- Legal turns the paper around this week, then you sign the annual.\n\nDid I miss or misstate anything?",
      },
      newObjections: [],
      customerWords: ["line-level trail"],
      generatedAt: c.at(-21, "15:10"),
    },
    {
      id: VOICE_MEETING.lumenwireDiscovery,
      dealId: DEAL.lumenwire,
      title: "Lumenwire: discovery",
      startsAt: c.at(-51, "16:00"),
      attendees: [{ personId: PERSON.ethan, name: "Ethan Brooks", title: "Head of Revenue Accounting" }],
      lines: lumenwireDiscovery,
      // The debrief kept Priya's own line too; Buyer voice leaves the founder's words out.
      quoted: [0, 1, 2, 3, 4, 5],
      card: card({
        pain: { ...field("Five days on the usage tie-out; 2.1% of billed revenue unexplained.", [lumenwireDiscovery[0][2]]), impact: "2.1% of billed revenue" },
        spend: field("A contractor rebuilds the reconciliation workbook every quarter.", [lumenwireDiscovery[1][2]]),
        champion: { ...field("Ethan will own the numbers and present them to Grace.", [lumenwireDiscovery[5][2]]), name: "Ethan Brooks", championStatus: "untested" },
        decisionProcess: field("Grace wants a security review before anyone touches billing data.", [lumenwireDiscovery[4][2]], "partial"),
        fit: field("Usage-priced per message and minute; revenue accounting team of four.", []),
      }),
      qualification: score({ pain: 2, spend: 2, criticalEvent: 0, champion: 1, economicBuyer: 0, icpFit: 2 }, false),
      recap: {
        subject: "Lumenwire + Ledgerline: recap",
        body: "Ethan, thanks for the time.\n\nWhat I heard:\n- Five days on the usage tie-out, and 2.1% you can't explain.\n- A contractor rebuilds the workbook every quarter.\n- Grace will want a security review first.\n\nDid I miss or misstate anything?",
      },
      newObjections: ["Expects NetSuite's usage billing module to cover this.", "Needs a security review before anyone touches billing data."],
      customerWords: ["usage tie-out", "rebuild the workbook"],
      generatedAt: imported(c, 3),
    },
    {
      id: VOICE_MEETING.lumenwireScoping,
      dealId: DEAL.lumenwire,
      title: "Lumenwire: scoping with Grace",
      startsAt: c.at(-31, "11:00"),
      attendees: [
        { personId: PERSON.ethan, name: "Ethan Brooks", title: "Head of Revenue Accounting" },
        { personId: PERSON.grace, name: "Grace Liu", title: "CFO" },
      ],
      lines: lumenwireScoping,
      quoted: [0, 1, 2, 3, 4, 5],
      card: card({
        criticalEvent: { ...field("The board wants variance under half a percent before the audit.", [lumenwireScoping[0][2]], "partial"), date: c.d(48) },
        economicBuyer: { ...field("Grace agreed $36,000 if both numbers are hit.", [lumenwireScoping[4][2]]), name: "Grace Liu", engaged: true },
        decisionProcess: field("Security questionnaire first; Grace signs; legal turns their paper in a week.", [lumenwireScoping[3][2], lumenwireScoping[5][2]]),
      }),
      qualification: score({ pain: 2, spend: 2, criticalEvent: 1, champion: 2, economicBuyer: 2, icpFit: 2 }, true),
      nextStep: { what: "Pilot success criteria signed", date: c.d(-17), buyerAgreed: true, owner: "both" },
      recap: {
        subject: "Lumenwire + Ledgerline: scoping and next steps",
        body: "Grace, Ethan, thanks for the time.\n\nWhat I heard:\n- The board wants variance under half a percent before the audit.\n- You need the security questionnaire before anything connects to the warehouse.\n\nWhat we agreed:\n- A paid pilot against both numbers; if it hits them, the annual at $36,000.\n\nDid I miss or misstate anything?",
      },
      newObjections: ["Asked why their new analyst couldn't build it.", "Needs the security questionnaire before connecting the warehouse."],
      customerWords: ["under half a percent"],
      generatedAt: imported(c, 4),
      priceQuoted: { amountUsd: 36_000, quote: lumenwireScoping[4][2] },
    },
    {
      id: VOICE_MEETING.rowanstackDiscovery,
      dealId: DEAL.rowanstack,
      title: "Rowanstack: discovery",
      startsAt: c.at(-40, "15:00"),
      attendees: [{ personId: PERSON.tom, name: "Tom Becker", title: "Director of Billing Operations" }],
      lines: rowanstackDiscovery,
      quoted: [0, 1, 2, 3],
      card: card({
        pain: { ...field("Three days a month rebuilding the reconciliation sheet; warehouse numbers never match billing.", [rowanstackDiscovery[0][2], rowanstackDiscovery[1][2]]), impact: "Three days a month" },
        champion: { ...field("Tom owns the reconciliation and wants out of it.", [rowanstackDiscovery[3][2]]), name: "Tom Becker", championStatus: "untested" },
        fit: field("Usage-priced and warehouse-metered.", [], "partial"),
      }),
      qualification: score({ pain: 2, spend: 0, criticalEvent: 0, champion: 1, economicBuyer: 0, icpFit: 1 }, false),
      recap: {
        subject: "Rowanstack + Ledgerline: recap",
        body: "Tom, thanks for the time.\n\nWhat I heard:\n- Three days a month, rebuilding the sheet every time.\n- The Snowflake numbers never match what Stripe invoiced.\n- Meterbook only sees usage that flows through it.\n\nDid I miss or misstate anything?",
      },
      newObjections: ["Looked at Meterbook last year; it only sees usage that flows through it."],
      customerWords: ["rebuild the sheet", "never match what Stripe invoiced"],
      generatedAt: imported(c, 5),
    },
    {
      id: VOICE_MEETING.rowanstackPricing,
      dealId: DEAL.rowanstack,
      title: "Rowanstack: pricing with Nadia",
      startsAt: c.at(-20, "11:00"),
      attendees: [
        { personId: PERSON.nadia, name: "Nadia Haddad", title: "VP Finance" },
        { personId: PERSON.tom, name: "Tom Becker", title: "Director of Billing Operations" },
      ],
      lines: rowanstackPricing,
      quoted: [0, 1, 2, 3, 4],
      card: card({
        spend: field("The alternative is another headcount on Tom's team.", [rowanstackPricing[2][2]]),
        criticalEvent: { ...field("The first audit will ask how every usage invoice ties out.", [rowanstackPricing[1][2]]), date: c.d(90) },
        economicBuyer: { ...field("Nadia owns the budget and the decision.", [rowanstackPricing[0][2]]), name: "Nadia Haddad", engaged: true },
        decisionProcess: field("Counsel reviews, then Nadia signs. No procurement.", [rowanstackPricing[4][2]]),
      }),
      qualification: score({ pain: 2, spend: 2, criticalEvent: 2, champion: 2, economicBuyer: 2, icpFit: 1 }, true),
      nextStep: { what: "Revised proposal at a price inside Nadia's plan", date: c.d(-10), buyerAgreed: true, owner: "founder" },
      recap: {
        subject: "Rowanstack + Ledgerline: pricing and next steps",
        body: "Nadia, Tom, thanks for the time.\n\nWhat I heard:\n- Your auditors will ask how every usage invoice ties out.\n- The alternative is another headcount on Tom's team.\n- $54,000 is more than you planned for this year.\n\nWhat we agreed:\n- I'll send a revised proposal; counsel reviews, then you sign.\n\nDid I miss or misstate anything?",
      },
      newObjections: ["Fifty-four thousand is more than planned; Closewise quoted less for the whole close."],
      customerWords: ["another headcount", "ties out"],
      generatedAt: c.at(-20, "12:40"),
      priceQuoted: { amountUsd: 54_000, quote: rowanstackPricing[3][2] },
    },
    {
      id: VOICE_MEETING.quillfeatherDiscovery,
      dealId: DEAL.quillfeather,
      title: "Quillfeather: discovery",
      startsAt: c.at(-33, "13:00"),
      attendees: [{ personId: PERSON.ben, name: "Ben Adler", title: "Head of Data" }],
      lines: quillfeather,
      quoted: [0, 1, 2, 3],
      card: card({
        pain: { ...field("Usage in Snowflake and invoices in Stripe drift every month.", [quillfeather[3][2]], "partial") },
        champion: { ...field("Ben would rather build it.", [quillfeather[0][2]], "partial"), name: "Ben Adler", championStatus: "none" },
        fit: field("Usage-priced per GB scanned; no controller yet.", [quillfeather[1][2]], "partial"),
        decisionProcess: field("Security reviews any vendor that reads the warehouse.", [quillfeather[2][2]], "partial"),
      }),
      qualification: score({ pain: 1, spend: 0, criticalEvent: 0, champion: 0, economicBuyer: 0, icpFit: 2 }, false),
      recap: {
        subject: "Quillfeather + Ledgerline: recap",
        body: "Ben, thanks for the time.\n\nWhat I heard:\n- You'd build it in-house with a few dbt models.\n- Finance is one person, so nobody would own a tool yet.\n\nDid I miss or misstate anything?",
      },
      newObjections: ["Would build it in-house with dbt models.", "No one in finance to own a tool yet."],
      customerWords: ["drift every month"],
      generatedAt: imported(c, 0),
    },
  ];
  return Object.fromEntries(specs.map((s) => [s.id, meeting(s)]));
}

/** The deals gain their earlier calls, oldest first and ahead of the calls already listed, so each company sheet shows them. */
export function withVoiceMeetings(deals: Record<ID, Deal>, meetings: Record<ID, Meeting>): Record<ID, Deal> {
  const earlier = Object.values(meetings).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  for (const deal of Object.values(deals)) {
    const ids = earlier.filter((m) => m.dealId === deal.id && !deal.meetingIds.includes(m.id)).map((m) => m.id);
    if (ids.length) deal.meetingIds = [...ids, ...deal.meetingIds];
  }
  return deals;
}

/**
 * The cached naming pass, as if it ran after yesterday's Northwind debrief: names in buyers' words for the themes code
 * found, keyed by theme key. A name whose theme isn't there is simply unused. Plus one battlecard drafted two days
 * ago, waiting to be saved, so the sample shows a draft next to the ones still to write.
 */
const NAMES: Record<string, { name: string; gist: string }> = {
  "pain:time": { name: "Usage tie-out eats days every close", gist: "Matching usage to invoices takes most of every month-end." },
  "pain:unexplained": { name: "Variances nobody can explain", gist: "Lines that don't tie end up as adjustments booked without a cause." },
  "pain:mismatch": { name: "Warehouse usage never matches the invoice", gist: "Usage in Snowflake and what Stripe billed drift apart every month." },
  "pain:manual": { name: "Rebuilding the spreadsheet every month", gist: "Someone exports usage and rebuilds the same workbook each close." },
  "pain:headcount": { name: "Hiring just to keep up", gist: "Teams budget a contractor or another hire to run the export." },
  "pain:audit": { name: "Explaining usage to the auditor", gist: "They expect the auditor to ask how every usage invoice ties out." },
  "pain:leakage": { name: "Usage that never reaches an invoice", gist: "Overbilled or unbilled usage surfaces only when a customer disputes it." },
  "objection:build": { name: "Our data team could build it", gist: "A dbt model or the new analyst looks cheaper than a vendor." },
  "objection:security": { name: "Nervous about vendors touching billing data", gist: "Nobody connects to the warehouse until security has signed off." },
  "objection:competitor": { name: "Our existing tools should cover this", gist: "They expect NetSuite, Meterbook or Closewise to handle usage already." },
  "objection:owner": { name: "Nobody here to own it", gist: "Finance is too small, or nobody knows who would sign." },
  "objection:price": { name: "More than we planned to spend", gist: "The quote is above their plan and a cheaper tool exists." },
  "objection:timing": { name: "Budgets frozen until next year", gist: "New finance tools wait for the next fiscal year." },
  "objection:info": { name: "Send me some info", gist: "A polite exit with no next step." },
  "process:security": { name: "Security review before any access", gist: "A questionnaire and review come before anyone connects to billing data." },
  "process:legal": { name: "Counsel reviews the paper", gist: "Legal turns the order form around in about a week, then they sign." },
  "process:approval": { name: "The finance lead signs", gist: "The controller, VP Finance or CFO approves from their own budget." },
  "process:deadline": { name: "The audit sets the date", gist: "Quarter-end true-ups, the audit or the fiscal year force the timing." },
  "process:pilot": { name: "A paid pilot proves it", gist: "They commit once a pilot hits the agreed numbers." },
  "process:access": { name: "Read-only access, no pipeline changes", gist: "The data owner wants read-only warehouse access and nothing touched." },
  "outcome:speed": { name: "Close usage in a day", gist: "They want the tie-out to take hours instead of days." },
  "outcome:accuracy": { name: "Variance under half a percent", gist: "The board wants unexplained variance down before the audit." },
  "outcome:trail": { name: "A trail the auditor accepts", gist: "Every invoice line traced to its usage, so the auditor stops asking." },
  "outcome:no_hire": { name: "Skip the extra hire", gist: "If it replaces the planned hire, the budget is already there." },
  "outcome:time_back": { name: "Get the first week back", gist: "A faster close gives the controller their first week back." },
};

export function sampleBuyerVoice(ws: Workspace, c: Clock): BuyerVoiceState {
  const voice = buyerVoice(ws, c.today);
  const keys = new Set(voice.themes.map((t) => t.key));
  const entries = Object.fromEntries(Object.entries(NAMES).filter(([k]) => keys.has(k)));
  const hire = voice.alternatives.find((a) => a.key === "alt:hire");
  const hireQuotes = (hire?.snippets ?? []).filter((s) => s.verbatim).slice(0, 3).map((s) => s.id);
  return {
    // The pass also dropped one quote that mentions the pilot in passing but is about unbilled usage.
    names: { fingerprint: voiceFingerprint(ws), calls: debriefedCalls(ws), at: c.at(-1, "12:35"), costUsd: 0.004, entries, merges: {}, outliers: keys.has("process:pilot") ? { "process:pilot": [`${VOICE_MEETING.wrenfieldReview}:q3`] } : {} },
    battlecards: hireQuotes.length
      ? {
          "alt:hire": {
            key: "alt:hire",
            subject: "Hire someone",
            objection: "We'd rather hire someone to run the export.",
            category: "status_quo",
            underlyingConcern: "A hire feels safer than a new vendor, and finance already knows how to budget headcount.",
            clarifyingQ: "What would that hire spend their first month on, and who keeps the workbook running when they move on?",
            response:
              "That's the usual plan, and the hire ends up running the same export every close. A design partner cut month-end usage reconciliation from 4 days to 6 hours in their first close, without adding anyone. Want to see last month's close on your data before you open the role?",
            walkAwayIf: "The hire is already approved for broader revenue accounting work and usage is a small part of it.",
            landmines: ["Who maintains the reconciliation when the person who built it leaves?", "How much of the new hire's month would go to the usage tie-out?"],
            whenWeWin: "The hire is mostly there to run the usage export, as at Northwind and Rowanstack.",
            quoteIds: hireQuotes,
            claimIds: [CLAIM.designPartner],
            at: c.at(-2, "16:20"),
            costUsd: 0.021,
          },
        }
      : {},
  };
}
