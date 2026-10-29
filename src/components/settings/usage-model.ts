import { costOf, emptyUsage, MODEL_LABELS, WEB_SEARCH_PRICE, type ModelTier } from "@/lib/ai/models";
import { monthKey } from "@/lib/domain/ids";
import type { ModelTierName, RunSummary, WorkflowId, Workspace } from "@/lib/domain/types";

/**
 * Spend, budget and routing, computed in code from the workspace (usage roll-ups + run receipts).
 * Pure: used by the Usage section and by GET /api/usage, so other tools see the same numbers.
 */

export const WORKFLOW_META: Record<WorkflowId, { label: string; tiers: ModelTierName[] }> = {
  foundation: { label: "Playbook", tiers: ["strategist", "fast"] },
  discovery: { label: "Finding companies", tiers: ["operator", "fast"] },
  dossier: { label: "Dossiers", tiers: ["operator"] },
  compose: { label: "Drafts", tiers: ["operator", "fast"] },
  prep: { label: "Meeting prep", tiers: ["operator"] },
  debrief: { label: "Call debriefs", tiers: ["operator", "fast"] },
  review: { label: "Weekly reviews", tiers: ["operator"] },
  dinner_plan: { label: "Events", tiers: ["operator"] },
  ask: { label: "Ask", tiers: ["operator"] },
  asset: { label: "Documents", tiers: ["operator"] },
  studio: { label: "Studio", tiers: ["strategist", "operator", "fast"] },
  visual: { label: "Studio visuals", tiers: ["strategist", "operator"] },
  brief: { label: "Today's brief", tiers: ["fast"] },
  network: { label: "Network screen", tiers: ["fast"] },
  enrich: { label: "Free signals", tiers: ["none"] },
  partners: { label: "Creators and communities", tiers: ["operator"] },
  agent_ask: { label: "Agent questions", tiers: ["operator", "strategist", "fast"] },
  gtm_update: { label: "Weekly GTM updates", tiers: ["operator"] },
};

export function workflowLabel(id: WorkflowId): string {
  return WORKFLOW_META[id]?.label ?? id;
}

export const TIER_LABEL: Record<ModelTierName, string> = { ...MODEL_LABELS, none: "Code only" };

export interface RouteRow {
  tier: ModelTierName;
  model: string;
  job: string;
  what: string;
  /** USD per million tokens, from models.ts. Null for code. */
  price: { input: number; output: number; cacheRead: number } | null;
}

function pricePerMTok(tier: ModelTier) {
  const one = (k: "inputTokens" | "outputTokens" | "cacheReadTokens") => costOf(tier, { ...emptyUsage(), [k]: 1_000_000 });
  return { input: one("inputTokens"), output: one("outputTokens"), cacheRead: one("cacheReadTokens") };
}

/** The model routing policy, in plain words. Prices come straight from `src/lib/ai/models.ts`. */
export const ROUTING: RouteRow[] = [
  {
    tier: "strategist",
    model: MODEL_LABELS.strategist,
    job: "Strategy only",
    what: "Your playbook: positioning, who to sell to and the plan. It runs a few times a month at most.",
    price: pricePerMTok("strategist"),
  },
  {
    tier: "operator",
    model: MODEL_LABELS.operator,
    job: "Writing",
    what: "Dossiers, drafts, meeting prep, debriefs, reviews, documents and Ask.",
    price: pricePerMTok("operator"),
  },
  {
    tier: "fast",
    model: MODEL_LABELS.fast,
    job: "Screening",
    what: "Sorting candidates, screening your network, tagging news and short copy. Never searches the web.",
    price: pricePerMTok("fast"),
  },
  {
    tier: "none",
    model: "Code",
    job: "Everything else",
    what: "Crawling sites, job boards, news, DNS, ranking, scoring, dedupe, lint, caps and syncing your other tools.",
    price: null,
  },
];

export const SEARCH_PRICE = WEB_SEARCH_PRICE;

export interface UsageReport {
  month: string; // YYYY-MM
  spendUsd: number;
  budgetUsd: number;
  /** spend ÷ budget; 0 with no budget. */
  share: number;
  /** near = 80% of the budget (warning), over = runs are blocked. */
  state: "ok" | "near" | "over";
  /** First day of next month, when the budget resets. */
  resetsOn: string;
  /** Straight-line month-end estimate; null in the first two days or with no spend. */
  projectedUsd: number | null;
  runs: number;
  freeSignals: number;
  searches: number;
  byWorkflow: { workflow: WorkflowId; label: string; costUsd: number; runs: number }[];
  byModel: { tier: ModelTierName; runs: number; costUsd: number }[];
  /** Share of input tokens read from the prompt cache (billed at 5–10% of the input price). */
  cache: { inputTokens: number; cacheReadTokens: number; share: number | null };
  history: { month: string; costUsd: number; runs: number }[];
  /** This month's finished and live runs, newest first. */
  recent: RunSummary[];
  /**
   * Runs this month in compatibility mode: the API rejected an optional feature and the run went without
   * it (no refusal fallbacks, or no strict output). Null when every run had everything.
   */
  compat: { runs: number; features: CompatLeftOut[]; lastAt: string; reason: string } | null;
}

