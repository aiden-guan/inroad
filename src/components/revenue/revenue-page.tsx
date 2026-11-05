"use client";

import { FileText, FileUp, Target } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GtmInitiatives } from "@/components/gtm/initiatives";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { useClock } from "@/components/today/use-today";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { LoadingSignal } from "@/components/ui/loading";
import { EmptyState } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { isConsumer } from "@/lib/consumer/market";
import { METRIC_PROVIDER_IDS } from "@/lib/metrics/types";
import { todayISO } from "@/lib/domain/ids";
import { baseline, computeForecast, computePlan, forecastChanges, money, shortDay } from "@/lib/revenue/forecast";
import { pipelineXray } from "@/lib/revenue/xray";
import { BusinessMetrics } from "./business-metrics";
import { DataQuality } from "./data-quality";
import { DealCalls } from "./deal-calls";
import { DealImport } from "./deal-import";
import { DiagnosticTabs, tabForAnchor, type DiagnosticTab } from "./diagnostics";
import { ForecastHero } from "./forecast-hero";
import { PipelineConversion } from "./pipeline-conversion";
import { Changes, PlanView } from "./plan-view";
import { TargetDialog } from "./target-dialog";
import { WeeklyUpdate } from "./weekly-update";
import { Working } from "./working";
import { CommitEvidenceLine, XrayRows } from "./xray";
import { BuyerVoiceCard } from "@/components/voice/buyer-voice-card";

const DIAGNOSTICS = "behind-the-number";
const TAB_IDS = ["pipeline", "working", "data", "metrics"] as const;
type TabId = (typeof TAB_IDS)[number];
const TAB_ANCHORS: Record<TabId, string[]> = { pipeline: ["pipeline-conversion"], working: ["working-label"], data: ["data-quality-title"], metrics: ["business-metrics"] };
const asTab = (v: string | null | undefined): TabId | null => (TAB_IDS as readonly string[]).includes(v ?? "") ? (v as TabId) : null;

/**
 * Revenue answers one question: will we hit the number, and what do I do about it? The call and the deal-by-deal
 * calls come first, then what needs fixing and the plan behind the gap, then the week's priorities and update.
 * The diagnostics (pipeline flow, what's working, data quality, connected metrics) sit below in tabs, addressable
 * by ?tab= or an old #anchor. Everything is computed in code from the deals on file (zero tokens); the only model
 * call is the weekly update, and only when asked.
 */
