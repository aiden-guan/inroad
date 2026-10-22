import { todayISO } from "@/lib/domain/ids";
import type { ID, Move, OutreachPackage, Workspace } from "@/lib/domain/types";
import { RULE_PREFIX, visibleMoves } from "./rules";
import { isSuppressed, knowsDirectly } from "./util";

/**
 * What Today prepares before the founder asks (SPEC §5.1, W7): the brief for every meeting in the next
 * 24 hours, drafts for the follow-ups and first touches on the desk (so a card opens on finished work
 * instead of a 90-second wait), and the network screen once the bet it screens against exists. Pure; prepareToday claims the plan inside its write and starts the runs.
 * Never on the sample workspace or without a key (the caller checks), and capped per day.
 */

/** Automatic meeting briefs a day. */
export const AHEAD_PREPS_PER_DAY = 4;
/** Automatic drafts a day: follow-ups first, then first touches (the spec's "up to 5 first-touch drafts"). */
export const AHEAD_DRAFTS_PER_DAY = 5;
/** A run for the same meeting or company inside this window (done, failed or live) means don't start another. */
const RETRY_HOURS = 6;

export interface DraftArgs {
  domain: string;
  personId?: string;
  mode: OutreachPackage["mode"];
  packageId?: string;
}

export interface AheadPlan {
  /** Meeting ids to brief. */
  preps: ID[];
  /** Compose runs to start, with the card each one fills. */
  drafts: { moveId: ID; args: DraftArgs }[];
  /** Screen the founder's network against the bet: imported while the bet was still being written, or the bet changed since. */
  screen?: "import" | "rescreen";
  /** Claim keys for today's brief (`Brief.ahead`), so no prepare starts the same work twice. */
  keys: string[];
}

/**
 * A LinkedIn import dropped in during onboarding lands before the ICP exists, so it can't be screened yet. Once
 * the bet is written (or rewritten), screen it. Zero names to the model; company names and titles only.
 */
export function networkToScreen(ws: Workspace, now: Date): { reason: "import" | "rescreen"; key: string } | null {
  const net = ws.network;
  const f = ws.foundation;
  if (!net || !f?.generatedAt || !f.icp?.criteria?.length) return null;
  const stale = !net.screenedAt || net.screenedAt < net.importedAt || net.screenedAt < f.generatedAt;
  if (!stale) return null;
  const since = now.getTime() - RETRY_HOURS * 3_600_000;
  if (ws.runs.some((r) => r.workflow === "network" && (r.status === "running" || r.status === "queued" || Date.parse(r.startedAt) >= since))) return null;
  return { reason: net.screenedAt ? "rescreen" : "import", key: `net:${net.importedAt}:${f.generatedAt}` };
}

const prepKey = (ws: Workspace, id: ID) => `mtg:${id}:${ws.meetings[id]?.brief?.generatedAt ?? "none"}`;
const draftKey = (d: AheadPlan["drafts"][number]) => `acc:${d.args.domain}:${d.moveId}`;

function recentRun(ws: Workspace, workflow: "prep" | "compose", ref: { kind: "meeting" | "account"; id: string }, now: Date): boolean {
  const since = now.getTime() - RETRY_HOURS * 3_600_000;
  return ws.runs.some(
    (r) =>
      r.workflow === workflow &&
      r.ref?.kind === ref.kind &&
      r.ref.id === ref.id &&
      (r.status === "running" || r.status === "queued" || Date.parse(r.startedAt) >= since),
  );
}

