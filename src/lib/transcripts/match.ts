/**
 * Which call a transcript is, worked out in code: the date and time in the file name or the text against
 * each meeting's start, the speakers against the meeting's attendees, and a company named in the title or
 * the speaker labels. Candidates are meetings already on deals, meetings on the calendar with a company
 * that isn't tracked yet, and companies on file (a new call). The founder confirms or picks another.
 */
import type { Workspace } from "@/lib/domain/types";
import { isFounderLabel, type ParsedTranscript } from "./parse";

export type CandidateKind = "meeting" | "calendar" | "account";

export interface MatchCandidate {
  /** "meeting:mtg_…", "calendar:<event id>#<domain>", "account:<domain>". */
  key: string;
  kind: CandidateKind;
  domain: string;
  company: string;
  title: string;
  startsAt?: string;
  meetingId?: string;
  eventId?: string;
  attendees: string[];
  debriefed?: boolean;
  score: number;
  reasons: string[];
}

export interface CalendarCandidate {
  eventId: string;
  domain: string;
  company: string;
  title: string;
  start: string;
  guests: string[];
}

export interface Match {
  best?: MatchCandidate;
  /** high: propose it; medium: propose it and say why; low: ask. */
  confidence: "high" | "medium" | "low";
  candidates: MatchCandidate[];
}

const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const splitName = (label: string) => norm(label.replace(/\s*\([^)]*\)\s*$/, ""));

/** How well the people who spoke match the people invited: +4 a full name, +2 a first name, once per person. */
function peopleScore(speakers: string[], attendees: string[]): { score: number; names: string[] } {
  let score = 0;
  const names: string[] = [];
  for (const a of attendees) {
    const full = norm(a);
    const [first, ...rest] = full.split(" ");
    const last = rest.at(-1);
    let best = 0;
    for (const s of speakers) {
      const n = splitName(s);
      const parts = n.split(" ");
      if (n === full && rest.length) best = Math.max(best, 4);
      else if (last && parts.length > 1 && parts[0] === first && parts.at(-1) === last) best = Math.max(best, 4);
      else if (first && parts[0] === first && first.length > 1) best = Math.max(best, 2);
      else if (last && parts.at(-1) === last && last.length > 2) best = Math.max(best, 1);
    }
    if (best) {
      score += best;
      if (best >= 2) names.push(a);
    }
  }
  return { score, names };
}

function companyMentioned(t: ParsedTranscript, company: string, domain: string): "label" | "title" | null {
  const root = norm(domain.split(".")[0] ?? "");
  const name = norm(company);
  const hit = (s: string | undefined) => {
    const n = ` ${norm(s ?? "")} `;
    return (!!name && name.length > 2 && n.includes(` ${name} `)) || (!!root && root.length > 3 && n.replace(/ /g, "").includes(root));
  };
  if (t.speakers.some((s) => hit(s.company))) return "label";
  if (hit(t.title)) return "title";
  return null;
}

