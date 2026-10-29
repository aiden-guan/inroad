"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/field";
import { Segmented } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { addDays } from "@/lib/domain/ids";
import type { RevenueTarget } from "@/lib/domain/types";
import { money } from "@/lib/revenue/forecast";
import { quarterOf, type Observed, type RevenueStats } from "@/lib/revenue/stats";

type PeriodChoice = "this" | "next" | "custom";

function nextQuarter(today: string) {
  return quarterOf(addDays(quarterOf(today).end, 1));
}

function num(v: string): number | undefined {
  const n = Number(v.replace(/[$,\s%x×]/gi, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * The revenue number and the assumptions behind the plan. Assumptions are optional: blank means
 * "use my own rate once I have one, a stated default until then".
 */
export function TargetDialog({ open, onOpenChange, today, stats }: { open: boolean; onOpenChange: (open: boolean) => void; today: string; stats: RevenueStats }) {
  const { ws, dispatch } = useWorkspace();
  const existing = ws?.revenue?.target;
  const thisQ = quarterOf(today);
  const nextQ = nextQuarter(today);
  const initialChoice: PeriodChoice = !existing || existing.periodStart === thisQ.start ? "this" : existing.periodStart === nextQ.start ? "next" : "custom";

  const [amount, setAmount] = useState(existing ? String(existing.amountUsd) : "");
  const [choice, setChoice] = useState<PeriodChoice>(initialChoice);
  const [start, setStart] = useState(existing?.periodStart ?? thisQ.start);
  const [end, setEnd] = useState(existing?.periodEnd ?? thisQ.end);
  const [label, setLabel] = useState(existing?.label ?? "");
  const [more, setMore] = useState(!!(existing?.winRate || existing?.avgDealUsd || existing?.cycleDays || existing?.coverageTarget));
  const [winRate, setWinRate] = useState(existing?.winRate ? String(Math.round(existing.winRate * 100)) : "");
  const [avgDeal, setAvgDeal] = useState(existing?.avgDealUsd ? String(existing.avgDealUsd) : "");
  const [cycle, setCycle] = useState(existing?.cycleDays ? String(existing.cycleDays) : "");
  const [coverage, setCoverage] = useState(existing?.coverageTarget ? String(existing.coverageTarget) : "");

  const period = choice === "this" ? thisQ : choice === "next" ? nextQ : { start, end, label: "" };
  const autoLabel = choice === "custom" ? "New ARR" : `${period.label} new ARR`;
  const value = num(amount);
  const valid = !!value && period.start <= period.end;

  const save = async () => {
    if (!valid) return;
    const target: RevenueTarget = {
      amountUsd: Math.round(value!),
      periodStart: period.start,
      periodEnd: period.end,
      label: label.trim() || autoLabel,
      ...(num(winRate) ? { winRate: Math.min(0.95, num(winRate)! / 100) } : {}),
      ...(num(avgDeal) ? { avgDealUsd: Math.round(num(avgDeal)!) } : {}),
      ...(num(cycle) ? { cycleDays: Math.round(num(cycle)!) } : {}),
      ...(num(coverage) ? { coverageTarget: Math.min(10, num(coverage)!) } : {}),
    };
    const ok = await dispatch({ type: "revenue.setTarget", target });
    if (ok) {
      toast(`${target.label}: ${money(target.amountUsd)}`);
      onOpenChange(false);
    }
  };

  const clear = async () => {
    const ok = await dispatch({ type: "revenue.setTarget", target: null });
    if (ok) {
      toast("Target cleared");
      onOpenChange(false);
    }
  };

  const hint = (o: Observed, fmt: (v: number) => string) => `${fmt(o.value)} ${o.source === "observed" ? `(yours, n=${o.n})` : o.source === "blended" ? `(blended, n=${o.n})` : "(default)"}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Revenue target" description="The number you're measured on. I work backward from it to the meetings it takes.">
      <form
        className="space-y-5 px-5 pb-5 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div>
          <Label htmlFor="target-amount" hint="New annual contract value closed in the period">
            Target
          </Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-fg-3">$</span>
            <Input id="target-amount" inputMode="numeric" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="150,000" className="pl-6 font-mono" />
          </div>
        </div>

        <div>
          <Label>Period</Label>
          <Segmented
            value={choice}
            onChange={setChoice}
            layoutId="target-period"
            options={[
              { value: "this", label: thisQ.label },
              { value: "next", label: nextQ.label },
              { value: "custom", label: "Custom" },
            ]}
          />
          {choice === "custom" && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="target-start">From</Label>
                <Input id="target-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} className="font-mono" />
              </div>
              <div>
                <Label htmlFor="target-end">To</Label>
                <Input id="target-end" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="font-mono" />
              </div>
            </div>
          )}
        </div>

        <div>
          <Label htmlFor="target-label">Name</Label>
          <Input id="target-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={autoLabel} />
        </div>

        <div>
          <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-fg-2 hover:text-fg">
            <ChevronRight className={cn("size-3.5 transition-transform duration-150", more && "rotate-90")} aria-hidden />
            Planning assumptions
          </button>
          {more && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="target-win">Win rate %</Label>
                <Input id="target-win" inputMode="numeric" value={winRate} onChange={(e) => setWinRate(e.target.value)} placeholder={hint(stats.winRate, (v) => `${Math.round(v * 100)}`)} className="font-mono" />
              </div>
              <div>
                <Label htmlFor="target-deal">Typical deal $</Label>
                <Input id="target-deal" inputMode="numeric" value={avgDeal} onChange={(e) => setAvgDeal(e.target.value)} placeholder={hint(stats.avgDealUsd, (v) => `${Math.round(v)}`)} className="font-mono" />
              </div>
              <div>
                <Label htmlFor="target-cycle">Sales cycle, days</Label>
                <Input id="target-cycle" inputMode="numeric" value={cycle} onChange={(e) => setCycle(e.target.value)} placeholder={hint(stats.cycleDays, (v) => `${Math.round(v)}`)} className="font-mono" />
              </div>
              <div>
                <Label htmlFor="target-coverage">Healthy coverage ×</Label>
                <Input id="target-coverage" inputMode="decimal" value={coverage} onChange={(e) => setCoverage(e.target.value)} placeholder="1 ÷ win rate" className="font-mono" />
              </div>
              <p className="col-span-2 text-[12px] leading-5 text-fg-3">Leave blank to use your own rates as soon as there are enough closed deals, and a stated default until then. Your own history always wins over these once it exists.</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          {existing ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => void clear()}>
              Clear target
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" variant="primary" disabled={!valid}>
            Save target
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
