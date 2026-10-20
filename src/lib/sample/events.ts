import type { DinnerPlan, GtmEvent, Guest, ID } from "@/lib/domain/types";
import type { Clock } from "./clock";
import { DEAL, DOMAIN, EVENT, PERSON, RUN } from "./ids";

const DINNER_IN_DAYS = 26;

function guests(list: Guest[]): Record<ID, Guest> {
  return Object.fromEntries(list.map((g) => [g.id, g]));
}

function dinnerPlan(c: Clock): DinnerPlan {
  const T = DINNER_IN_DAYS;
  const day = `${c.weekday(T)} ${c.label(T)}`;
  return {
    goal: "accelerate_deals",
    city: "New York",
    targetDate: c.d(T),
    budgetUsd: { low: 3_500, high: 5_500 },
    coHostSuggestion: "Alder Street Ventures platform team (Claire Donovan). Their portfolio sells to the same finance leaders, and they split the cost.",
    themes: [
      {
        title: "Closing the month on consumption contracts",
        question: "What breaks in the close the first quarter after you move enterprise customers to committed-use contracts?",
        whyNow: "4 of the 9 New York companies you track launched usage or committed-use pricing in the last 90 days.",
        prompts: [
          "Where did the first true-up surprise you?",
          "Who owns the usage tie-out today, and who should?",
          "What did your auditor ask about usage revenue that you couldn't answer on the spot?",
        ],
        reservePrompts: [
          "What would you never do again in a pricing migration?",
          "How do you explain a usage variance to your CEO?",
          "Build or buy: where did your data team draw the line?",
          "What does a good close look like a year from now?",
        ],
      },
      {
        title: "Who owns usage reconciliation?",
        question: "Finance, data or billing ops: who should own the usage tie-out, and what happens when that person leaves?",
        whyNow: "5 tracked companies are hiring a role whose posting names usage reconciliation.",
        prompts: ["Who wrote your reconciliation logic, and are they still here?", "What broke the last time someone new took over the close?"],
        reservePrompts: ["How do you hand over a close checklist?", "What would you put in the job description now?"],
      },
      {
        title: "Usage revenue and the first audit",
        question: "What does an auditor need to see to trust usage-billed revenue?",
        whyNow: "Two tracked companies are preparing for their first financial statement audit.",
        prompts: ["What did the auditor sample first?", "Which usage lines took longest to support?"],
        reservePrompts: ["What would you tell yourself six months before the audit?"],
      },
    ],
    inviteMath: { invites: 36, expectedAcceptRate: 0.25, confirmsTarget: 12, expectedShowRate: 0.8, seats: 10 },
    timeline: [
      { due: c.d(-9), offset: "T-5w", task: "Pick the goal, theme and co-host; Alder Street splits the cost", owner: "founder", done: true },
      { due: c.d(-7), offset: "T-5w", task: "Must-attend list: 3 open deals, Ava as customer host, 1 anchor", owner: "ember", done: true },
      { due: c.d(-4), offset: "T-4w", task: "Shortlist 3 private rooms near Union Square", owner: "ember", done: true },
      { due: c.d(-2), offset: "T-4w", task: "Personal invites from Priya and Claire to the first 18", owner: "founder", done: true },
      { due: c.d(2), offset: "T-3w", task: "Book the private room for 10–12", owner: "founder" },
      { due: c.d(5), offset: "T-3w", task: "Second wave of invites from Claire's list", owner: "cohost" },
      { due: c.d(12), offset: "T-2w", task: "One follow-up to non-responders; ask decliners who should come instead", owner: "founder" },
      { due: c.d(19), offset: "T-1w", task: "Dietary needs and logistics; over-confirm from the waitlist", owner: "founder" },
      { due: c.d(T - 2), offset: "T-48h", task: "Briefing book: each guest's stage, challenge and planned intros", owner: "ember" },
      { due: c.d(T - 1), offset: "T-1d", task: "Personal reminder to each guest, naming what they want from the night", owner: "founder" },
      { due: c.d(T), offset: "Day of", task: "Short text with the address and arrival time", owner: "founder" },
    ],
    venueCriteria: [
      "Private room for 10–12 at one long table",
      "Quiet enough to talk across the table; no open dining room",
      "Within 15 minutes of Union Square for most guests",
      "Fixed menu under $150 a head, wine included",
      "Space to stand for 30 minutes of drinks before sitting",
    ],
    venueIdeas: [
      { name: "Harlow & Pine, the Ledger Room", why: "Private room for 12, one table, fixed menus from $120.", url: "https://harlowandpine.example/private-dining" },
      { name: "Marrow Street Kitchen, back room", why: "Seats 10, separate entrance, quiet on weeknights.", url: "https://marrowstreet.example/events" },
      { name: "Osteria Calma, wine cellar", why: "Seats 14; stone walls keep it quiet. Slightly over budget.", url: "https://osteriacalma.example/cellar" },
    ],
    copy: {
      inviteFounder: {
        subject: "dinner on consumption contracts",
        body: `Claire Donovan at Alder Street and I are hosting ten finance leaders from usage-priced companies for dinner in New York on ${day}. The question for the night is what breaks in the close the first quarter after you move enterprise customers to committed-use contracts. Ava Whitman, Controller at Wrenfield, will open with what changed in her close, and you'd sit with people working through the same thing. No slides, no pitch, off the record. Would you like a seat?`,
      },
      inviteCustomerHost: {
        subject: "host the dinner with us?",
        body: `Ava, Claire Donovan and I are hosting ten finance leaders for dinner on ${day}, all moving to usage or committed-use contracts. Would you open the night with five minutes on what changed in Wrenfield's close? No slides. You'd sit at one end of the table, and I'll seat the two people closest to your situation next to you.`,
      },
      reminder48h: `Looking forward to ${c.weekday(T)}. You'll sit next to someone who has already been through the problem you mentioned. Drinks at 6:30; the address follows once the room is booked. Reply here if anything changes.`,
      dayOfText: "See you tonight. Drinks at 6:30, we sit at 7. The address is in the invite.",
    },
    runOfShow: [
      { time: "6:30", segment: "Drinks", notes: "30 minutes standing. Don't seat early." },
      { time: "7:00", segment: "Seat and welcome", notes: "Under 5 minutes. Norms: off the record, no recording, no pitch." },
      { time: "7:05", segment: "Intros", notes: "Name, role, and what you're working on this quarter." },
      { time: "7:20", segment: "Framing", notes: "Ava, 5–10 minutes on what changed in Wrenfield's close after usage pricing." },
      { time: "7:30", segment: "Discussion", notes: "Prompts 1–3; bring in quiet guests by name. Reserve prompts if it stalls." },
      { time: "8:30", segment: "Dessert, switch seats", notes: "Move each priority prospect next to someone who solved the same problem." },
      { time: "9:15", segment: "Close", notes: "One synthesizing observation from Priya. No pitch." },
    ],
    seatingRules: [
      "Ava (customer host) at one end, Claire (co-host) at the other.",
      "Marcus next to Ava: same move to committed-use contracts.",
      "Nadia next to Rosa Delgado: first audit on usage revenue.",
      "Never seat two people from companies that compete.",
      "Place cards, no name badges.",
    ],
    followUp: {
      nextMorningNote: "A personal note by 9am to each guest, naming one thing they said and one concrete next step.",
      groupEmail: "Within 48 hours: 3–5 themes from the night (Chatham House, no names), the intros promised, nothing to buy.",
      cadence: [
        { day: 1, touch: "Personal note with one next step" },
        { day: 2, touch: "Group email: themes and intros" },
        { day: 14, touch: "Something useful tied to what they said" },
        { day: 30, touch: "Offer a working session if the problem came up" },
        { day: 90, touch: "Check in after their quarter-end close" },
      ],
      noShow: "Same day: \"Sorry we missed you. Here's what came up. Want the notes?\" No fee, no guilt.",
    },
  };
}

