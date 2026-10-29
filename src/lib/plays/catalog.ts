import { addDays, daysBetween } from "@/lib/domain/ids";
import { OPEN_STAGES, STAGE_LABELS, type Account, type Deal, type ID, type ISODate, type Person, type Signal, type SignalType, type Workspace } from "@/lib/domain/types";
import { openIntroFor } from "@/lib/intros/rules";
import { bestPerson, clip, companyName, daysSince, first, isOpen, isSuppressed, localDate, plural } from "@/lib/moves/util";

/**
 * Plays: the repeatable programs a GTM team runs, each a trigger you could write down, an audience, one
 * action and a result you can count. Triggers are code over the workspace (signals with dates, deals with
 * history, activities), so matching costs nothing and every match shows the fact that triggered it.
 * Running plays feed Today; pausing one takes its cards off Today. Nothing here sends anything.
 */

export type PlayFamily = "signal" | "network" | "pipeline" | "customer";
export type PlayActionKind = "write" | "intro" | "research" | "deal";

export interface PlayMatch {
  /** Stable per play and subject, so a match keeps its identity across days. */
  key: string;
  domain: string;
  company: string;
  personId?: ID;
  personName?: string;
  dealId?: ID;
  /** The triggering fact, ≤ 90 chars: "Lena Fischer started as Head of Billing Ops". */
  headline: string;
  date?: ISODate;
  url?: string;
  /** Higher is better: fit, strength and recency. Ranks matches inside a play. */
  score: number;
  /** Already worked: touched in the last 30 days, or an open draft or intro covers it. */
  worked: boolean;
}

export interface PlayDef {
  id: string;
  name: string;
  family: PlayFamily;
  /** The trigger, in words a GTM engineer could implement: "A new VP or C-level in the buying seat started ≤ 90 days ago". */
  trigger: string;
  /** Why it works, ≤ 30 words, with a number where there is one. */
  why: string;
  /** Who to contact. */
  audience: string;
  action: { kind: PlayActionKind; label: string };
  /** How long a trigger stays live. */
  windowDays: number;
  /** "free": public signals and the workspace. "paid": needs intent or visitor data Inroad doesn't buy. */
  data: "free" | "paid";
  /** Signal types that trigger it, for signal plays (the Today signal rule uses this mapping too). */
  signals?: SignalType[];
  /** How to run it well, ≤ 40 words. Shown on the play and on its Today card. */
  coach: string;
  /** For plays worked as a personal note rather than a sequenced draft: what to ask me to write. */
  prompt?: (m: PlayMatch, ws: Workspace) => string;
  /** Where the number in `why` comes from. Vendor data is labelled as such. */
  source?: { label: string; url: string };
  /** Signal plays: the days after a signal when it's freshest (scored highest), within the window. */
  bestDays?: [number, number];
  /** Signal plays: the account tiers the play runs on. */
  tiers?: Account["tier"][];
  match: (ws: Workspace, today: ISODate) => PlayMatch[];
}

const TIER_WEIGHT: Record<Account["tier"], number> = { A: 30, B: 18, C: 6 };

function touchedSince(ws: Workspace, domain: string, since: ISODate): boolean {
  return ws.activities.some((a) => a.accountDomain === domain && (a.kind === "touch_sent" || a.kind === "linkedin_dm" || a.kind === "intro_requested") && a.outcome !== "not_sent" && localDate(a.at) >= since);
}

function draftedSince(ws: Workspace, domain: string, since: ISODate): boolean {
  return Object.values(ws.outreach).some((p) => p.accountDomain === domain && localDate(p.createdAt) >= since);
}

/** Not a customer, not ruled out, and no open or parked deal: a company still to win. */
function prospect(ws: Workspace, acc: Account): boolean {
  if (acc.status === "disqualified" || acc.status === "customer") return false;
  const stage = acc.dealId ? ws.deals[acc.dealId]?.stage : undefined;
  return !stage || (stage !== "nurture" && !OPEN_STAGES.includes(stage));
}

function recent(today: ISODate, date: ISODate | undefined, window: number): number {
  if (!date) return 0;
  return Math.max(0, (window - daysSince(date, today)) / window) * 20;
}

