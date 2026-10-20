import type { Activity, ID, OutreachPackage } from "@/lib/domain/types";
import { GRACE_BACK_IN_DAYS } from "./accounts";
import { draftStep } from "./build";
import type { Clock } from "./clock";
import { CLAIM, CONNECTOR, DEAL, DOMAIN, EVENT, PACKAGE, PERSON, POV, RUN } from "./ids";

/**
 * Four packages, one per mode the composer handles, built the way the compose workflow builds them:
 * a LinkedIn package's step is the post-accept message (the invite note sits on `linkedin.note`), and a
 * warm-intro package's step is the forwardable (the note to the connector sits on `intro.wrapper`).
 * Copy follows the outreach rules: one problem, one question, a cited premise, a founder POV or
 * credential, no links, no calendar, no hype. Lint runs later, against the assembled workspace.
 */
export function outreach(c: Clock): Record<ID, OutreachPackage> {
  const fernwickBody =
    "Owen, Fernwick's billing analyst posting asks the hire to \"reconcile metered trace usage to invoices every month.\" I've talked to 30 controllers at usage-priced companies this year. Most had a script for this. It outlived the analyst who wrote it, and the next hire got a black box. I spent five years on billing pipelines at Tollgate. Is the new analyst taking over a process you built, or starting from scratch?";

  const driftglassStep1 =
    "Mei, Driftglass now bills per query and per GB stored, two meters that land on one invoice. Usage leakage is rarely a billing bug. It is an event that arrives after the invoice run, and nobody owns the gap. One design partner cut month-end usage reconciliation from 4 days to 6 hours in their first close. Do you reconcile the storage meter the same way as queries today?";

  const driftglassStep2 =
    "Mei, the Series A announcement says Driftglass is building an enterprise tier on committed-use contracts. Each commitment adds a true-up line. The monthly usage export never sees it, so finance finds it at quarter-end. Is anyone on your team owning true-ups yet, or does that land on you?";

  const bramblecastNote =
    "Jordan, your post on closing per-minute billing matches what I saw running billing pipelines at Tollgate: late events end up on a sheet someone checks by hand. Glad to connect.";

  const bramblecastDm =
    "Thanks for connecting. Your post sends events that arrive after the invoice run to a true-up sheet your team reviews by hand. At Tollgate, that sheet is where most of our leakage hid. Does yours get reviewed every close, or only after a customer disputes an invoice?";

  const ashgroveWrapper =
    "Claire, would you introduce me to Rafael Ortiz, VP Finance at Ashgrove? They're hiring a revenue accounting manager to build a usage reconciliation process. That's the problem Ledgerline solves. A note you can forward is below. If the timing is wrong, no problem at all.";

  const ashgroveForwardable =
    "Rafael, I'm Priya, co-founder of Ledgerline. I spent five years building the billing pipeline at Tollgate. Ashgrove's posting for a revenue accounting manager asks the hire to \"build a scalable usage reconciliation process\" as fleets move to usage-based contracts. One design partner cut month-end usage reconciliation from 4 days to 6 hours in their first close. Would you give me 20 minutes on how Ashgrove closes per-device usage today? Not a pitch. Happy for you to forward this.";

  const list: OutreachPackage[] = [
    {
      id: PACKAGE.fernwickCold,
      mode: "cold",
      personId: PERSON.owen,
      accountDomain: DOMAIN.fernwick,
      angleId: "ang_fw_black_box",
      angleOrder: ["ang_fw_black_box", "ang_fw_late_traces"],
      createdAt: c.ago(4),
      runId: RUN.composeFernwick,
      steps: [
        draftStep({
          step: 1,
          frame: "founder_card",
          subject: "trace usage tie-out",
          body: fernwickBody,
          sendOn: c.today,
          spans: [{ text: "Fernwick's billing analyst posting asks the hire to \"reconcile metered trace usage to invoices every month.\"", evidenceId: "ev_fw_jd" }],
          evidenceIds: ["ev_fw_jd", "ev_fw_owen"],
          claimIds: [CLAIM.credential],
          credentialClaimId: CLAIM.credential,
          povId: POV.blackBox,
          angleId: "ang_fw_black_box",
        }),
      ],
      alternates: [],
      blockers: [],
      warnings: ["Owen published this address on Fernwick's pricing FAQ; it hasn't been verified."],
    },
    {
      id: PACKAGE.driftglassCold,
      mode: "cold",
      personId: PERSON.mei,
      accountDomain: DOMAIN.driftglass,
      angleId: "ang_dg_two_meters",
      angleOrder: ["ang_dg_two_meters", "ang_dg_true_ups"],
      createdAt: c.at(-4, "10:13"),
      runId: RUN.composeDriftglass,
      steps: [
        draftStep({
          step: 1,
          frame: "observation_problem_proof",
          subject: "queries vs storage",
          body: driftglassStep1,
          sendOn: c.d(-3),
          spans: [{ text: "Driftglass now bills per query and per GB stored", evidenceId: "ev_dg_pricing" }],
          claimIds: [CLAIM.designPartner],
          povId: POV.lateEvents,
          angleId: "ang_dg_two_meters",
          status: "sent",
          sentAt: c.at(-3, "09:12"),
        }),
        draftStep({
          step: 2,
          frame: "problem_prompter",
          subject: null,
          body: driftglassStep2,
          sendOn: c.today,
          spans: [{ text: "the Series A announcement says Driftglass is building an enterprise tier on committed-use contracts", evidenceId: "ev_dg_fund" }],
          povId: POV.consumption,
          angleId: "ang_dg_true_ups",
        }),
      ],
      alternates: [],
      blockers: [],
      warnings: ["Mei's address is a pattern guess you confirmed. If it bounces, switch to LinkedIn."],
    },
    {
      id: PACKAGE.bramblecastLinkedin,
      mode: "linkedin",
      personId: PERSON.jordan,
      accountDomain: DOMAIN.bramblecast,
      createdAt: c.at(-1, "08:20"),
      steps: [
        draftStep({
          step: 1,
          frame: "mouse_trap",
          subject: null,
          body: bramblecastDm,
          sendOn: c.today,
          spans: [{ text: "Your post sends events that arrive after the invoice run to a true-up sheet your team reviews by hand", evidenceId: "ev_bc_post" }],
          credentialClaimId: CLAIM.credential,
          povId: POV.lateEvents,
        }),
      ],
      alternates: [],
      linkedin: { note: bramblecastNote, recommendNoNote: false, postAcceptDm: bramblecastDm },
      blockers: [],
      warnings: ["Free LinkedIn notes left this month: 2 of 3. This one is worth it: the context is his own post."],
    },
    {
      id: PACKAGE.ashgroveIntro,
      mode: "warm_intro",
      personId: PERSON.rafael,
      accountDomain: DOMAIN.ashgrove,
      connectorId: CONNECTOR.claire,
      createdAt: c.at(-1, "08:25"),
      steps: [
        draftStep({
          step: 1,
          frame: "intro",
          subject: "usage reconciliation at Ashgrove",
          body: ashgroveForwardable,
          sendOn: c.today,
          spans: [{ text: "Ashgrove's posting for a revenue accounting manager asks the hire to \"build a scalable usage reconciliation process\"", evidenceId: "ev_ag_jd" }],
          evidenceIds: ["ev_ag_jd", "ev_ag_fund"],
          claimIds: [CLAIM.credential, CLAIM.designPartner],
          credentialClaimId: CLAIM.credential,
        }),
      ],
      alternates: [],
      intro: {
        connectorName: "Claire Donovan",
        wrapper: ashgroveWrapper,
        forwardable: { subject: "usage reconciliation at Ashgrove", body: ashgroveForwardable },
      },
      blockers: [],
      warnings: [],
    },
  ];
  return Object.fromEntries(list.map((p) => [p.id, p]));
}

