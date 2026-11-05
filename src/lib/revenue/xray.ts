import type { ISODate, Workspace } from "@/lib/domain/types";
import { computeForecast, type DealCall, type Forecast } from "./forecast";
import type { Fix, RiskCode } from "./risk";
import { importUnknown } from "./stats";

/**
 * The pipeline X-ray: four questions a Head of GTM asks of every open deal, answered in code from what's on file
 * (docs/research/15 §3 #5). No next step on the calendar, a close date already gone, one person on the buyer side,
 * gone quiet or stuck. Each flagged deal carries the fact behind it and its fix, the same ones its risks show on
 * Revenue. When the data to answer a question isn't on file (a CRM export without contacts or activity dates),
 * the X-ray says it can't tell instead of flagging the deal.
 */

export type XrayCode = "no_next_step" | "close_passed" | "single_threaded" | "stale";

export interface XrayDeal {
  id: string;
  name: string;
  domain: string;
  amountUsd: number;
  /** The amount is the typical deal, not one on file. */
  estimated: boolean;
  /** The fact behind the flag. */
  detail: string;
  fix: Fix;
}

export interface XrayCheck {
  code: XrayCode;
  label: string;
  /** Why it matters, one sentence. */
  why: string;
  deals: XrayDeal[];
  usd: number;
  /** Open deals this check couldn't read, because the data isn't on file. */
  unknown: number;
  /** Set when no deal could be read: what's missing. */
  unchecked?: string;
}

export interface PipelineXray {
  open: number;
  openUsd: number;
  checks: XrayCheck[];
  /** Open deals no check flagged (unreadable checks don't count against a deal). */
  clear: number;
  /** Late-stage deals in the period that can't be commit until the evidence is on file. */
  commitBlocked: { count: number; usd: number };
}

const CHECKS: { code: XrayCode; label: string; why: string; risks: RiskCode[]; unchecked: string }[] = [
  { code: "no_next_step", label: "No next step on the calendar", why: "Without a dated step agreed with the buyer, nothing makes the deal move this week.", risks: ["no_next_step", "next_step_overdue"], unchecked: "" },
  { code: "close_passed", label: "Close date already passed", why: "The forecast counts on a date that's gone. Each needs a real one.", risks: ["close_passed"], unchecked: "" },
  { code: "single_threaded", label: "One person or fewer on the buyer side", why: "If that person goes quiet or leaves, the deal goes with them.", risks: ["single_threaded"], unchecked: "No contacts came with these deals, so threading can't be checked yet." },
  { code: "stale", label: "Gone quiet or stuck in a stage", why: "Silence and long stays in one stage are the earliest signs of a slip.", risks: ["quiet", "stalled"], unchecked: "No activity or stage dates came with these deals. I'll count from the day they arrived." },
];

/** True when the X-ray has nothing to go on for this question about this deal. */
function unreadable(c: DealCall, code: XrayCode): boolean {
  const d = c.deal;
  if (code === "single_threaded") return !d.contacts.length && importUnknown(d, "contacts");
  if (code === "stale") {
    const since = d.imported?.at;
    const quietUnknown = !!since && importUnknown(d, "activity") && d.lastActivityAt === since;
    const last = d.stageHistory.at(-1);
    const stageUnknown = !!since && last?.at === since && (importUnknown(d, "stage_date") || importUnknown(d, "created"));
    return quietUnknown && stageUnknown;
  }
  return false;
}

export function pipelineXray(ws: Workspace, today: ISODate, f: Forecast = computeForecast(ws, today)): PipelineXray {
  const calls = f.calls;
  const flagged = new Set<string>();
  const checks = CHECKS.map((def): XrayCheck => {
    const deals: XrayDeal[] = [];
    let unknown = 0;
    for (const c of calls) {
      // A deal with no contacts from a file that had none is unknown, not thin. Staleness counted from the import is a
      // floor, so once it fires it's a finding; before that, with no dates on file, it's unknown.
      // Two people at a late stage is thin, and Revenue says so; the X-ray asks the sharper question: one or none.
      const thread = def.code !== "single_threaded" || (!unreadable(c, def.code) && c.deal.contacts.length <= 1);
      const risk = thread ? c.risks.find((r) => def.risks.includes(r.code)) : undefined;
      if (!risk) {
        if (unreadable(c, def.code)) unknown++;
        continue;
      }
      flagged.add(c.deal.id);
      deals.push({ id: c.deal.id, name: c.deal.name, domain: c.deal.accountDomain, amountUsd: c.amount.usd, estimated: c.amount.source === "average", detail: risk.detail, fix: risk.fix });
    }
    deals.sort((a, b) => b.amountUsd - a.amountUsd || a.name.localeCompare(b.name));
    return {
      code: def.code,
      label: def.label,
      why: def.why,
      deals,
      usd: deals.reduce((n, d) => n + d.amountUsd, 0),
      unknown,
      ...(calls.length > 0 && unknown === calls.length && def.unchecked ? { unchecked: def.unchecked } : {}),
    };
  });
  const late = calls.filter((c) => c.inPeriod && (c.deal.stage === "proposal" || c.deal.stage === "pilot") && c.codeCategory !== "commit");
  return {
    open: calls.length,
    openUsd: calls.reduce((n, c) => n + c.amount.usd, 0),
    checks,
    clear: calls.filter((c) => !flagged.has(c.deal.id)).length,
    commitBlocked: { count: late.length, usd: late.reduce((n, c) => n + c.amount.usd, 0) },
  };
}