function personMatch(ws: Workspace, acc: Account): { person?: Person; personId?: ID; personName?: string } {
  const person = bestPerson(ws, acc);
  if (!person || isSuppressed(ws, person, acc.domain)) return {};
  return { person, personId: person.id, personName: person.name };
}

/** One match per account: its strongest fresh signal of these types, scored highest inside its best days. */
function signalMatches(playId: string, types: SignalType[], window: number, tiers: Account["tier"][], best?: [number, number]) {
  return (ws: Workspace, today: ISODate): PlayMatch[] => {
    const out: PlayMatch[] = [];
    for (const acc of Object.values(ws.accounts)) {
      if (!tiers.includes(acc.tier) || !prospect(ws, acc)) continue;
      const sig = acc.signals
        .filter((s): s is Signal => types.includes(s.type) && !!s.date && daysSince(s.date, today) <= window && s.type !== "sensitive")
        .sort((a, b) => b.strength - a.strength || b.date.localeCompare(a.date))[0];
      if (!sig) continue;
      const who = personMatch(ws, acc);
      out.push({
        key: `${playId}:${acc.domain}:${sig.id}`,
        domain: acc.domain,
        company: acc.name,
        personId: who.personId,
        personName: who.personName,
        headline: clip(sig.headline, 90),
        date: sig.date,
        url: sig.url,
        score:
          TIER_WEIGHT[acc.tier] +
          sig.strength * 8 +
          recent(today, sig.date, window) +
          (acc.warmPathCount > 0 ? 6 : 0) +
          (best && daysSince(sig.date, today) >= best[0] && daysSince(sig.date, today) <= best[1] ? 10 : 0),
        worked: touchedSince(ws, acc.domain, sig.date) || draftedSince(ws, acc.domain, sig.date) || !!openIntroFor(ws, acc.domain),
      });
    }
    return out;
  };
}

function lostOn(deal: Deal): ISODate | undefined {
  const h = [...deal.stageHistory].reverse().find((x) => x.stage === "lost");
  return h ? localDate(h.at) : undefined;
}

function wonOn(deal: Deal): ISODate | undefined {
  const h = [...deal.stageHistory].reverse().find((x) => x.stage === "won");
  return h ? localDate(h.at) : undefined;
}

function dealPerson(ws: Workspace, deal: Deal): Person | undefined {
  const champ = deal.contacts.find((c) => c.role === "champion") ?? deal.contacts[0];
  return champ ? ws.people[champ.personId] : undefined;
}

/**
 * How long each kind of no takes to expire. Fit and pain losses never come back on their own; any other
 * loss comes back early when a fresh leader, round or first hire shows up at the account.
 */
export const REVISIT_AFTER: Partial<Record<NonNullable<Deal["lossReason"]>, number>> = { went_dark: 60, timing: 90, no_budget: 120, price: 180, competitor: 300 };
const REVISIT_MAX_DAYS = 540;
const REOPENERS: SignalType[] = ["new_leader", "funding", "first_hire", "jd_names_pain"];

