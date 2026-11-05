import { addDays, daysBetween, todayISO } from "@/lib/domain/ids";
import { STAGE_LABELS, type Account, type EntityRef, type ID, type ISODateTime, type Workspace } from "@/lib/domain/types";
import { clip, clockTime, companyName, first, localDate, plural } from "./util";

/**
 * "Since your last visit" (audit 15 #6): what changed, computed in code from the workspace and a small snapshot of
 * it taken when the founder last left Today. New replies, meetings booked, moved or canceled, deals that changed
 * stage, and new signals on companies they track. Each fact links to its thing. With no snapshot yet (a first visit,
 * another browser) it covers the last 24 hours from timestamps alone.
 */

export interface DeskSnapshot {
  at: ISODateTime;
  meetings: Record<ID, { startsAt: string; title: string; dealId: ID }>;
  /** Signal ids on tracked companies. */
  signals: string[];
}

export interface SinceFact {
  key: string;
  kind: "replies" | "booked" | "moved" | "canceled" | "stage" | "signals";
  text: string;
  /** The full list behind a rolled-up fact, for a tooltip. */
  detail?: string;
  /** Replies: open these in the lane. */
  replyIds?: ID[];
  /** Everything else: the company it's about. */
  domain?: string;
  ref?: EntityRef;
}

export interface Since {
  /** Where the facts start: the last visit, or 24 hours ago. */
  from: ISODateTime;
  /** "Since 9:12 AM", "Since yesterday 5:40 PM", "Since Monday", "Since yesterday". */
  label: string;
  facts: SinceFact[];
}

const tracked = (a: Account) => a.status !== "disqualified" && (a.watch || a.status === "tracked" || a.status === "in_pipeline" || a.status === "customer");
const signalsOf = (a: Account) => a.signals.filter((s) => s.strength >= 2 && s.type !== "sensitive");

/** What the next visit compares against. Small: meeting times and signal ids, nothing the timestamps already tell. */
export function deskSnapshot(ws: Workspace, now: Date): DeskSnapshot {
  const meetings: DeskSnapshot["meetings"] = {};
  for (const m of Object.values(ws.meetings)) meetings[m.id] = { startsAt: m.startsAt, title: m.title, dealId: m.dealId };
  const signals = Object.values(ws.accounts)
    .filter(tracked)
    .flatMap((a) => signalsOf(a).map((s) => s.id));
  return { at: now.toISOString(), meetings, signals };
}

const slot = (iso: string) => `${new Date(iso).toLocaleDateString("en-US", { weekday: "short" })} ${clockTime(iso)}`;