function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00`) - Date.parse(`${b}T12:00:00`)) / 86_400_000);

function timeScore(t: ParsedTranscript, startsAt: string | undefined, now: Date): { score: number; reason?: string } {
  if (!startsAt) return { score: 0 };
  const start = Date.parse(startsAt);
  const w = t.when;
  if (w?.iso) {
    const gap = Math.abs(Date.parse(w.iso) - start);
    if (gap <= 90 * 60_000) return { score: 7, reason: "Recorded at the meeting's time" };
  }
  if (w) {
    const days = dayDiff(w.date, localDate(startsAt));
    if (days === 0) {
      if (w.time) {
        const [h, m] = w.time.split(":").map(Number);
        const local = new Date(start);
        const minutes = Math.abs(h * 60 + m - (local.getHours() * 60 + local.getMinutes()));
        if (minutes <= 90) return { score: 7, reason: "Recorded at the meeting's time" };
      }
      return { score: 4, reason: "Same day as the meeting" };
    }
    if (Math.abs(days) === 1) return { score: 1, reason: "A day from the meeting" };
    return { score: -3 };
  }
  // No date anywhere: a recent past call is the likely one; one far ahead can't have a transcript yet.
  if (start > now.getTime() + 2 * 3_600_000) return { score: -4 };
  if (now.getTime() - start <= 3 * 86_400_000) return { score: 1, reason: "Recent" };
  return { score: 0 };
}

export function matchTranscript(t: ParsedTranscript, { ws, calendar = [], now, founderNames = [], meetingIds }: { ws: Workspace; calendar?: CalendarCandidate[]; now: Date; founderNames?: string[]; meetingIds?: string[] }): Match {
  const others = [...t.speakers.filter((s) => !s.founder && !s.generic).map((s) => s.name), ...t.listed.filter((n) => !isFounderLabel(n, founderNames))];
  const out: MatchCandidate[] = [];

  const score = (base: Omit<MatchCandidate, "score" | "reasons">): MatchCandidate => {
    const reasons: string[] = [];
    let total = 0;
    const time = timeScore(t, base.startsAt, now);
    total += time.score;
    if (time.reason) reasons.push(time.reason);
    const people = peopleScore(others, base.attendees);
    total += people.score;
    if (people.names.length) reasons.push(`${people.names.slice(0, 2).join(" and ")}${people.names.length > 2 ? ` and ${people.names.length - 2} more` : ""} spoke`);
    const named = companyMentioned(t, base.company, base.domain);
    if (named === "label") {
      total += 4;
      reasons.push(`Speaker labels say ${base.company}`);
    } else if (named === "title") {
      total += 3;
      reasons.push(`The title names ${base.company}`);
    }
    if (base.debriefed) {
      total -= 1;
      reasons.push("Already debriefed");
    }
    return { ...base, score: total, reasons };
  };

  const pool = meetingIds ? meetingIds.map((id) => ws.meetings[id]).filter(Boolean) : Object.values(ws.meetings);
  for (const m of pool) {
    const deal = ws.deals[m.dealId];
    if (!deal) continue;
    const company = ws.accounts[deal.accountDomain]?.name ?? deal.name;
    out.push(
      score({
        key: `meeting:${m.id}`,
        kind: "meeting",
        domain: deal.accountDomain,
        company,
        title: m.title,
        startsAt: m.startsAt,
        meetingId: m.id,
        attendees: m.attendees.map((a) => a.name).filter(Boolean),
        ...(m.debrief ? { debriefed: true } : {}),
      }),
    );
  }
  if (!meetingIds) {
    for (const c of calendar) {
      out.push(score({ key: `calendar:${c.eventId}#${c.domain}`, kind: "calendar", domain: c.domain, company: c.company, title: c.title, startsAt: c.start, eventId: c.eventId, attendees: c.guests }));
    }
    // A company named in the title or the labels, with no meeting that fits: a new call with them.
    const fitting = new Set(out.filter((c) => c.score >= 4).map((c) => c.domain));
    for (const acc of Object.values(ws.accounts)) {
      if (acc.status === "disqualified" || fitting.has(acc.domain) || !companyMentioned(t, acc.name, acc.domain)) continue;
      const people = Object.values(ws.people).filter((p) => p.accountDomain === acc.domain).map((p) => p.name);
      const c = score({ key: `account:${acc.domain}`, kind: "account", domain: acc.domain, company: acc.name, title: t.title ?? `Call with ${acc.name}`, attendees: people });
      out.push({ ...c, score: c.score - 1, reasons: [...c.reasons, "No meeting on file for this call"] });
    }
  }

  const candidates = out.filter((c) => c.score > 0).sort((a, b) => b.score - a.score || (b.startsAt ?? "").localeCompare(a.startsAt ?? "")).slice(0, 6);
  const best = candidates[0];
  const second = candidates[1]?.score ?? 0;
  const confidence: Match["confidence"] = !best ? "low" : best.score >= 7 && best.score - second >= 3 ? "high" : best.score >= 4 ? "medium" : "low";
  return { ...(best && confidence !== "low" ? { best } : {}), confidence, candidates };
}