export const PLAYS: PlayDef[] = [
  {
    id: "new_leader",
    name: "New leader in the buying seat",
    family: "signal",
    trigger: "A new leader in the buying function started in the last 90 days at an A or B account with no open deal.",
    why: "A VP-level hire came before 28% more software purchases in a study of about 1M of them. New leaders set priorities in their first quarter.",
    audience: "The new leader",
    action: { kind: "write", label: "Write to them" },
    windowDays: 90,
    data: "free",
    signals: ["new_leader"],
    bestDays: [14, 60],
    source: { label: "Bloomberry, 1M software purchases (vendor data)", url: "https://bloomberry.com/blog/i-analyzed-1m-software-purchases-to-find-the-strongest-buyer-intent-signals/" },
    coach: "Lead with what new leaders are measured on in their first quarter, not with your product. One observation, one question; no meeting ask in the first note.",
    tiers: ["A", "B"],
    match: signalMatches("new_leader", ["new_leader"], 90, ["A", "B"], [14, 60]),
  },
  {
    id: "hiring_for_pain",
    name: "Hiring for the problem you solve",
    family: "signal",
    trigger: "A job post in the last 60 days names the pain, or is the first hire for the role you replace, at an A or B account. Generic hiring doesn't count.",
    why: "A post that names the pain is the company writing down the problem and the budget. Generic hiring growth barely moves buying odds (+7%).",
    audience: "The hiring manager",
    action: { kind: "write", label: "Write to the hiring manager" },
    windowDays: 60,
    data: "free",
    signals: ["jd_names_pain", "first_hire"],
    bestDays: [0, 21],
    source: { label: "Bloomberry, 1M software purchases (vendor data)", url: "https://bloomberry.com/blog/i-analyzed-1m-software-purchases-to-find-the-strongest-buyer-intent-signals/" },
    coach: "Quote the posting back to them: the task they're hiring for is the pain. Offer how others handle it before the hire lands.",
    tiers: ["A", "B"],
    match: signalMatches("hiring_for_pain", ["jd_names_pain", "first_hire"], 60, ["A", "B"], [0, 21]),
  },
  {
    id: "funding",
    name: "Fresh funding",
    family: "signal",
    trigger: "A priced round or Form D filing in the last 60 days at an A or B account.",
    why: "A round came before 25% more software purchases over the next six months. Skip the first week's inbox flood; write while the plan is being made.",
    audience: "The leader who owns the problem",
    action: { kind: "write", label: "Write to the owner" },
    windowDays: 60,
    data: "free",
    signals: ["funding", "filing"],
    bestDays: [7, 45],
    source: { label: "Bloomberry, 1M software purchases (vendor data)", url: "https://bloomberry.com/blog/i-analyzed-1m-software-purchases-to-find-the-strongest-buyer-intent-signals/" },
    coach: "Skip the congratulations. Name the thing the round makes harder (scale, enterprise deals, an audit) and ask how they're handling it.",
    tiers: ["A", "B"],
    match: signalMatches("funding", ["funding", "filing"], 60, ["A", "B"], [7, 45]),
  },
  {
    id: "change_event",
    name: "Launch, pricing or stack change",
    family: "signal",
    trigger: "A launch, pricing change, stack change or compliance deadline in the last 60 days at an A or B account.",
    why: "A change creates new work nobody planned for. The angle writes itself from what they announced.",
    audience: "Whoever inherits the new work",
    action: { kind: "write", label: "Write about the change" },
    windowDays: 60,
    data: "free",
    signals: ["launch", "stack_change", "compliance_deadline"],
    coach: "Write about the new work the change creates for them, citing what they announced. One question about how they'll handle it.",
    tiers: ["A", "B"],
    match: signalMatches("change_event", ["launch", "stack_change", "compliance_deadline"], 60, ["A", "B"]),
  },
  {
    id: "public_pain",
    name: "They said it in public",
    family: "signal",
    trigger: "Someone in the buying persona posted about the problem, or asked for help in a community, in the last 30 days.",
    why: "A public post is permission to reply. Answer where they asked first; email only after they engage.",
    audience: "The person who posted",
    action: { kind: "write", label: "Reply where they posted" },
    windowDays: 30,
    data: "free",
    signals: ["persona_post", "community_request", "public_pain"],
    coach: "Answer in the thread, as yourself, with something useful. Don't pitch and don't move it to email until they engage.",
    tiers: ["A", "B", "C"],
    match: signalMatches("public_pain", ["persona_post", "community_request", "public_pain"], 30, ["A", "B", "C"]),
  },
  {
    id: "champion_moved",
    name: "Champion changed jobs",
    family: "network",
    trigger: "Someone who knows you or the product started at an ICP company in the last 120 days.",
    why: "They already trust you and know the problem. Best between days 14 and 60, once they've settled in; how it's written matters more than the alert.",
    audience: "Your former champion",
    action: { kind: "write", label: "Congratulate, then ask" },
    windowDays: 120,
    data: "free",
    signals: ["champion_job_change"],
    bestDays: [14, 60],
    coach: "Congratulate them on the new role, then ask how they're finding the problem at the new place. They know you: no template, your own words.",
    prompt: (m) => `Draft a short personal note to ${m.personName ?? "my former champion"}, who just moved to ${m.company} (${m.headline}). Congratulate them, then ask one question about whether the problem we solved together exists there. Under 80 words, my voice, no template.`,
    tiers: ["A", "B", "C"],
    match: signalMatches("champion_moved", ["champion_job_change"], 120, ["A", "B", "C"], [14, 60]),
  },
  {
    id: "warm_path",
    name: "Warm path into a target",
    family: "network",
    trigger: "An A or B account with no deal where someone you know works, and no touch or intro in 30 days.",
    why: "An intro converts to a meeting at about 10× a cold email. Spend the network on accounts that fit.",
    audience: "The person you know, or an intro through them",
    action: { kind: "intro", label: "Ask for the intro" },
    windowDays: 30,
    data: "free",
    coach: "Ask for the intro with a forwardable note: who you are, why them, why now, in three lines the connector can pass on unchanged.",
    match: (ws, today) =>
      Object.values(ws.accounts)
        .filter((a) => (a.tier === "A" || a.tier === "B") && a.warmPathCount > 0 && prospect(ws, a) && !(a.dealId && ws.deals[a.dealId]))
        .map((acc) => {
          const who = personMatch(ws, acc);
          return {
            key: `warm_path:${acc.domain}`,
            domain: acc.domain,
            company: acc.name,
            personId: who.personId,
            personName: who.personName,
            headline: `${plural(acc.warmPathCount, "person", "people")} you know there${acc.whyNow ? ` · ${clip(acc.whyNow, 50)}` : ""}`,
            score: TIER_WEIGHT[acc.tier] + acc.fitScore / 10 + acc.warmPathCount * 2,
            worked: touchedSince(ws, acc.domain, addDays(today, -30)) || draftedSince(ws, acc.domain, addDays(today, -30)) || !!openIntroFor(ws, acc.domain),
          };
        }),
  },
  {
    id: "multi_thread",
    name: "Multi-thread qualified deals",
    family: "pipeline",
    trigger: "An open deal at Qualified or later with one contact or none.",
    why: "Single-threaded deals lose far more often; won deals usually have three or more people engaged on the buyer side.",
    audience: "Economic buyer and technical approver",
    action: { kind: "deal", label: "Add a second thread" },
    windowDays: 0,
    data: "free",
    coach: "Ask your contact who else feels this and who signs, with a reason that helps them: a review they'd want, not a favor to you.",
    prompt: (m) => `${m.company} is single-threaded through ${m.personName ?? "one contact"}. Who should I bring in (economic buyer, technical approver), and draft the note asking ${m.personName ? m.personName.split(" ")[0] : "them"} to loop them in, with a reason that serves them.`,
    match: (ws) =>
      Object.values(ws.deals)
        .filter((d) => isOpen(d) && d.stage !== "talking" && d.contacts.length <= 1)
        .map((deal) => {
          const p = dealPerson(ws, deal);
          return {
            key: `multi_thread:${deal.id}`,
            domain: deal.accountDomain,
            company: companyName(ws, deal.accountDomain),
            dealId: deal.id,
            personId: p?.id,
            personName: p?.name,
            headline: `${deal.stage === "proposal" ? "Proposal" : deal.stage === "pilot" ? "Pilot" : "Qualified"} · only ${p ? first(p.name) : "no one"} on the buyer side`,
            score: (deal.stage === "proposal" ? 40 : deal.stage === "pilot" ? 34 : 26) + (deal.amountUsd ?? 0) / 10_000,
            worked: false,
          };
        }),
  },
  {
    id: "stalled_rescue",
    name: "Rescue a stalled deal",
    family: "pipeline",
    trigger: "An open deal with no activity in 21 days.",
    why: "After three quiet weeks a deal is more likely lost than late. A direct, honest note gets an answer either way.",
    audience: "Your main contact",
    action: { kind: "write", label: "Write the honest note" },
    windowDays: 0,
    data: "free",
    coach: "Be direct: say it's gone quiet, offer an easy way out, and ask where it stands. Honest notes get answers; bumps don't.",
    prompt: (m) => `${m.company} has gone quiet (${m.headline.toLowerCase()}). Draft an honest, short note to ${m.personName ?? "my main contact"} that makes it easy to say where it stands, including "not now". Under 80 words.`,
    match: (ws, today) =>
      Object.values(ws.deals)
        .filter((d) => isOpen(d) && daysSince(d.lastActivityAt || d.updatedAt, today) >= 21)
        .map((deal) => {
          const p = dealPerson(ws, deal);
          const quiet = daysSince(deal.lastActivityAt || deal.updatedAt, today);
          return {
            key: `stalled_rescue:${deal.id}`,
            domain: deal.accountDomain,
            company: companyName(ws, deal.accountDomain),
            dealId: deal.id,
            personId: p?.id,
            personName: p?.name,
            headline: `Quiet for ${quiet} days at ${deal.stage}`,
            date: localDate(deal.lastActivityAt || deal.updatedAt),
            score: 20 + Math.min(30, quiet) + (deal.amountUsd ?? 0) / 10_000,
            worked: false,
          };
        }),
  },
  {
    id: "closed_lost_revisit",
    name: "Revisit closed-lost",
    family: "pipeline",
    trigger: "A lost deal whose reason has had time to expire (silence 60 days, timing 90, budget 120, price 180, a competitor 300), or any lost deal with a fresh leader, round or first hire, and no touch since.",
    why: "A timing or budget no expires. These buyers already know the problem and you; the only question is whether it's now. Hold some back to measure it.",
    audience: "The champion on the lost deal",
    action: { kind: "write", label: "Write the check-back" },
    windowDays: 365,
    data: "free",
    coach: "Name why it ended, ask if that's changed, and bring one thing that's new since. No guilt, no 'just checking in'.",
    prompt: (m) => `Draft a check-back note to ${m.personName ?? "the champion"} at ${m.company}. ${m.headline}. Ask whether that has changed and give one concrete reason it might be worth a look now. Under 90 words, my voice, no pressure.`,
    match: (ws, today) =>
      Object.values(ws.deals)
        .filter((d) => d.stage === "lost" && !!d.lossReason && d.lossReason !== "not_icp" && d.lossReason !== "no_pain")
        .flatMap((deal) => {
          const on = lostOn(deal);
          const acc = ws.accounts[deal.accountDomain];
          if (!on || !acc || acc.status === "disqualified" || acc.status === "customer") return [];
          const age = daysSince(on, today);
          const wait = REVISIT_AFTER[deal.lossReason!];
          const reopener = age >= 30 ? acc.signals.find((x) => REOPENERS.includes(x.type) && x.date >= on && daysSince(x.date, today) <= 45 && x.strength >= 2) : undefined;
          if (!(reopener || (wait !== undefined && age >= wait)) || age > REVISIT_MAX_DAYS || touchedSince(ws, deal.accountDomain, on)) return [];
          const p = dealPerson(ws, deal);
          if (p && isSuppressed(ws, p, deal.accountDomain)) return [];
          const reason = deal.lossReason!.replace(/_/g, " ");
          return [
            {
              key: `closed_lost_revisit:${deal.id}`,
              domain: deal.accountDomain,
              company: acc.name,
              dealId: deal.id,
              personId: p?.id,
              personName: p?.name,
              headline: reopener ? `Lost to ${reason}; since then: ${clip(reopener.headline, 50)}` : `Lost ${Math.max(1, Math.round(age / 30))} months ago: ${reason}`,
              date: reopener?.date ?? on,
              url: reopener?.url,
              score: TIER_WEIGHT[acc.tier] + (deal.amountUsd ?? 0) / 5_000 + (reopener ? 20 : 0) + (deal.lossReason === "timing" ? 6 : 0),
              worked: draftedSince(ws, deal.accountDomain, on),
            },
          ];
        }),
  },
  {
    id: "customer_referral",
    name: "Ask customers for referrals",
    family: "customer",
    trigger: "A customer that signed 30 to 180 days ago, with no referral or intro asked since.",
    why: "Referred deals close faster and at higher win rates than any outbound channel. The best time to ask is after first value.",
    audience: "Your champion at the customer",
    action: { kind: "intro", label: "Ask for a referral" },
    windowDays: 180,
    data: "free",
    coach: "Give before you get: offer something useful, then ask who else has the same problem. Make the ask specific (a role at a kind of company).",
    prompt: (m) => `Draft a note to ${m.personName ?? "my champion"} at ${m.company}, a customer, asking who else they know with the same problem (a peer at another company). Offer something useful first and make the ask specific. Under 90 words.`,
    match: (ws, today) =>
      Object.values(ws.deals)
        .filter((d) => d.stage === "won")
        .flatMap((deal) => {
          const on = wonOn(deal);
          if (!on) return [];
          const age = daysSince(on, today);
          if (age < 30 || age > 180) return [];
          const asked = ws.activities.some((a) => a.accountDomain === deal.accountDomain && a.kind === "intro_requested" && localDate(a.at) >= on);
          if (asked) return [];
          const p = dealPerson(ws, deal);
          return [
            {
              key: `customer_referral:${deal.id}`,
              domain: deal.accountDomain,
              company: companyName(ws, deal.accountDomain),
              dealId: deal.id,
              personId: p?.id,
              personName: p?.name,
              headline: `Customer for ${Math.round(age / 7)} weeks${p ? ` · ${first(p.name)} championed it` : ""}`,
              date: on,
              score: 30 + (deal.amountUsd ?? 0) / 5_000,
              worked: false,
            },
          ];
        }),
  },
  {
    id: "event_follow_up",
    name: "Follow up after an event",
    family: "customer",
    trigger: "Someone attended your dinner or roundtable in the last 14 days and hasn't heard from you since.",
    why: "Post-event follow-up inside 48 hours is where event pipeline is made; after two weeks the room is forgotten.",
    audience: "The guest",
    action: { kind: "write", label: "Write the follow-up" },
    windowDays: 14,
    data: "free",
    coach: "Within 48 hours: reference something they said in the room, send one useful thing, ask one question.",
    prompt: (m) => `Draft the follow-up to ${m.personName ?? "the guest"} at ${m.company} after our event (${m.headline}). Reference the conversation, offer one useful thing, ask one question. Under 90 words.`,
    match: (ws, today) => {
      const out: PlayMatch[] = [];
      const seen = new Set<string>();
      for (const a of ws.activities) {
        if (a.kind !== "event_attended" || !a.personId || !a.accountDomain || seen.has(a.personId)) continue;
        const on = localDate(a.at);
        if (daysSince(on, today) > 14) continue;
        seen.add(a.personId);
        const p = ws.people[a.personId];
        // Guests whose company is already an open deal are followed up through the deal.
        if (!p || isSuppressed(ws, p, a.accountDomain) || isOpen(ws.deals[ws.accounts[a.accountDomain]?.dealId ?? ""])) continue;
        const since = ws.activities.some((x) => x.personId === a.personId && x.kind === "touch_sent" && localDate(x.at) >= on);
        if (since) continue;
        out.push({
          key: `event_follow_up:${a.personId}:${on}`,
          domain: a.accountDomain,
          company: companyName(ws, a.accountDomain),
          personId: p.id,
          personName: p.name,
          headline: `${first(p.name)} came to ${a.eventId ? ws.events[a.eventId]?.title ?? "your event" : "your event"}`,
          date: on,
          score: 30 + recent(today, on, 14),
          worked: false,
        });
      }
      return out;
    },
  },
  {
    id: "lookalike",
    name: "Lookalikes of your customers",
    family: "customer",
    trigger: "An untouched A-tier account that meets at least two of the same ICP criteria your won customers met.",
    why: "Your best predictor of the next customer is the last one. Score new accounts by what your wins have in common, not by guesswork.",
    audience: "The same persona that bought last time",
    action: { kind: "research", label: "Research it" },
    windowDays: 0,
    data: "free",
    coach: "Research first: confirm the shared traits on their site and job posts, then write the way you wrote to the customer they resemble.",
    match: (ws) => {
      const wonDomains = Object.values(ws.deals).filter((d) => d.stage === "won").map((d) => d.accountDomain);
      const shared = new Map<string, number>();
      for (const domain of wonDomains) for (const c of ws.accounts[domain]?.criteria ?? []) if (c.met === "true") shared.set(c.criterionId, (shared.get(c.criterionId) ?? 0) + 1);
      if (!shared.size) return [];
      const touched = new Set(Object.values(ws.outreach).map((p) => p.accountDomain));
      return Object.values(ws.accounts)
        .filter((a) => a.tier === "A" && prospect(ws, a) && !a.dealId && !touched.has(a.domain))
        .flatMap((acc) => {
          const common = acc.criteria.filter((c) => c.met === "true" && shared.has(c.criterionId));
          if (common.length < 2) return [];
          const criteria = ws.foundation?.icp.criteria ?? [];
          const names = common.map((c) => criteria.find((x) => x.id === c.criterionId)?.text).filter(Boolean) as string[];
          return [
            {
              key: `lookalike:${acc.domain}`,
              domain: acc.domain,
              company: acc.name,
              headline: `Shares ${common.length} traits with your customers${names[0] ? `: ${clip(names[0], 50)}` : ""}`,
              score: TIER_WEIGHT[acc.tier] + common.length * 8 + acc.fitScore / 10,
              worked: !!acc.dossier,
            },
          ];
        });
    },
  },
];

