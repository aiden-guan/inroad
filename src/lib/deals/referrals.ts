import type { Debrief, ID, Meeting, Person, Workspace } from "@/lib/domain/types";
import { normalizeCompany } from "@/lib/network/csv";

/**
 * "Who else should I talk to?" is a mandatory question on every call, and the answers are the
 * warmest leads a founder gets. Each name a debrief heard becomes a lead: its company (when it's in
 * the workspace), who on the call suggested them, and whether the founder has written to them yet.
 * Pure: the debrief review, Today's card and its rule read the same answers.
 */

export interface DebriefReferral {
  name?: string;
  company?: string;
  /** Their words when the debrief quoted them. */
  quote?: string;
  /** Their company's domain, once the founder added it. */
  domain?: string;
}

export interface ReferralLead extends DebriefReferral {
  key: string;
  /** Position in the debrief's referrals. */
  index: number;
  /** Who suggested them: someone on the call. */
  referrerId?: ID;
  /** Their company's account: named and on file, or the referrer's when no company was named. */
  domain?: string;
  /** Already a person on file. */
  personId?: ID;
  /** Written to (or drafted) since the call, or someone not to contact. */
  acted: boolean;
}

/** What the debrief keeps of the model's referrals: trimmed, quoted only from verified quotes, empty ones dropped. */
export function structuredReferrals(raw: { name: string | null; company: string | null; quoteId: string | null }[], quoteText: Map<string, string>): DebriefReferral[] {
  return raw.flatMap((r) => {
    const name = r.name?.trim();
    const company = r.company?.trim();
    const quote = r.quoteId ? quoteText.get(r.quoteId) : undefined;
    return name || company ? [{ ...(name ? { name } : {}), ...(company ? { company } : {}), ...(quote ? { quote } : {}) }] : [];
  });
}

/** Structured referrals. Debriefs from before `referralPeople` kept only "Name at Company". */
export function debriefReferrals(d: Debrief): DebriefReferral[] {
  if (d.referralPeople) return d.referralPeople;
  return (d.referrals ?? [])
    .map((s) => {
      const i = s.lastIndexOf(" at ");
      return i > 0 ? { name: s.slice(0, i).trim(), company: s.slice(i + 4).trim() } : { name: s.trim() };
    })
    .filter((r) => r.name || r.company);
}

const lower = (s: string | undefined) => (s ?? "").trim().toLowerCase();
const firstOf = (s: string | undefined) => lower(s).split(/\s+/)[0] ?? "";

/** The account a company name refers to, if the workspace has it. */
export function accountByName(ws: Workspace, company: string): string | undefined {
  const n = normalizeCompany(company);
  if (!n) return undefined;
  const squashed = n.replace(/ /g, "");
  return Object.values(ws.accounts).find((a) => normalizeCompany(a.name) === n || a.domain.split(".")[0] === squashed)?.domain;
}

/** Who on the call suggested them: the speaker of the quote when that's someone on the call, else the champion, else the first contact. */
function referrerFor(ws: Workspace, meeting: Meeting, quote: string | undefined): Person | undefined {
  const deal = ws.deals[meeting.dealId];
  const ids = [...meeting.attendees.map((a) => a.personId), ...(deal?.contacts.map((c) => c.personId) ?? [])].filter((x): x is string => !!x);
  const onCall = [...new Set(ids)].map((id) => ws.people[id]).filter((p): p is Person => !!p);
  const speaker = quote ? meeting.debrief?.quotes.find((q) => q.text === quote)?.speaker : undefined;
  const bySpeaker = speaker ? onCall.find((p) => lower(p.name) === lower(speaker) || firstOf(p.name) === firstOf(speaker)) : undefined;
  return bySpeaker ?? onCall.find((p) => p.role === "champion" || !!p.champion) ?? onCall[0];
}

export function referralLeads(ws: Workspace, meeting: Meeting): ReferralLead[] {
  const d = meeting.debrief;
  if (!d) return [];
  const own = ws.deals[meeting.dealId]?.accountDomain;
  return debriefReferrals(d).map((r, i) => {
    const referrer = referrerFor(ws, meeting, r.quote);
    const domain = r.domain && ws.accounts[r.domain] ? r.domain : r.company ? accountByName(ws, r.company) : own;
    const people = Object.values(ws.people).filter((p) => !!r.name && lower(p.name) === lower(r.name));
    const person = people.find((p) => p.accountDomain === domain) ?? (domain ? undefined : people[0]);
    const since = d.generatedAt;
    // Someone already on this deal is reached through it, not with a referral note.
    const onDeal = !!person && (meeting.attendees.some((a) => a.personId === person.id) || !!ws.deals[meeting.dealId]?.contacts.some((c) => c.personId === person.id));
    const acted =
      !!person &&
      (onDeal ||
        person.doNotContact ||
        Object.values(ws.outreach).some((p) => p.personId === person.id && p.createdAt >= since) ||
        ws.activities.some((a) => a.personId === person.id && a.at >= since && (a.kind === "touch_sent" || a.kind === "linkedin_dm" || a.kind === "linkedin_connect" || a.kind === "intro_requested")));
    return {
      ...r,
      key: `${meeting.id}:${i}`,
      index: i,
      ...(referrer ? { referrerId: referrer.id } : {}),
      ...(domain ? { domain } : {}),
      ...(person ? { personId: person.id } : {}),
      acted,
    };
  });
}