/* ───────────── The last three weeks, oldest first ───────────── */

export function activities(c: Clock): Activity[] {
  let n = 0;
  const a = (x: Omit<Activity, "id">): Activity => ({ id: `act_${String(++n).padStart(3, "0")}`, source: "founder", ...x });
  return [
    a({ at: c.at(-20, "09:10"), kind: "touch_sent", personId: PERSON.leo, accountDomain: DOMAIN.saltmarsh, channel: "email", signalType: "jd_names_pain", summary: "Cold email to Leo Marchetti about the GPU-second reconciliation posting" }),
    a({ at: c.at(-20, "14:00"), kind: "meeting_held", personId: PERSON.ben, accountDomain: DOMAIN.quillfeather, dealId: DEAL.quillfeather, channel: "phone", summary: "Technical call with Ben Adler, Head of Data" }),
    a({ at: c.at(-19, "16:30"), kind: "stage_changed", accountDomain: DOMAIN.wrenfield, dealId: DEAL.wrenfield, summary: "Wrenfield moved to Won: $30,000 annual after the design-partner close" }),
    a({
      at: c.at(-18, "08:47"),
      kind: "reply_received",
      personId: PERSON.leo,
      accountDomain: DOMAIN.saltmarsh,
      channel: "email",
      sentiment: "positive",
      summary: "Leo Marchetti replied: open to a call",
      body: "Timing's decent. Our close has been rough since reserved capacity launched. Next week works.",
    }),
    a({ at: c.at(-17, "11:05"), kind: "stage_changed", accountDomain: DOMAIN.saltmarsh, dealId: DEAL.saltmarsh, summary: "Saltmarsh moved to Talking: discovery booked" }),
    a({ at: c.at(-16, "10:00"), kind: "meeting_held", personId: PERSON.ethan, accountDomain: DOMAIN.lumenwire, dealId: DEAL.lumenwire, channel: "phone", summary: "Pilot kickoff with Ethan Brooks and Grace Liu" }),
    a({ at: c.at(-16, "11:30"), kind: "stage_changed", accountDomain: DOMAIN.lumenwire, dealId: DEAL.lumenwire, summary: "Lumenwire moved to Pilot: $7,500, credited to annual" }),
    a({
      at: c.at(-15, "16:40"),
      kind: "reply_received",
      personId: PERSON.ben,
      accountDomain: DOMAIN.quillfeather,
      dealId: DEAL.quillfeather,
      channel: "email",
      sentiment: "negative",
      summary: "Ben Adler: they'll extend their dbt models instead",
      body: "We're going to extend our dbt models for now. Thanks for the time, and I'll reach out if that changes.",
    }),
    a({ at: c.at(-15, "17:00"), kind: "stage_changed", accountDomain: DOMAIN.quillfeather, dealId: DEAL.quillfeather, summary: "Quillfeather moved to Lost: building in-house" }),
    a({ at: c.at(-14, "13:00"), kind: "event_attended", personId: PERSON.dana, accountDomain: DOMAIN.northwind, eventId: EVENT.roundtable, channel: "in_person", summary: "Dana Okafor attended the roundtable" }),
    a({ at: c.at(-14, "13:00"), kind: "event_attended", personId: PERSON.tom, accountDomain: DOMAIN.rowanstack, eventId: EVENT.roundtable, channel: "in_person", summary: "Tom Becker attended the roundtable" }),
    a({ at: c.at(-13, "10:05"), kind: "stage_changed", accountDomain: DOMAIN.northwind, dealId: DEAL.northwind, summary: "Northwind moved to Talking: discovery booked after the roundtable" }),
    a({ at: c.at(-12, "15:00"), kind: "meeting_held", personId: PERSON.dana, accountDomain: DOMAIN.northwind, dealId: DEAL.northwind, channel: "phone", summary: "Discovery with Dana Okafor" }),
    a({ at: c.at(-12, "17:20"), kind: "touch_sent", personId: PERSON.dana, accountDomain: DOMAIN.northwind, dealId: DEAL.northwind, channel: "email", summary: "Recap to Dana Okafor" }),
    a({ at: c.at(-9, "11:00"), kind: "meeting_held", personId: PERSON.nadia, accountDomain: DOMAIN.rowanstack, dealId: DEAL.rowanstack, channel: "phone", summary: "Proposal walkthrough with Nadia Haddad and Tom Becker" }),
    a({ at: c.at(-9, "12:15"), kind: "stage_changed", accountDomain: DOMAIN.rowanstack, dealId: DEAL.rowanstack, summary: "Rowanstack moved to Proposal: $48,000 annual" }),
    a({ at: c.at(-9, "13:00"), kind: "touch_sent", personId: PERSON.nadia, accountDomain: DOMAIN.rowanstack, dealId: DEAL.rowanstack, channel: "email", summary: "Sent the proposal and order form to Nadia Haddad" }),
    a({ at: c.at(-9, "16:00"), kind: "note", eventId: EVENT.dinner, summary: "Claire Donovan agreed to co-host the New York dinner and split the cost" }),
    a({ at: c.at(-6, "13:00"), kind: "meeting_held", personId: PERSON.leo, accountDomain: DOMAIN.saltmarsh, dealId: DEAL.saltmarsh, channel: "phone", summary: "Discovery with Leo Marchetti" }),
    a({ at: c.at(-6, "16:10"), kind: "touch_sent", personId: PERSON.leo, accountDomain: DOMAIN.saltmarsh, dealId: DEAL.saltmarsh, channel: "email", summary: "Recap and one-pager to Leo Marchetti" }),
    a({ at: c.at(-6, "17:00"), kind: "intro_requested", personId: PERSON.ava, accountDomain: DOMAIN.wrenfield, channel: "intro", summary: "Asked Ava Whitman for two controller intros" }),
    a({ at: c.at(-5, "18:31"), kind: "note", source: "ember", summary: "LinkedIn re-import: 2 people moved to ICP companies (Glassmoor, Hollowpine)" }),
    a({
      at: c.at(-4, "15:05"),
      kind: "reply_received",
      personId: PERSON.ava,
      accountDomain: DOMAIN.wrenfield,
      channel: "email",
      sentiment: "referral",
      summary: "Ava Whitman pointed you to Theo Grant at Hollowpine",
      body: "Happy to. Theo just started at Hollowpine as Finance Lead. He ran our close on Ledgerline, so he'd take your call. Second name coming once I've asked her.",
    }),
    a({ at: c.at(-4, "16:20"), kind: "touch_sent", personId: PERSON.ava, accountDomain: DOMAIN.wrenfield, channel: "email", summary: "Thanked Ava; said you'd write to Theo directly" }),
    a({
      at: c.at(-3, "09:12"),
      kind: "touch_sent",
      personId: PERSON.mei,
      accountDomain: DOMAIN.driftglass,
      channel: "email",
      draftRef: { packageId: PACKAGE.driftglassCold, step: 1 },
      angleId: "ang_dg_two_meters",
      signalType: "launch",
      summary: "Cold email to Mei Tanaka: queries vs storage",
    }),
    a({
      at: c.at(-3, "10:20"),
      kind: "reply_received",
      personId: PERSON.nadia,
      accountDomain: DOMAIN.rowanstack,
      dealId: DEAL.rowanstack,
      channel: "email",
      sentiment: "neutral",
      summary: "Nadia Haddad: counsel has the order form",
      body: `Counsel has the order form. Redlines back by ${c.label(-2)}.`,
    }),
    a({ at: c.at(-3, "10:45"), kind: "touch_sent", personId: PERSON.nadia, accountDomain: DOMAIN.rowanstack, dealId: DEAL.rowanstack, channel: "email", summary: "Thanked Nadia; offered a call with counsel if anything needs explaining" }),
    a({ at: c.at(-2, "11:30"), kind: "event_invited", personId: PERSON.marcus, accountDomain: DOMAIN.northwind, eventId: EVENT.dinner, channel: "email", summary: "Invited Marcus Lindqvist to the New York dinner" }),
    a({ at: c.at(-2, "11:40"), kind: "event_invited", personId: PERSON.lena, accountDomain: DOMAIN.glassmoor, eventId: EVENT.dinner, channel: "linkedin", summary: "Invited Lena Fischer to the New York dinner" }),
    a({
      at: c.at(-1, "09:40"),
      kind: "reply_received",
      personId: PERSON.grace,
      accountDomain: DOMAIN.lumenwire,
      dealId: DEAL.lumenwire,
      channel: "email",
      sentiment: "ooo",
      summary: `Grace Liu is out of office until ${c.weekday(GRACE_BACK_IN_DAYS)}`,
      body: `I'm out of the office until ${c.weekday(GRACE_BACK_IN_DAYS)}. For anything urgent, contact Ethan Brooks.`,
    }),
    a({ at: c.at(-1, "11:00"), kind: "meeting_held", personId: PERSON.marcus, accountDomain: DOMAIN.northwind, dealId: DEAL.northwind, channel: "phone", summary: "Follow-up with Dana Okafor and Marcus Lindqvist" }),
    a({ at: c.at(-1, "12:31"), kind: "stage_changed", accountDomain: DOMAIN.northwind, dealId: DEAL.northwind, summary: "Northwind moved to Qualified: 10 of 12" }),
    a({ at: c.at(-1, "13:05"), kind: "touch_sent", personId: PERSON.dana, accountDomain: DOMAIN.northwind, dealId: DEAL.northwind, channel: "email", summary: "Recap to Dana Okafor and Marcus Lindqvist" }),
    a({
      at: c.ago(95),
      kind: "reply_received",
      personId: PERSON.dana,
      accountDomain: DOMAIN.northwind,
      dealId: DEAL.northwind,
      channel: "email",
      sentiment: "positive",
      summary: "Dana Okafor: recap looks right, Sofia is in",
      body: "Recap looks right. Sofia is in for the deep-dive and will send the invite. One question: can the security answers cover EU data, since Sofia's team is in Lisbon?",
    }),
  ];
}