export const PLAY_BY_ID: Record<string, PlayDef> = Object.fromEntries(PLAYS.map((p) => [p.id, p]));

export const FAMILY_LABELS: Record<PlayFamily, string> = {
  signal: "Why-now signals",
  network: "Your network",
  pipeline: "Open pipeline",
  customer: "Customers and events",
};

/** The play a signal type belongs to. Today's signal cards carry it, so pausing the play takes them off Today. */
export function playForSignal(type: SignalType): string | undefined {
  return PLAYS.find((p) => p.signals?.includes(type))?.id;
}

/** Every play runs unless it was paused. */
export function playEnabled(ws: Workspace, id: string): boolean {
  return ws.plays?.[id]?.enabled ?? true;
}

/** A play's matches, best first, worked ones last. */
export function playMatches(ws: Workspace, play: PlayDef, today: ISODate): PlayMatch[] {
  return play.match(ws, today).sort((a, b) => Number(a.worked) - Number(b.worked) || b.score - a.score || a.company.localeCompare(b.company));
}

/* ─────────────────────────────── Results ─────────────────────────────── */

export interface PlayResults {
  /** Accounts worked from the play: bulk runs plus its Today cards that were done. */
  worked: number;
  touched: number;
  replied: number;
  meetings: number;
  /** Open deals and their value. */
  pipeline: number;
  pipelineUsd: number;
  won: number;
  wonUsd: number;
}

