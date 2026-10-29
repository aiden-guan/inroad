"use client";

import { motion } from "motion/react";
import { ArrowRight, Sparkle } from "lucide-react";
import Link from "next/link";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Favicon } from "@/components/ui/favicon";
import { CheckStamp, DigitPop, PopNumber, TextReveal, fx } from "@/components/ui/fx";
import { InkBanner, type InkFamily } from "@/components/ui/ink-pattern";
import { Segmented } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import type { AnswerView, AskTurn } from "@/lib/domain/types";
import { ease, spring } from "@/lib/motion";

/**
 * Generative answers: an instant answer drawn as a card built for its question (the number, the week, a list of
 * deals) instead of a list. Every figure is code-computed; the card only decides how to show it. A live answer
 * assembles itself: the ink header inks in, the title rises, the number lands digit by digit, the rest follows.
 * Answers reopened from history are simply there.
 */

type Rows = NonNullable<AskTurn["instant"]>["rows"];

const compact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const usd = (n: number) => compact.format(Math.round(n));
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Delay for a beat of the assembly, or nothing when the card shouldn't play. */
const at = (play: boolean, ms: number) => (play ? ms : 0);
const rise = (play: boolean, i: number, ms = 0): { className?: string; style?: CSSProperties } => (play ? { className: "fx-rise", style: fx(i, ms) } : {});

export function AnswerCard({ view, title, rows, play, onNavigate }: { view: AnswerView; title: string; rows: Rows; play: boolean; onNavigate?: () => void }) {
  return (
    <div className="space-y-2.5">
      <Provenance facts={view.facts} domains={view.domains} play={play} />
      {view.kind === "forecast" ? (
        <ForecastCard view={view} headline={title} play={play} onNavigate={onNavigate} />
      ) : view.kind === "week" ? (
        <WeekCard view={view} play={play} onNavigate={onNavigate} />
      ) : (
        <DealsCard view={view} title={title} rows={rows} play={play} onNavigate={onNavigate} />
      )}
    </div>
  );
}

/** "Using 9 records from your workspace", with the companies it read popping in one by one. */
function Provenance({ facts, domains, play }: { facts: number; domains: string[]; play: boolean }) {
  if (!facts) return null;
  return (
    <p className={cn("flex items-center gap-2 text-[12px] text-fg-3", play && "fx-rise")}>
      <Sparkle aria-hidden className="size-3 text-accent-text" />
      <span>
        Using <span className="font-mono tnum text-fg-2">{facts}</span> {facts === 1 ? "record" : "records"} from your workspace
      </span>
      {domains.length > 0 && (
        <span className="flex -space-x-1">
          {domains.map((d, i) => (
            <motion.span
              key={d}
              initial={play ? { opacity: 0, scale: 0.4, x: -6, y: 4 } : false}
              animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
              transition={{ ...spring.pop, delay: 0.12 + i * 0.07 }}
              className="inline-flex"
            >
              <Favicon domain={d} size={16} className="ring-2 ring-bg" />
            </motion.span>
          ))}
        </span>
      )}
    </p>
  );
}

/** The card's ink header: a pattern seeded by the question that dissolves into the paper, the title set on it. */
function Header({ seed, family, eyebrow, title, play }: { seed: string; family: InkFamily; eyebrow: ReactNode; title: string; play: boolean }) {
  return (
    <InkBanner seed={seed} family={family} reveal={play} delay={80} className="h-[132px]" inkClassName="opacity-[0.2]">
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-[76px] bg-gradient-to-t from-surface from-25% via-surface/75 to-transparent" />
      <div className="relative flex h-full flex-col justify-end px-5 pb-2.5">
        <h3 className="font-serif text-[30px] leading-[34px] tracking-[-0.03em] text-fg [font-variation-settings:'opsz'_60]">
          <TextReveal text={title} play={play} delay={160} step={60} />
        </h3>
        <p className={cn("mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-3", play && "fx-rise")} style={play ? fx(0, 300) : undefined}>
          {eyebrow}
        </p>
      </div>
    </InkBanner>
  );
}

