import { addDays, todayISO } from "@/lib/domain/ids";
import { STAGE_LABELS, type Deal, type Stage, type Workspace } from "@/lib/domain/types";
import { localDate } from "@/lib/moves/util";
import { FUNNEL, median, type OpenStage } from "./stats";

const RANK: Partial<Record<Stage, number>> = { talking: 0, qualified: 1, pilot: 2, proposal: 3, won: 4 };
const DAY = 86_400_000;
export const MIN_CONVERSION_EXITS = 10;

function history(deal: Deal, now: number) {
  return deal.stageHistory.filter((h) => Number.isFinite(Date.parse(h.at)) && Date.parse(h.at) <= now).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
export function knownDealValue(deal: Deal): number | null {
  const value = deal.amountUsd ?? deal.priceQuotes?.at(-1)?.amountUsd;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export interface FunnelRow {
  stage: OpenStage;
  label: string;
  entered: number;
  advanced: number;
  lost: number;
  waiting: number;
  unknown: number;
  /** Observed forward moves ÷ decided exits; open and undated outcomes stay out. */
  conversion: number | null;
  medianDays: number | null;
  waitingDeals: { id: string; name: string; domain: string; days: number }[];
}
export interface PipelinePulse {
  asOf: string;
  from: string;
  previousFrom: string;
  recent: { count: number; knownUsd: number; missingValues: number };
  previous: { count: number; knownUsd: number; missingValues: number };
  openQualified: number;
  knownOpenUsd: number;
  undatedQualified: number;
  rows: FunnelRow[];
}

/** Explicit dated entries only. A current stage is not a made-up historical transition. */
export function pipelinePulse(ws: Pick<Workspace, "deals">, now = new Date()): PipelinePulse {
  const asOf = todayISO(now);
  const from = addDays(asOf, -29);
  const previousFrom = addDays(from, -30);
  const cohortFrom = addDays(asOf, -89);
  const result: PipelinePulse = {
    asOf, from, previousFrom,
    recent: { count: 0, knownUsd: 0, missingValues: 0 }, previous: { count: 0, knownUsd: 0, missingValues: 0 },
    openQualified: 0, knownOpenUsd: 0, undatedQualified: 0,
    rows: FUNNEL.map((stage) => ({ stage, label: STAGE_LABELS[stage], entered: 0, advanced: 0, lost: 0, waiting: 0, unknown: 0, conversion: null, medianDays: null, waitingDeals: [] })),
  };
  const durations = new Map<OpenStage, number[]>();
  for (const deal of Object.values(ws.deals)) {
    const events = history(deal, now.getTime());
    const qualified = events.find((e) => e.stage === "qualified");
    const value = knownDealValue(deal);
    if (["qualified", "pilot", "proposal"].includes(deal.stage)) {
      result.openQualified++;
      if (value !== null) result.knownOpenUsd += value;
      if (!qualified) result.undatedQualified++;
    }
    if (qualified) {
      const date = localDate(qualified.at);
      const bucket = date >= from ? result.recent : date >= previousFrom ? result.previous : undefined;
      if (bucket) { bucket.count++; if (value === null) bucket.missingValues++; else bucket.knownUsd += value; }
    }
    for (const row of result.rows) {
      const entryIndex = events.findIndex((e) => e.stage === row.stage);
      const entry = events[entryIndex];
      if (!entry || localDate(entry.at) < cohortFrom) continue;
      row.entered++;
      const entryTime = Date.parse(entry.at);
      const exit = events.slice(entryIndex + 1).find((e) => e.stage === "lost" || (RANK[e.stage] ?? -1) > RANK[row.stage]!);
      if (exit && exit.stage !== "lost") {
        row.advanced++;
        const times = durations.get(row.stage) ?? [];
        times.push((Date.parse(exit.at) - entryTime) / DAY);
        durations.set(row.stage, times);
      } else if (exit?.stage === "lost") row.lost++;
      else if ((RANK[deal.stage] ?? -1) > RANK[row.stage]! || deal.stage === "won" || deal.stage === "lost") row.unknown++;
      else {
        row.waiting++;
        row.waitingDeals.push({ id: deal.id, name: deal.name, domain: deal.accountDomain, days: Math.max(0, Math.floor((now.getTime() - entryTime) / DAY)) });
      }
    }
  }
  for (const row of result.rows) {
    const decided = row.advanced + row.lost;
    row.conversion = decided >= MIN_CONVERSION_EXITS ? row.advanced / decided : null;
    row.medianDays = median(durations.get(row.stage) ?? []);
    row.waitingDeals.sort((a, b) => b.days - a.days || a.id.localeCompare(b.id));
  }
  return result;
}