/**
 * Results are attributed in code: an account counts for a play from the first time the play worked it
 * (a bulk run, or one of its Today cards marked done); touches, replies and deals after that date count.
 */
export function playResults(ws: Workspace, play: PlayDef): PlayResults {
  const since = new Map<string, string>();
  const note = (domain: string | undefined, at: string) => {
    if (!domain) return;
    const day = localDate(at);
    if (!since.has(domain) || day < since.get(domain)!) since.set(domain, day);
  };
  for (const run of ws.plays?.[play.id]?.runs ?? []) for (const d of run.domains) note(d, run.at);
  for (const m of Object.values(ws.moves)) {
    if (m.playId !== play.id || m.status !== "done" || m.autoDone) continue;
    const domain = m.ref?.kind === "account" ? m.ref.id : m.ref?.kind === "person" ? ws.people[m.ref.id]?.accountDomain : m.ref?.kind === "deal" ? ws.deals[m.ref.id]?.accountDomain : undefined;
    note(domain, m.createdAt);
  }
  const r: PlayResults = { worked: since.size, touched: 0, replied: 0, meetings: 0, pipeline: 0, pipelineUsd: 0, won: 0, wonUsd: 0 };
  for (const [domain, from] of since) {
    const acts = ws.activities.filter((a) => a.accountDomain === domain && localDate(a.at) >= from);
    if (acts.some((a) => a.kind === "touch_sent" && a.outcome !== "not_sent")) r.touched++;
    if (acts.some((a) => a.kind === "reply_received")) r.replied++;
    if (acts.some((a) => a.kind === "meeting_held")) r.meetings++;
    // Sourced or moved after the play worked it.
    const deal = Object.values(ws.deals).find((d) => d.accountDomain === domain && localDate(d.stageHistory.at(-1)?.at ?? d.createdAt) >= from);
    if (!deal) continue;
    if (OPEN_STAGES.includes(deal.stage)) {
      r.pipeline++;
      r.pipelineUsd += deal.amountUsd ?? 0;
    } else if (deal.stage === "won") {
      r.won++;
      r.wonUsd += deal.amountUsd ?? 0;
    }
  }
  return r;
}

