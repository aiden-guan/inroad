import { addDays, todayISO, weekOf } from "@/lib/domain/ids";
import { OPEN_STAGES, type Account, type Connector, type Deal, type Meeting, type Person, type Workspace } from "@/lib/domain/types";
import { ledger, reachMatch, type Ledger } from "@/lib/intros/rules";
import { awaitingOutcome } from "@/lib/moves/replies";

/**
 * What the ⌘K pages list, worked out in code from the workspace. Each command lands in a flow that
 * already exists (a company sheet, Today, the Playbook); these only decide who and what to offer.
 */

const isOpenDeal = (d: Deal | undefined) => !!d && OPEN_STAGES.includes(d.stage);

/** "Write to…": people the founder can write to, the ones in a live deal or on a tracked company first. */
export function writeTargets(ws: Workspace, limit = 300): { person: Person; account?: Account }[] {
  const rank = (p: Person) => {
    const acc = ws.accounts[p.accountDomain];
    const deal = acc?.dealId ? ws.deals[acc.dealId] : undefined;
    return (isOpenDeal(deal) ? 300 : 0) + (acc?.watch || acc?.status === "tracked" ? 100 : 0) + (acc?.fitScore ?? 0);
  };
  return Object.values(ws.people)
    .filter((p) => !p.doNotContact && ws.accounts[p.accountDomain]?.status !== "disqualified")
    .sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((person) => ({ person, account: ws.accounts[person.accountDomain] }));
}

/** "Prep for…": meetings from earlier today through the next two weeks that haven't been debriefed, soonest first. */
export function upcomingMeetings(ws: Workspace, now: Date): { meeting: Meeting; domain?: string; company: string }[] {
  const from = new Date(`${todayISO(now)}T00:00:00`).getTime();
  const until = new Date(`${addDays(todayISO(now), 14)}T23:59:59`).getTime();
  return Object.values(ws.meetings)
    .filter((m) => {
      const t = Date.parse(m.startsAt);
      return !m.debrief && t >= from && t <= until && !!ws.deals[m.dealId];
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((meeting) => {
      const domain = ws.deals[meeting.dealId]?.accountDomain;
      return { meeting, domain, company: (domain && ws.accounts[domain]?.name) || ws.deals[meeting.dealId]?.name || "" };
    });
}

/** "Ask a connector for intros": the people who introduce the founder, the ones ready for an ask first. */
export function connectorChoices(ws: Workspace, today: string): { connector: Connector; ledger: Ledger }[] {
  const order: Record<Ledger["status"], number> = { ready: 0, give_first: 1, resting: 2, in_flight: 3 };
  return ws.connectors
    .filter((c) => c.relationship !== "connection")
    .map((connector) => ({ connector, ledger: ledger(ws, connector, today) }))
    .sort((a, b) => order[a.ledger.status] - order[b.ledger.status] || a.connector.name.localeCompare(b.connector.name));
}

/**
 * The companies to ask a connector about: prospects without a live deal, the ones their reach names
 * first (by domain or name, then by topic), then by fit.
 */
export function connectorTargets(ws: Workspace, connector: Connector, limit = 50): { account: Account; reach: "exact" | "topic" | null }[] {
  const reach = [...(connector.reach ?? []), ...(connector.company ? [connector.company] : [])];
  const score = { exact: 2, topic: 1 } as const;
  return Object.values(ws.accounts)
    .filter((a) => a.status !== "disqualified" && a.status !== "customer" && !isOpenDeal(a.dealId ? ws.deals[a.dealId] : undefined) && a.domain !== ws.company?.domain)
    .map((account) => {
      const hits = reach.map((r) => reachMatch(r, account)).filter((h): h is "exact" | "topic" => !!h);
      return { account, reach: hits.includes("exact") ? ("exact" as const) : hits.length ? ("topic" as const) : null };
    })
    .sort((a, b) => (b.reach ? score[b.reach] : 0) - (a.reach ? score[a.reach] : 0) || b.account.fitScore - a.account.fitScore || a.account.name.localeCompare(b.account.name))
    .slice(0, limit);
}

/** "Draft a pilot proposal": live deals, the ones closest to a proposal first. */
export function proposalDeals(ws: Workspace): Deal[] {
  const order: Record<string, number> = { proposal: 0, pilot: 1, qualified: 2, talking: 3 };
  return Object.values(ws.deals)
    .filter(isOpenDeal)
    .sort((a, b) => (order[a.stage] ?? 9) - (order[b.stage] ?? 9) || b.lastActivityAt.localeCompare(a.lastActivityAt));
}

/** "Add a deal": companies without a live deal (a conversation is about to start), most recently active first. */
export function dealCandidates(ws: Workspace, limit = 200): Account[] {
  const lastTouch = new Map<string, string>();
  for (const a of ws.activities) if (a.accountDomain && (lastTouch.get(a.accountDomain) ?? "") < a.at) lastTouch.set(a.accountDomain, a.at);
  return Object.values(ws.accounts)
    .filter((a) => a.status !== "disqualified" && !isOpenDeal(a.dealId ? ws.deals[a.dealId] : undefined) && a.domain !== ws.company?.domain)
    .sort((a, b) => (lastTouch.get(b.domain) ?? "").localeCompare(lastTouch.get(a.domain) ?? "") || b.fitScore - a.fitScore || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** "Check replies": how many people are waiting to be marked (R/N/B/U), the same list the Today move opens. */
export function repliesToCheck(ws: Workspace, now: Date): number {
  return awaitingOutcome(ws, now).length;
}

/** "Run the weekly review": this week's review of that kind, when it's already written (open it, don't pay twice). */
export function reviewThisWeek(ws: Workspace, kind: "monday" | "friday", now: Date): boolean {
  const weekStart = weekOf(todayISO(now));
  return Object.values(ws.briefs).some((b) => b.reviewKind === kind && !!b.review && b.date >= weekStart);
}
