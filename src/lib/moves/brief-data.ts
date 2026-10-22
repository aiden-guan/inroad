import { addDays, todayISO } from "@/lib/domain/ids";
import { STAGE_LABELS, type EntityRef, type Move, type Workspace } from "@/lib/domain/types";
import { dealsMissingNextStep } from "./scoreboard";
import { clip, clockTime, companyName, daysSince, first, isOpen, localDate, plural } from "./util";

/**
 * Inputs for the daily brief. Code writes the greeting and decides whether anything is new enough to be
 * worth a sentence; only then does a small model write up to 3 cited "worth knowing" lines.
 */

export interface BriefItem {
  key: string; // stable: "sig:<id>", "rep:<activityId>", "risk:<dealId>", "mtg:<id>"
  text: string;
  url?: string;
  date?: string;
  quote?: string;
  ref?: EntityRef;
}

export function briefInputs(ws: Workspace, now: Date): { fresh: BriefItem[]; risks: BriefItem[]; meetings: BriefItem[] } {
  const today = todayISO(now);
  const fresh: BriefItem[] = [];

  for (const acc of Object.values(ws.accounts)) {
    if (acc.status === "disqualified") continue;
    for (const s of acc.signals) {
      if (s.strength < 2 || s.type === "sensitive" || !s.date || daysSince(s.date, today) > 14) continue;
      const ev = s.evidenceId ? ws.evidence[s.evidenceId] : undefined;
      if (ev?.flaggedWrong) continue;
      fresh.push({
        key: `sig:${s.id}`,
        text: `${acc.name} (${acc.tier}-tier${acc.dealId ? ", in your pipeline" : acc.warmPathCount ? `, ${plural(acc.warmPathCount, "person", "people")} you know there` : ""}): ${s.headline} · ${s.date} · ${s.host}`,
        url: s.url,
        date: s.date,
        quote: ev?.quote,
        ref: { kind: "account", id: acc.domain },
      });
    }
  }

  for (const a of ws.activities) {
    if (a.kind !== "reply_received" || daysSince(a.at, today) > 7) continue;
    const person = a.personId ? ws.people[a.personId] : undefined;
    const domain = person?.accountDomain ?? a.accountDomain;
    fresh.push({
      key: `rep:${a.id}`,
      // What a prospect wrote is data: tagged so the model quotes it and never follows it. < and > are stripped so it can't close the tag.
      text: `${person?.name ?? "Someone"}${person?.title ? `, ${person.title}` : ""} at ${companyName(ws, domain)} replied${a.sentiment ? ` (${a.sentiment})` : ""} on ${localDate(a.at)}${a.body ? `: <reply>${clip(a.body, 280).replace(/[<>]/g, "")}</reply>` : ""}`,
      date: localDate(a.at),
      quote: a.body ? clip(a.body, 200) : undefined,
      ref: a.personId ? { kind: "person", id: a.personId } : undefined,
    });
  }

  const risks: BriefItem[] = dealsMissingNextStep(ws, today)
    .map((id) => ws.deals[id])
    .filter(isOpen)
    .sort((a, b) => ["proposal", "pilot", "qualified", "talking"].indexOf(a.stage) - ["proposal", "pilot", "qualified", "talking"].indexOf(b.stage))
    .slice(0, 4)
    .map((d) => ({
      key: `risk:${d.id}`,
      text: `${companyName(ws, d.accountDomain)} (${STAGE_LABELS[d.stage]}): ${d.nextStep?.date ? `next step "${clip(d.nextStep.what, 60)}" was due ${d.nextStep.date}` : "no dated next step"}`,
      ref: { kind: "deal", id: d.id },
    }));

  const meetings: BriefItem[] = Object.values(ws.meetings)
    .filter((m) => localDate(m.startsAt) === today)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((m) => ({
      key: `mtg:${m.id}`,
      text: `${companyName(ws, ws.deals[m.dealId]?.accountDomain)} at ${clockTime(m.startsAt)}${m.attendees.length ? ` with ${m.attendees.map((x) => x.name).join(", ")}` : ""}`,
      ref: { kind: "meeting", id: m.id },
    }));

  return { fresh, risks, meetings };
}

export function salutation(now: Date): string {
  const h = now.getHours();
  return h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening";
}

/** The greeting, always assembled in code: outcome first, counts not praise. Recomputed on every prepare, so it stays current. */
export function codeGreeting(ws: Workspace, visible: Move[], now: Date): string {
  const today = todayISO(now);
  const name = first(ws.founder.name);
  const hello = name ? `${salutation(now)}, ${name}.` : `${salutation(now)}.`;

  const missing = dealsMissingNextStep(ws, today).length;
  const yesterday = addDays(today, -1);
  const yesterdayCloseOut = ws.moves[`mv_closeout_${yesterday}`];
  // Yesterday's brief records what the close-out still listed at the day's last prepare; a skipped close-out counts too.
  const leftOpen = !!ws.briefs[yesterday]?.closeOutLeft || (!!yesterdayCloseOut && yesterdayCloseOut.status !== "done");
  if (leftOpen && missing > 0) {
    return `${hello} ${plural(missing, "deal")} still ${missing === 1 ? "has" : "have"} no dated next step.`;
  }

  const replies = visible.filter((m) => m.kind === "reply").length;
  const meetings = visible.filter((m) => m.kind === "meeting_prep").length;
  if (replies || meetings) {
    const parts = [replies ? `${plural(replies, "reply", "replies")} to read` : "", meetings ? `${plural(meetings, "meeting")} today` : ""].filter(Boolean);
    return `${hello} ${parts.join(" and ")}.`;
  }
  if (visible.length) return `${hello} ${plural(visible.length, "move")} today.`;

  const worth = Object.values(ws.accounts).filter(
    (a) => a.status !== "disqualified" && a.signals.some((s) => s.strength >= 2 && s.date && daysSince(s.date, today) <= 14),
  ).length;
  return worth ? `${hello} Nothing urgent; ${plural(worth, "company", "companies")} worth a note.` : `${hello} Nothing urgent today.`;
}

/**
 * The label over Today's moves. On day one (no companies yet) it says "While that runs" only while
 * discovery is actually looking; nothing started means the moves are the other way in, not filler.
 */
export function movesHeading(opts: { dayOne: boolean; discovering: boolean }): string {
  if (!opts.dayOne) return "Your moves";
  return opts.discovering ? "While that runs" : "Or start here";
}