/** Days since a date, for match copy ("12d ago"). */
export function matchAge(date: ISODate | undefined, today: ISODate): string {
  if (!date) return "";
  const d = Math.max(0, daysBetween(date, today));
  return d === 0 ? "today" : d < 45 ? `${d}d ago` : `${Math.round(d / 30)}mo ago`;
}

/* ─────────────────────────────── Backtest and audit ─────────────────────────────── */

export interface PlayBacktest {
  /** Deals whose company showed this trigger in the window before the first conversation: [with it, all]. */
  won: [number, number];
  lost: [number, number];
  open: [number, number];
  /** Last 90 days: companies the trigger fired at, and how many have a deal that started after it. */
  fired: number;
  becameDeals: number;
}

/**
 * The play run against the workspace's own history, in code: would it have fired before the deals you
 * won, and before the ones you lost? Signal plays only (other triggers aren't dated the same way).
 */
export function backtestPlay(ws: Workspace, play: PlayDef, today: ISODate): PlayBacktest | null {
  const types = play.signals;
  if (!types?.length) return null;
  const startOf = (d: Deal) => localDate(d.stageHistory[0]?.at ?? d.createdAt);
  const hit = (d: Deal) => {
    const start = startOf(d);
    return (ws.accounts[d.accountDomain]?.signals ?? []).some((x) => types.includes(x.type) && !!x.date && x.date <= start && daysBetween(x.date, start) <= play.windowDays);
  };
  const tally = (deals: Deal[]): [number, number] => [deals.filter(hit).length, deals.length];
  const deals = Object.values(ws.deals);
  let fired = 0;
  let becameDeals = 0;
  for (const acc of Object.values(ws.accounts)) {
    const first = acc.signals.filter((x) => types.includes(x.type) && !!x.date && daysSince(x.date, today) <= 90).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (!first) continue;
    fired++;
    if (deals.some((d) => d.accountDomain === acc.domain && startOf(d) >= first.date)) becameDeals++;
  }
  return {
    won: tally(deals.filter((d) => d.stage === "won")),
    lost: tally(deals.filter((d) => d.stage === "lost")),
    open: tally(deals.filter((d) => OPEN_STAGES.includes(d.stage))),
    fired,
    becameDeals,
  };
}

