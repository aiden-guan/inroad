"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Compass } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useActiveRuns, useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { isConsumer } from "@/lib/consumer/market";
import type { Action } from "@/lib/domain/actions";
import { addDays, todayISO, weekOf } from "@/lib/domain/ids";
import type { Brief, Move, MoveKind, SkipReason, Workspace } from "@/lib/domain/types";
import { codeGreeting, movesHeading } from "@/lib/moves/brief-data";
import { KIND_ORDER, TOP_MOVES, visibleMoves } from "@/lib/moves/rules";
import { computeScoreboard } from "@/lib/moves/scoreboard";
import { daysSince, plural } from "@/lib/moves/util";
import { ease, spring } from "@/lib/motion";
import type { CheckRepliesHandle } from "./check-replies";
import { Masthead } from "./masthead";
import { MoveCard } from "./move-card";
import { cardDraft, endsInBody } from "./move-body";
import { KIND_LABELS, Keys, RunInline, SKIP_REASONS } from "./parts";
import { ReviewDoc } from "./review-panel";
import { useClock, usePrepare, useReveal } from "./use-today";

/** Today: "what should I do in the next 90 minutes?" One number, at most five moves, then Later. */
export function TodayView() {
  const { ws, error, refresh } = useWorkspace();
  if (!ws) {
    return error ? (
      <Column>
        <EmptyState
          title="Couldn't load your workspace"
          body={`${error} Your data is still on this machine.`}
          action={
            <Button variant="primary" onClick={() => void refresh()}>
              Try again
            </Button>
          }
        />
      </Column>
    ) : (
      <TodaySkeleton />
    );
  }
  return <Today ws={ws} />;
}

