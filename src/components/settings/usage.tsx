"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { AgentErrorNote } from "@/components/ui/agent-error";
import { Badge } from "@/components/ui/badge";
import { Num, Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { duration, plural, relativeTime } from "@/lib/client/format";
import type { Action } from "@/lib/domain/actions";
import type { ModelTierName, RunStep, RunSummary, Workspace } from "@/lib/domain/types";
import { ease } from "@/lib/motion";
import { Callout, Group, Row, SettingsSection, TextSetting } from "./parts";
import { cost, ROUTING, SEARCH_PRICE, TIER_LABEL, tokens, usageReport, workflowLabel, type UsageReport } from "./usage-model";

type Dispatch = (actions: Action | Action[]) => Promise<boolean>;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (key: string) => MONTHS[Number(key.slice(5, 7)) - 1] ?? key;
const shortMonth = (key: string) => monthName(key).slice(0, 3);
const resetLabel = (iso: string) => `${shortMonth(iso.slice(0, 7))} ${Number(iso.slice(8, 10))}`;

export function UsageSection({ ws, dispatch, now }: { ws: Workspace; dispatch: Dispatch; now: number }) {
  const report = useMemo(() => usageReport(ws, new Date(now)), [ws, now]);
  return (
    <SettingsSection
      id="usage"
      title="Usage & budget"
      description="You pay Anthropic directly for the AI work, at cost. Every run ends with a receipt; this is the month in one place."
    >
      <SpendCard report={report} />
      <BudgetGroup ws={ws} dispatch={dispatch} report={report} />
      <Stats report={report} />
      <ByWorkflow report={report} />
      <RecentRuns report={report} now={now} />
      <HowCostStaysLow report={report} />
    </SettingsSection>
  );
}

/* ───────────── This month ───────────── */

function SpendCard({ report }: { report: UsageReport }) {
  const { spendUsd, budgetUsd, share, state } = report;
  const pct = Math.round(share * 100);
  const past = report.history.filter((h) => h.month !== report.month).slice(-3).reverse();
  return (
    <div className="rounded-lg bg-surface p-5 shadow-xs ring-1 ring-border">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] font-medium text-fg-3">AI spend in {monthName(report.month)}</p>
        {state !== "ok" && <Badge tone={state === "over" ? "danger" : "warning"}>{state === "over" ? "Budget reached" : `${pct}% of budget`}</Badge>}
      </div>
      <p className="mt-1 font-serif text-[44px] leading-[48px] tracking-[-0.02em] text-fg [font-variation-settings:'opsz'_72]">
        <Num value={spendUsd} format={{ style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }} />
      </p>
      <p className="mt-1 text-[13px] text-fg-2">
        {budgetUsd > 0 ? (
          <>
            of your <span className="font-mono tnum">${budgetUsd.toLocaleString("en-US")}</span> monthly budget · <span className="font-mono tnum">{pct}%</span> · <span className="whitespace-nowrap">resets {resetLabel(report.resetsOn)}</span>
          </>
        ) : (
          "No monthly budget set."
        )}
      </p>
      {budgetUsd > 0 && <BudgetBar share={share} state={state} />}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-fg-3">
        {report.projectedUsd !== null && (
          <span>
            At this pace, about <span className="font-mono tnum text-fg-2">{cost(report.projectedUsd)}</span> by month end.
          </span>
        )}
        {past.map((h) => (
          <span key={h.month}>
            {shortMonth(h.month)} <span className="font-mono tnum text-fg-2">{cost(h.costUsd)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function BudgetBar({ share, state }: { share: number; state: UsageReport["state"] }) {
  return (
    <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-border" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, share) * 100)} aria-label="Share of monthly budget used">
      <motion.div
        className={cn("absolute inset-y-0 left-0 w-full origin-left rounded-full", state === "over" ? "bg-danger" : state === "near" ? "bg-warning" : "bg-fg-2")}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: Math.min(1, Math.max(share, share > 0 ? 0.01 : 0)) }}
        transition={{ duration: 0.6, ease: ease.out }}
      />
      {/* The 80% line: past it, I warn; at 100%, new runs stop. */}
      <span className="absolute inset-y-0 left-[80%] w-px bg-border-strong" aria-hidden />
    </div>
  );
}

/* ───────────── Budget ───────────── */

function BudgetGroup({ ws, dispatch, report }: { ws: Workspace; dispatch: Dispatch; report: UsageReport }) {
  return (
    <div className="space-y-3">
      {report.state === "over" && (
        <Callout tone="danger" title="This month's budget is used up, so new runs won't start.">
          Raise the budget below to keep going, or wait until {resetLabel(report.resetsOn)}. Everything done in code keeps working: free signals, imports, syncing your tools and the
          checks on your drafts.
        </Callout>
      )}
      {report.state === "near" && (
        <Callout tone="warning" title={`You've used ${Math.round(report.share * 100)}% of this month's budget.`}>
          At the cap, new runs stop with a clear message until you raise it or the month turns over. Runs already going always finish.
        </Callout>
      )}
      <Group>
        <TextSetting
          label="Monthly budget (USD)"
          hint="A hard stop for AI spend, checked before each run. As a backstop, set a spend limit in your Anthropic Console too."
          value={String(ws.caps.monthlyBudgetUsd)}
          mono
          inputMode="numeric"
          required="Set a budget. It keeps a runaway month from surprising you."
          normalize={(v) => v.replace(/[$,\s]/g, "")}
          validate={(v) => {
            const n = Number(v);
            if (!Number.isFinite(n)) return "Enter a dollar amount, like 50.";
            if (n < 5) return "Set at least $5. One dossier costs about $0.10.";
            if (n > 5000) return "That's above $5,000. Set it in the Anthropic Console instead.";
            return null;
          }}
          onSave={(v) => dispatch({ type: "caps.update", patch: { monthlyBudgetUsd: Math.round(Number(v)) } })}
        />
        <Row
          label="Anthropic Console limit"
          hint="Anthropic stops all API use at that limit, even if this machine's records were reset."
        >
          <div className="flex sm:justify-end">
            <a
              href="https://console.anthropic.com/settings/limits"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 items-center gap-1 rounded-sm px-2.5 text-[13px] font-medium text-fg-2 ring-1 ring-border-strong/70 transition-[background-color,color,transform] duration-150 hover:bg-bg-subtle hover:text-fg active:scale-[0.97]"
            >
              Open limits <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
          </div>
        </Row>
      </Group>
    </div>
  );
}

/* ───────────── Stats ───────────── */

function Stats({ report }: { report: UsageReport }) {
  const cacheShare = report.cache.share;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Stat label="Runs this month" value={report.runs} note={report.runs ? `${cost(report.runs ? report.spendUsd / report.runs : 0)} on average` : "Nothing yet"} />
      <Stat
        label="Free signal lookups"
        value={report.freeSignals}
        note={
          report.freeSignals
            ? `Done in code, $0 in tokens. As web searches they'd cost at least ${cost(report.freeSignals * SEARCH_PRICE)}.`
            : "Job boards, news and DNS, fetched in code for $0."
        }
      />
      <Stat
        label="Read from cache"
        value={cacheShare === null ? null : Math.round(cacheShare * 100)}
        suffix="%"
        note={cacheShare === null ? "Shows once runs have receipts." : "of input tokens, billed at a tenth to a twentieth of the normal price."}
      />
    </div>
  );
}

function Stat({ label, value, note, suffix }: { label: string; value: number | null; note: string; suffix?: string }) {
  return (
    <div className="rounded-lg bg-surface px-4 py-3.5 shadow-xs ring-1 ring-border">
      <p className="text-[12px] font-medium text-fg-3">{label}</p>
      <p className="mt-1 font-mono text-[22px] leading-7 text-fg">
        {value === null ? <span className="text-fg-4">—</span> : <Num value={value} format={{ maximumFractionDigits: 0 }} />}
        {value !== null && suffix}
      </p>
      <p className="mt-1 text-[12px] leading-[17px] text-fg-3 text-pretty">{note}</p>
    </div>
  );
}

/* ───────────── Spend by workflow ───────────── */

function ByWorkflow({ report }: { report: UsageReport }) {
  const rows = report.byWorkflow;
  const max = Math.max(...rows.map((r) => r.costUsd), 0.0001);
  return (
    <Group title="Spend by workflow" hint={rows.length ? "Where this month's money went. Code-only work shows at $0." : undefined}>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-fg-3">
          {report.spendUsd > 0 ? "This month's spend has no per-workflow breakdown yet." : "No AI spend yet this month."}
        </p>
      ) : (
        <ul className="px-4 py-2">
          {rows.map((r, i) => (
            <li key={r.workflow} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-1.5 sm:grid-cols-[140px_minmax(0,1fr)_72px]">
              <span className="truncate text-[13px] text-fg">{r.label}</span>
              <span className="order-3 col-span-2 h-2 sm:order-none sm:col-span-1">
                <span className="relative block h-full w-full">
                  {r.costUsd > 0 ? (
                    <motion.span
                      className="absolute inset-y-0 left-0 origin-left rounded-[2px] bg-fg-3"
                      style={{ width: `${Math.max(1.5, (r.costUsd / max) * 100)}%` }}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 0.45, ease: ease.out, delay: Math.min(i, 8) * 0.04 }}
                    />
                  ) : (
                    <span className="absolute inset-y-0 left-0 flex items-center text-[11px] text-fg-3">code only</span>
                  )}
                </span>
              </span>
              <span className="text-right font-mono text-[12px] tnum text-fg-2">
                {cost(r.costUsd)}
                {r.runs > 0 && <span className="ml-1.5 text-fg-4 sm:hidden">· {plural(r.runs, "run")}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Group>
  );
}

/* ───────────── Recent runs ───────────── */

const PAGE = 8;

function RecentRuns({ report, now }: { report: UsageReport; now: number }) {
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const runs = report.recent;
  const shown = showAll ? runs : runs.slice(0, PAGE);
  return (
    <Group id="runs" title="Recent runs" hint={runs.length ? "Each receipt shows the model, time, sources and cost. Open one for the full log." : undefined}>
      {runs.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-fg-3 text-pretty">
          No runs yet this month. When I research or write something, its receipt lands here.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {shown.map((r) => (
              <RunRow key={r.id} run={r} now={now} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
            ))}
          </ul>
          {runs.length > PAGE && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="flex h-9 w-full items-center justify-center text-[12.5px] text-fg-2 transition-colors hover:bg-bg-subtle/60 hover:text-fg"
            >
              {showAll ? "Show fewer" : `Show all ${runs.length} this month`}
            </button>
          )}
        </>
      )}
    </Group>
  );
}

function receiptLine(r: RunSummary): string {
  const rc = r.receipt;
  const parts = [workflowLabel(r.workflow), rc ? TIER_LABEL[rc.model] : null, rc ? duration(rc.durationMs) : null, rc?.sources ? plural(rc.sources, "source") : null, rc?.drafts ? plural(rc.drafts, "draft") : null];
  return parts.filter(Boolean).join(" · ");
}

function RunRow({ run, now, open, onToggle }: { run: RunSummary; now: number; open: boolean; onToggle: () => void }) {
  const [steps, setSteps] = useState<RunStep[] | null>(null);
  const [loading, setLoading] = useState(false);
  const live = run.status === "running" || run.status === "queued";

  const toggle = () => {
    onToggle();
    if (open || steps || loading) return;
    setLoading(true);
    fetch(`/api/runs/${run.id}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { steps: [] }))
      .then((body: { steps?: RunStep[] }) => setSteps(body.steps ?? []))
      .catch(() => setSteps([]))
      .finally(() => setLoading(false));
  };

  return (
    <li>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-bg-subtle/60"
      >
        <StatusDot status={run.status} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-fg">{run.title}</span>
          <span className="block truncate font-mono text-[11.5px] text-fg-3">
            {live ? <span className="shimmer-text">{run.status === "queued" ? "Queued" : "Working"}</span> : receiptLine(run)}
          </span>
        </span>
        <span className="hidden shrink-0 font-mono text-[11.5px] text-fg-3 sm:inline">{relativeTime(run.endedAt ?? run.startedAt, now)}</span>
        <span className="w-14 shrink-0 text-right font-mono text-[12.5px] tnum text-fg">{live ? "—" : cost(run.receipt?.costUsd ?? 0)}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-fg-3 transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: 0.22, ease: ease.out }}
            className="overflow-hidden"
          >
            <RunDetail run={run} steps={steps} loading={loading} />
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function StatusDot({ status }: { status: RunSummary["status"] }) {
  const tone = status === "error" ? "bg-danger" : status === "stopped" ? "bg-fg-4" : status === "done" ? "bg-fg-3" : "bg-accent";
  return <span className={cn("size-1.5 shrink-0 rounded-full", tone)} aria-label={status} role="img" />;
}

function RunDetail({ run, steps, loading }: { run: RunSummary; steps: RunStep[] | null; loading: boolean }) {
  const rc = run.receipt;
  const fields: [string, string][] = rc
    ? [
        ["Model", TIER_LABEL[rc.model]],
        ["Worked for", duration(rc.durationMs)],
        ["Sources", String(rc.sources)],
        ["Web searches", rc.searches ? `${rc.searches} · ${cost(rc.searches * SEARCH_PRICE)}` : "0"],
        ["Pages read", String(rc.fetches)],
        ["Input tokens", tokens(rc.inputTokens)],
        ["Cache reads", tokens(rc.cacheReadTokens)],
        ["Output tokens", tokens(rc.outputTokens)],
        ["Cost", cost(rc.costUsd)],
      ]
    : [];
  return (
    <div className="bg-bg-subtle/50 px-4 pb-4 pt-1 sm:pl-[34px]">
      {run.error && (
        <p className="mb-2">
          <AgentErrorNote error={run.error} className="text-[12.5px]" />
        </p>
      )}
      {fields.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {fields.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] text-fg-3">{k}</dt>
              <dd className="truncate font-mono text-[12px] text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-3">
        {loading && (
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3.5 w-1/2" />
          </div>
        )}
        {steps && steps.length > 0 && (
          <ol className="space-y-0.5 border-l border-border pl-3">
            {steps
              .filter((s) => s.type !== "thinking")
              .slice(-12)
              .map((s, i) => (
                <li key={i} className="truncate text-[12px] leading-5 text-fg-2">
                  {s.type === "search" ? (
                    <>
                      Searched <span className="text-fg-3">“{s.text}”</span>
                    </>
                  ) : s.type === "read" ? (
                    <>
                      Read <span className="font-mono text-[11.5px] text-fg-3">{s.host ?? s.text}</span>
                    </>
                  ) : (
                    s.text
                  )}
                </li>
              ))}
          </ol>
        )}
        {steps && steps.length === 0 && !loading && <p className="text-[12px] text-fg-3">The step log for this run has been cleared. The receipt above is kept.</p>}
      </div>
    </div>
  );
}

/* ───────────── How Inroad keeps cost down ───────────── */

function HowCostStaysLow({ report }: { report: UsageReport }) {
  const byTier = new Map<ModelTierName, { runs: number; costUsd: number }>(report.byModel.map((m) => [m.tier, m]));
  const cachePct = report.cache.share === null ? null : Math.round(report.cache.share * 100);
  const points: { title: string; body: ReactNode }[] = [
    {
      title: "Code gathers, the model writes.",
      body: "Websites, job boards, news, Hacker News and DNS are fetched in code and cached on disk. I read a compact digest, never raw pages.",
    },
    {
      title: "Web search is a capped fallback.",
      body: (
        <>
          Only when free sources come back thin, and at most 3 to 5 searches a run at {cost(SEARCH_PRICE)} each. This month: <span className="font-mono tnum">{report.searches}</span>.
        </>
      ),
    },
    { title: "Results get reused.", body: "A dossier stays fresh for 7 days. I rewrite it only when you ask or a strong new signal lands." },
    {
      title: "Repeated instructions are cached.",
      body: cachePct === null ? "Cached prompt reads cost a tenth to a twentieth of the normal price." : `This month ${cachePct}% of input came from cache, at a tenth to a twentieth of the price.`,
    },
    { title: "Nothing runs in the background.", body: "I prepare things when you open the app, so a quiet week costs nothing." },
    {
      title: "Your other tools plug in.",
      body: (
        <>
          Leads, CRM sync, sequencer pushes and Slack run in plain code. If another agent already writes your outreach, send it my dossiers and skip drafting here.{" "}
          <Link href="/integrations" className="text-fg underline underline-offset-2 hover:text-fg-2">
            Integrations
          </Link>
        </>
      ),
    },
  ];

  return (
    <div id="cost" className="scroll-mt-24">
      <h3 className="mb-1 text-[14px] font-semibold tracking-[-0.005em] text-fg">How Inroad keeps cost down</h3>
      <p className="mb-4 max-w-[60ch] font-serif text-[17px] leading-[26px] text-fg-2">
        I spend tokens only where judgment or writing is needed. The right model for each job, and code for everything else.
      </p>
      <div className="overflow-hidden rounded-lg bg-surface shadow-xs ring-1 ring-border">
        <div className="hidden grid-cols-[120px_minmax(0,1fr)_120px_88px] gap-4 border-b border-border px-4 py-2 text-[11px] font-medium text-fg-3 sm:grid">
          <span>Model</span>
          <span>Used for</span>
          <span className="text-right">Per M tokens</span>
          <span className="text-right">This month</span>
        </div>
        <ul className="divide-y divide-border">
          {ROUTING.map((r) => {
            const used = byTier.get(r.tier);
            return (
              <li key={r.tier} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[120px_minmax(0,1fr)_120px_88px]">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-fg">{r.model}</p>
                  <p className="text-[12px] text-fg-3">{r.job}</p>
                </div>
                <p className="order-3 col-span-2 text-[12.5px] leading-[18px] text-fg-2 text-pretty sm:order-none sm:col-span-1">{r.what}</p>
                <p className="hidden text-right font-mono text-[11.5px] leading-5 text-fg-3 sm:block">
                  {r.price ? (
                    <>
                      {cost(r.price.input)} in
                      <br />
                      {cost(r.price.output)} out
                    </>
                  ) : (
                    "$0"
                  )}
                </p>
                <p className="text-right font-mono text-[12px] leading-5 text-fg-2">
                  {used?.runs ? (
                    <>
                      {cost(used.costUsd)}
                      <span className="block text-[11px] text-fg-3">{plural(used.runs, "run")}</span>
                    </>
                  ) : r.tier === "none" ? (
                    <span className="text-fg-3">{report.freeSignals ? `${report.freeSignals} lookups` : "$0"}</span>
                  ) : (
                    <span className="text-fg-4">—</span>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
      <ol className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {points.map((p, i) => (
          <li key={p.title} className="flex gap-3">
            <span className="mt-px font-mono text-[11px] text-fg-4">{String(i + 1).padStart(2, "0")}</span>
            <p className="text-[13px] leading-5 text-fg-2 text-pretty">
              <span className="font-medium text-fg">{p.title}</span> {p.body}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