export interface PlaySkip {
  domain: string;
  company: string;
  /** Why the play passed it over, ≤ 70 chars. */
  reason: string;
  date?: ISODate;
}

/** Companies with this play's trigger on file that it didn't match, and why: the audit trail. Signal plays only. */
export function playSkips(ws: Workspace, play: PlayDef, today: ISODate): PlaySkip[] {
  const types = play.signals;
  if (!types?.length) return [];
  const matched = new Set(play.match(ws, today).map((m) => m.domain));
  const out: PlaySkip[] = [];
  for (const acc of Object.values(ws.accounts)) {
    if (matched.has(acc.domain)) continue;
    const sig = acc.signals.filter((x) => types.includes(x.type) && !!x.date && daysSince(x.date, today) <= Math.max(120, play.windowDays * 2)).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!sig) continue;
    const deal = acc.dealId ? ws.deals[acc.dealId] : undefined;
    const age = daysSince(sig.date, today);
    const reason =
      acc.status === "customer"
        ? "Already a customer"
        : acc.status === "disqualified"
          ? `Disqualified${acc.disqualified ? `: ${acc.disqualified.reason.replace(/_/g, " ")}` : ""}`
          : deal && OPEN_STAGES.includes(deal.stage)
            ? `Open deal at ${STAGE_LABELS[deal.stage]}: it's worked from the deal, not this play`
            : deal?.stage === "nurture"
              ? `Parked in nurture${deal.nurtureUntil ? ` until ${deal.nurtureUntil}` : ""}`
              : play.tiers && !play.tiers.includes(acc.tier)
                ? `Tier ${acc.tier}: this play runs on ${play.tiers.join(" and ")}`
                : age > play.windowDays
                  ? `Signal is ${age} days old; the window is ${play.windowDays}`
                  : "Filtered out (signal marked not usable in outreach)";
    out.push({ domain: acc.domain, company: acc.name, reason, date: sig.date });
  }
  return out.sort((a, b) => a.company.localeCompare(b.company));
}