/** Meetings starting in the next 24 hours with no brief, or a brief older than the dossier or the latest touch or reply. */
export function meetingsToPrep(ws: Workspace, now: Date): ID[] {
  const nowMs = now.getTime();
  const until = nowMs + 24 * 3_600_000;
  return Object.values(ws.meetings)
    .filter((m) => {
      const start = Date.parse(m.startsAt);
      if (Number.isNaN(start) || start <= nowMs || start > until) return false;
      const deal = ws.deals[m.dealId];
      if (!deal) return false;
      if (m.brief) {
        const acc = ws.accounts[deal.accountDomain];
        const latest = [acc?.dossier?.generatedAt ?? "", ...ws.activities.filter((a) => a.accountDomain === deal.accountDomain && (a.kind === "touch_sent" || a.kind === "reply_received")).map((a) => a.at)]
          .filter((t) => t && t <= now.toISOString())
          .sort()
          .at(-1);
        if (!latest || latest <= m.brief.generatedAt) return false;
      }
      return !recentRun(ws, "prep", { kind: "meeting", id: m.id }, now);
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((m) => m.id);
}

const ruleOf = (m: Move) => (m.rule.startsWith(RULE_PREFIX) ? m.rule.slice(RULE_PREFIX.length) : m.rule);

/** A draft the card would show already exists (the same test the card uses: newer than the card, same person, same kind). */
function drafted(ws: Workspace, move: Move, domain: string, personId: string | undefined, modes: OutreachPackage["mode"][]): boolean {
  if (move.draft) return true;
  return Object.values(ws.outreach).some(
    (p) => modes.includes(p.mode) && p.accountDomain === domain && (!personId || p.personId === personId) && p.createdAt >= move.createdAt && p.steps.some((s) => s.status === "draft"),
  );
}

/** Today's open cards that a draft would finish: due follow-ups first, then first touches, best first. */
export function draftsToStart(ws: Workspace, now: Date): AheadPlan["drafts"] {
  const today = todayISO(now);
  const out: AheadPlan["drafts"] = [];
  const domains = new Set<string>();
  const moves = visibleMoves(ws.moves, today);
  const order = (m: Move) => (ruleOf(m) === "follow_up" ? 0 : 1);
  for (const m of [...moves].sort((a, b) => order(a) - order(b))) {
    const rule = ruleOf(m);
    const person = m.ref?.kind === "person" ? ws.people[m.ref.id] : undefined;
    const domain = person?.accountDomain ?? (m.ref?.kind === "account" ? m.ref.id : undefined);
    if (!domain || domains.has(domain) || !ws.accounts[domain] || isSuppressed(ws, person, domain)) continue;
    if (recentRun(ws, "compose", { kind: "account", id: domain }, now)) continue;
    let args: DraftArgs | undefined;
    if (rule === "follow_up" && person && !drafted(ws, m, domain, person.id, ["follow_up", "cold"])) {
      const pkg = m.id.startsWith("mv_followup_") ? m.id.slice("mv_followup_".length).replace(/_\d+$/, "") : undefined;
      args = { domain, personId: person.id, mode: "follow_up", ...(pkg && ws.outreach[pkg] ? { packageId: pkg } : {}) };
    } else if ((m.kind === "first_touch" && (rule === "signal" || rule === "first_three")) || (m.kind === "linkedin" && rule === "first_three")) {
      // Someone the founder knows gets a note in their own words, never a cold template; and a dossier is
      // what makes a draft worth reading (the first three's draft starts the moment theirs lands).
      if (knowsDirectly(person) || !ws.accounts[domain].dossier) continue;
      const mode = m.kind === "linkedin" ? "linkedin" : "cold";
      if (!drafted(ws, m, domain, person?.id, [mode])) args = { domain, personId: person?.id, mode };
    }
    if (!args) continue;
    domains.add(domain);
    out.push({ moveId: m.id, args });
  }
  return out;
}

/**
 * The plan within what's left of the daily caps, skipping anything today's brief already claimed (a
 * meeting is briefed again only once its brief has changed, a card is drafted for once).
 */
export function planAhead(ws: Workspace, now: Date): AheadPlan {
  const claimed = new Set(ws.briefs[todayISO(now)]?.ahead ?? []);
  const usedPreps = [...claimed].filter((k) => k.startsWith("mtg:")).length;
  const usedDrafts = [...claimed].filter((k) => k.startsWith("acc:")).length;
  const preps = meetingsToPrep(ws, now)
    .filter((id) => !claimed.has(prepKey(ws, id)))
    .slice(0, Math.max(0, AHEAD_PREPS_PER_DAY - usedPreps));
  const drafts = draftsToStart(ws, now)
    .filter((d) => !claimed.has(draftKey(d)))
    .slice(0, Math.max(0, AHEAD_DRAFTS_PER_DAY - usedDrafts));
  const net = networkToScreen(ws, now);
  const screen = net && !claimed.has(net.key) ? net : null;
  return {
    preps,
    drafts,
    ...(screen ? { screen: screen.reason } : {}),
    keys: [...preps.map((id) => prepKey(ws, id)), ...drafts.map(draftKey), ...(screen ? [screen.key] : [])],
  };
}