export function RevenuePage() {
  const { ws, error, refresh } = useWorkspace();
  const now = useClock(60_000);
  const params = useSearchParams();
  const [targetOpen, setTargetOpen] = useState(params.get("target") === "1");
  const [importOpen, setImportOpen] = useState(params.get("import") === "1");
  const [tab, setTab] = useState<TabId>(() => asTab(params.get("tab")) ?? "pipeline");
  const today = todayISO(new Date(now));

  const data = useMemo(() => {
    if (!ws) return null;
    const f = computeForecast(ws, today);
    const plan = computePlan(ws, f, new Date(now));
    const base = baseline(ws, today);
    return { f, plan, base, changes: forecastChanges(ws, base, f), xray: pipelineXray(ws, today, f) };
  }, [ws, today, now]);
  const period = useMemo(() => (data ? { start: data.f.period.start, end: data.f.period.end, label: data.f.period.label } : null), [data]);

  /** Opens a diagnostics tab, keeps it in the URL (?tab=) without a navigation, and optionally brings it into view. */
  const openTab = useCallback((id: TabId, scroll = false) => {
    setTab(id);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", id);
    url.hash = "";
    window.history.replaceState(window.history.state, "", url);
    if (scroll) requestAnimationFrame(() => document.getElementById(DIAGNOSTICS)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);

  // Old deep links point at sections that now live in a tab (/revenue#business-metrics): open it, then scroll to the
  // section. Read after mount, since a prefetched page renders before the URL is its own.
  const ready = !!data;
  useEffect(() => {
    if (!ready) return;
    const follow = () => {
      const anchor = decodeURIComponent(window.location.hash.slice(1));
      const id = anchor ? asTab(tabForAnchor(TAB_IDS.map((t) => ({ id: t, anchors: TAB_ANCHORS[t] })), anchor)) : null;
      if (!id) return;
      setTab(id);
      requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" })));
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [ready]);

  if (!ws || !data || !period) {
    return error ? (
      <div className="page-shell max-w-[1080px]">
        <EmptyState
          title="Couldn't load your workspace"
          body={`${error} Your data is still on this machine.`}
          action={
            <Button variant="primary" onClick={() => void refresh()}>
              Try again
            </Button>
          }
        />
      </div>
    ) : (
      <LoadingSignal label="Calling the forecast" className="min-h-[60dvh]" />
    );
  }

  const { f, plan, base, changes, xray } = data;
  const empty = !Object.values(ws.deals).length;
  // Connected sources get their own tab; with none, connecting one is a single line under the tabs.
  const connectedMetrics = METRIC_PROVIDER_IDS.some((id) => ws.integrations[id]?.enabled);
  const tabs: DiagnosticTab[] = [
    { id: "pipeline", label: "Pipeline flow", anchors: TAB_ANCHORS.pipeline, content: <PipelineConversion /> },
    {
      id: "working",
      label: "What's working",
      anchors: TAB_ANCHORS.working,
      content: (
        <div className="space-y-10">
          <Working ws={ws} f={f} />
          <BuyerVoiceCard ws={ws} />
        </div>
      ),
    },
    { id: "data", label: "Data quality", anchors: TAB_ANCHORS.data, content: <DataQuality ws={ws} f={f} /> },
    ...(connectedMetrics ? [{ id: "metrics", label: "Connected metrics", anchors: TAB_ANCHORS.metrics, content: <BusinessMetrics /> }] : []),
  ];

  return (
    <div className="page-shell max-w-[1080px]">
      <PageHeader
        title="Revenue"
        eyebrow="The number"
        description={
          f.hasTarget ? (
            <>
              {f.period.label}: <span className="font-mono tnum text-fg">{money(f.target)}</span> by {shortDay(f.period.end)}. The call, the deals behind it and what needs fixing, all counted from your deals.
            </>
          ) : f.ended ? (
            `${f.ended.target.label} is over. Set ${f.period.label}'s number to see the gap and the plan behind it.`
          ) : (
            "The forecast called from your deals: what will close, what's at risk, and what it takes."
          )
        }
        actions={
          <>
            {!empty && (
              <Button variant="ghost" icon={<FileText className="size-4" />} onClick={() => document.getElementById("weekly-update")?.scrollIntoView({ behavior: "smooth", block: "start" })} className="hidden sm:inline-flex">
                Weekly update
              </Button>
            )}
            <Button variant={f.hasTarget ? "secondary" : "primary"} icon={<Target className="size-4" />} onClick={() => setTargetOpen(true)}>
              {f.hasTarget ? `${f.period.label} · ${money(f.target)}` : f.ended ? `Set the ${f.period.label} target` : "Set a revenue target"}
            </Button>
          </>
        }
      />

      {isConsumer(ws) && (
        <p className="mt-6 rounded-md bg-bg-subtle px-3 py-2.5 text-[13px] leading-5 text-fg-2">
          Revenue calls a business&apos;s deals. You&apos;re set up as a consumer company, so your number lives on{" "}
          <Link href="/growth" className="text-fg underline underline-offset-2">
            Growth
          </Link>
          .
        </p>
      )}

      {empty ? (
        <section aria-labelledby="no-deals-title" className="mt-8 rounded-xl bg-surface px-5 py-6 shadow-sm ring-1 ring-inset ring-border sm:px-7">
          <h2 id="no-deals-title" className="font-serif text-[21px] leading-[30px] text-fg">
            No deals to call yet.
          </h2>
          <p className="mt-1.5 max-w-[60ch] text-pretty text-[13.5px] leading-[21px] text-fg-2">
            Bring your open deals from a CRM export and the forecast is called from them in code: commit, best case and pipeline, with what needs fixing on each. Or log deals as they start.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={<FileUp className="size-4" />} onClick={() => setImportOpen(true)}>
              Import open deals
            </Button>
            <Link href="/companies?log=1" className="inline-flex h-9 items-center rounded-md px-3.5 text-[13px] font-medium text-fg-2 hover:bg-bg-subtle hover:text-fg">
              Log a deal
            </Link>
          </div>
        </section>
      ) : (
        <>
          <ForecastHero f={f} plan={plan} onSetTarget={() => setTargetOpen(true)} onDataQuality={() => openTab("data", true)} />
          <DealCalls f={f} focus={params.get("d")} onImport={() => setImportOpen(true)} />

          {xray.open > 0 && (
            <section className="mt-12" aria-labelledby="fix-label">
              <SectionLabel right={<span className="text-[12px] text-fg-3">Across {xray.open} open {xray.open === 1 ? "deal" : "deals"}</span>}>
                <span id="fix-label">What needs fixing</span>
              </SectionLabel>
              <XrayRows xray={xray} openFirst={false} />
              <CommitEvidenceLine xray={xray} className="mt-3 px-1" />
            </section>
          )}

          <PlanView f={f} plan={plan} />
          <Changes changes={changes} since={base?.weekOf} />
        </>
      )}

      <GtmInitiatives compactEmpty className="mb-0 mt-12" />
      {!empty && <WeeklyUpdate ws={ws} today={today} />}

      {empty ? (
        <div className="mt-12">
          <BusinessMetrics />
        </div>
      ) : (
        <DiagnosticTabs id={DIAGNOSTICS} title="Behind the number" tabs={tabs} active={tab} onChange={(id) => openTab(id as TabId)} footer={connectedMetrics ? undefined : <BusinessMetrics />} />
      )}

      {targetOpen && <TargetDialog open={targetOpen} onOpenChange={setTargetOpen} today={today} stats={f.stats} />}
      <Dialog open={importOpen} onOpenChange={setImportOpen} title="Import open deals" description="From a CSV export of your CRM. Nothing is written until you confirm the preview." className="max-w-[600px]">
        <div className="px-5 pb-5 pt-3">
          <DealImport period={period} />
        </div>
      </Dialog>
    </div>
  );
}