function roundtablePlan(c: Clock): DinnerPlan {
  return {
    goal: "create_pipeline",
    city: "Virtual",
    targetDate: c.d(-14),
    budgetUsd: { low: 0, high: 0 },
    themes: [
      {
        title: "Closing the month on usage billing",
        question: "Where does the usage tie-out actually break in your close?",
        whyNow: "6 tracked companies had moved to usage pricing in the last six months.",
        prompts: ["Walk us through your last usage tie-out.", "What do you book when it doesn't tie?", "Who would you hire to fix it?"],
        reservePrompts: ["What changed when you added a second meter?", "What does your auditor ask about usage?"],
      },
    ],
    inviteMath: { invites: 22, expectedAcceptRate: 0.3, confirmsTarget: 8, expectedShowRate: 0.75, seats: 7 },
    timeline: [
      { due: c.d(-35), offset: "T-3w", task: "Theme, framer and invite list", owner: "founder", done: true },
      { due: c.d(-28), offset: "T-2w", task: "Personal invites to 22", owner: "founder", done: true },
      { due: c.d(-16), offset: "T-48h", task: "Briefing notes per guest", owner: "ember", done: true },
      { due: c.d(-13), offset: "T+1d", task: "Next-morning notes and group email", owner: "founder", done: true },
    ],
    venueCriteria: [],
    venueIdeas: [],
    copy: {
      inviteFounder: {
        subject: "60 minutes on usage close",
        body: "I'm hosting six finance leaders from usage-priced companies for a 60-minute video roundtable on where the usage tie-out breaks in the close. Ava Whitman, Controller at Wrenfield, will open. No slides, no pitch, off the record. Would you join?",
      },
      inviteCustomerHost: {
        subject: "open the roundtable?",
        body: "Ava, would you open the roundtable with five minutes on Wrenfield's close before and after usage pricing? Six peers, off the record.",
      },
      reminder48h: "Looking forward to it. Ava will open with exactly the problem you described. Link below.",
      dayOfText: "Starting in an hour. Same link as the invite.",
    },
    runOfShow: [
      { time: "0:00", segment: "Welcome", notes: "5 minutes. Off the record, no recording, no pitch." },
      { time: "0:05", segment: "Intros", notes: "10 minutes. Name, role, how you close usage today." },
      { time: "0:15", segment: "Framing", notes: "5 minutes from Ava." },
      { time: "0:20", segment: "Discussion", notes: "35 minutes on the three prompts." },
      { time: "0:55", segment: "Close", notes: "5 minutes. One synthesizing observation." },
    ],
    seatingRules: [],
    followUp: {
      nextMorningNote: "A personal note to each guest naming one thing they said and one next step.",
      groupEmail: "Three themes from the hour, Chatham House.",
      cadence: [
        { day: 1, touch: "Personal note" },
        { day: 2, touch: "Group email" },
        { day: 30, touch: "Check in on their next close" },
      ],
      noShow: "Same day: the three themes and an offer of the notes.",
    },
  };
}

