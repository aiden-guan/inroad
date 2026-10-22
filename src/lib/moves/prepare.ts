import "server-only";
import { isConfigured } from "@/lib/ai/client";
import { addDays, todayISO } from "@/lib/domain/ids";
import type { Brief, Workspace } from "@/lib/domain/types";
import { briefData, emitHubEvent } from "@/lib/hub";
import { startRun } from "@/lib/runs/registry";
import { mutateWorkspace, readWorkspace } from "@/lib/store/workspace";
import { getWorkflow } from "@/lib/workflows";
import { planAhead, type AheadPlan } from "./ahead";
import { briefInputs, codeGreeting } from "./brief-data";
import { computeMoves, mergeMoves, TOP_MOVES, visibleMoves } from "./rules";
import { computeScoreboard } from "./scoreboard";

/**
 * Prepares Today. Runs on open, after the founder acts, and on a slow client timer; it is all
 * code (zero tokens) except one optional Haiku call when something new deserves a sentence.
 * The first open of the day also starts the free signal check (job boards, news, HN; no model)
 * on the watch list, so new why-now triggers keep turning into moves. With a key (never on the demo),
 * any prepare also briefs the next 24 hours' meetings and drafts the desk's follow-ups and first
 * touches ahead, within daily caps (./ahead).
 */

const MAX_MODEL_BRIEFS_PER_DAY = 3;
/** Companies the daily signal check covers; a longer watch list rotates, stalest first. */
const SWEEP_MAX = 25;

export interface PrepareResult {
  changed: boolean;
  briefRunId: string | null;
  /** The day's free signal check, started on the first open of the day. */
  sweepRunId: string | null;
  /** Meeting briefs and drafts started ahead of the founder (see ./ahead). */
  aheadRunIds: string[];
  moves: number;
}

function nextBrief(ws: Workspace, now: Date): Brief {
  const today = todayISO(now);
  const moves = mergeMoves(ws.moves, computeMoves(ws, now), today);
  const visible = visibleMoves(moves, today);
  const prev = ws.briefs[today];
  const base: Brief = prev ?? { date: today, kind: "daily", greeting: "", matters: [], generatedAt: now.toISOString(), seen: [] };
  return {
    ...base,
    // The greeting is code-built and recomputed every prepare, so counts and the salutation stay current.
    greeting: codeGreeting({ ...ws, moves }, visible, now),
    scoreboard: computeScoreboard(ws, now),
    moveIds: visible.slice(0, TOP_MOVES).map((m) => m.id),
    // What an open close-out still lists; tomorrow's greeting leads with it.
    closeOutLeft: visible.find((m) => m.kind === "close_out")?.subjectIds?.length || undefined,
  };
}

/** Watched and pipeline companies for the free signal check: A before B before C, least recently checked first. */
function sweepDomains(ws: Workspace): string[] {
  const tier = { A: 0, B: 1, C: 2 } as const;
  return Object.values(ws.accounts)
    .filter((a) => a.status !== "disqualified" && a.status !== "customer" && (a.watch || a.status === "tracked" || a.status === "in_pipeline"))
    .sort((a, b) => (tier[a.tier] ?? 3) - (tier[b.tier] ?? 3) || (a.enrichment?.crawledAt ?? "").localeCompare(b.enrichment?.crawledAt ?? ""))
    .slice(0, SWEEP_MAX)
    .map((a) => a.domain);
}

/** Old daily briefs carry nothing worth keeping; reviews stay (they're the Journal). */
function pruneBriefs(ws: Workspace, today: string) {
  const cutoff = addDays(today, -45);
  for (const [date, b] of Object.entries(ws.briefs)) if (date < cutoff && !b.review) delete ws.briefs[date];
}

