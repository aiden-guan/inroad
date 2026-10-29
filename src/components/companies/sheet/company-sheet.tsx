"use client";

import { ArrowUpRight, Eye, EyeOff, MapPin, MoreHorizontal, Phone, RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AskPanel } from "@/components/ask/ask-panel";
import { useRunFor, useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { EmptyState, Segmented, Skeleton } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { WorkLog } from "@/components/ui/work-log";
import { pushRecent } from "@/lib/client/recent";
import { OPEN_STAGES, STAGE_LABELS, type Account, type Deal, type EntityRef, type Workspace } from "@/lib/domain/types";
import { newId, nowISO } from "@/lib/domain/ids";
import { newDeal } from "@/lib/deals/rules";
import { placeLabel, resolvePlace } from "@/lib/geo/places";
import { DealPanel } from "./deal-panel";
import { DossierView, EnrichmentView } from "./dossier-view";
import { IntentBlock, readIntent, type SheetIntent } from "./intent";
import { LogCall } from "./meetings";
import { newAccount } from "./new-account";
import { setOpenSheet, unlessSheetOpen } from "./open-sheet";
import { Callout, useToday } from "./shared";
import { Timeline } from "./timeline";

type Tab = "dossier" | "deal" | "timeline" | "ask";
type AskPrefill = { text: string; n: number; domain: string };

const DISQUALIFY: { value: NonNullable<Account["disqualified"]>["reason"]; label: string }[] = [
  { value: "not_icp", label: "Not our ICP" },
  { value: "too_small", label: "Too small to pay" },
  { value: "too_big", label: "Too big for now" },
  { value: "competitor", label: "A competitor" },
  { value: "customer", label: "Already a customer" },
  { value: "already_known", label: "Already in touch another way" },
  { value: "other", label: "Something else" },
];

const STATUS_LABEL: Record<Account["status"], string> = { new: "New", tracked: "Tracked", in_pipeline: "In pipeline", customer: "Customer", disqualified: "Disqualified" };

function openDeal(ws: Workspace | null, account: Account | undefined): Deal | undefined {
  const deal = account?.dealId ? ws?.deals[account.dealId] : undefined;
  return deal;
}

/**
 * The detail sheet for one company: dossier with margin-note citations, people, angles,
 * the deal (stage, next step, qualification card, meetings: prep & debrief), and the timeline.
 * Open it from anywhere with a URL param: `/companies?c=<domain>` (`&intent=log` focuses Log a call).
 */
export function CompanySheet({ domain, onClose }: { domain: string | null; onClose: () => void }) {
  // Keep showing the last company while the sheet animates out.
  const [last, setLast] = useState(domain);
  if (domain && domain !== last) setLast(domain);
  const shown = domain ?? last;
  const { ws } = useWorkspace();
  const params = useSearchParams();
  const intentLog = params.get("intent") === "log" || params.get("log") === "1";
  // ⌘K "Prep for…" opens the deal's meetings; reply, write and intro land as a composer at the top (intent.tsx).
  const intentPrep = params.get("intent") === "prep";
  const intent = readIntent(params);
  const account = shown ? ws?.accounts[shown] : undefined;
  // ⌘K lists recently opened companies first.
  useEffect(() => {
    if (domain) pushRecent(domain);
  }, [domain]);
  useEffect(() => {
    setOpenSheet(domain);
    return () => setOpenSheet(null);
  }, [domain]);
  const deal = openDeal(ws, account);
  const [tabs, setTabs] = useState<Record<string, Tab>>({});
  const defaultTab: Tab = intentLog || intentPrep ? "deal" : deal && OPEN_STAGES.includes(deal.stage) ? "deal" : "dossier";
  const tab = (shown && tabs[shown]) || defaultTab;
  const setTab = (t: Tab) => shown && setTabs((m) => ({ ...m, [shown]: t }));
  // ⌘K → Ask while this sheet is open lands in the sheet's Ask tab instead of stacking a window on top.
  // Tied to the company it was asked about and cleared once sent, so a tab switch or another company never re-asks it.
  const [askPrefill, setAskPrefill] = useState<AskPrefill | null>(null);
  const consumeAskPrefill = useCallback(() => setAskPrefill((p) => (p ? { ...p, text: "" } : p)), []);
  useEffect(() => {
    if (!domain) return;
    const onAsk = (e: Event) => {
      const text = (e as CustomEvent<{ prefill?: string }>).detail?.prefill ?? "";
      setTabs((m) => ({ ...m, [domain]: "ask" }));
      if (text) setAskPrefill((p) => ({ text, n: (p?.n ?? 0) + 1, domain }));
    };
    window.addEventListener("inroad:sheet-ask", onAsk);
    return () => window.removeEventListener("inroad:sheet-ask", onAsk);
  }, [domain]);

  return (
    <Sheet
      open={!!domain}
      onOpenChange={(o) => !o && onClose()}
      title={account?.name ?? shown ?? "Company"}
      width={880}
      header={shown ? <Header domain={shown} account={account} deal={deal} tab={tab} onTab={setTab} /> : null}
      seed={shown ?? undefined}
    >
      {/* Keyed by company: switching companies with the sheet open must not carry a half-logged call (or any form) across. */}
      {shown && (
        <Body
          key={shown}
          domain={shown}
          account={account}
          deal={deal}
          tab={tab}
          onTab={setTab}
          focusLog={intentLog}
          intent={intent}
          loading={!ws}
          askPrefill={askPrefill}
          onAskPrefillSent={consumeAskPrefill}
        />
      )}
    </Sheet>
  );
}

function useResearch(domain: string, account: Account | undefined) {
  const { start } = useRuns();
  const ref = useMemo<EntityRef>(() => ({ kind: "account", id: domain }), [domain]);
  const run = useRunFor(ref, "dossier");
  const active = !!run && (run.status === "running" || run.status === "queued");
  const research = () => void start("dossier", { domain, force: !!account?.dossier }, { notify: unlessSheetOpen(domain) });
  return { run, active, research };
}

function Header({ domain, account, deal, tab, onTab }: { domain: string; account?: Account; deal?: Deal; tab: Tab; onTab: (t: Tab) => void }) {
  const { dispatch } = useWorkspace();
  const { active, research } = useResearch(domain, account);
  if (!account) {
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        <Favicon domain={domain} size={28} />
        <span className="truncate font-mono text-[13px] text-fg-2">{domain}</span>
      </div>
    );
  }
  const startDeal = async () => {
    const d = newDeal(account, newId("deal"), nowISO());
    const ok = await dispatch({ type: "deal.create", deal: d });
    if (ok) {
      onTab("deal");
      toast(`Deal started at ${STAGE_LABELS.talking}`);
    }
  };
  const disqualified = account.status === "disqualified";
  const hasOpenDeal = !!deal && OPEN_STAGES.includes(deal.stage);

  // Where they are, from the built-in city list (no network); opens the map focused on them.
  const place = resolvePlace(account.hqCity);
  const hq = place ? placeLabel(place) : null;
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <Favicon domain={account.domain} name={account.name} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[16px] font-semibold tracking-[-0.01em] text-fg">{account.name}</h2>
            <Badge tone="outline">Tier {account.tier}</Badge>
            {deal ? (
              <Badge tone="neutral">{STAGE_LABELS[deal.stage]}</Badge>
            ) : (
              // "Tracked" would repeat the eye toggle next to it.
              !(account.status === "tracked" && account.watch) && <Badge tone={disqualified ? "danger" : "neutral"}>{STATUS_LABEL[account.status]}</Badge>
            )}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
            <a href={`https://${account.domain}`} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-0.5 font-mono text-[12px] text-fg-3 hover:text-fg-2">
              <span className="truncate">{account.domain}</span>
              <ArrowUpRight className="size-3 shrink-0" aria-hidden />
            </a>
            {hq && (
              <Link
                href={`/companies?view=map&focus=${encodeURIComponent(account.domain)}`}
                className="inline-flex items-center gap-1 text-[12px] text-fg-3 hover:text-fg-2"
                title="See it on the map, with your other leads nearby"
              >
                <MapPin className="size-3 shrink-0" aria-hidden />
                {hq}
              </Link>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {/* The label names the action, so no aria-pressed (a toggle's label must not change with its state). */}
        <IconButton
          label={account.watch ? "Stop tracking" : "Track"}
          disabled={disqualified}
          className={account.watch ? "text-fg" : undefined}
          onClick={() => void dispatch({ type: "account.track", domain: account.domain, watch: !account.watch })}
        >
          {account.watch ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </IconButton>
        {/* With no dossier, the dossier tab's empty state owns the Research call to action. */}
        {(account.dossier || tab !== "dossier") && (
          <Button
            size="sm"
            variant={account.dossier ? "secondary" : "agent"}
            loading={active}
            icon={account.dossier ? <RefreshCw className="size-3.5" /> : <Search className="size-3.5" />}
            onClick={() => {
              onTab("dossier");
              research();
            }}
            disabled={active}
          >
            {active ? "Researching" : account.dossier ? "Refresh" : "Research"}
          </Button>
        )}
        {!hasOpenDeal && !disqualified && (
          <Button size="sm" variant="secondary" onClick={() => void startDeal()}>
            Start deal
          </Button>
        )}
        <Menu
          trigger={
            <IconButton label="More">
              <MoreHorizontal className="size-4" />
            </IconButton>
          }
        >
          {disqualified ? (
            <MenuItem onSelect={() => void dispatch({ type: "account.restore", domain: account.domain }).then((ok) => ok && toast("Restored"))}>Restore</MenuItem>
          ) : (
            <>
              <MenuLabel>Disqualify</MenuLabel>
              {DISQUALIFY.map((r) => (
                <MenuItem
                  key={r.value}
                  danger
                  onSelect={() =>
                    void dispatch({ type: "account.disqualify", domain: account.domain, reason: r.value, at: nowISO() }).then((ok) => ok && toast(`Disqualified: ${r.label.toLowerCase()}. I won't suggest them again.`))
                  }
                >
                  {r.label}
                </MenuItem>
              ))}
            </>
          )}
          <MenuSeparator />
          <MenuItem onSelect={() => onTab("timeline")}>Timeline</MenuItem>
        </Menu>
      </div>
    </div>
  );
}

function Body({
  domain,
  account,
  deal,
  tab,
  onTab,
  focusLog,
  intent,
  loading,
  askPrefill,
  onAskPrefillSent,
}: {
  domain: string;
  account?: Account;
  deal?: Deal;
  tab: Tab;
  onTab: (t: Tab) => void;
  focusLog: boolean;
  intent: SheetIntent | null;
  loading: boolean;
  askPrefill: AskPrefill | null;
  onAskPrefillSent: () => void;
}) {
  const { dispatch } = useWorkspace();
  const { start } = useRuns();
  const today = useToday();
  const { run, active, research } = useResearch(domain, account);
  const askContext = useMemo<EntityRef>(() => ({ kind: "account", id: domain }), [domain]);

  if (loading) {
    return (
      <div className="space-y-4 px-6 py-8">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="mt-6 h-24 w-full" />
      </div>
    );
  }
  if (!account) {
    return (
      <EmptyState
        title={`I don't have ${domain} yet`}
        body="Add it and I'll research it: why now, who to talk to, and the angle, with sources."
        action={
          <Button
            variant="agent"
            onClick={async () => {
              const ok = await dispatch({ type: "account.add", account: newAccount(domain) });
              if (ok) void start("dossier", { domain }, { notify: unlessSheetOpen(domain) });
            }}
          >
            Add and research
          </Button>
        }
      />
    );
  }

  const options: { value: Tab; label: string }[] = [
    { value: "dossier", label: "Dossier" },
    { value: "deal", label: "Deal" },
    { value: "timeline", label: "Timeline" },
    { value: "ask", label: "Ask" },
  ];

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-surface-raised/95 px-4 py-2 backdrop-blur sm:px-6">
        <Segmented layoutId={`sheet-tabs-${domain}`} value={tab} onChange={onTab} options={options} />
      </div>
      <div className="px-4 pb-20 pt-6 sm:px-6">
        {account.status === "disqualified" && account.disqualified && (
          <Callout className="mb-6" action={<Button size="xs" variant="ghost" onClick={() => void dispatch({ type: "account.restore", domain })}>Restore</Button>}>
            Disqualified · {DISQUALIFY.find((r) => r.value === account.disqualified!.reason)?.label.toLowerCase() ?? account.disqualified.reason}
            {account.disqualified.note ? ` · ${account.disqualified.note}` : ""}
          </Callout>
        )}
        {intent && tab !== "ask" && <IntentBlock domain={domain} intent={intent} />}
        {/* On the dossier tab a failed run is explained once, next to the Research button; elsewhere the log says it. */}
        {run && (active || (run.status === "error" && tab !== "dossier")) && tab !== "ask" && <WorkLog run={run} className="mb-6" />}

        <div key={tab} className="animate-[fade-in_150ms_var(--ease-out)]">
          {tab === "dossier" &&
            (account.dossier ? (
              <DossierView account={account} lastRun={run} onRefresh={research} refreshing={active} />
            ) : (
              <EnrichmentView account={account} onResearch={research} researching={active} lastRun={run} />
            ))}
          {tab === "deal" && (deal ? <DealPanel deal={deal} account={account} today={today} focusLog={focusLog} /> : <NoDeal account={account} focusLog={focusLog} onStarted={() => onTab("deal")} />)}
          {tab === "timeline" && <Timeline account={account} deal={deal} />}
          {tab === "ask" && <AskPanel key={askPrefill?.n ?? 0} context={askContext} prefill={askPrefill?.domain === domain && askPrefill.text ? askPrefill.text : undefined} onPrefillSent={onAskPrefillSent} />}
        </div>
      </div>
    </div>
  );
}

function NoDeal({ account, focusLog, onStarted }: { account: Account; focusLog: boolean; onStarted: () => void }) {
  const { dispatch } = useWorkspace();
  const [logging, setLogging] = useState(focusLog);
  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-surface px-5 py-6 ring-1 ring-border">
        <p className="font-serif text-[24px] leading-[30px] tracking-[-0.01em] text-fg">No deal yet.</p>
        <p className="mt-2 max-w-[52ch] text-[14px] leading-[21px] text-fg-2">
          A deal starts at the first real conversation. Touches before that live on the timeline. Start one when a call is booked, or log a call that already happened.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={async () => {
              const ok = await dispatch({ type: "deal.create", deal: newDeal(account, newId("deal"), nowISO()) });
              if (ok) onStarted();
            }}
            disabled={account.status === "disqualified"}
          >
            Start deal
          </Button>
          <Button variant="secondary" icon={<Phone className="size-3.5" />} onClick={() => setLogging(true)}>
            Log a call
          </Button>
        </div>
      </div>
      {logging && <LogCall account={account} meetings={[]} autoFocus onClose={() => setLogging(false)} />}
    </div>
  );
}
