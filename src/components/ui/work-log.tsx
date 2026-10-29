"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Square } from "lucide-react";
import { useEffect, useState } from "react";
import type { LogStep, RunState } from "@/components/providers/runs-provider";
import { useRuns } from "@/components/providers/runs-provider";
import { cn } from "@/lib/client/cn";
import { duration, usd } from "@/lib/client/format";
import { ease, spring } from "@/lib/motion";
import { AgentErrorNote } from "./agent-error";
import { Favicon } from "./favicon";
import { Orb } from "./orb";

function useNow(active: boolean, from: number) {
  const [now, setNow] = useState(from);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function label(step: LogStep, active: boolean): { verb: string; detail: string } {
  switch (step.kind) {
    case "search":
      return { verb: active ? "Searching" : "Searched", detail: step.text };
    case "read":
      return { verb: active ? "Reading" : "Read", detail: step.text };
    default:
      return { verb: step.text, detail: "" };
  }
}

function StepRow({ step, active }: { step: LogStep; active: boolean }) {
  const { verb, detail } = label(step, active);
  const ms = step.doneAt ? step.doneAt - step.at : 0;
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: ease.out }}
      className="flex h-7 items-center gap-2.5 text-[13px]"
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        <AnimatePresence mode="popLayout" initial={false}>
          {active ? (
            <motion.span key="spin" exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.1 }} className="size-3 rounded-full border-[1.5px] border-accent/25 border-t-accent animate-spin" />
          ) : (
            <motion.svg key="check" viewBox="0 0 16 16" className="size-3.5 text-fg-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <motion.path
                d="M3.5 8.5l3 3 6-7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.25, ease: ease.out }}
              />
            </motion.svg>
          )}
        </AnimatePresence>
      </span>
      {step.kind === "read" && step.host && <Favicon domain={step.host} size={14} />}
      <span className={cn("min-w-0 flex-1 truncate", active ? "shimmer-text" : "text-fg-2")}>
        <span className={cn(!active && "text-fg")}>{verb}</span>
        {detail && <span className={cn("ml-1.5", step.kind === "search" ? "" : "font-mono text-[12px]", !active && "text-fg-3")}>{step.kind === "search" ? `“${detail}”` : detail}</span>}
      </span>
      {!active && ms > 400 && <span className="shrink-0 font-mono text-[11px] tnum text-fg-3">{(ms / 1000).toFixed(1)}s</span>}
    </motion.li>
  );
}

/** "Worked for 1m 52s · 9 sources · $0.04" — every run ends with a receipt. */
export function Receipt({ run, onClick, open }: { run: RunState; onClick?: () => void; open?: boolean }) {
  const ms = (run.endedAt ?? run.startedAt) - run.startedAt;
  const parts = [
    `Worked for ${duration(ms)}`,
    run.sources.length ? `${run.sources.length} source${run.sources.length === 1 ? "" : "s"}` : null,
    run.costUsd !== undefined ? usd(run.costUsd) : null,
  ].filter(Boolean);
  return (
    <button
      onClick={onClick}
      className="inline-flex h-6 items-center gap-1.5 rounded-xs px-1.5 font-mono text-[11.5px] text-fg-3 transition-colors hover:bg-bg-subtle hover:text-fg-2"
    >
      <Orb state={run.status === "error" ? "error" : "idle"} size={10} />
      {parts.join(" · ")}
      {onClick && <ChevronDown className={cn("size-3 transition-transform duration-200", open && "rotate-180")} />}
    </button>
  );
}

/**
 * The live log of an agent run: present-tense verbs while working, a receipt when done.
 * Thoughts are ephemeral — each one replaces the last in place.
 */
export function WorkLog({ run, className, defaultOpen }: { run: RunState; className?: string; defaultOpen?: boolean }) {
  const { stop } = useRuns();
  const active = run.status === "running" || run.status === "queued";
  const now = useNow(active, run.startedAt);
  const [userOpen, setOpen] = useState<boolean | null>(null);
  const open = userOpen ?? defaultOpen ?? active;

  const steps = run.steps.filter((s) => s.text);
  const elapsed = (run.endedAt ?? now) - run.startedAt;
  const hosts = [...new Set(run.sources.map((s) => s.host))].slice(0, 4);

  if (!active && !open) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Receipt run={run} onClick={() => setOpen(true)} />
        {run.error && run.status !== "stopped" && <AgentErrorNote error={run.error} className="min-w-0" />}
      </div>
    );
  }

  return (
    <motion.div layout transition={spring.smooth} aria-busy={active} className={cn("relative overflow-hidden rounded-xl bg-surface p-4 shadow-xs ring-1 ring-inset", active ? "ring-accent/25" : "ring-border", className)}>
      {active && <span aria-hidden className="run-scan" />}
      <div className="mb-3 flex items-center gap-2.5">
        <Orb state={active ? "working" : run.status === "error" ? "error" : "idle"} size={18} tick={steps.length} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{active
            ? run.title
            : run.status === "stopped"
              ? `Stopped · ${run.title}`
              : run.status === "error"
                ? `Didn't finish · ${run.title}`
                : `Done · ${run.title}`}</span>
        <span className="font-mono text-[11.5px] tnum text-fg-3">{duration(elapsed)}</span>
        {active ? (
          <button
            onClick={() => void stop(run.id)}
            className="inline-flex h-6 items-center gap-1 rounded-xs px-1.5 text-[12px] text-fg-3 transition-colors hover:bg-bg-subtle hover:text-fg"
          >
            <Square className="size-2.5 fill-current" /> Stop
          </button>
        ) : (
          <button onClick={() => setOpen(false)} className="rounded-xs px-1.5 text-[12px] text-fg-3 hover:text-fg">
            Hide
          </button>
        )}
      </div>
      {run.status === "queued" && <p className="pl-7 text-[12px] text-fg-3">Queued behind other research. It starts automatically.</p>}
      <ul className="pl-0.5">
        {steps.slice(-8).map((s, i, arr) => (
          <StepRow key={s.id} step={s} active={active && i === arr.length - 1 && !s.doneAt} />
        ))}
      </ul>
      <AnimatePresence mode="wait">
        {active && run.thinking && (
          <motion.p
            key={run.thinking}
            initial={{ opacity: 0, filter: "blur(2px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, filter: "blur(2px)" }}
            transition={{ duration: 0.15 }}
            className="mt-1 truncate pl-[26px] font-serif text-[13.5px] italic text-fg-3"
          >
            {run.thinking}
          </motion.p>
        )}
      </AnimatePresence>
      {active && run.writingChars > 0 && (
        <p className="mt-1 pl-[26px] font-mono text-[11.5px] text-fg-3">Writing · {Math.round(run.writingChars / 5)} words</p>
      )}
      {(hosts.length > 0 || !active) && (
        <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
          {hosts.length > 0 && (
            <span className="flex -space-x-1">
              {hosts.map((h) => (
                <Favicon key={h} domain={h} size={16} className="ring-2 ring-surface" />
              ))}
            </span>
          )}
          {run.sources.length > 4 && <span className="font-mono text-[11px] text-fg-3">+{run.sources.length - 4}</span>}
          <span className="flex-1" />
          {!active && <Receipt run={run} />}
        </div>
      )}
      {run.error && run.status !== "stopped" && (
        <p className="mt-2">
          <AgentErrorNote error={run.error} />
        </p>
      )}
    </motion.div>
  );
}
