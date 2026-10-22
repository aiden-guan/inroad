"use client";

import { ArrowLeftRight, ArrowRight, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Favicon } from "@/components/ui/favicon";
import { cn } from "@/lib/client/cn";
import type { Intro, Workspace } from "@/lib/domain/types";
import { nextStep, STAGE_LABEL, type IntroNext } from "@/lib/intros/rules";
import { first } from "@/lib/moves/util";
import { spring } from "@/lib/motion";
import { IntroNextPanel, StageControls } from "./intro-next";

const ASK_STEPS = ["Asked", "Checking", "Introduced", "Met", "Thanked"] as const;
const GIVE_STEPS = ["Asked both", "Both said yes", "Introduced", "Checked in"] as const;

/** How far along an intro is, as a step index. Closed-early intros stop where they stopped. */
function progress(intro: Intro): { at: number; steps: readonly string[]; ended?: string } {
  if (intro.kind === "give") {
    const both = intro.sides?.every((s) => s.consent === "yes");
    const at = intro.stage === "done" ? 3 : intro.stage === "introduced" ? 2 : both ? 1 : 0;
    return { at, steps: GIVE_STEPS, ended: intro.stage === "declined" || intro.stage === "no_answer" ? STAGE_LABEL[intro.stage] : undefined };
  }
  const reached = intro.thankedOn && (intro.stage === "done" || intro.introducedOn) ? 4 : intro.stage === "done" || intro.stage === "meeting" ? 3 : intro.introducedOn ? 2 : intro.forwardedOn ? 1 : 0;
  return { at: reached, steps: ASK_STEPS, ended: intro.stage === "declined" || intro.stage === "no_answer" ? STAGE_LABEL[intro.stage] : undefined };
}

export function Stepper({ intro }: { intro: Intro }) {
  const { at, steps, ended } = progress(intro);
  return (
    <ol className="flex items-center gap-1" aria-label={`Progress: ${ended ?? steps[at]}`}>
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-1">
          <span
            title={s}
            className={cn(
              "block h-1.5 rounded-full transition-[background-color,width] duration-300",
              i <= at ? (ended && i === at ? "w-5 bg-fg-4" : "w-5 bg-accent") : "w-3 bg-border-strong/60",
            )}
          />
        </li>
      ))}
      <li className="ml-1.5 text-[11.5px] text-fg-3">{ended ?? steps[at]}</li>
    </ol>
  );
}

function OwnerChip({ next }: { next: IntroNext }) {
  if (next.owner === "you")
    return (
      <span className="inline-flex h-5 items-center rounded-full bg-accent-subtle px-2 text-[11.5px] font-medium text-accent-text">
        Your move{next.overdueDays ? ` · ${next.overdueDays}d late` : ""}
      </span>
    );
  if (next.owner === null) return null;
  return <span className="inline-flex h-5 items-center rounded-full bg-bg-subtle px-2 text-[11.5px] text-fg-3 ring-1 ring-border">Waiting</span>;
}

/**
 * "Claire → Rafael at Ashgrove" or "Ava ↔ Marcus". Who's being introduced is the point, so on a phone the
 * names wrap onto a second line instead of being cut off; wider screens keep one line.
 */
export function IntroTitle({ intro, ws }: { intro: Intro; ws: Workspace }) {
  if (intro.kind === "give") {
    const [a, b] = intro.sides ?? [];
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 sm:flex-nowrap">
        <span className="font-medium text-fg sm:truncate">{a?.name}</span>
        <ArrowLeftRight className="size-3.5 shrink-0 text-fg-3" aria-label="and" />
        <span className="font-medium text-fg sm:truncate">{b?.name}</span>
      </span>
    );
  }
  const acc = intro.accountDomain ? ws.accounts[intro.accountDomain] : undefined;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 sm:flex-nowrap">
      <span className="shrink-0 text-fg-2">{intro.connectorName ?? "Connector"}</span>
      <ArrowRight className="size-3.5 shrink-0 text-fg-3" aria-label="to" />
      {/* The mark travels with the name it belongs to when the line wraps. */}
      <span className="flex min-w-0 items-center gap-1.5">
        {acc && <Favicon domain={acc.domain} name={acc.name} size={14} />}
        <span className="min-w-0 font-medium text-fg [overflow-wrap:anywhere] sm:truncate">
          {intro.targetName.split(",")[0]}
          {acc && !intro.targetName.toLowerCase().includes(acc.name.split(" ")[0].toLowerCase()) && <span className="font-normal text-fg-2"> at {acc.name}</span>}
        </span>
      </span>
    </span>
  );
}

/**
 * One intro: who → whom, how far it got, and whose move it is. Expands to the founder's next move
 * (the drafted note and one button) or to "what happened?" when it's someone else's move.
 */
export function IntroCard({ intro, ws, today, defaultOpen, highlight }: { intro: Intro; ws: Workspace; today: string; defaultOpen?: boolean; highlight?: boolean }) {
  const next = nextStep(intro, ws, today);
  const [open, setOpen] = useState(!!defaultOpen);
  const yours = next.owner === "you" && !!next.action;
  return (
    <div
      id={`intro-${intro.id}`}
      className={cn("rounded-lg bg-surface ring-1 transition-shadow duration-300", highlight ? "shadow-md ring-accent/50" : "ring-border", open && "shadow-sm")}
    >
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex min-w-0 items-center gap-2 text-[14px]">
            <IntroTitle intro={intro} ws={ws} />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {/* On a phone the status chip joins this row, so the title above gets the full width. */}
            {next.owner !== null && (
              <span className="sm:hidden">
                <OwnerChip next={next} />
              </span>
            )}
            <Stepper intro={intro} />
            <span className="text-[12.5px] text-fg-2">{next.line}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          <span className="hidden sm:contents">
            <OwnerChip next={next} />
          </span>
          <ChevronDown className={cn("size-4 text-fg-3 transition-transform duration-200", open && "rotate-180")} aria-hidden />
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring.smooth} className="overflow-hidden">
            <div className="border-t border-border px-4 pb-4 pt-3">
              {yours ? (
                <IntroNextPanel intro={intro} next={next} today={today} onDone={() => setOpen(false)} />
              ) : (
                <div className="space-y-2.5">
                  <IntroFacts intro={intro} />
                  <StageControls intro={intro} />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The dated trail, newest last, for intros that aren't the founder's move. */
function IntroFacts({ intro }: { intro: Intro }) {
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const facts = [
    intro.kind === "give" ? null : `Asked ${first(intro.connectorName)} ${fmt(intro.askedOn)}`,
    ...(intro.sides ?? []).map((s) => (s.askedOn ? `${first(s.name)}: ${s.consent === "yes" ? "said yes" : s.consent === "no" ? "passed" : "asked"} ${fmt(s.askedOn)}` : `${first(s.name)}: not asked yet`)),
    intro.nudgedOn ? `nudged ${fmt(intro.nudgedOn)}` : null,
    intro.forwardedOn ? `checking with them ${fmt(intro.forwardedOn)}` : null,
    intro.introducedOn ? `introduced ${fmt(intro.introducedOn)}` : null,
    intro.repliedOn ? `you replied ${fmt(intro.repliedOn)}` : null,
    intro.thankedOn ? (intro.kind === "give" ? `checked in ${fmt(intro.thankedOn)}` : `${first(intro.connectorName)} heard back ${fmt(intro.thankedOn)}`) : null,
  ].filter(Boolean);
  return <p className="text-[12.5px] leading-[19px] text-fg-3">{facts.join(" · ")}</p>;
}
