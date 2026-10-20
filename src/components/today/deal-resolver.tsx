"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { cn } from "@/lib/client/cn";
import { addDays, daysBetween, nowISO } from "@/lib/domain/ids";
import { STAGE_LABELS, type Deal, type LossReason } from "@/lib/domain/types";
import { HoldButton } from "./parts";

const LOSS_REASONS: { id: LossReason; label: string }[] = [
  { id: "went_dark", label: "Went dark" },
  { id: "no_pain", label: "No real pain" },
  { id: "timing", label: "Timing" },
  { id: "no_budget", label: "No budget" },
  { id: "competitor", label: "Chose a competitor" },
  { id: "build", label: "Building it themselves" },
  { id: "price", label: "Price" },
  { id: "product_gap", label: "Product gap" },
  { id: "not_icp", label: "Not a fit" },
];

/** Next business day: a next step on a Saturday is a next step nobody keeps. */
function nextBusinessDay(today: string): string {
  let d = addDays(today, 1);
  for (let i = 0; i < 3; i++) {
    const day = new Date(`${d}T12:00:00`).getDay();
    if (day !== 0 && day !== 6) break;
    d = addDays(d, 1);
  }
  return d;
}

const PLACEHOLDER: Record<string, string> = {
  talking: "Second call with the person who owns the problem",
  qualified: "Security review with their CISO",
  pilot: "Mid-pilot check-in on the success metric",
  proposal: "Order form review with their CFO",
};

/**
 * Resolves a deal without a dated next step: book one (the default), park it in nurture with a
 * date, or close it as lost with a reason (hold to confirm). Nothing is ever blocked.
 */
export function DealResolver({ deal, today, company, onResolved, compact }: { deal: Deal; today: string; company: string; onResolved: () => void; compact?: boolean }) {
  const staleDays = deal.nextStep?.date ? daysBetween(deal.nextStep.date, today) : daysBetween((deal.lastActivityAt || deal.updatedAt).slice(0, 10), today);
  const { dispatch } = useWorkspace();
  const [mode, setMode] = useState<"next" | "nurture" | "lost">("next");
  const [what, setWhat] = useState(deal.nextStep?.what ?? "");
  const [date, setDate] = useState(nextBusinessDay(today));
  const [agreed, setAgreed] = useState(deal.nextStep?.buyerAgreed ?? false);
  const [until, setUntil] = useState(addDays(today, 60));
  const [reason, setReason] = useState<LossReason>("went_dark");
  const id = useId();

  const save = async () => {
    if (!what.trim()) return;
    const ok = await dispatch({ type: "deal.setNextStep", id: deal.id, nextStep: { what: what.trim(), date, buyerAgreed: agreed }, at: nowISO() });
    if (ok) onResolved();
  };

  return (
    <div className={cn("space-y-3", compact && "space-y-2")}>
      {mode === "next" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-2.5"
        >
          {!compact && (
            <p className="text-[13px] leading-5 text-fg-2">
              {staleDays >= 14
                ? `No dated next step for ${staleDays} days. Book one, park ${company} in nurture with a date, or close it: a deal without a next step is already a soft no.`
                : `A meeting without a dated, buyer-agreed next step is a soft no. What did ${company} agree to, and when?`}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <div>
              <Label htmlFor={`${id}-what`} className="sr-only">
                Next step
              </Label>
              <Input id={`${id}-what`} value={what} onChange={(e) => setWhat(e.target.value)} placeholder={PLACEHOLDER[deal.stage] ?? "What happens next, with whom"} autoComplete="off" />
            </div>
            <div>
              <Label htmlFor={`${id}-date`} className="sr-only">
                Date
              </Label>
              <Input id={`${id}-date`} type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className="font-mono text-[12.5px] sm:w-40" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-fg-2">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="size-3.5 accent-[var(--primary)]" />
              They agreed to it
            </label>
            <span className="flex-1" />
            {what.trim() ? (
              <Button type="submit" variant="primary" size="sm">
                Save next step
              </Button>
            ) : (
              <span className="text-[12px] text-fg-3">Type the step to save it</span>
            )}
          </div>
        </form>
      )}

      {mode === "nurture" && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor={`${id}-until`}>Check back on</Label>
            <Input id={`${id}-until`} type="date" value={until} min={today} onChange={(e) => setUntil(e.target.value)} className="w-40 font-mono text-[12.5px]" />
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={async () => {
              const ok = await dispatch({ type: "deal.setStage", id: deal.id, stage: "nurture", nurtureUntil: until, at: nowISO() });
              if (ok) onResolved();
            }}
          >
            Move to nurture
          </Button>
        </div>
      )}

      {mode === "lost" && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor={`${id}-reason`}>Reason</Label>
            <select
              id={`${id}-reason`}
              value={reason}
              onChange={(e) => setReason(e.target.value as LossReason)}
              className="h-8 rounded-sm bg-surface px-2 text-[13px] text-fg ring-1 ring-border-strong/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              {LOSS_REASONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <HoldButton
            onConfirm={async () => {
              const ok = await dispatch({ type: "deal.setStage", id: deal.id, stage: "lost", lossReason: reason, at: nowISO() });
              if (ok) onResolved();
            }}
          >
            Hold to close as lost
          </HoldButton>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
        {mode !== "next" && (
          <button onClick={() => setMode("next")} className="text-fg-2 underline-offset-4 hover:text-fg hover:underline">
            Set a next step instead
          </button>
        )}
        {mode !== "nurture" && (
          <button onClick={() => setMode("nurture")} className="text-fg-2 underline-offset-4 hover:text-fg hover:underline">
            Park in nurture
          </button>
        )}
        {mode !== "lost" && (
          <button onClick={() => setMode("lost")} className="text-fg-2 underline-offset-4 hover:text-fg hover:underline">
            Close as lost
          </button>
        )}
        <Link href={`/companies?c=${encodeURIComponent(deal.accountDomain)}`} className="ml-auto text-fg-3 hover:text-fg">
          {STAGE_LABELS[deal.stage]} · open {company}
        </Link>
      </div>
    </div>
  );
}