export function events(c: Clock): Record<ID, GtmEvent> {
  const T = DINNER_IN_DAYS;
  const dinner: GtmEvent = {
    id: EVENT.dinner,
    kind: "dinner",
    title: "New York dinner: closing on consumption contracts",
    status: "planning",
    plan: dinnerPlan(c),
    chosenThemeIdx: 0,
    // Event times are wall-clock in the event's city (see eventDateTime), not UTC instants.
    date: `${c.d(T)}T18:30:00`,
    createdAt: c.at(-9, "14:05"),
    runId: RUN.dinner,
    guests: guests([
      { id: "gst_ava", personId: PERSON.ava, name: "Ava Whitman", title: "Controller", accountDomain: DOMAIN.wrenfield, role: "customer_host", score: 96, personalLine: "Ran Wrenfield's first close on usage pricing; opens the night.", warmPath: "Customer", status: "confirmed", invitedOn: c.d(-7), dietary: "Vegetarian" },
      { id: "gst_rosa", name: "Rosa Delgado", title: "Former CFO, Meridian Works", accountDomain: "meridianworks.example", role: "anchor", score: 90, personalLine: "Took a usage-priced company through its first audit; the voice the room will trust.", warmPath: "Rohan Mehta", status: "accepted", invitedOn: c.d(-6) },
      { id: "gst_rohan", name: "Rohan Mehta", title: "Angel investor, former CFO", accountDomain: "rohanmehta.example", role: "connector", score: 70, personalLine: "Knows half the room; can make two intros on the night.", warmPath: "Your angel", status: "confirmed", invitedOn: c.d(-6) },
      { id: "gst_marcus", personId: PERSON.marcus, name: "Marcus Lindqvist", title: "VP Finance", accountDomain: DOMAIN.northwind, role: "prospect", score: 94, dealId: DEAL.northwind, personalLine: "First committed-use true-ups next quarter; wants to hear how peers handled it.", warmPath: "Dana Okafor", status: "accepted", invitedOn: c.d(-2) },
      { id: "gst_ethan", personId: PERSON.ethan, name: "Ethan Brooks", title: "Head of Revenue Accounting", accountDomain: DOMAIN.lumenwire, role: "prospect", score: 88, dealId: DEAL.lumenwire, personalLine: "Mid-pilot; hearing Ava's story helps him make the case to Grace.", warmPath: "Pilot customer", status: "accepted", invitedOn: c.d(-2) },
      { id: "gst_nadia", personId: PERSON.nadia, name: "Nadia Haddad", title: "VP Finance", accountDomain: DOMAIN.rowanstack, role: "prospect", score: 86, dealId: DEAL.rowanstack, personalLine: "Preparing for a first audit on usage revenue; seat her next to Rosa.", warmPath: "Tom Becker", status: "invited", invitedOn: c.d(-2) },
      { id: "gst_lena", personId: PERSON.lena, name: "Lena Fischer", title: "Head of Billing Operations", accountDomain: DOMAIN.glassmoor, role: "prospect", score: 84, personalLine: "New in the role at Glassmoor; ran billing infrastructure with you at Tollgate.", warmPath: "Former colleague", status: "accepted", invitedOn: c.d(-2) },
      { id: "gst_theo", personId: PERSON.theo, name: "Theo Grant", title: "Finance Lead", accountDomain: DOMAIN.hollowpine, role: "prospect", score: 78, personalLine: "Used Ledgerline at Wrenfield; now owns finance at Hollowpine.", warmPath: "Ava Whitman", status: "invited", invitedOn: c.d(-2) },
      { id: "gst_mei", personId: PERSON.mei, name: "Mei Tanaka", title: "Director of Finance", accountDomain: DOMAIN.driftglass, role: "prospect", score: 74, personalLine: "Just moved Driftglass to usage pricing; committed-use contracts next.", status: "declined", invitedOn: c.d(-2) },
      { id: "gst_owen", personId: PERSON.owen, name: "Owen Park", title: "Controller", accountDomain: DOMAIN.fernwick, role: "prospect", score: 72, personalLine: "First controller at Fernwick, rebuilding the close after per-trace pricing.", status: "candidate" },
      { id: "gst_sam", personId: PERSON.sam, name: "Sam Whitlock", title: "Controller", accountDomain: DOMAIN.cinderpath, role: "prospect", score: 58, personalLine: "Per-MAU billing; no sign yet that usage is the hard part. Invite if seats open.", status: "waitlist" },
    ]),
  };

  const roundtable: GtmEvent = {
    id: EVENT.roundtable,
    kind: "roundtable",
    title: "Roundtable: closing the month on usage billing",
    status: "done",
    plan: roundtablePlan(c),
    chosenThemeIdx: 0,
    date: `${c.d(-14)}T12:00:00`,
    venue: { name: "Video call" },
    createdAt: c.at(-36, "10:00"),
    guests: guests([
      { id: "rt_ava", personId: PERSON.ava, name: "Ava Whitman", title: "Controller", accountDomain: DOMAIN.wrenfield, role: "customer_host", score: 96, personalLine: "Framed the hour with Wrenfield's before and after.", status: "attended" },
      {
        id: "rt_dana",
        personId: PERSON.dana,
        name: "Dana Okafor",
        title: "Controller",
        accountDomain: DOMAIN.northwind,
        role: "prospect",
        score: 90,
        personalLine: "Hiring a revenue accountant for usage reconciliation.",
        status: "attended",
        debrief: {
          challenge: "Five-day usage tie-out that still ends in an unexplained adjustment.",
          nextStep: "Discovery call booked",
          fit: "pursue",
          nextMorningNote: "Dana, thanks for being so specific about the five-day tie-out. You asked how Ava handles late events; she's happy to compare notes. Do you have 30 minutes this week to walk through your close?",
        },
      },
      {
        id: "rt_tom",
        personId: PERSON.tom,
        name: "Tom Becker",
        title: "Director of Billing Operations",
        accountDomain: DOMAIN.rowanstack,
        role: "prospect",
        score: 88,
        dealId: DEAL.rowanstack,
        personalLine: "Rebuilds the reconciliation sheet every month.",
        status: "attended",
        debrief: {
          challenge: "Audit prep: needs a trail from every usage invoice to its events.",
          nextStep: "Proposal walkthrough with Nadia",
          fit: "pursue",
          nextMorningNote: "Tom, your point about the auditor sampling usage invoices first stuck with the group. I'll send the proposal ahead of the walkthrough with Nadia.",
        },
      },
      {
        id: "rt_leo",
        personId: PERSON.leo,
        name: "Leo Marchetti",
        title: "Controller",
        accountDomain: DOMAIN.saltmarsh,
        role: "prospect",
        score: 80,
        dealId: DEAL.saltmarsh,
        personalLine: "GPU-second billing with new reserved-capacity contracts.",
        status: "attended",
        debrief: {
          challenge: "Overage on reserved capacity has no reconciliation owner yet.",
          nextStep: null,
          fit: "nurture",
          nextMorningNote: "Leo, thanks for joining. The reserved-capacity overage question came up twice after you raised it. Happy to share how others split it.",
        },
      },
      {
        id: "rt_ben",
        personId: PERSON.ben,
        name: "Ben Adler",
        title: "Head of Data",
        accountDomain: DOMAIN.quillfeather,
        role: "prospect",
        score: 62,
        personalLine: "Building reconciliation in dbt.",
        status: "attended",
        debrief: {
          challenge: "Extending dbt models to reconcile usage; no finance owner.",
          nextStep: null,
          fit: "none",
          nextMorningNote: "Ben, thanks for the data team's view; it kept the hour honest. Good luck with the dbt build.",
        },
      },
      { id: "rt_sam", personId: PERSON.sam, name: "Sam Whitlock", title: "Controller", accountDomain: DOMAIN.cinderpath, role: "prospect", score: 58, personalLine: "Per-MAU billing.", status: "no_show" },
    ]),
  };

  return { [dinner.id]: dinner, [roundtable.id]: roundtable };
}