function Shell({ children, play }: { children: ReactNode; play: boolean }) {
  return <article className={cn("overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-inset ring-border", play && "fx-lift")}>{children}</article>;
}

function Hint({ children, href, cta, onNavigate, play, delay }: { children: ReactNode; href: string; cta: string; onNavigate?: () => void; play: boolean; delay: number }) {
  const r = rise(play, 0, delay);
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border bg-bg-subtle/50 px-5 py-3", r.className)} style={r.style}>
      <p className="flex min-w-0 flex-1 items-start gap-2 text-[12.5px] leading-5 text-fg-2">
        <Sparkle aria-hidden className="mt-[3px] size-3 shrink-0 text-accent-text" />
        <span className="min-w-0">{children}</span>
      </p>
      <Link href={href} onClick={onNavigate} className="group inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-fg">
        {cta}
        <ArrowRight className="size-3.5 transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}

/* ─────────────────────────────── The number ─────────────────────────────── */

type Lens = "commit" | "call" | "best";
const LENSES: { value: Lens; label: string; eyebrow: string }[] = [
  { value: "commit", label: "Commit", eyebrow: "Commit · the floor" },
  { value: "call", label: "The call", eyebrow: "The call · at category odds" },
  { value: "best", label: "Best case", eyebrow: "Best case · the ceiling" },
];

function ForecastCard({ view, headline, play, onNavigate }: { view: Extract<AnswerView, { kind: "forecast" }>; headline: string; play: boolean; onNavigate?: () => void }) {
  const [lens, setLens] = useState<Lens>("call");
  const value = lens === "commit" ? view.commit : lens === "call" ? view.call : view.bestCase;
  const meta = LENSES.find((l) => l.value === lens)!;
  const target = view.target;
  const gap = target - value;
  const scale = Math.max(target, view.pipeline, 1) * 1.04;
  const pos = (n: number) => `${Math.min(100, Math.max(0, (n / scale) * 100))}%`;
  const parts = [
    { key: "won", value: view.closedWon, className: "bg-fg" },
    { key: "commit", value: view.commit - view.closedWon, className: "bg-fg/65" },
    { key: "best", value: view.bestCase - view.commit, className: "bg-fg/35" },
    { key: "pipe", value: view.pipeline - view.bestCase, className: "bg-fg/12 bg-[repeating-linear-gradient(135deg,transparent_0_4px,rgb(127_127_127/0.14)_4px_5px)]" },
  ];
  // What sits beyond the lens dims, so the bar reads "this much, at this confidence".
  const lit = (key: string) => (lens === "commit" ? key === "won" || key === "commit" : key !== "pipe");

  return (
    <Shell play={play}>
      <Header
        seed={`${view.period}·${view.start}`}
        family="tile"
        title={view.period}
        eyebrow={`${day(view.start)} – ${day(view.end)} · ${view.weeksLeft} ${view.weeksLeft === 1 ? "week" : "weeks"} left`}
        play={play}
      />
      <div className="px-5 pb-5 pt-3">
        <p className={cn("font-mono text-[10px] uppercase tracking-[0.12em] text-fg-3", play && "fx-rise")} style={play ? fx(0, 380) : undefined}>
          {meta.eyebrow}
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5">
          <PopNumber value={value} format={usd} delay={440} still={!play} className="text-[44px] font-medium leading-[52px] tracking-[-0.045em] text-fg" />
          {target > 0 && (
            <span className={cn("text-[13px] text-fg-3", play && "fx-rise")} style={play ? fx(0, 700) : undefined}>
              of {usd(target)} ·{" "}
              <PopNumber value={Math.round((value / target) * 100)} format={(n) => `${n}%`} className="font-mono text-[12.5px] text-fg-2" delay={760} still={!play} />
            </span>
          )}
        </div>

        <div className={cn("mt-4", play && "fx-rise")} style={play ? fx(0, 560) : undefined}>
          <Segmented value={lens} onChange={setLens} options={LENSES.map(({ value: v, label }) => ({ value: v, label }))} layoutId="forecast-lens" />
        </div>

        <div className="relative mt-6 h-9" aria-hidden>
          {/* Where the lens lands: a small ink caret that glides between the three numbers. */}
          <motion.span
            className="absolute -top-3.5 z-10 -ml-[5px] block size-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-fg"
            initial={play ? { opacity: 0, y: -6, left: pos(value) } : false}
            animate={{ left: pos(value), opacity: 1, y: 0 }}
            transition={{ left: spring.glide, opacity: { duration: 0.2, delay: at(play, 1100) / 1000 }, y: { ...spring.pop, delay: at(play, 1100) / 1000 } }}
          />
          <div className={cn("absolute inset-0 flex overflow-hidden rounded-md bg-bg-subtle ring-1 ring-inset ring-border", play && "fx-wipe")} style={play ? fx(0, 640) : undefined}>
            {parts.map((p) =>
              p.value > 0 ? (
                <span key={p.key} className={cn("h-full border-r border-bg/70 transition-opacity duration-300 ease-out last:border-r-0", p.className, !lit(p.key) && "opacity-30")} style={{ width: pos(p.value) }} />
              ) : null,
            )}
          </div>
          {target > 0 && (
            <span className="pointer-events-none absolute -bottom-1.5 -top-1.5" style={{ left: pos(target) }}>
              <span className={cn("block h-full w-0.5 -translate-x-1/2 rounded-full bg-fg", play && "fx-drop")} style={play ? fx(0, 1180) : undefined} />
            </span>
          )}
        </div>
        {target > 0 && (
          <div className="relative mt-2 h-4 text-[11px]">
            <span
              className={cn("absolute whitespace-nowrap font-mono tnum text-fg-3", target / scale > 0.3 ? "-translate-x-full pr-1.5" : "pl-1.5", play && "fx-rise")}
              style={{ left: pos(target), ...(play ? fx(0, 1240) : {}) }}
            >
              Target {usd(target)}
            </span>
          </div>
        )}

        <p className={cn("mt-4 text-pretty font-serif text-[16px] leading-[24px] text-fg [font-variation-settings:'opsz'_20]", play && "fx-rise")} style={play ? fx(0, 860) : undefined}>
          {headline}
        </p>
      </div>
      <Hint href="/revenue" cta="See the plan" onNavigate={onNavigate} play={play} delay={980}>
        {target <= 0 ? (
          "No target set yet. Set one on Revenue and every number here is measured against it."
        ) : gap > 0 ? (
          <>
            <span className="font-medium text-fg">{usd(gap)}</span> short at {meta.label.toLowerCase()}
            {view.hitChance !== null && (
              <>
                {" "}
                · <span className="font-mono tnum">{Math.round(view.hitChance * 100)}%</span> chance with today&apos;s deals
              </>
            )}
            .
          </>
        ) : (
          <>
            Clears the target by <span className="font-medium text-fg">{usd(-gap)}</span> at {meta.label.toLowerCase()}.
          </>
        )}
      </Hint>
    </Shell>
  );
}

/* ─────────────────────────────── The week ─────────────────────────────── */

function Ring({ value, max, play }: { value: number; max: number; play: boolean }) {
  const pct = Math.min(1, value / Math.max(1, max));
  return (
    <span className="relative inline-flex size-[76px] shrink-0 items-center justify-center" aria-hidden>
      <svg viewBox="0 0 76 76" className="absolute inset-0 -rotate-90">
        <circle cx="38" cy="38" r="33" fill="none" stroke="var(--border)" strokeWidth="5" />
        <motion.circle
          cx="38"
          cy="38"
          r="33"
          fill="none"
          stroke="var(--fg)"
          strokeWidth="5"
          strokeLinecap="round"
          initial={play ? { pathLength: 0 } : false}
          animate={{ pathLength: pct }}
          transition={{ duration: 1, ease: ease.out, delay: at(play, 520) / 1000 }}
        />
      </svg>
      <span className="font-mono text-[11px] tnum text-fg-3">{Math.round(pct * 100)}%</span>
    </span>
  );
}

function Meter({ label, value, max, note, tone, play, i }: { label: string; value: number; max?: number; note?: string; tone?: "warn"; play: boolean; i: number }) {
  const r = rise(play, i, 620);
  return (
    <div className={cn("min-w-0 rounded-lg bg-bg-subtle/60 px-3 py-2.5 ring-1 ring-inset ring-border/70", r.className)} style={r.style}>
      <p className="truncate text-[11.5px] text-fg-3">{label}</p>
      <p className="mt-0.5 flex items-baseline gap-1">
        <DigitPop text={String(value)} delay={700 + i * 60} still={!play} className={cn("text-[22px] font-medium leading-7 tracking-[-0.03em]", tone === "warn" && value > 0 ? "text-warning" : "text-fg")} />
        {max !== undefined && <span className="font-mono text-[11px] text-fg-3">/ {max}</span>}
        {note && <span className="truncate text-[11.5px] text-fg-3">{note}</span>}
      </p>
      {max !== undefined && (
        <span className="progress-track mt-2 block">
          <motion.span
            className="block h-full origin-left rounded-[inherit] bg-fg-2"
            initial={play ? { scaleX: 0 } : false}
            animate={{ scaleX: Math.min(1, value / Math.max(1, max)) }}
            transition={{ duration: 0.8, ease: ease.out, delay: at(play, 760 + i * 60) / 1000 }}
          />
        </span>
      )}
    </div>
  );
}

function WeekCard({ view, play, onNavigate }: { view: Extract<AnswerView, { kind: "week" }>; play: boolean; onNavigate?: () => void }) {
  const [held, target] = view.conversations;
  const togo = Math.max(0, target - held);
  return (
    <Shell play={play}>
      <Header seed={`week·${view.weekOf}`} family="waves" title="This week" eyebrow={`Week of ${day(view.weekOf)}`} play={play} />
      <div className="px-5 pb-5 pt-3">
        <div className="flex items-center gap-4">
          <Ring value={held} max={target} play={play} />
          <div className="min-w-0">
            <p className={cn("font-mono text-[10px] uppercase tracking-[0.12em] text-fg-3", play && "fx-rise")} style={play ? fx(0, 380) : undefined}>
              Conversations held
            </p>
            <p className="flex items-baseline gap-2">
              <DigitPop text={String(held)} delay={440} still={!play} className="text-[44px] font-medium leading-[52px] tracking-[-0.045em] text-fg" />
              <span className="text-[13px] text-fg-3">of {target} this week</span>
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Meter label="Cold first touches" value={view.firstTouches[0]} max={view.firstTouches[1]} play={play} i={0} />
          <Meter label="Replies" value={view.replies} note={view.positiveReplies ? `${view.positiveReplies} positive` : undefined} play={play} i={1} />
          <Meter label="Qualified deals" value={view.qualified} play={play} i={2} />
          <Meter label="Missing a next step" value={view.missingNextStep} tone="warn" play={play} i={3} />
        </div>
        <div className={cn("mt-3 flex items-center gap-3 text-[12.5px] text-fg-2", play && "fx-rise")} style={play ? fx(0, 900) : undefined}>
          <span className="shrink-0 text-fg-3">Goal</span>
          <span className="progress-track min-w-0 flex-1">
            <motion.span
              className="block h-full origin-left rounded-[inherit] bg-fg"
              initial={play ? { scaleX: 0 } : false}
              animate={{ scaleX: Math.min(1, view.goal[0] / Math.max(1, view.goal[1])) }}
              transition={{ duration: 0.9, ease: ease.out, delay: at(play, 980) / 1000 }}
            />
          </span>
          <span className="shrink-0 font-mono text-[11.5px] tnum">
            {view.goal[0]} / {view.goal[1]} {view.goalLabel}
          </span>
        </div>
      </div>
      <Hint href="/today" cta="Open Today" onNavigate={onNavigate} play={play} delay={1040}>
        {togo > 0 ? (
          <>
            <span className="font-medium text-fg">{togo}</span> {togo === 1 ? "conversation" : "conversations"} to go this week. Today&apos;s moves are the shortest path.
          </>
        ) : (
          "On pace for the week. Keep the follow-ups moving."
        )}
      </Hint>
    </Shell>
  );
}

/* ─────────────────────────────── A list of deals ─────────────────────────────── */

const TONES: Record<Extract<AnswerView, { kind: "deals" }>["tone"], { title: string; eyebrow: string; family: InkFamily; empty: string; unit: string }> = {
  risk: { title: "At risk", eyebrow: "Risks on file · worst first", family: "lattice", empty: "No open deal has a risk on file", unit: "on the line" },
  missing: { title: "No next step", eyebrow: "No dated next step", family: "arches", empty: "Every open deal has a dated next step", unit: "waiting on a date" },
  stale: { title: "Gone quiet", eyebrow: "14 days or more without activity", family: "waves", empty: "Nothing has gone quiet", unit: "going cold" },
  pipeline: { title: "Open pipeline", eyebrow: "Every open deal · latest stage first", family: "tile", empty: "No open deals yet", unit: "in play" },
};

function DealsCard({ view, title, rows, play, onNavigate }: { view: Extract<AnswerView, { kind: "deals" }>; title: string; rows: Rows; play: boolean; onNavigate?: () => void }) {
  const tone = TONES[view.tone];
  return (
    <Shell play={play}>
      <Header seed={`deals·${view.tone}`} family={tone.family} title={tone.title} eyebrow={tone.eyebrow} play={play} />
      <div className="px-5 pb-4 pt-3">
        {view.count === 0 ? (
          <p className="flex items-center gap-2.5 py-2 text-[14px] text-fg">
            <CheckStamp size={20} still={!play} />
            {tone.empty}.
          </p>
        ) : (
          <p className="flex flex-wrap items-baseline gap-x-2.5">
            <DigitPop text={String(view.count)} delay={420} still={!play} className="text-[44px] font-medium leading-[52px] tracking-[-0.045em] text-fg" />
            <span className="text-[13px] text-fg-3">
              {view.count === 1 ? "deal" : "deals"}
              {view.usd > 0 && (
                <>
                  {" "}
                  · <span className="font-mono text-fg-2">{usd(view.usd)}</span> {tone.unit}
                </>
              )}
            </span>
          </p>
        )}
        {/* The stage breakdown says something the count doesn't; the other titles just repeat it. */}
        {view.tone === "pipeline" && view.count > 0 && (
          <p className={cn("mt-0.5 text-[13px] text-fg-2", play && "fx-rise")} style={play ? fx(0, 560) : undefined}>
            {title}
          </p>
        )}
      </div>
      {rows.length > 0 && (
        <ul className="divide-y divide-border border-t border-border">
          {rows.map((r, i) => {
            const body = (
              <>
                {r.domain ? <Favicon domain={r.domain} name={r.label} size={16} /> : <span className="size-1.5 shrink-0 rounded-full bg-fg-4" />}
                <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-2">
                  <span className="block truncate text-[13.5px] text-fg sm:max-w-[42%] sm:shrink-0">{r.label}</span>
                  {r.detail && <span className="block truncate text-[12.5px] text-fg-3">{r.detail}</span>}
                </span>
                {r.href && <ArrowRight aria-hidden className="size-3.5 shrink-0 -translate-x-1 text-fg-4 opacity-0 transition-[opacity,transform] duration-200 ease-out group-hover:translate-x-0 group-hover:opacity-100" />}
              </>
            );
            const r_ = rise(play, Math.min(i, 8), 620);
            return (
              <li key={i} className={r_.className} style={r_.style}>
                {r.href ? (
                  <Link href={r.href} onClick={onNavigate} className="group flex min-h-11 items-center gap-2.5 px-5 py-2 transition-colors hover:bg-bg-subtle focus-visible:bg-bg-subtle">
                    {body}
                  </Link>
                ) : (
                  <div className="flex min-h-11 items-center gap-2.5 px-5 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}
