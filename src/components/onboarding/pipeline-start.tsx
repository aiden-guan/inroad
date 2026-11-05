"use client";

import { ArrowLeft, Check, Plug } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { KeyConnect } from "@/components/integrations/key-connect";
import { DealImport } from "@/components/revenue/deal-import";
import { TargetForm } from "@/components/revenue/target-dialog";
import { CommitEvidenceLine, XrayRows } from "@/components/revenue/xray";
import { useClock } from "@/components/today/use-today";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import { useFirstSight } from "@/components/ui/fx";
import { cn } from "@/lib/client/cn";
import { CONNECTORS, CRM_IDS, type CrmId } from "@/lib/connectors/catalog";
import { todayISO } from "@/lib/domain/ids";
import type { Workspace } from "@/lib/domain/types";
import { listItem } from "@/lib/motion";
import { money } from "@/lib/revenue/forecast";
import { liveTarget, openStage, quarterOf, revenueStats } from "@/lib/revenue/stats";
import { pipelineXray } from "@/lib/revenue/xray";
import { useOpenSample } from "./shared";

function StepCard({ n, title, done, summary, children, action }: { n: number; title: string; done: boolean; summary?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <motion.li variants={listItem} custom={n + 1} className="rounded-xl bg-surface p-4 shadow-xs ring-1 ring-border sm:p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn("mt-px flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[12px]", done ? "bg-success-subtle text-success" : "bg-bg-subtle text-fg-2 ring-1 ring-inset ring-border")}
        >
          {done ? <Check className="size-3.5" /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-[15px] font-medium leading-6 text-fg">
              {title}
              {done && <span className="sr-only"> (done)</span>}
            </h2>
            {action}
          </div>
          {summary && <div className="mt-0.5 break-words text-[13px] leading-5 text-fg-2">{summary}</div>}
          {children && <div className="mt-4">{children}</div>}
        </div>
      </div>
    </motion.li>
  );
}

/** Connecting the CRM, honestly: what it does today, and why the deals still come in from an export. */
function CrmConnect({ ws }: { ws: Workspace }) {
  const [open, setOpen] = useState<CrmId | null>(null);
  const connected = CRM_IDS.filter((id) => ws.integrations[id]?.enabled);
  return (
    <div className="mt-4 border-t border-border pt-4">
      {connected.length > 0 ? (
        <p className="flex gap-2 text-pretty text-[12.5px] leading-[18px] text-fg-3">
          <Plug className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {connected.map((id) => CONNECTORS[id].name).join(" and ")} {connected.length === 1 ? "is" : "are"} connected: Inroad won&apos;t suggest companies you already have, and deals you work here can sync back once you
            turn that on in Integrations. It doesn&apos;t read deals from your CRM yet, so bring today&apos;s pipeline in with an export from its Deals view, filtered to open deals.
          </span>
        </p>
      ) : open ? (
        <div>
          <p className="mb-3 text-[12.5px] leading-[18px] text-fg-3">
            Connecting {CONNECTORS[open].name} keeps it from being suggested companies you already have, and lets deals you work here sync back later. Today&apos;s open deals still come in from an export.
          </p>
          <KeyConnect id={open} onConnected={() => setOpen(null)} onCancel={() => setOpen(null)} />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px] text-fg-3">
          <span>Or connect your CRM:</span>
          {CRM_IDS.map((id) => (
            <Button key={id} size="xs" variant="secondary" onClick={() => setOpen(id)}>
              {CONNECTORS[id].name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The first run for a Head of GTM at a company with a pipeline: open deals in (a CRM export, or a connected CRM for
 * what it can do today), this quarter's number, then the pipeline X-ray computed from those deals, and on to
 * Revenue with the forecast called from them. All code: no website and no AI key. `onFinish` completes onboarding
 * and opens a page (Revenue, or one deal on it).
 */
export function PipelineStart({ ws, onFounder, onFinish }: { ws: Workspace; onFounder: () => void; onFinish: (to: string) => Promise<boolean> }) {
  const now = useClock(60_000);
  const today = todayISO(new Date(now));
  const reduce = useReducedMotion();
  const heading = useRef<HTMLHeadingElement>(null);
  const [adding, setAdding] = useState(false);
  const [skipTarget, setSkipTarget] = useState(false);
  const [editTarget, setEditTarget] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const sample = useOpenSample("/revenue");

  // Everything this screen reads, computed in code from the workspace, once per change (or day).
  const { open, openUsd, target, period, stats, xray } = useMemo(() => {
    const open = Object.values(ws.deals).filter((d) => openStage(d.stage));
    const target = liveTarget(ws.revenue?.target, today);
    return {
      open,
      openUsd: open.reduce((n, d) => n + (d.amountUsd ?? 0), 0),
      target,
      period: target ? { start: target.periodStart, end: target.periodEnd, label: target.label } : quarterOf(today),
      stats: revenueStats(ws, today),
      xray: pipelineXray(ws, today),
    };
  }, [ws, today]);

  // Any deal in counts (a file can hold only this quarter's wins); the X-ray then says there's nothing open to check.
  const dealsDone = Object.keys(ws.deals).length > 0 && !adding;
  const targetDone = (!!target || skipTarget) && !editTarget;
  const ready = dealsDone && targetDone;
  // The X-ray reads out once, the first time it's on screen; the seen flag is written from an effect.
  const play = useFirstSight("gtm-xray") && !reduce;

  // Arriving from the founder screen moves focus to this screen's heading, so keyboard and screen-reader users land here.
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);

  const finish = async (to: string) => {
    if (leaving) return;
    setLeaving(true);
    if (!(await onFinish(to))) setLeaving(false);
  };

  return (
    <motion.main key="pipeline" initial="hidden" animate="show" exit={{ opacity: 0, transition: { duration: 0.12 } }} className="mx-auto w-full max-w-[640px] px-4 pb-20 pt-[6vh] sm:px-6 sm:pt-[10vh]">
      <motion.div variants={listItem} custom={0} className="mb-8 flex items-center gap-3">
        <span className="flex size-12 items-center justify-center rounded-xl bg-surface text-fg shadow-sm ring-1 ring-inset ring-border">
          <BrandMark draw="once" className="size-8" />
        </span>
        <span className="page-eyebrow">For a Head of GTM</span>
      </motion.div>
      <motion.h1
        ref={heading}
        tabIndex={-1}
        variants={listItem}
        custom={0}
        className="text-balance font-serif text-[34px] leading-[40px] tracking-[-0.02em] text-fg outline-none [font-variation-settings:'opsz'_48] sm:text-[40px] sm:leading-[44px]"
      >
        Let&rsquo;s call your quarter.
      </motion.h1>
      <motion.p variants={listItem} custom={1} className="mt-3 text-pretty text-[15px] leading-[23px] text-fg-2">
        Bring your open deals and this quarter&apos;s number. I&apos;ll call the forecast deal by deal and X-ray the pipeline, in code, in about a minute.
      </motion.p>

      <ol className="mt-8 space-y-3" aria-label="Three steps to your forecast">
        <StepCard
          n={1}
          title="Your open deals"
          done={dealsDone}
          summary={dealsDone ? `${open.length} open ${open.length === 1 ? "deal" : "deals"}${openUsd ? `, ${money(openUsd)} on file` : ""}.` : "A CSV export from your CRM: one row per deal, with its stage."}
          action={
            dealsDone ? (
              <button type="button" onClick={() => setAdding(true)} className="text-[12.5px] font-medium text-fg-2 underline decoration-border-strong underline-offset-2 hover:text-fg">
                Add another file
              </button>
            ) : adding ? (
              <button type="button" onClick={() => setAdding(false)} className="text-[12.5px] font-medium text-fg-2 underline decoration-border-strong underline-offset-2 hover:text-fg">
                Done adding
              </button>
            ) : undefined
          }
        >
          {!dealsDone && (
            <>
              <DealImport period={period} onDone={() => setAdding(false)} />
              <CrmConnect ws={ws} />
              <p className="mt-4 text-[12.5px] leading-[18px] text-fg-3">
                No export handy?{" "}
                <button type="button" onClick={() => void sample.open()} disabled={sample.busy} className="font-medium text-fg-2 underline decoration-border-strong underline-offset-2 hover:text-fg disabled:opacity-60">
                  {sample.busy ? "Opening the sample…" : "Look around a sample pipeline"}
                </button>
                . Everything in it is made up.
              </p>
            </>
          )}
        </StepCard>

        {dealsDone && (
          <StepCard
            n={2}
            title="This quarter's number"
            done={targetDone}
            summary={targetDone ? (target ? `${target.label}: ${money(target.amountUsd)}.` : "Skipped for now. Set it on Revenue any time.") : "New annual contract value to close in the period. It turns the forecast into a gap and a plan."}
            action={
              targetDone ? (
                <button type="button" onClick={() => setEditTarget(true)} className="text-[12.5px] font-medium text-fg-2 underline decoration-border-strong underline-offset-2 hover:text-fg">
                  Change
                </button>
              ) : (
                <button type="button" onClick={() => setSkipTarget(true)} className="text-[12.5px] font-medium text-fg-3 underline decoration-border-strong underline-offset-2 hover:text-fg-2">
                  Skip for now
                </button>
              )
            }
          >
            {!targetDone && (
              <TargetForm
                today={today}
                stats={stats}
                idPrefix="gtm-target"
                submitLabel="Set the target"
                onSaved={() => {
                  setEditTarget(false);
                  setSkipTarget(false);
                }}
              />
            )}
          </StepCard>
        )}

        {ready && (
          <StepCard
            n={3}
            title="The pipeline X-ray"
            done={false}
            summary={xray.open ? `Four questions about ${xray.open === 1 ? "your open deal" : `your ${xray.open} open deals`}, answered from what's on file. Each flagged deal comes with its fix.` : "No open deals to check. The forecast still counts this quarter's wins."}
          >
            {xray.open > 0 && (
              <>
                <XrayRows xray={xray} play={play} onFix={(d) => void finish(`/revenue?d=${encodeURIComponent(d.id)}`)} className="shadow-none" />
                <CommitEvidenceLine xray={xray} className="mt-3" />
              </>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button variant="primary" size="lg" loading={leaving} onClick={() => void finish("/revenue")}>
                Open my forecast
              </Button>
              <span className="text-[12px] text-fg-3">The call, deal by deal, with the plan behind the gap.</span>
            </div>
          </StepCard>
        )}
      </ol>

      <motion.footer variants={listItem} custom={5} className="mt-12 border-t border-border pt-4">
        <button type="button" onClick={onFounder} className="inline-flex items-center gap-1.5 rounded-xs text-[13px] text-fg-3 underline-offset-4 transition-colors duration-150 hover:text-fg-2 hover:underline">
          <ArrowLeft className="size-3.5" aria-hidden /> I&apos;m finding our first customers instead
        </button>
        <p className="mt-2 text-pretty text-[12px] leading-[18px] text-fg-3">Your workspace stays on this computer. Nothing is written to your CRM unless you turn on write-back.</p>
      </motion.footer>
    </motion.main>
  );
}
