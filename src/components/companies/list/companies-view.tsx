"use client";

import { LoadingSignal } from "@/components/ui/loading";
import { PageHeader } from "@/components/ui/page-header";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CompanySheet } from "@/components/companies/sheet/company-sheet";
import { unlessSheetOpen } from "@/components/companies/sheet/open-sheet";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { EmptyState, Segmented, Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { plural } from "@/lib/client/format";
import { nowISO } from "@/lib/domain/ids";
import { OPEN_STAGES, type Account } from "@/lib/domain/types";
import { Customers } from "./customers";
import { DiscoveryStatus } from "./discovery-status";
import { AddCompany, FindCompanies, ImportLink, MoreActions, lookupDomain, type LookupResult } from "./header-actions";
import { customerRows, isScored, nameFromDomain, normalizeDomainInput, touchIndex, useToday } from "./lib";
import { LogPicker } from "./log-picker";
import { Prospects } from "./prospects";
import { MapView } from "./map-view";
import { Talking, type ClosedView } from "./talking";

type View = "prospects" | "talking" | "customers" | "map";
const VIEWS: View[] = ["prospects", "talking", "customers", "map"];
const CLOSED: ClosedView[] = ["won", "lost", "nurture"];

/**
 * Companies: Prospects · Talking · Customers. Everything is addressable by URL:
 *   ?view=prospects|talking|customers|map  ?c=<domain> (sheet)  ?add=<domain> (add & research)
 *   ?log=1 (pick a deal, then the sheet opens with &intent=log)  ?layout=table  ?closed=won|lost|nurture
 */
export function CompaniesView() {
  const { ws, error, dispatch, refresh } = useWorkspace();
  const { runs, start } = useRuns();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const today = useToday();

  const view = VIEWS.find((v) => v === params.get("view")) ?? "prospects";
  const sheetDomain = params.get("c");
  const add = params.get("add");
  const log = params.get("log") === "1";
  const layout = params.get("layout") === "table" ? "table" : "board";
  const closed = CLOSED.find((c) => c === params.get("closed")) ?? null;

  // View state lives in the URL but never needs the server: the native history API updates
  // useSearchParams without a round trip, so switching views and opening sheets is instant.
  const setParams = useCallback(
    (patch: Record<string, string | null>, push = false) => {
      const next = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (push) window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [pathname],
  );

  const openSheet = useCallback((domain: string, extra: Record<string, string | null> = {}) => setParams({ c: domain, intent: null, ref: null, ...extra }, true), [setParams]);
  const closeSheet = useCallback(() => setParams({ c: null, intent: null, ref: null }), [setParams]);

  /* ─────────── Discovery run ─────────── */

  const discoveryRun = useMemo(
    () =>
      Object.values(runs)
        .filter((r) => r.workflow === "discovery")
        .sort((a, b) => b.startedAt - a.startedAt)[0],
    [runs],
  );
  const [dismissedRun, setDismissedRun] = useState<string | null>(null);
  const discovering = !!discoveryRun && (discoveryRun.status === "running" || discoveryRun.status === "queued");
  const lastBrief = useRef<{ brief?: string; count: number }>({ count: 10 });

  const findCompanies = useCallback(
    (opts: { brief?: string; count: number }) => {
      lastBrief.current = opts;
      if (view !== "prospects") setParams({ view: null, closed: null, layout: null });
      void start("discovery", { count: opts.count, brief: opts.brief, source: "manual" });
    },
    [start, setParams, view],
  );

  /* ─────────── Add company (popover, and ?add=<domain> from ⌘K) ─────────── */

  const addCompany = useCallback(
    async (domain: string, info: LookupResult | null, research: boolean, extra: Record<string, string | null> = {}) => {
      if (!ws) return;
      if (ws.accounts[domain]) {
        openSheet(domain, extra);
        return;
      }
      const account: Account = {
        domain,
        name: info?.name || nameFromDomain(domain),
        oneLiner: info?.oneLiner ?? undefined,
        status: "tracked",
        source: "manual",
        addedAt: nowISO(),
        fitScore: 0,
        tier: "C",
        criteria: [],
        signals: [],
        whyNow: null,
        whyNowScore: 0,
        peopleIds: [],
        warmPathCount: 0,
        watch: true,
        sourceUrl: info?.yc?.url,
      };
      const ok = await dispatch({ type: "account.add", account });
      if (!ok) return;
      // Free signal check either way; the dossier (a few cents) only when asked.
      void start("enrich", { domains: [domain] }, { notify: false });
      if (research) {
        void start("dossier", { domain }, { notify: unlessSheetOpen(domain) });
        openSheet(domain, extra);
      } else {
        if (Object.keys(extra).length) setParams(extra);
        toast(`Added ${account.name}`, { description: "Checking their job boards and news now.", action: { label: "Open", onClick: () => openSheet(domain) } });
      }
    },
    [ws, dispatch, start, openSheet, setParams],
  );

  const handledAdd = useRef<string | null>(null);
  useEffect(() => {
    if (!add || !ws || handledAdd.current === add) return;
    handledAdd.current = add;
    const domain = normalizeDomainInput(add);
    if (!domain) {
      toast.error(`“${add}” doesn't look like a website. Try something like acme.com.`);
      setParams({ add: null });
      return;
    }
    if (ws.accounts[domain]) {
      setParams({ add: null, c: domain });
      return;
    }
    void lookupDomain(domain, 5000).then((info) => addCompany(domain, info, true, { add: null }));
  }, [add, ws, addCompany, setParams]);

  /* ─────────── Counts ─────────── */

  const counts = useMemo(() => {
    if (!ws) return null;
    const accounts = Object.values(ws.accounts);
    const deals = Object.values(ws.deals);
    const touched = touchIndex(ws.activities);
    return {
      prospects: accounts.filter((a) => a.status === "new" || a.status === "tracked").length,
      talking: deals.filter((d) => OPEN_STAGES.includes(d.stage)).length,
      customers: customerRows(ws).length,
      ready: accounts.filter((a) => a.status !== "disqualified" && a.status !== "in_pipeline" && a.status !== "customer" && isScored(a) && a.tier === "A" && !touched.has(a.domain)).length,
      // Tracked companies, plus screened Tier B picks waiting for a reason to reach out.
      tracked: accounts
        .filter((a) => (a.watch || a.status === "tracked" || a.status === "in_pipeline" || (a.status === "new" && a.tier === "B" && a.criteria.length > 0)) && a.status !== "disqualified")
        .map((a) => a.domain),
    };
  }, [ws]);

  // Bulk checks have no `ref`; single-company checks started by Add company don't count.
  const refreshing = Object.values(runs).some((r) => r.workflow === "enrich" && !r.ref && (r.status === "running" || r.status === "queued"));

  const refreshTracked = () => {
    if (refreshing) {
      toast("Already checking signals. I'll tell you when it's done.");
      return;
    }
    const domains = counts?.tracked.slice(0, 50) ?? [];
    if (!domains.length) {
      toast("Track a few companies first. I'll keep their signals fresh.");
      return;
    }
    void start("enrich", { domains }).then((run) => {
      if (run) {
        toast(`Checking signals for ${plural(domains.length, "company", "companies")}`, {
          description: "Job boards and news, free. This can take a few minutes; I'll tell you when it's done.",
        });
      }
    });
  };

  /* ─────────── Render ─────────── */

  const findButton = (
    <FindCompanies
      running={discovering}
      disabledReason={ws && !ws.company && !ws.foundation ? "Finish the welcome step first, so I know who you sell to." : undefined}
      onStart={findCompanies}
    />
  );

  return (
    <div className="page-shell">
      <PageHeader
        title="Companies"
        eyebrow="Your pipeline"
        description={counts ? <>{plural(counts.prospects, "prospect")} · {counts.talking} talking · {plural(counts.customers, "customer")}{counts.ready > 0 && <> · <span className="font-medium text-fg">{counts.ready} ready to work</span></>}</> : <span aria-hidden className="skeleton inline-block h-3 w-52 rounded-sm" />}
        actions={<>
          <ImportLink className="hidden lg:inline-flex" />
          <MoreActions trackedCount={counts?.tracked.length ?? 0} onRefresh={refreshTracked} />
          <AddCompany onAdd={(d, info, research) => void addCompany(d, info, research)} onOpenExisting={(d) => openSheet(d)} />
          {findButton}
        </>}
      />

      <div className="mt-6">
        <Segmented
          value={view}
          layoutId="companies-view"
          onChange={(v) => setParams({ view: v === "prospects" ? null : v, closed: null })}
          options={[
            { value: "prospects", label: "Prospects", count: counts?.prospects },
            { value: "talking", label: "Talking", count: counts?.talking },
            { value: "customers", label: "Customers", count: counts?.customers },
            { value: "map", label: "Map" },
          ]}
        />
      </div>

      {log && ws && <LogPicker ws={ws} onPick={(d) => openSheet(d, { log: null, intent: "log" })} onClose={() => setParams({ log: null })} />}

      <div className="mt-5">
        {view === "prospects" && discoveryRun && discoveryRun.id !== dismissedRun && (
          <DiscoveryStatus run={discoveryRun} onDismiss={() => setDismissedRun(discoveryRun.id)} onRetry={() => findCompanies(lastBrief.current)} />
        )}

        {!ws ? (
          error ? (
            <EmptyState title="Couldn't load your workspace." body={error} action={<Button onClick={() => void refresh()}>Try again</Button>} />
          ) : (
            <ListSkeleton />
          )
        ) : view === "prospects" ? (
          <Prospects
            ws={ws}
            today={today}
            sheetOpen={!!sheetDomain || log}
            onOpen={(d) => openSheet(d)}
            emptyAction={
              discovering ? null : (
                <div className="flex flex-col items-center gap-3">
                  {findButton}
                  <span className="text-[12.5px] text-fg-3">
                    or{" "}
                    <button onClick={() => router.push("/integrations?import=linkedin")} className="text-fg-2 underline-offset-4 hover:underline">
                      start from people you know
                    </button>
                  </span>
                </div>
              )
            }
          />
        ) : view === "talking" ? (
          <Talking
            ws={ws}
            today={today}
            layout={layout}
            closed={closed}
            onLayout={(l) => setParams({ layout: l === "board" ? null : l })}
            onClosed={(c) => setParams({ closed: c })}
            onOpen={(d) => openSheet(d)}
            onProspects={() => setParams({ view: null, closed: null, layout: null })}
          />
        ) : view === "map" ? (
          <MapView onOpen={(d) => openSheet(d)} focusDomain={params.get("focus")} />
        ) : (
          <Customers ws={ws} today={today} onOpen={(d) => openSheet(d)} onTalking={() => setParams({ view: "talking" })} />
        )}
      </div>

      <CompanySheet domain={sheetDomain} onClose={closeSheet} />
    </div>
  );
}

const SKELETON_WIDTHS = ["w-28", "w-36", "w-24", "w-32", "w-40", "w-28", "w-20", "w-32"];

function ListSkeleton() {
  return (
    <div aria-busy aria-label="Loading companies" className="divide-y divide-border">
      <LoadingSignal label="Loading companies" className="mb-7" />
      {SKELETON_WIDTHS.map((w, i) => (
        <div key={i} className="flex h-11 items-center gap-3 px-3">
          <Skeleton className="size-5 rounded-[5px]" />
          <Skeleton className={cn("h-3", w)} />
          <Skeleton className="ml-8 hidden h-3 w-6 md:block" />
          <Skeleton className={cn("hidden h-3 md:block", i % 2 ? "w-64" : "w-48")} />
          <span className="flex-1" />
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