function Column({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[800px] px-6 pb-24 pt-8 md:px-10 md:pt-12 xl:max-w-[1040px] xl:pr-[280px]", className)}>{children}</div>;
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

type Exit = "done" | "skip";

/** The desk itself, once the workspace has loaded. */
export function Today({ ws }: { ws: Workspace }) {
  const { dispatch } = useWorkspace();
  const now = useClock(60_000);
  const today = todayISO(new Date(now));
  const weekStart = weekOf(today);
  const phase = useReveal(today);
  const reveal = phase === "reveal";
  const { prepare, schedule, error } = usePrepare();
  const [refreshing, setRefreshing] = useState(false);
  const activeRuns = useActiveRuns();
  const { runs } = useRuns();
  // A dossier or discovery run landing changes the desk (the first three's drafts start once their research is in, and
  // research that failed must stop reading as "researching"): re-prepare now instead of on the five-minute timer.
  // Runs already finished when Today opened don't count.
  const landed = useRef<Set<string> | null>(null);
  useEffect(() => {
    const done = Object.values(runs).filter((r) => (r.workflow === "dossier" && r.status !== "running" && r.status !== "queued") || (r.workflow === "discovery" && r.status === "done"));
    if (!landed.current) {
      landed.current = new Set(done.map((r) => r.id));
      return;
    }
    const fresh = done.filter((r) => !landed.current!.has(r.id));
    for (const r of fresh) landed.current.add(r.id);
    if (fresh.length) schedule(300);
  }, [runs, schedule]);
  const briefWorking = activeRuns.some((r) => r.workflow === "brief");
  // Day one's "While that runs" is only true while discovery is actually looking.
  const discovering = activeRuns.some((r) => r.workflow === "discovery");

  const [expandedId, setExpandedId] = useState<string | null>(null);
  // The open card stays put until the founder collapses or finishes it, even once its own work resolved it
  // (the last reply marked, the dossier landed), so its summary and next step stay reachable.
  const visible = useMemo(() => {
    const v = visibleMoves(ws.moves, today);
    const held = expandedId ? ws.moves[expandedId] : undefined;
    if (!held || v.some((m) => m.id === held.id)) return v;
    return [...v, held].sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
  }, [ws.moves, today, expandedId]);
  const top = visible.slice(0, TOP_MOVES);
  const laterGroups = useMemo(() => {
    const rest = visible.slice(TOP_MOVES);
    const byKind = new Map<MoveKind, Move[]>();
    for (const m of rest) byKind.set(m.kind, [...(byKind.get(m.kind) ?? []), m]);
    return [...byKind.entries()].sort((a, b) => KIND_ORDER.indexOf(a[0]) - KIND_ORDER.indexOf(b[0]));
  }, [visible]);
  const laterCount = visible.length - top.length;
  const [laterOpen, setLaterOpen] = useState(false);
  const nav = useMemo(() => (laterOpen ? [...top, ...laterGroups.flatMap(([, ms]) => ms)] : top), [laterOpen, top, laterGroups]);

  const [focusId, setFocusId] = useState<string | null>(null);
  const [skipFor, setSkipFor] = useState<string | null>(null);
  const [exits, setExits] = useState<Record<string, Exit>>({});
  const headers = useRef(new Map<string, HTMLButtonElement>());
  const repliesHandle = useRef<CheckRepliesHandle>(null);
  const lastG = useRef(0);

  // ⌘K "Check replies" lands here: ?open=<move kind> on arrival, or an event when Today is already open.
  // The move opens as soon as it exists (the day's first prepare makes it), folded under Later or not.
  const [wanted, setWanted] = useState<MoveKind | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => setWanted((e as CustomEvent<MoveKind>).detail);
    window.addEventListener("inroad:today-open", onOpen);
    const asked = new URLSearchParams(window.location.search).get("open");
    if (asked) {
      window.history.replaceState(null, "", window.location.pathname);
      window.dispatchEvent(new CustomEvent("inroad:today-open", { detail: asked }));
    }
    return () => window.removeEventListener("inroad:today-open", onOpen);
  }, []);
  const wantedMove = wanted ? visible.find((m) => m.kind === wanted) : undefined;
  if (wantedMove) {
    setWanted(null);
    setExpandedId(wantedMove.id);
    setFocusId(wantedMove.id);
    if (!top.some((m) => m.id === wantedMove.id)) setLaterOpen(true);
  }
  useEffect(() => {
    if (expandedId) headers.current.get(expandedId)?.scrollIntoView({ block: "nearest" });
  }, [expandedId]);

  const scoreboard = useMemo(() => computeScoreboard(ws, new Date(now)), [ws, now]);
  const brief = ws.briefs[today];
  const greeting = brief?.greeting || codeGreeting(ws, visible, new Date(now));
  const dateLabel = new Date(now).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const minutes = top.reduce((n, m) => n + m.minutes, 0);

  const focusMove = (id: string | undefined) => {
    if (!id) return;
    setFocusId(id);
    const el = headers.current.get(id);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest" });
  };

  const finish = async (move: Move, how: "done" | "skip" | "snooze", opts: { reason?: SkipReason; quiet?: boolean; until?: string } = {}) => {
    setExits((e) => ({ ...e, [move.id]: how === "done" ? "done" : "skip" }));
    const idx = nav.findIndex((m) => m.id === move.id);
    const next = nav[idx + 1] ?? nav[idx - 1];
    setSkipFor(null);
    if (expandedId === move.id) setExpandedId(null);
    if (focusId === move.id) {
      setFocusId(next?.id ?? null);
      if (next) requestAnimationFrame(() => headers.current.get(next.id)?.focus({ preventScroll: true }));
    }
    const action: Action =
      how === "done"
        ? { type: "move.done", id: move.id }
        : how === "skip"
          ? { type: "move.skip", id: move.id, reason: opts.reason ?? "other" }
          : { type: "move.snooze", id: move.id, until: opts.until ?? addDays(today, 1) };
    // A draft skipped as "tone off" teaches the voice card what not to write.
    const draft = how === "skip" && opts.reason === "tone_off" ? cardDraft(ws, move) : undefined;
    const offText = draft?.steps.find((st) => st.status === "draft")?.body;
    const ok = await dispatch(offText ? [action, { type: "voice.noteToneOff", text: offText, at: new Date().toISOString(), moveId: move.id }] : action);
    schedule();
    if (!ok || opts.quiet) return;
    const undo = {
      label: "Undo",
      onClick: () => {
        void dispatch({ type: "move.reopen", id: move.id }).then(() => schedule(200));
      },
    };
    if (how === "skip") toast(`Noted: ${SKIP_REASONS.find((r) => r.id === opts.reason)?.noted ?? "skipped"}.`, { action: undo });
    else if (how === "snooze") toast("Moved to tomorrow.", { action: undo });
    else toast("Done.", { action: undo });
  };

  // Keyboard: J/K move, Enter opens (native, on the focused card), A done, X skip, S tomorrow, Esc closes.
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
    if (document.querySelector('[role="dialog"]')) return; // palette, Ask or a sheet owns the keyboard
    if (e.key.toLowerCase() === "g") {
      lastG.current = e.timeStamp;
      return;
    }
    if (lastG.current && e.timeStamp - lastG.current < 1200) {
      lastG.current = 0; // "G then S" belongs to navigation
      return;
    }
    const expanded = expandedId ? visible.find((m) => m.id === expandedId) : undefined;
    if (expanded?.kind === "check_replies" && repliesHandle.current?.handleKey(e)) {
      e.preventDefault();
      return;
    }
    const current = nav.find((m) => m.id === focusId);
    if (skipFor) {
      const n = Number(e.key);
      const target = visible.find((m) => m.id === skipFor);
      if (target && n >= 1 && n <= SKIP_REASONS.length) {
        e.preventDefault();
        void finish(target, "skip", { reason: SKIP_REASONS[n - 1].id });
        return;
      }
      if (e.key === "Escape") {
        setSkipFor(null);
        return;
      }
    }
    const k = e.key.toLowerCase();
    if (k === "j" || k === "k") {
      if (!nav.length) return;
      e.preventDefault();
      const i = current ? nav.indexOf(current) : -1;
      focusMove(nav[k === "j" ? Math.min(nav.length - 1, i + 1) : Math.max(0, i === -1 ? 0 : i - 1)]?.id);
      return;
    }
    if (!current) return;
    if (k === "a") {
      // A draft's composer approves; a booking card marks its nudge as sent. Closed, A opens them.
      const showsDraft = !!cardDraft(ws, current) || endsInBody(current);
      if (showsDraft && expandedId === current.id) return; // DraftView approves, BookBody logs the nudge
      e.preventDefault();
      if (showsDraft) setExpandedId(current.id);
      else void finish(current, "done");
    } else if (k === "x") {
      e.preventDefault();
      setSkipFor(current.id);
    } else if (k === "s") {
      e.preventDefault();
      void finish(current, "snooze");
    } else if (e.key === "Escape") {
      if (expandedId) setExpandedId(null);
      else {
        setFocusId(null);
        (document.activeElement as HTMLElement | null)?.blur();
      }
    }
  };
  const keyRef = useRef(onKey);
  useEffect(() => {
    keyRef.current = onKey;
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const card = (m: Move, i: number) => (
    <motion.li
      key={m.id}
      layout="position"
      custom={exits}
      variants={{
        exit: (all: Record<string, Exit>) =>
          all[m.id] === "skip"
            ? { opacity: 0, scale: 0.98, transition: { duration: 0.15, ease: ease.inQuad } }
            : { opacity: 0, x: 24, transition: { duration: 0.2, ease: ease.inQuad } },
      }}
      initial={reveal ? { opacity: 0, y: 6 } : { opacity: 0 }}
      animate={{ opacity: 1, y: 0, x: 0, scale: 1, transition: reveal ? { duration: 0.28, ease: ease.out, delay: 0.15 + Math.min(i, 8) * 0.04 } : { duration: 0.15 } }}
      exit="exit"
      transition={spring.layout}
      onPointerDownCapture={() => setFocusId(m.id)}
    >
      <MoveCard
        move={m}
        ws={ws}
        now={now}
        today={today}
        weekStart={weekStart}
        focused={focusId === m.id}
        expanded={expandedId === m.id}
        skipOpen={skipFor === m.id}
        bindHeader={(el) => {
          if (el) headers.current.set(m.id, el);
          else headers.current.delete(m.id);
        }}
        repliesHandle={m.kind === "check_replies" ? repliesHandle : undefined}
        onFocus={() => setFocusId(m.id)}
        onToggle={() => {
          setFocusId(m.id);
          setExpandedId((id) => (id === m.id ? null : m.id));
        }}
        onDone={() => void finish(m, "done", { quiet: true })}
        onMarkDone={() => void finish(m, "done")}
        onSnoozeUntil={(until) => void finish(m, "snooze", { quiet: true, until })}
        onSkipOpen={() => setSkipFor(m.id)}
        onSkip={(reason) => void finish(m, "skip", { reason })}
        onSkipCancel={() => setSkipFor(null)}
        onSnooze={() => void finish(m, "snooze")}
        onChanged={() => schedule(200)}
      />
    </motion.li>
  );

  const list = (moves: Move[], offset = 0) => (
    <ul className="relative space-y-2">
      <AnimatePresence mode="popLayout" initial={reveal} custom={exits}>
        {moves.map((m, i) => card(m, offset + i))}
      </AnimatePresence>
    </ul>
  );

  const consumer = isConsumer(ws);
  // A consumer Today starts from its own moves (numbers, user conversations, creators), not from finding companies.
  const dayOne = !consumer && Object.keys(ws.accounts).length === 0;
  const worth = Object.values(ws.accounts).filter((a) => a.status !== "disqualified" && a.signals.some((s) => s.strength >= 2 && daysSince(s.date, today) <= 14)).length;
  const weekReviews = Object.values(ws.briefs)
    .filter((b) => b.review && (b.reviewKind === "monday" || b.reviewKind === "friday" || b.reviewKind === "growth") && b.date >= weekStart && !visible.some((m) => m.id === `mv_review_${b.reviewKind}_${weekStart}`))
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Column>
      <div key={phase === "skipped" ? "final" : "live"}>
        <Masthead
          ws={ws}
          dateLabel={dateLabel}
          brief={brief}
          greeting={greeting}
          scoreboard={scoreboard}
          reveal={reveal}
          working={briefWorking}
          preparing={refreshing}
          error={error}
          onRefresh={() => {
            setRefreshing(true);
            void prepare("refresh").finally(() => setRefreshing(false));
          }}
        />

        <section className="mt-10" aria-label="Your moves">
          {dayOne && <DayOne warm={!!ws.network} networkCard={visible.some((m) => m.rule === "today.network")} />}
          {visible.length === 0 ? (
            !dayOne && (consumer ? <CaughtUpConsumer /> : <CaughtUp worth={worth} />)
          ) : (
            <div className={cn(dayOne && "mt-6")}>
              <SectionLabel right={<span className="font-mono text-[11.5px] tnum text-fg-3">about {minutes} min</span>}>{movesHeading({ dayOne, discovering })}</SectionLabel>
              {list(top)}
            </div>
          )}
        </section>

        {laterCount > 0 && (
          <section className="mt-8" aria-label="Later">
            <button
              onClick={() => setLaterOpen((o) => !o)}
              aria-expanded={laterOpen}
              className="inline-flex h-8 items-center gap-1.5 rounded-sm px-1.5 -ml-1.5 text-[13px] font-medium text-fg-2 transition-colors hover:bg-bg-subtle hover:text-fg"
            >
              <ChevronRight className={cn("size-3.5 transition-transform duration-150", laterOpen && "rotate-90")} />
              Later
              <span className="font-mono text-[12px] tnum text-fg-3">({laterCount})</span>
            </button>
            {laterOpen && (
              <div className="mt-3 space-y-5">
                {laterGroups.map(([kind, moves]) => (
                  <div key={kind}>
                    <SectionLabel>{KIND_LABELS[kind]}</SectionLabel>
                    {list(moves, TOP_MOVES)}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {weekReviews[0] && <WeekCard ws={ws} review={weekReviews[0]} kind={weekReviews[0].reviewKind === "monday" || weekReviews[0].reviewKind === "growth" ? weekReviews[0].reviewKind : "friday"} />}

        {visible.length > 0 && (
          <Keys
            className="mt-12"
            items={[
              ["J", "next"],
              ["K", "previous"],
              ["Enter", "open"],
              ["A", "done"],
              ["X", "skip"],
              ["S", "tomorrow"],
              ["Esc", "close"],
            ]}
          />
        )}
      </div>
    </Column>
  );
}

/** A quiet card for this week's review once it has run (the review move itself is gone). */
function WeekCard({ ws, review, kind }: { ws: Workspace; review: Brief; kind: "monday" | "friday" | "growth" }) {
  const [open, setOpen] = useState(false);
  const headline = (review.review ?? "").split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "";
  const open_ = (review.proposals ?? []).filter((p) => p.status === "open").length;
  return (
    <section className="mt-10" aria-label="This week">
      <SectionLabel>This week</SectionLabel>
      <div className="rounded-lg bg-bg-subtle/60 ring-1 ring-border">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-3 text-left">
          <ChevronRight className={cn("mt-1 size-3.5 shrink-0 text-fg-3 transition-transform duration-150", open && "rotate-90")} />
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-medium text-fg">
              {kind === "monday" ? "Pipeline review" : kind === "growth" ? "Growth review" : "Learning review"}
              {open_ > 0 && <span className="font-normal text-fg-3"> · {plural(open_, "proposal")} to decide</span>}
            </span>
            {headline && <span className="mt-0.5 block font-serif text-[15px] leading-[23px] text-fg-2">{headline}</span>}
          </span>
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0, transition: { duration: 0.15 } }} transition={spring.smooth} className="overflow-hidden">
              <div className="border-t border-border px-4 pb-4 pt-4">
                <ReviewDoc ws={ws} review={review} kind={kind} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

/** Day one, no companies yet. Warm-first only once there's a network to start from; until then, say how to get one. */
/** `networkCard`: "Bring in your network" is on the desk below, so the import is asked for there, once. */
function DayOne({ warm, networkCard }: { warm: boolean; networkCard: boolean }) {
  const askImport = !warm && !networkCard;
  return (
    <EmptyState
      icon={<Compass className="size-6" />}
      title="Find your first prospects"
      body={
        warm
          ? "Start with companies where you have a connection. Inroad researches each prospect and prepares outreach for your review."
          : "Find companies, review outreach drafts, then send from your inbox."
      }
      action={
        <div className="flex flex-col items-center gap-3">
          <RunInline workflow="discovery" args={{ count: 3, source: "manual" }} label="Find my first prospects" hint="About 2 minutes" />
          {askImport && (
            <Link href="/integrations?import=linkedin" className="text-[13px] text-fg-2 underline-offset-4 hover:text-fg hover:underline">
              Import LinkedIn connections
            </Link>
          )}
        </div>
      }
    />
  );
}

function CaughtUp({ worth }: { worth: number }) {
  return (
    <EmptyState
      title="Nothing needs you right now"
      body={worth ? `${plural(worth, "company", "companies")} had a fresh signal this fortnight. Worth a look when you have time.` : "No replies, meetings or follow-ups are waiting. A good time to add a few companies to talk to."}
      action={<RunInline workflow="discovery" args={{ source: "manual" }} label="Find more companies" variant="secondary" />}
    />
  );
}

function CaughtUpConsumer() {
  return (
    <EmptyState
      title="Nothing needs you right now"
      body="Your growth actions are up to date. Find creators and communities to reach more users."
      action={<RunInline workflow="partners" args={{ mode: "find", count: 8, source: "founder" }} runRef={{ kind: "playbook", id: "partners" }} label="Find creators and communities" variant="secondary" />}
    />
  );
}

/** Matches the final layout; appears only after 150ms so fast loads never flash. */
function TodaySkeleton() {
  return (
    <Column className="opacity-0 animate-[fade-in_150ms_var(--ease-out)_150ms_forwards]">
      <Skeleton className="h-11 w-72 max-w-full md:h-[52px]" />
      <Skeleton className="mt-4 h-6 w-96 max-w-full" />
      <Skeleton className="mt-7 h-4 w-80 max-w-full" />
      <div className="mt-12 space-y-2">
        <Skeleton className="mb-3 h-3 w-20" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-start gap-3 rounded-lg bg-surface px-4 py-3 ring-1 ring-border">
            <Skeleton className="size-4" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3.5 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    </Column>
  );
}
