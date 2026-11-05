"use client";

import { Check, ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type CSSProperties } from "react";
import { fx } from "@/components/ui/fx";
import { Favicon } from "@/components/ui/favicon";
import { cn } from "@/lib/client/cn";
import { ease } from "@/lib/motion";
import { money } from "@/lib/revenue/forecast";
import type { PipelineXray, XrayCheck, XrayDeal } from "@/lib/revenue/xray";
import { FixAction } from "./risk-list";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * The pipeline X-ray, read out: one row per question, its count and dollars, opening to the deals behind it, each
 * with the fix. `play` reveals the rows one after another (the first look after an import); `onFix` replaces the
 * in-place fix with a callback, for screens where Ask and the deal sheet aren't available yet (first run).
 */
export function XrayRows({ xray, play, onFix, openFirst = true, className }: { xray: PipelineXray; play?: boolean; onFix?: (deal: XrayDeal) => void; openFirst?: boolean; className?: string }) {
  // The first question with deals can open by itself, so the screen leads with something to do.
  const [open, setOpen] = useState<string | null>(() => (openFirst ? (xray.checks.find((c) => c.deals.length)?.code ?? null) : null));
  return (
    <ul className={cn("divide-y divide-border overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-inset ring-border", className)}>
      {xray.checks.map((c, i) => (
        <XrayRow key={c.code} check={c} open={open === c.code} onToggle={() => setOpen((o) => (o === c.code ? null : c.code))} play={play} i={i} onFix={onFix} />
      ))}
    </ul>
  );
}

function XrayRow({ check: c, open, onToggle, play, i, onFix }: { check: XrayCheck; open: boolean; onToggle: () => void; play?: boolean; i: number; onFix?: (deal: XrayDeal) => void }) {
  const n = c.deals.length;
  const panel = `xray-${c.code}`;
  const status = c.unchecked ? "Can't tell yet" : n ? plural(n, "deal") : "None";
  return (
    <li className={cn(play && "fx-rise")} style={play ? fx(i, 260, { "--fx-step": "320ms" } as CSSProperties) : undefined}>
      <button
        type="button"
        onClick={onToggle}
        disabled={!n}
        aria-expanded={n ? open : undefined}
        aria-controls={n ? panel : undefined}
        className="grid w-full grid-cols-[44px_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3.5 text-left outline-none transition-colors hover:bg-bg-subtle/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] disabled:cursor-default disabled:hover:bg-transparent sm:px-5"
      >
        <span className={cn("pt-px text-right font-mono text-[22px] leading-7 tnum", n ? "text-fg" : "text-fg-4")} aria-hidden>
          {c.unchecked ? "–" : n ? n : <Check className="ml-auto mt-1 size-4 text-success" />}
        </span>
        <span className="min-w-0">
          <span className="block text-[14px] font-medium leading-5 text-fg">
            {c.label}
            <span className="sr-only">: {status}</span>
          </span>
          <span className="mt-0.5 block text-pretty text-[12.5px] leading-[18px] text-fg-3">
            {c.unchecked ?? (n ? c.why : "Every open deal passes this one.")}
            {!c.unchecked && c.unknown > 0 && ` ${plural(c.unknown, "deal")} couldn't be checked: the data isn't on file.`}
          </span>
        </span>
        <span className="flex items-center gap-2 pt-0.5">
          {n > 0 && <span className="font-mono text-[12.5px] tnum text-fg-2">{money(c.usd)}</span>}
          {n > 0 && <ChevronRight aria-hidden className={cn("size-4 text-fg-4 transition-transform duration-150", open && "rotate-90")} />}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && n > 0 && (
          <motion.div
            id={panel}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: ease.out }}
            className="overflow-hidden"
          >
            <ul className="divide-y divide-border border-t border-border bg-bg-subtle/40 sm:pl-[60px]">
              {c.deals.map((d) => (
                <li key={d.id} className="flex flex-col gap-1.5 px-4 py-2.5 sm:flex-row sm:items-start sm:gap-4 sm:pl-0 sm:pr-5">
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <Favicon domain={d.domain} name={d.name} size={16} className="mt-0.5" />
                    <div className="min-w-0">
                      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[13px] leading-5">
                        <span className="min-w-0 break-words font-medium text-fg">{d.name}</span>
                        <span className="font-mono text-[12px] tnum text-fg-3">
                          {money(d.amountUsd)}
                          {d.estimated && " est."}
                        </span>
                      </p>
                      <p className="break-words text-[12.5px] leading-5 text-fg-3">{d.detail}</p>
                    </div>
                  </div>
                  <div className="pl-6 sm:pl-0">
                    {onFix ? (
                      <button
                        type="button"
                        onClick={() => onFix(d)}
                        className="inline-flex min-h-7 items-center rounded-sm px-1 text-left text-[12.5px] font-medium text-fg-2 outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-[var(--ring)] sm:whitespace-nowrap sm:px-1.5"
                      >
                        {d.fix.label}
                      </button>
                    ) : (
                      <FixAction fix={d.fix} dealId={d.id} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

/** One line under the X-ray: how much of the period can't be commit yet, and why, said once. */
export function CommitEvidenceLine({ xray, className }: { xray: PipelineXray; className?: string }) {
  if (!xray.commitBlocked.count) return null;
  return (
    <p className={cn("text-pretty text-[12.5px] leading-5 text-fg-3", className)}>
      {plural(xray.commitBlocked.count, "late-stage deal")} ({money(xray.commitBlocked.usd)}) {xray.commitBlocked.count === 1 ? "isn't" : "aren't"} commit by my call yet. Commit needs an engaged economic buyer, a known paper process and a buyer-agreed next step on file.
    </p>
  );
}
