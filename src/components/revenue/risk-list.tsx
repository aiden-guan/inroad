"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useAsk } from "@/components/providers/ask-provider";
import { cn } from "@/lib/client/cn";
import type { Deal } from "@/lib/domain/types";
import type { Fix, Risk, RiskCode } from "@/lib/revenue/risk";

export const SEVERITY_DOT: Record<Risk["severity"], string> = {
  high: "bg-danger",
  medium: "bg-warning",
  low: "bg-fg-4",
};

export const BAND_LABEL = { healthy: "Healthy", watch: "Watch", at_risk: "At risk" } as const;
export const BAND_TONE = { healthy: "text-fg-3", watch: "text-warning", at_risk: "text-danger" } as const;

const FIX_LINK =
  "inline-flex min-h-7 items-center gap-1 rounded-sm px-1 text-left text-[12.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] sm:whitespace-nowrap sm:px-1.5";

/**
 * The one fix that moves a risk. Fixes that need thinking open Ask on the deal with the question already asked;
 * the rest open the deal where the fix is made. `jumpTo` scrolls to a section on this page instead.
 */
export function FixAction({ fix, dealId, jumpTo, className }: { fix: Fix; dealId: string; jumpTo?: string; className?: string }) {
  const { openAsk } = useAsk();
  if (fix.ask) {
    return (
      <button type="button" onClick={() => openAsk({ context: { kind: "deal", id: dealId }, prefill: fix.ask })} className={cn(FIX_LINK, "text-accent-text hover:underline active:scale-[0.97]", className)}>
        {fix.label}
      </button>
    );
  }
  if (jumpTo) {
    return (
      <button type="button" onClick={() => document.getElementById(jumpTo)?.scrollIntoView({ behavior: "smooth", block: "start" })} className={cn(FIX_LINK, "text-fg-2 hover:text-fg", className)}>
        {fix.label}
      </button>
    );
  }
  if (!fix.href) return null;
  return (
    <Link href={fix.href} className={cn(FIX_LINK, "text-fg-2 hover:text-fg", className)}>
      {fix.label} <ArrowUpRight className="size-3 shrink-0 opacity-60" aria-hidden />
    </Link>
  );
}

/** A deal's risks, worst first, each with the one fix that moves it. */
export function RiskList({ risks, deal, className, jump }: { risks: Risk[]; deal: Deal; className?: string; jump?: Partial<Record<RiskCode, string>> }) {
  if (!risks.length) return <p className={cn("text-[13px] text-fg-3", className)}>Nothing on file says this deal is at risk.</p>;
  return (
    <ul className={cn("divide-y divide-border", className)}>
      {risks.map((r) => (
        <li key={r.code} className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-start sm:gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <span aria-hidden className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", SEVERITY_DOT[r.severity])} />
            <div className="min-w-0">
              <p className="text-[13px] font-medium leading-5 text-fg">
                {r.label}
                <span className="sr-only">, {r.severity} risk</span>
              </p>
              <p className="break-words text-[12.5px] leading-5 text-fg-3">{r.detail}</p>
            </div>
          </div>
          <div className="pl-4 sm:pl-0">
            <FixAction fix={r.fix} dealId={deal.id} jumpTo={r.fix.ask ? undefined : jump?.[r.code]} />
          </div>
        </li>
      ))}
    </ul>
  );
}