/** "9:12 AM" today, "yesterday 5:40 PM", "Monday" this week, else "Oct 28". */
export function sinceLabel(from: ISODateTime, now: Date): string {
  const today = todayISO(now);
  const day = localDate(from);
  const gap = daysBetween(day, today);
  if (gap <= 0) return clockTime(from);
  if (gap === 1) return `yesterday ${clockTime(from)}`;
  if (gap < 7) return new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });
  return new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function sinceFacts(ws: Workspace, prev: DeskSnapshot | null, now: Date): Since {
  const nowIso = now.toISOString();
  const from = prev?.at ?? new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const facts: SinceFact[] = [];

  const replies = ws.activities.filter((a) => a.kind === "reply_received" && a.at > from && a.at <= nowIso).sort((a, b) => b.at.localeCompare(a.at));
  if (replies.length) {
    const names = replies.map((a) => (a.personId ? ws.people[a.personId]?.name : undefined) ?? "Someone");
    facts.push({
      key: "replies",
      kind: "replies",
      text: replies.length === 1 ? `${first(names[0]) || "Someone"} replied` : `${plural(replies.length, "reply", "replies")}`,
      detail: [...new Set(names)].join(", "),
      replyIds: replies.map((a) => a.id),
    });
  }

  const domainOfDeal = (dealId: ID) => ws.deals[dealId]?.accountDomain;
  if (prev) {
    const booked = Object.values(ws.meetings).filter((m) => !prev.meetings[m.id] && m.startsAt > from && !m.title.startsWith("Canceled:"));
    for (const m of booked.slice(0, 2)) {
      const domain = domainOfDeal(m.dealId);
      facts.push({ key: `booked:${m.id}`, kind: "booked", text: `${companyName(ws, domain)} booked ${slot(m.startsAt)}`, detail: m.title, domain, ref: { kind: "meeting", id: m.id } });
    }
    if (booked.length > 2) facts.push({ key: "booked:more", kind: "booked", text: `${booked.length - 2} more booked`, detail: booked.slice(2).map((m) => m.title).join(", ") });
    for (const m of Object.values(ws.meetings)) {
      const was = prev.meetings[m.id];
      if (!was) continue;
      const domain = domainOfDeal(m.dealId);
      // A canceled call that had a brief or notes stays on file, retitled.
      if (m.title.startsWith("Canceled:") && !was.title.startsWith("Canceled:")) facts.push({ key: `canceled:${m.id}`, kind: "canceled", text: `${companyName(ws, domain)} canceled`, detail: was.title, domain });
      else if (was.startsAt !== m.startsAt) facts.push({ key: `moved:${m.id}`, kind: "moved", text: `${companyName(ws, domain)} moved to ${slot(m.startsAt)}`, detail: m.title, domain, ref: { kind: "meeting", id: m.id } });
    }
    for (const [id, was] of Object.entries(prev.meetings)) {
      if (ws.meetings[id] || was.startsAt <= from) continue;
      const domain = domainOfDeal(was.dealId);
      facts.push({ key: `canceled:${id}`, kind: "canceled", text: `${companyName(ws, domain)} canceled`, detail: was.title, domain });
    }
  } else {
    // No snapshot: a booking from a scheduling tool still logs a dated note.
    for (const a of ws.activities) {
      if (a.kind !== "note" || a.channel !== "integration" || a.at <= from || a.at > nowIso || !/ booked /.test(a.summary)) continue;
      facts.push({ key: `booked:${a.id}`, kind: "booked", text: `${companyName(ws, a.accountDomain)} booked a call`, detail: a.summary, domain: a.accountDomain });
    }
  }

  const moved = Object.values(ws.deals)
    .map((d) => ({ d, h: [...d.stageHistory].filter((h) => h.at > from && h.at <= nowIso).sort((a, b) => b.at.localeCompare(a.at))[0] }))
    .filter((x) => !!x.h)
    .sort((a, b) => b.h!.at.localeCompare(a.h!.at));
  for (const { d, h } of moved.slice(0, 3)) {
    facts.push({ key: `stage:${d.id}`, kind: "stage", text: `${companyName(ws, d.accountDomain)} → ${STAGE_LABELS[h!.stage]}`, domain: d.accountDomain, ref: { kind: "deal", id: d.id } });
  }
  if (moved.length > 3) facts.push({ key: "stage:more", kind: "stage", text: `${moved.length - 3} more deals moved`, detail: moved.slice(3).map((x) => companyName(ws, x.d.accountDomain)).join(", ") });

  const seen = prev ? new Set(prev.signals) : null;
  const since = localDate(from);
  const fresh = Object.values(ws.accounts)
    .filter(tracked)
    .flatMap((a) => signalsOf(a).filter((s) => (seen ? !seen.has(s.id) : !!s.date && s.date >= since && s.date <= addDays(todayISO(now), 0))).map((s) => ({ a, s })))
    .sort((x, y) => y.s.strength - x.s.strength || y.s.date.localeCompare(x.s.date));
  if (fresh.length === 1) {
    const { a, s } = fresh[0];
    facts.push({ key: `signal:${s.id}`, kind: "signals", text: `${a.name}: ${clip(s.headline, 44)}`, detail: `${s.headline} · ${s.host}`, domain: a.domain, ref: { kind: "account", id: a.domain } });
  } else if (fresh.length > 1) {
    facts.push({ key: "signals", kind: "signals", text: `${fresh.length} new signals`, detail: fresh.slice(0, 6).map(({ a, s }) => `${a.name}: ${clip(s.headline, 50)}`).join("\n"), domain: fresh[0].a.domain });
  }

  return { from, label: prev ? `Since ${sinceLabel(prev.at, now)}` : "Since yesterday", facts };
}
