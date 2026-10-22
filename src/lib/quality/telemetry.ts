import { daysBetween } from "@/lib/domain/ids";
import type { DraftCritic, Workspace } from "@/lib/domain/types";

/**
 * Product health for Inroad itself (SPEC §5.4), computed from the workspace on this machine and shown in Settings →
 * Usage. Nothing is sent anywhere. Critic verdicts stay hidden on drafts; only these aggregates are shown.
 */

export interface HealthRow {
  key: string;
  label: string;
  /** "64%", "1m 40s", "Yes". Null when there's nothing to measure yet. */
  value: string | null;
  n?: number;
  target: string;
  /** null when there's too little to judge. */
  ok: boolean | null;
  note?: string;
}

/** The critic's pass rule, as compose applies it: a reply, no fatal issue, every span entailed, a POV that isn't obvious. */
export function criticPass(c: DraftCritic): boolean {
  return c.wouldReply && c.fatal.length === 0 && c.unsupportedSpans.length === 0 && !c.povObvious;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function seconds(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** A rate row: hidden below `min` samples, judged against `target` (at least, or at most). */
function rate(key: string, label: string, hits: number, n: number, target: number, dir: "min" | "max", min = 5, note?: string): HealthRow {
  const value = n ? hits / n : null;
  return {
    key,
    label,
    value: value === null ? null : pct(value),
    n,
    target: `${dir === "min" ? "≥" : "≤"}${pct(target)}`,
    ok: value === null || n < min ? null : dir === "min" ? value >= target : value <= target,
    note,
  };
}

export function productHealth(ws: Workspace, now: Date): HealthRow[] {
  const rows: HealthRow[] = [];

  // Drafts: the critic's first verdict on each step it judged (a rewrite keeps the verdict that prompted it).
  const critics = Object.values(ws.outreach).flatMap((p) => [...p.steps, ...p.alternates]).flatMap((s) => (s.critic ? [s.critic] : []));
  rows.push(rate("critic_first_pass", "Critic passes the first draft", critics.filter(criticPass).length, critics.length, 0.7, "min"));
  rows.push(rate("critic_vs_reference", "Drafts preferred over the reference email", critics.filter((c) => c.preferredOverReference).length, critics.length, 0.5, "min", 5, "Blind, pairwise, from the buyer's seat"));

  const sends = ws.activities.filter((a) => a.draftRef && a.editDistance !== undefined && (a.kind === "touch_sent" || a.kind === "linkedin_dm" || a.kind === "intro_requested"));
  rows.push(rate("light_edits", "Drafts sent with 20% or less edited", sends.filter((a) => a.editDistance! <= 0.2).length, sends.length, 0.6, "min"));

  const evidence = Object.values(ws.evidence);
  rows.push(rate("flagged_wrong", "Evidence you flagged as wrong", evidence.filter((e) => e.flaggedWrong).length, evidence.length, 0.02, "max", 20));

  // Check replies: touches older than a week, how many got an outcome marked within 7 days.
  const today = now.toISOString();
  const touches = ws.activities.filter((a) => a.kind === "touch_sent" && daysBetween(a.at, today) > 7 && daysBetween(a.at, today) <= 60);
  const marked = touches.filter((a) => (a.outcomeAt && daysBetween(a.at, a.outcomeAt) <= 7) || ws.activities.some((r) => r.kind === "reply_received" && r.personId === a.personId && r.at > a.at && daysBetween(a.at, r.at) <= 7));
  rows.push(rate("outcomes_marked", "Touches with an outcome marked within 7 days", marked.length, touches.length, 0.7, "min"));

  // First run, from pressing Enter on the website.
  const onb = ws.onboarding;
  const run = onb.runId ? ws.runs.find((r) => r.id === onb.runId) : undefined;
  const start = run?.startedAt ?? onb.ledger?.[0]?.at;
  const after = (iso: string | undefined) => (start && iso ? new Date(iso).getTime() - new Date(start).getTime() : null);
  const timing = (key: string, label: string, ms: number | null, targetMs: number, target: string): HealthRow => ({ key, label, value: ms === null || ms < 0 ? null : seconds(ms), target, ok: ms === null || ms < 0 ? null : ms <= targetMs });
  rows.push(timing("first_learned", "First run: what I learned on screen", after(onb.sections?.snapshot), 20_000, "≤20s"));
  const discovery = onb.discoveryRunId ? ws.runs.find((r) => r.id === onb.discoveryRunId) : undefined;
  rows.push(timing("first_companies", "First run: three companies to talk to", after(discovery?.endedAt), 120_000, "≤2m"));

  // The founder's first weeks.
  const hired = onb.hiredAt;
  if (hired) {
    const within = (iso: string | undefined, days: number) => !!iso && daysBetween(hired, iso) <= days && iso >= hired;
    const yesNo = (key: string, label: string, yes: boolean, decided: boolean, target: string): HealthRow => ({ key, label, value: decided || yes ? (yes ? "Yes" : "No") : null, target, ok: decided || yes ? yes : null });
    const elapsed = daysBetween(hired, today);
    const firstSend = ws.activities.filter((a) => a.draftRef).sort((a, b) => a.at.localeCompare(b.at))[0];
    rows.push(yesNo("day1_send", "Sent a draft on day one", within(firstSend?.at, 1), elapsed >= 1, "Yes"));
    rows.push(yesNo("week1_import", "Imported a network list in week one", within(ws.network?.importedAt, 7), elapsed >= 7, "Yes"));
    const nowMs = now.getTime();
    const held = Object.values(ws.meetings).filter((m) => new Date(m.startsAt).getTime() <= nowMs && within(m.startsAt, 21)).length;
    rows.push(yesNo("week3_conversations", "Five conversations by week three", held >= 5, elapsed >= 21, "Yes"));
  }
  return rows;
}
