"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { SectionLabel } from "@/components/ui/card";
import { Favicon } from "@/components/ui/favicon";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/client/cn";
import { nowISO } from "@/lib/domain/ids";
import { STAGE_LABELS, type ForecastCategory } from "@/lib/domain/types";
import { ease } from "@/lib/motion";
import { CATEGORY_LABELS, CATEGORY_ORDER, money, shortDay, type DealCall, type Forecast } from "@/lib/revenue/forecast";
import { BAND_LABEL, BAND_TONE, RiskList, SEVERITY_DOT } from "./risk-list";

/**
 * The forecast call, deal by deal. Code proposes a category from evidence; the owner of the number can
 * call it differently, and the code's call stays visible beside theirs. A row opens in place (no modal)
 * to show what's at risk and the fix for each.
 */
export function DealCalls({ f, focus }: { f: Forecast; focus?: string | null }) {
  const [open, setOpen] = useState<string | null>(focus ?? null);
  const groups = CATEGORY_ORDER.map((cat) => ({ cat, calls: f.calls.filter((c) => c.category === cat) })).filter((g) => g.calls.length);

  if (!f.calls.length) {
    return (
      <section className="mt-12" aria-labelledby="calls-label">
        <SectionLabel>
          <span id="calls-label">Deals in the forecast</span>
        </SectionLabel>
        <p className="rounded-lg bg-surface px-5 py-6 text-[14px] text-fg-2 ring-1 ring-border">
          No open deals yet. A deal starts at the first real conversation; log one from{" "}
          <Link href="/companies?log=1" className="font-medium text-fg underline-offset-2 hover:underline">
            Companies
          </Link>
          .
        </p>
      </section>
    );
  }

  return (
    <section className="mt-12" aria-labelledby="calls-label">
      <SectionLabel right={<span className="text-[12px] text-fg-3">Click a deal to see its risks</span>}>
        <span id="calls-label">Deals in the forecast</span>
      </SectionLabel>
      <div className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-inset ring-border">
        <div className="hidden grid-cols-[minmax(0,1fr)_88px_92px_minmax(0,180px)_120px] gap-4 border-b border-border px-4 py-2 text-[11.5px] font-medium text-fg-3 md:grid">
          <span>Deal</span>
          <span className="text-right">Amount</span>
          <span>Close</span>
          <span>Health</span>
          <span className="text-right">Call</span>
        </div>
        {groups.map((g) => (
          <div key={g.cat}>
            <div className="flex items-baseline justify-between gap-3 border-b border-border bg-bg-subtle/60 px-4 py-1.5">
              <span className="text-[12px] font-medium text-fg-2">{CATEGORY_LABELS[g.cat]}</span>
              <span className="font-mono text-[12px] tnum text-fg-3">
                {g.calls.length} · {money(g.calls.reduce((n, c) => n + c.amount.usd, 0))}
              </span>
            </div>
            {g.calls.map((c) => (
              <CallRow key={c.deal.id} c={c} open={open === c.deal.id} onToggle={() => setOpen((o) => (o === c.deal.id ? null : c.deal.id))} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function CallRow({ c, open, onToggle }: { c: DealCall; open: boolean; onToggle: () => void }) {
  const top = c.risks[0];
  const passed = c.risks.some((r) => r.code === "close_passed");
  return (
    <div className={cn("border-b border-border last:border-b-0", open && "bg-bg-subtle/40")}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 md:grid-cols-[minmax(0,1fr)_88px_92px_minmax(0,180px)_120px]">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-2.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 text-fg-4 transition-transform duration-150", open && "rotate-90")} />
          <Favicon domain={c.deal.accountDomain} name={c.deal.name} size={18} />
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-medium text-fg">{c.deal.name}</span>
            <span className="block truncate text-[12px] text-fg-3">
              {STAGE_LABELS[c.deal.stage]}
              {c.deal.nextStep?.what ? ` · ${c.deal.nextStep.what}` : ""}
            </span>
          </span>
        </button>
        <span className="text-right font-mono text-[13px] tnum text-fg md:order-none">
          {money(c.amount.usd)}
          {c.amount.source !== "deal" && (
            <Tooltip content={c.amount.source === "quote" ? "From the last price you quoted." : "No amount yet: your typical deal, until one is set."}>
              <span tabIndex={0} className="ml-1 cursor-help text-[11px] text-fg-4 outline-none">
                {c.amount.source === "quote" ? "quote" : "est."}
              </span>
            </Tooltip>
          )}
        </span>
        <span className={cn("hidden font-mono text-[12.5px] tnum md:block", passed ? "text-danger" : "text-fg-2")}>
          {shortDay(c.closeDate)}
          {c.closeEstimated && <span className="ml-1 text-[11px] text-fg-4">est.</span>}
        </span>
        <span className="col-span-2 flex min-w-0 items-center gap-2 pl-[50px] text-[12.5px] md:col-span-1 md:pl-0">
          <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", top ? SEVERITY_DOT[top.severity] : "bg-success")} />
          <span className={cn("shrink-0 font-medium", BAND_TONE[c.band])}>{BAND_LABEL[c.band]}</span>
          {top && <span className="truncate text-fg-3">· {top.label}</span>}
          <span className="ml-auto font-mono text-[12px] tnum text-fg-3 md:hidden">{shortDay(c.closeDate)}</span>
        </span>
        <div className="col-span-2 flex justify-end md:col-span-1">
          <CallMenu c={c} />
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: ease.out }}
            className="overflow-hidden"
          >
            <div className="grid gap-6 px-4 pb-5 pt-1 md:grid-cols-[minmax(0,1fr)_260px] md:pl-[54px]">
              <div>
                <p className="mb-1 text-[12px] font-medium text-fg-2">What could stop it</p>
                <RiskList risks={c.risks} deal={c.deal} />
              </div>
              <div className="space-y-3 text-[12.5px] leading-5 text-fg-3">
                <div>
                  <p className="font-medium text-fg-2">Why I call it {CATEGORY_LABELS[c.codeCategory].toLowerCase()}</p>
                  <p>{c.why}</p>
                </div>
                {c.called && (
                  <div>
                    <p className="font-medium text-fg-2">Your call: {CATEGORY_LABELS[c.category]}</p>
                    {c.deal.forecastCall?.note && <p>{c.deal.forecastCall.note}</p>}
                  </div>
                )}
                <p>
                  Odds at this stage <span className="font-mono tnum text-fg-2">{Math.round(c.probability * 100)}%</span> · weighted{" "}
                  <span className="font-mono tnum text-fg-2">{money(c.weightedUsd)}</span>
                </p>
                <Link href={`/companies?c=${encodeURIComponent(c.deal.accountDomain)}`} className="inline-flex items-center gap-1 font-medium text-fg-2 underline-offset-2 hover:text-fg hover:underline">
                  Open {c.deal.name}
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function CallMenu({ c }: { c: DealCall }) {
  const { dispatch } = useWorkspace();
  const call = async (category: ForecastCategory | null) => {
    const ok = await dispatch({ type: "deal.forecastCall", id: c.deal.id, category, at: nowISO() });
    if (ok) toast(category ? `${c.deal.name} called ${CATEGORY_LABELS[category].toLowerCase()}` : `${c.deal.name} back to my call: ${CATEGORY_LABELS[c.codeCategory].toLowerCase()}`);
  };
  return (
    <Menu
      trigger={
        <button
          type="button"
          aria-label={`Forecast call for ${c.deal.name}: ${CATEGORY_LABELS[c.category]}${c.called ? ", your call" : ""}`}
          className="inline-flex h-7 items-center gap-1 rounded-sm px-2 text-[12.5px] font-medium text-fg ring-1 ring-inset ring-border transition-[background-color,transform] duration-150 hover:bg-bg-subtle active:scale-[0.97]"
        >
          {CATEGORY_LABELS[c.category]}
          {c.called && <span className="rounded-[3px] bg-bg-subtle px-1 font-mono text-[10px] text-fg-3 ring-1 ring-inset ring-border">you</span>}
          <ChevronDown className="size-3 text-fg-3" aria-hidden />
        </button>
      }
    >
      <MenuLabel>Call this deal</MenuLabel>
      {CATEGORY_ORDER.map((cat) => (
        <MenuItem key={cat} onSelect={() => void call(cat)} icon={c.category === cat ? <Check className="size-3.5" /> : undefined} hint={cat === c.codeCategory ? "my call" : undefined}>
          {CATEGORY_LABELS[cat]}
        </MenuItem>
      ))}
      {c.called && (
        <>
          <MenuSeparator />
          <MenuItem onSelect={() => void call(null)}>Use my call ({CATEGORY_LABELS[c.codeCategory].toLowerCase()})</MenuItem>
        </>
      )}
    </Menu>
  );
}