export async function prepareToday(opts: { force?: boolean } = {}): Promise<PrepareResult> {
  const now = new Date();
  const today = todayISO(now);

  // Dry run against the cached snapshot so an unchanged day costs no write.
  const snapshot = readWorkspace();
  const dryMoves = mergeMoves(snapshot.moves, computeMoves(snapshot, now), today);
  const dryBrief = nextBrief(snapshot, now);
  const fresh = briefInputs(snapshot, now).fresh;
  // Anything a brief covered in the last 14 days (the signal window; replies use 7) isn't new again today.
  const since = addDays(today, -14);
  const seen = new Set(
    Object.entries(snapshot.briefs)
      .filter(([d]) => d >= since)
      .flatMap(([, b]) => b.seen ?? []),
  );
  const newKeys = fresh.filter((i) => !seen.has(i.key)).map((i) => i.key);
  const runsToday = snapshot.briefs[today]?.llmRuns ?? 0;
  // The sample workspace is a demo: never spend the founder's tokens on it unless a caller forces it.
  const wantModel = (opts.force || (newKeys.length > 0 && !snapshot.sample)) && runsToday < MAX_MODEL_BRIEFS_PER_DAY && isConfigured();

  // Briefs for the next 24 hours and drafts for the desk, prepared ahead. Never on the demo or without a key.
  const canPrepareAhead = !snapshot.sample && isConfigured();
  const wantAhead = canPrepareAhead && planAhead({ ...snapshot, moves: dryMoves }, now).keys.length > 0;

  const changed = wantModel || wantAhead || JSON.stringify(dryMoves) !== JSON.stringify(snapshot.moves) || JSON.stringify(dryBrief) !== JSON.stringify(snapshot.briefs[today]);

  // The first prepare of the day announces the brief (Slack, webhooks) once.
  const firstOfDay = !snapshot.briefs[today];
  let claimed = false;
  let sweep = false;
  let ahead: AheadPlan = { preps: [], drafts: [], keys: [] };
  if (changed) {
    const { value } = await mutateWorkspace((ws) => {
      ws.moves = mergeMoves(ws.moves, computeMoves(ws, now), today);
      // Planned against the merged desk and claimed in the same write, so two tabs never start the same run.
      const plan: AheadPlan = canPrepareAhead ? planAhead(ws, now) : { preps: [], drafts: [], keys: [] };
      const brief = nextBrief(ws, now);
      if (plan.keys.length) brief.ahead = [...(brief.ahead ?? []), ...plan.keys];
      // Claim the model run inside the write so two tabs opening at once don't both start one.
      const claim = wantModel && (ws.briefs[today]?.llmRuns ?? 0) === runsToday;
      if (claim) {
        brief.llmRuns = runsToday + 1;
        brief.seen = [...new Set([...(brief.seen ?? []), ...newKeys])];
      }
      // Decided inside the write too: only the day's first prepare starts the signal check. Never on the demo.
      const startSweep = !ws.sample && !ws.briefs[today];
      ws.briefs[today] = brief;
      pruneBriefs(ws, today);
      return { claim, sweep: startSweep, plan };
    });
    claimed = value.claim;
    sweep = value.sweep;
    ahead = value.plan;
  }

  let briefRunId: string | null = null;
  if (claimed) {
    const def = getWorkflow("brief");
    try {
      // When this is the day's first brief, the run announces it once the lines are written.
      if (def) briefRunId = (await startRun(def, { keys: newKeys, force: !!opts.force, announce: firstOfDay })).id;
    } catch (err) {
      // Budget used up or no key: the code greeting stands. Never block Today on the model.
      console.warn("[today] brief run not started:", err instanceof Error ? err.message : err);
    }
  }

  let sweepRunId: string | null = null;
  if (sweep) {
    const domains = sweepDomains(readWorkspace());
    const def = getWorkflow("enrich");
    try {
      if (def && domains.length) sweepRunId = (await startRun(def, { domains })).id;
    } catch (err) {
      console.warn("[today] signal check not started:", err instanceof Error ? err.message : err);
    }
  }

  const aheadRunIds: string[] = [];
  const prep = getWorkflow("prep");
  const compose = getWorkflow("compose");
  for (const meetingId of ahead.preps) {
    try {
      if (prep) aheadRunIds.push((await startRun(prep, { meetingId })).id);
    } catch (err) {
      // Budget used up: the card keeps its "Prepare the brief" button.
      console.warn("[today] brief not prepared ahead:", err instanceof Error ? err.message : err);
    }
  }
  for (const { args } of ahead.drafts) {
    try {
      if (compose) aheadRunIds.push((await startRun(compose, args)).id);
    } catch (err) {
      console.warn("[today] draft not started ahead:", err instanceof Error ? err.message : err);
    }
  }

  const after = readWorkspace();
  if (firstOfDay && !briefRunId && after.briefs[today]) void emitHubEvent("brief.ready", { brief: briefData(after, today) });
  return { changed, briefRunId, sweepRunId, aheadRunIds, moves: visibleMoves(after.moves, today).length };
}
