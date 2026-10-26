import { daysBetween } from "@/lib/domain/ids";
import type { Account, Person, Workspace } from "@/lib/domain/types";
import { emailOf, isSuppressed } from "@/lib/moves/util";

/**
 * The founder's existing users and design partners: the warmest people they have. Onboarding asks
 * "Who are your last 3 users or design partners?"; this turns the answer into customers (with a tag
 * that says how they know the product) and a referral ask: "who else has this problem?". Pure, shared
 * by the server and the browser.
 */

export interface KnownUser {
  /** The company, as the founder wrote it or as its domain's stem. */
  name: string;
  domain?: string;
  /** "Dana at Globex" → Dana. */
  person?: string;
}

export type KnownUsersKind = "design_partner" | "past_user";

const DOMAIN = /\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i;
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** "acme.com, northwind.io, Dana at Globex" → three users. Up to five; filler words are dropped. */
export function parseKnownUsers(text: string | undefined): KnownUser[] {
  const out: KnownUser[] = [];
  for (const raw of (text ?? "").split(/[,;\n]|\s+and\s+|\s*&\s*/i)) {
    const part = raw.replace(/^\s*(?:and|also|plus|e\.g\.|like)\s+/i, "").replace(/[.()]+$/g, "").trim();
    if (!part || part.length > 80) continue;
    const at = part.match(/^(.+?)\s+(?:at|from|@)\s+(.+)$/i);
    const who = at?.[1]?.trim();
    const where = (at?.[2] ?? part).trim();
    const d = where.match(DOMAIN)?.[1]?.toLowerCase().replace(/^www\./, "");
    if (d) {
      out.push({ name: titleCase(d.split(".")[0]), domain: d, ...(who ? { person: who } : {}) });
      continue;
    }
    // A bare company name: short, starts with a capital or a digit, not a sentence.
    if (!/^[A-Z0-9]/.test(where) || where.split(/\s+/).length > 4 || /\b(no|none|not|yet|users?|customers?|partners?)\b/i.test(where)) continue;
    out.push({ name: where, ...(who && /^[A-Z][a-z]+/.test(who) ? { person: who } : {}) });
  }
  const seen = new Set<string>();
  return out.filter((u) => {
    const key = (u.domain ?? u.name).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

/** Design partners when the founder said so anywhere in onboarding; past users otherwise. */
export function knownUsersKind(ws: Workspace): KnownUsersKind {
  const said = [ws.onboarding.answers?.last3, ws.onboarding.note, ws.company?.founderNote].filter(Boolean).join(" ");
  return /design[- ]partners?/i.test(said) ? "design_partner" : "past_user";
}

/** The account a known user already is in the workspace, by domain or by name. */
export function accountFor(ws: Workspace, u: KnownUser): Account | undefined {
  if (u.domain && ws.accounts[u.domain]) return ws.accounts[u.domain];
  const n = u.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return n.length >= 3 ? Object.values(ws.accounts).find((a) => a.name.toLowerCase().replace(/[^a-z0-9]/g, "") === n) : undefined;
}

/* ───────────── The referral ask ───────────── */

/** When this company became a customer: the deal's won date, else when it was marked one, else when it was added. */
export function customerSince(ws: Workspace, acc: Account): string {
  const won = Object.values(ws.deals)
    .filter((d) => d.accountDomain === acc.domain && d.stage === "won")
    .map((d) => [...d.stageHistory].reverse().find((h) => h.stage === "won")?.at ?? d.createdAt)
    .sort()
    .at(-1);
  return won ?? acc.customerAt ?? acc.addedAt;
}

/** Whether the founder has asked this customer for a referral since `since` (an intro request, or a referral reply). */
export function askedForReferral(ws: Workspace, domain: string, since: string): boolean {
  return ws.activities.some((a) => a.accountDomain === domain && a.at >= since && (a.kind === "intro_requested" || a.sentiment === "referral" || /referr/i.test(a.summary)));
}

/** Who to ask at a customer: the champion, else a named user, else whoever is on file. Never someone who opted out. */
export function referralPerson(ws: Workspace, acc: Account): Person | undefined {
  const people = acc.peopleIds.map((id) => ws.people[id]).filter((p): p is Person => !!p && !p.mayHaveLeft && !isSuppressed(ws, p));
  return people.find((p) => p.champion) ?? people.find((p) => p.tags?.length) ?? people[0];
}

const firstName = (name: string | undefined) => name?.trim().split(/\s+/)[0] ?? "";

/**
 * A short referral note in the founder's voice: thanks, the problem in their words, one ask for one or
 * two names, and an offer of a forwardable line. Written in code, so it costs nothing and never invents.
 */
export function referralAsk(ws: Workspace, domain: string): { to: string | null; subject: string; body: string; personName?: string } {
  const acc = ws.accounts[domain];
  const p = acc ? referralPerson(ws, acc) : undefined;
  const product = ws.company?.name ?? "what we're building";
  const obstacle = ws.foundation?.icp.hypothesis.obstacle?.trim().replace(/\.$/, "");
  const problem = obstacle ? obstacle.charAt(0).toLowerCase() + obstacle.slice(1) : "the problem we're solving for you";
  const me = firstName(ws.founder.name);
  const body = [
    `Hi ${firstName(p?.name) || "there"},`,
    "",
    `Thanks again for being one of the first teams on ${product}. A quick ask: who else do you know who is dealing with ${problem}?`,
    "",
    "If one or two people come to mind, an intro would mean a lot. I can send you a two-line note to forward, so it takes you a minute.",
    ...(me ? ["", me] : []),
  ].join("\n");
  return { to: emailOf(p) ?? null, subject: "Who else has this problem?", body, ...(p ? { personName: p.name } : {}) };
}

/** Customers worth a referral ask now: not asked since they became customers, within their first 90 days. Newest first. */
export function referralCandidates(ws: Workspace, today: string): { acc: Account; since: string; person?: Person }[] {
  return Object.values(ws.accounts)
    .filter((a) => a.status === "customer")
    .map((acc) => ({ acc, since: customerSince(ws, acc), person: referralPerson(ws, acc) }))
    .filter(({ acc, since }) => daysBetween(since.slice(0, 10), today) <= 90 && !askedForReferral(ws, acc.domain, since))
    // A company that asked not to hear from you is never asked; "customer" only keeps them out of cold email.
    .filter(({ acc }) => !ws.suppression.some((s) => s.reason !== "customer" && s.domain?.toLowerCase() === acc.domain))
    .sort((a, b) => b.since.localeCompare(a.since));
}