type CompatLeftOut = NonNullable<NonNullable<RunSummary["receipt"]>["compat"]>["features"][number];

/** What compat mode left out, in the founder's words. */
export const COMPAT_LABEL: Record<CompatLeftOut, string> = {
  fallback: "refusal fallbacks",
  binding: "thinking-history binding",
  strict: "strict output checks",
  betas: "refusal fallbacks and thinking-history binding",
};

/** What going without each one means for the founder. */
export const COMPAT_EFFECT: Record<CompatLeftOut, string> = {
  fallback: "a refused request won't be retried on another model",
  binding: "an Ask follow-up after the playbook or the Web toggle changed may be turned down",
  strict: "tool output isn't held to its schema by the API",
  betas: "a refused request won't be retried on another model, and an Ask follow-up after a change may be turned down",
};

function monthOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : monthKey(d);
}

export function usageReport(ws: Workspace, now: Date = new Date()): UsageReport {
  const month = monthKey(now);
  const usage = ws.usage[month];
  const spendUsd = usage?.costUsd ?? 0;
  const budgetUsd = ws.caps.monthlyBudgetUsd ?? 0;
  const share = budgetUsd > 0 ? spendUsd / budgetUsd : 0;
  // Compare in cents so $4.80 of $6 counts as 80% (floating point says 79.99…%).
  const cents = (n: number) => Math.round(n * 100);
  const state = budgetUsd <= 0 ? "ok" : cents(spendUsd) >= cents(budgetUsd) ? "over" : cents(spendUsd) * 10 >= cents(budgetUsd) * 8 ? "near" : "ok";

  const day = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projectedUsd = day >= 3 && spendUsd > 0 ? (spendUsd / day) * daysInMonth : null;
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const resetsOn = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;

  const recent = ws.runs.filter((r) => monthOf(r.startedAt) === month).sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const runsBy = new Map<WorkflowId, number>();
  const modelBy = new Map<ModelTierName, { runs: number; costUsd: number }>();
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let searches = 0;
  for (const r of recent) {
    runsBy.set(r.workflow, (runsBy.get(r.workflow) ?? 0) + 1);
    if (!r.receipt) continue;
    const m = modelBy.get(r.receipt.model) ?? { runs: 0, costUsd: 0 };
    m.runs += 1;
    m.costUsd += r.receipt.costUsd;
    modelBy.set(r.receipt.model, m);
    inputTokens += r.receipt.inputTokens;
    cacheReadTokens += r.receipt.cacheReadTokens;
    searches += r.receipt.searches;
  }

  const ids = new Set<WorkflowId>([...(Object.keys(usage?.byWorkflow ?? {}) as WorkflowId[]), ...runsBy.keys()]);
  const byWorkflow = [...ids]
    .map((workflow) => ({ workflow, label: workflowLabel(workflow), costUsd: usage?.byWorkflow[workflow] ?? 0, runs: runsBy.get(workflow) ?? 0 }))
    .filter((w) => w.costUsd > 0 || w.runs > 0)
    .sort((a, b) => b.costUsd - a.costUsd || b.runs - a.runs);

  const byModel = (["strategist", "operator", "fast", "none"] as ModelTierName[]).map((tier) => ({ tier, ...(modelBy.get(tier) ?? { runs: 0, costUsd: 0 }) }));

  const degraded = recent.filter((r) => r.receipt?.compat);
  const compat = degraded.length
    ? {
        runs: degraded.length,
        features: [...new Set(degraded.flatMap((r) => r.receipt!.compat!.features))],
        lastAt: degraded[0].endedAt ?? degraded[0].startedAt,
        reason: degraded[0].receipt!.compat!.reason,
      }
    : null;

  const totalIn = inputTokens + cacheReadTokens;
  const history = Object.entries(ws.usage)
    .filter(([k]) => k <= month)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([m, u]) => ({ month: m, costUsd: u.costUsd, runs: u.runs }));

  return {
    month,
    spendUsd,
    budgetUsd,
    share,
    state,
    resetsOn,
    projectedUsd,
    runs: Math.max(usage?.runs ?? 0, recent.filter((r) => r.status !== "running" && r.status !== "queued").length),
    freeSignals: usage?.freeSignals ?? 0,
    searches,
    byWorkflow,
    byModel,
    cache: { inputTokens, cacheReadTokens, share: totalIn > 0 ? cacheReadTokens / totalIn : null },
    history,
    recent,
    compat,
  };
}

/** Receipts: "$0", "$0.004", "$0.62", "$14.20". */
export function cost(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return "—";
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(3)}`;
  if (n < 1000) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** "1.2M", "48K", "640". */
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}
