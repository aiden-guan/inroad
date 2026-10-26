import { referralCandidates } from "@/lib/customers/known-users";
import type { ID, Move, Workspace } from "@/lib/domain/types";
import { first } from "./util";

/**
 * Today: "Ask {user} who else has this problem." Customer referrals are the warmest new leads there are
 * (a peer names a peer), and the founder's first users are the best people to ask. One card per
 * customer not yet asked, in their first 90 days, two at a time, newest first. Asking (an intro request
 * logged from the Customers tab) closes the card.
 */

export const CUSTOMER_REFERRAL = { base: 59, label: "A customer you haven't asked who else has the problem" } as const;

type Card = Omit<Move, "createdAt" | "status" | "rule" | "evidenceIds" | "dueOn"> & { rule: "customer_referral"; dueOn?: string; evidenceIds?: ID[] };

export function customerReferralMoves(ws: Workspace, today: string): Card[] {
  return referralCandidates(ws, today)
    .slice(0, 2)
    .map(({ acc, person }) => {
      const who = person ? `${first(person.name)} at ${acc.name}` : acc.name;
      const known = (acc.tags ?? []).includes("design_partner") ? "a design partner" : (acc.tags ?? []).includes("past_user") ? "one of your first users" : "a customer";
      return {
        id: `mv_custref_${acc.domain}`,
        kind: "intro_ask",
        rule: "customer_referral",
        title: `Ask ${who} who else has this problem`,
        why: `${acc.name} is ${known} · people with the problem know others who have it · the note is written`,
        minutes: 3,
        priority: CUSTOMER_REFERRAL.base,
        ref: person ? { kind: "person", id: person.id } : { kind: "account", id: acc.domain },
        href: `/companies?view=customers&referral=${encodeURIComponent(acc.domain)}`,
      };
    });
}
