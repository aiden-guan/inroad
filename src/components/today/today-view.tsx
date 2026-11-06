"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronRight, Compass } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useActiveRuns, useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { SectionLabel } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { LoadingSignal } from "@/components/ui/loading";
import { PageContainer } from "@/components/ui/page-header";
import { PageState } from "@/components/ui/page-state";
import { cn } from "@/lib/client/cn";
import { isConsumer } from "@/lib/consumer/market";
import type { Action } from "@/lib/domain/actions";
import { addDays, newId, nowISO, todayISO, weekOf } from "@/lib/domain/ids";
import type { Brief, EntityRef, Move, MoveKind, ReplyIntent, SkipReason, Workspace } from "@/lib/domain/types";
import { wouldLearn } from "@/lib/learning/targeting";
import { codeGreeting, movesHeading } from "@/lib/moves/brief-data";
import { deskLayout, deskProgress, nextUp, progressLine, waitFor } from "@/lib/moves/desk";
import { northStar } from "@/lib/moves/north-star";
import { KIND_ORDER, visibleMoves } from "@/lib/moves/rules";
import { sinceFacts } from "@/lib/moves/since";
import { daysSince, emailOf, first, plural, shortDay } from "@/lib/moves/util";
import { laneRows, type LaneActionId, type LaneRow } from "@/lib/replies/lane";
import { ease, spring } from "@/lib/motion";
import type { CheckRepliesHandle } from "./check-replies";
import { DeskEnd } from "./end-state";
import { LearnedButton } from "./learned";
import { Masthead, type Target } from "./masthead";
import { MoveCard, MoveExits } from "./move-card";
import { cardDraft, endsInBody, writesNote } from "./move-body";
import { KIND_LABELS, Keys, RunInline, SKIP_REASONS } from "./parts";
import { RepliesLane, referralActions } from "./replies-lane";
import { ReviewDoc } from "./review-panel";
import { useClock, usePrepare, useReveal, useSinceLastVisit } from "./use-today";
import { WaitingOn } from "./waiting";

/** Today: "what should I do in the next 90 minutes?" Replies first, at most five moves, every overdue one, then Later. */
export function TodayView() {
  const { ws, error, refresh } = useWorkspace();
  if (!ws) {
    return error ? (
      <Column>
        <PageState kind="error" title="Couldn't load your workspace" body="Your data is still on this machine." detail={error} onRetry={refresh} />
      </Column>
    ) : (
      <TodaySkeleton />
    );
  }
  return <Today ws={ws} />;
}

function Column({ children, className }: { children: React.ReactNode; className?: string }) {
  // The right padding at xl is the margin the masthead's source notes hang in; the feed column keeps its width inside.
  return (
    <PageContainer className={cn("xl:pr-[280px]", className)}>
      <div className="max-w-[820px]">{children}</div>
    </PageContainer>
  );
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

type Exit = "done" | "skip";
const UNTIL_REPLY_DAYS = 30;

/** The desk itself, once the workspace has loaded. */
export function Today({ ws }: { ws: Workspace }) {
  const { dispatch } = useWorkspace();
  const { start } = useRuns();
  const reduceMotion = useReducedMotion();
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
  const desk = useMemo(() => deskLayout(visible, ws), [visible, ws]);
  const rows = useMemo(() => laneRows(ws, desk.replies, new Date(now)), [ws, desk.replies, now]);
  const { top, overdue } = desk;
  const laterGroups = useMemo(() => {
    const byKind = new Map<MoveKind, Move[]>();
    for (const m of desk.later) byKind.set(m.kind, [...(byKind.get(m.kind) ?? []), m]);
    return [...byKind.entries()].sort((a, b) => KIND_ORDER.indexOf(a[0]) - KIND_ORDER.indexOf(b[0]));
  }, [desk.later]);
  const laterCount = desk.later.length;
  const [laterOpen, setLaterOpen] = useState(false);
  const [laneOpen, setLaneOpen] = useState(true);
  const nav = useMemo(
    () => [...(laneOpen ? rows.map((r) => r.move) : []), ...top, ...overdue, ...(laterOpen ? laterGroups.flatMap(([, ms]) => ms) : [])],
    [laneOpen, rows, top, overdue, laterOpen, laterGroups],
  );

  const [focusId, setFocusId] = useState<string | null>(null);
  const [skipFor, setSkipFor] = useState<string | null>(null);
  const [exits, setExits] = useState<Record<string, Exit>>({});
  const headers = useRef(new Map<string, HTMLButtonElement>());
  const deskRef = useRef<HTMLDivElement>(null);
  const repliesHandle = useRef<CheckRepliesHandle>(null);
  const lastG = useRef(0);

  // ⌘K "Check replies" lands here: ?open=<move kind> on arrival, or an event when Today is already open.
  // ?reply=<activity id> opens that reply in the lane. Either opens as soon as it exists, folded under Later or not.
  const [wanted, setWanted] = useState<{ kind?: MoveKind; reply?: string } | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<MoveKind | { reply: string }>).detail;
      setWanted(typeof detail === "string" ? { kind: detail } : detail);
    };
    window.addEventListener("inroad:today-open", onOpen);
    const params = new URLSearchParams(window.location.search);
    const asked = params.get("open");
    const reply = params.get("reply");
    if (asked || reply) {
      window.history.replaceState(null, "", window.location.pathname);
      window.dispatchEvent(new CustomEvent("inroad:today-open", { detail: reply ? { reply } : asked }));
    }
    return () => window.removeEventListener("inroad:today-open", onOpen);
  }, []);
  const wantedMove = wanted ? visible.find((m) => (wanted.reply ? m.activityId === wanted.reply && m.kind === "reply" : m.kind === wanted.kind)) : undefined;
  if (wantedMove) {
    setWanted(null);
    setExpandedId(wantedMove.id);
    setFocusId(wantedMove.id);
    if (wantedMove.kind === "reply") setLaneOpen(true);
    else if (!top.some((m) => m.id === wantedMove.id) && !overdue.some((m) => m.id === wantedMove.id)) setLaterOpen(true);
  }

  /** Keeps an opened card's body in view once it has finished opening. Instant with reduced motion. */
  const revealCard = (id: string) => {
    const el = document.querySelector<HTMLElement>(`[data-move="${CSS.escape(id)}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const behavior = reduceMotion ? "auto" : "smooth";
    if (r.height > window.innerHeight - 120) el.scrollIntoView({ block: "start", behavior });
    else if (r.bottom > window.innerHeight - 16 || r.top < 64) el.scrollIntoView({ block: "nearest", behavior });
  };
  // Opening something from elsewhere (a brief line, a since-fact, ?reply=) scrolls to it at once.
  const pendingScroll = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingScroll.current;
    if (!id || expandedId !== id) return;
    pendingScroll.current = null;
    requestAnimationFrame(() => headers.current.get(id)?.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" }));
  }, [expandedId, reduceMotion]);

  const open = (id: string, opts: { scroll?: boolean } = {}) => {
    const m = visible.find((x) => x.id === id);
    if (!m) return;
    if (m.kind === "reply") setLaneOpen(true);
    else if (desk.later.some((x) => x.id === id)) setLaterOpen(true);
    setFocusId(id);
    setExpandedId(id);
    if (opts.scroll) pendingScroll.current = id;
    requestAnimationFrame(() => headers.current.get(id)?.focus({ preventScroll: true }));
  };

  // Single-key shortcuts only act while focus is on the desk (WCAG 2.1.4): the first card takes focus on arrival, so
  // J works at once, and clicking elsewhere on the page hands the keys back.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || !nav.length) return;
    arrived.current = true;
    const active = document.activeElement;
    if (active && active !== document.body && active.id !== "main-content") return;
    // The header's own onFocus marks it focused.
    headers.current.get(nav[0].id)?.focus({ preventScroll: true });
  }, [nav]);

  const star = useMemo(() => northStar(ws, new Date(now)), [ws, now]);
  const { base, markSeen } = useSinceLastVisit(ws);
  const since = useMemo(() => (base === undefined ? null : sinceFacts(ws, base, new Date(now))), [ws, base, now]);
  const brief = ws.briefs[today];
  const greeting = brief?.greeting || codeGreeting(ws, visible, new Date(now));
  const dateLabel = new Date(now).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const minutes = [...top, ...overdue].reduce((n, m) => n + m.minutes, 0);
  const progress = useMemo(() => deskProgress(ws.moves, visible, today), [ws.moves, visible, today]);

  // The inbox-zero moment plays when the founder clears the last card in this session, never on arrival.
  const deskCount = rows.length + top.length + overdue.length + laterCount;
  const [hadWork, setHadWork] = useState(false);
  if (deskCount > 0 && !hadWork) setHadWork(true);
  const justCleared = hadWork && deskCount === 0;

  /**
   * The card or page a brief line or a since-fact points to: a reply in the lane, the card about that exact record,
   * else (`loose`, for the brief's sentences) the card about that company, else the company's page.
   */
  const targetOf = (x: { ref?: EntityRef; domain?: string; replyIds?: string[]; loose?: boolean }): Target => {
    if (x.replyIds?.length) {
      const row = rows.find((r) => x.replyIds!.includes(r.reply.id));
      return row ? { moveId: row.move.id } : { href: x.domain ? `/companies?c=${encodeURIComponent(x.domain)}` : undefined };
    }
    const ref = x.ref;
    const domainOf = (m: Move) =>
      m.ref?.kind === "account" ? m.ref.id : m.ref?.kind === "person" ? ws.people[m.ref.id]?.accountDomain : m.ref?.kind === "deal" ? ws.deals[m.ref.id]?.accountDomain : m.ref?.kind === "meeting" ? ws.deals[ws.meetings[m.ref.id]?.dealId ?? ""]?.accountDomain : undefined;
    const same = (m: Move) => !!ref && !!m.ref && m.ref.kind === ref.kind && m.ref.id === ref.id;
    const covers = (m: Move) => !!ref && ref.kind === "deal" && (m.subjectIds ?? []).includes(ref.id);
    const refDomain = ref?.kind === "account" ? ref.id : ref?.kind === "person" ? ws.people[ref.id]?.accountDomain : ref?.kind === "deal" ? ws.deals[ref.id]?.accountDomain : ref?.kind === "meeting" ? ws.deals[ws.meetings[ref.id]?.dealId ?? ""]?.accountDomain : undefined;
    const domain = x.domain ?? refDomain;
    const pick = visible.find(same) ?? visible.find(covers) ?? (x.loose && domain ? visible.find((m) => domainOf(m) === domain) : undefined);
    if (pick) return { moveId: pick.id };
    return { href: domain ? `/companies?c=${encodeURIComponent(domain)}` : undefined };
  };

  const finish = async (
    move: Move,
    how: "done" | "skip" | "snooze",
    opts: { reason?: SkipReason; quiet?: boolean; until?: string; untilReply?: { id: string; name: string }; extra?: Action[]; undoExtra?: Action[]; message?: string } = {},
  ) => {
    setExits((e) => ({ ...e, [move.id]: how === "done" ? "done" : "skip" }));
    const idx = nav.findIndex((m) => m.id === move.id);
    const next = nav[idx + 1] ?? nav[idx - 1];
    setSkipFor(null);
    if (expandedId === move.id) setExpandedId(null);
    if (focusId === move.id) {
      setFocusId(next?.id ?? null);
      if (next) requestAnimationFrame(() => headers.current.get(next.id)?.focus({ preventScroll: true }));
    }
    const at = nowISO();
    const until = opts.until ?? addDays(today, 1);
    const action: Action =
      how === "done"
        ? { type: "move.done", id: move.id, at }
        : how === "skip"
          ? { type: "move.skip", id: move.id, reason: opts.reason ?? "other", at }
          : { type: "move.snooze", id: move.id, until, at, ...(opts.untilReply ? { untilReply: opts.untilReply.id } : {}) };
    // The third skip with the same reason on a persona or a signal is the one that teaches: say what changes.
    const learned = how === "skip" && opts.reason ? wouldLearn(ws, move, opts.reason, at, today) : null;
    // A draft skipped as "tone off" teaches the voice card what not to write.
    const draft = how === "skip" && opts.reason === "tone_off" ? cardDraft(ws, move) : undefined;
    const offText = draft?.steps.find((st) => st.status === "draft")?.body;
    const ok = await dispatch([...(opts.extra ?? []), action, ...(offText ? [{ type: "voice.noteToneOff" as const, text: offText, at, moveId: move.id }] : [])]);
    schedule();
    if (!ok || opts.quiet) return;
    const undo = {
      label: "Undo",
      onClick: () => {
        void dispatch([...(opts.undoExtra ?? []), { type: "move.reopen", id: move.id }]).then(() => schedule(200));
      },
    };
    const noted = SKIP_REASONS.find((r) => r.id === opts.reason)?.noted ?? "skipped";
    const message =
      opts.message ??
      (how === "skip"
        ? learned
          ? `Noted: ${noted}. That's three this month, so ${learned.kind === "persona" ? `${learned.label} cards` : `cards built on ${learned.label.toLowerCase()}`} rank lower until ${shortDay(learned.until)}.`
          : `Noted: ${noted}.`
        : how === "snooze"
          ? opts.untilReply
            ? `I'll bring this back when ${opts.untilReply.name} replies, or on ${shortDay(until)}.`
            : until === addDays(today, 1)
              ? "Moved to tomorrow."
              : `Back on ${shortDay(until)}.`
          : "Done.");
    toast(message, { action: undo, ...(learned ? { duration: 10_000 } : {}) });
  };

  const waitOn = (m: Move) => {
    const person = waitFor(ws, m, new Date(now));
    if (!person) return;
    void finish(m, "snooze", { until: addDays(today, UNTIL_REPLY_DAYS), untilReply: { id: person.id, name: first(person.name) || "they" } });
  };

  /** A reply's draft, started by its key (when there's none yet and none being written). */
  const startReplyDraft = (row: LaneRow) => {
    const person = row.person;
    if (!person) return;
    const has = Object.values(ws.outreach).some((p) => p.mode === "reply" && p.personId === person.id && p.createdAt >= row.reply.at && p.steps.some((s) => s.status === "draft"));
    const live = activeRuns.some((r) => r.workflow === "compose" && r.ref?.kind === "account" && r.ref.id === person.accountDomain);
    if (!has && !live) void start("compose", { domain: person.accountDomain, personId: person.id, mode: "reply", replyText: row.reply.body ?? row.reply.summary, receivedAt: row.reply.at }, { notify: false });
  };

  /** One key per suggested action on a reply (1–4), each with Undo where it changes anything. */
  const laneAction = async (row: LaneRow, id: LaneActionId) => {
    const name = row.firstName || "them";
    switch (id) {
      case "draft":
        open(row.move.id);
        startReplyDraft(row);
        return;
      case "refer": {
        const r = referralActions(ws, row);
        open(row.move.id);
        if (!r) return; // nobody named: the open row says so
        if (r.actions.length) {
          if (!(await dispatch(r.actions))) return;
          toast(`Added ${r.person.name}${ws.accounts[r.person.accountDomain] ? ` at ${ws.accounts[r.person.accountDomain].name}` : ""}. Drafting a note that says ${name} sent you.`, {
            duration: 8_000,
            action: { label: "Undo", onClick: () => void dispatch({ type: "person.remove", id: r.person.id }) },
          });
        }
        const drafted = Object.values(ws.outreach).some((p) => p.mode === "cold" && p.personId === r.person.id && p.steps.some((s) => s.status === "draft"));
        const live = activeRuns.some((x) => x.workflow === "compose" && x.ref?.kind === "account" && x.ref.id === r.person.accountDomain);
        if (!drafted && !live) void start("compose", { domain: r.person.accountDomain, personId: r.person.id, mode: "cold", referredBy: row.reply.personId }, { notify: false });
        return;
      }
      case "hold": {
        const until = row.backOn ?? addDays(today, 7);
        return finish(row.move, "done", {
          extra: [{ type: "activity.setHold", id: row.reply.id, until }],
          undoExtra: [{ type: "activity.setHold", id: row.reply.id, until: row.reply.holdUntil ?? null }],
          message: `Holding follow-ups to ${name} until ${shortDay(until)}.`,
        });
      }
      case "revisit": {
        const until = row.revisitOn ?? addDays(today, 60);
        return finish(row.move, "done", {
          extra: [{ type: "activity.setHold", id: row.reply.id, until }],
          undoExtra: [{ type: "activity.setHold", id: row.reply.id, until: row.reply.holdUntil ?? null }],
          message: `I'll bring ${name} back on ${shortDay(until)} with a note to send.`,
        });
      }
      case "suppress": {
        const person = row.person;
        if (!person) return;
        const email = emailOf(person)?.toLowerCase();
        const supId = newId("sup");
        return finish(row.move, "done", {
          extra: [...(email ? [{ type: "suppression.add" as const, entry: { id: supId, email, reason: "unsubscribe" as const, at: nowISO() } }] : []), { type: "person.upsert", person: { ...person, doNotContact: true } }],
          undoExtra: [...(email ? [{ type: "suppression.remove" as const, id: supId }] : []), { type: "person.upsert", person }],
          message: `Suppressed ${name}. Their drafts are cancelled and I won't draft to them again.`,
        });
      }
      case "tomorrow":
        return finish(row.move, "snooze", { until: addDays(today, 1) });
      case "handled":
        return finish(row.move, "done", { message: "Handled." });
    }
  };

  const setIntent = (row: LaneRow, intent: ReplyIntent | null) => void dispatch({ type: "reply.setIntent", id: row.reply.id, intent });

  // Keyboard, while focus is on the desk: J/K move, Enter opens, 1–4 act on a reply, A done, X skip, S tomorrow,
  // W until they reply, R jumps to replies, Esc closes.
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
    if (document.querySelector('[role="dialog"]')) return; // palette, Ask, a sheet or a popover owns the keyboard
    if (!deskRef.current?.contains(document.activeElement)) return;
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
    const row = current ? rows.find((r) => r.move.id === current.id) : undefined;
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
      const to = nav[k === "j" ? Math.min(nav.length - 1, i + 1) : Math.max(0, i === -1 ? 0 : i - 1)];
      if (!to) return;
      setFocusId(to.id);
      const el = headers.current.get(to.id);
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (k === "r" && rows.length) {
      e.preventDefault();
      setLaneOpen(true);
      const id = rows[0].move.id;
      setFocusId(id);
      requestAnimationFrame(() => {
        const el = headers.current.get(id);
        el?.focus({ preventScroll: true });
        el?.scrollIntoView({ block: "nearest" });
      });
      return;
    }
    if (!current) return;
    const digit = Number(e.key);
    if (row && digit >= 1 && digit <= row.actions.length && !e.repeat) {
      e.preventDefault();
      void laneAction(row, row.actions[digit - 1].id);
      return;
    }
    if (k === "a") {
      // A draft's composer approves; a note's body marks it sent; a booking card logs its nudge. Closed, A opens them.
      const showsDraft = !!cardDraft(ws, current) || endsInBody(current) || writesNote(ws, current, now) || (!!row && expandedId === current.id);
      if (showsDraft && expandedId === current.id) return; // the body owns A
      e.preventDefault();
      if (showsDraft) open(current.id);
      else if (row) void laneAction(row, row.actions.find((a) => a.id === "handled") ? "handled" : row.actions[0].id);
      else void finish(current, "done");
    } else if (k === "x") {
      e.preventDefault();
      setSkipFor(current.id);
    } else if (k === "s") {
      e.preventDefault();
      void finish(current, "snooze");
    } else if (k === "w" && !row) {
      e.preventDefault();
      waitOn(current);
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

  const bind = (id: string) => (el: HTMLButtonElement | null) => {
    if (el) headers.current.set(id, el);
    else headers.current.delete(id);
  };

  const card = (m: Move, i: number) => {
    const waiter = waitFor(ws, m, new Date(now));
    return (
      <motion.li
        key={m.id}
        layout="position"
        custom={exits}
        variants={{
          // Skipped folds away at once. Done holds while its stamp lands and its title is crossed off, then folds;
          // the cards below close the gap as it goes (the fold is a height collapse, so they ride the reflow).
          exit: (all: Record<string, Exit>) =>
            all[m.id] === "skip"
              ? {
                  opacity: 0,
                  scale: 0.98,
                  height: 0,
                  marginBottom: 0,
                  transition: { opacity: { duration: 0.14, ease: ease.out }, scale: { duration: 0.2, ease: ease.out }, default: { duration: 0.24, ease: ease.inOut } },
                }
              : {
                  opacity: 0,
                  height: 0,
                  marginBottom: 0,
                  transition: { opacity: { delay: 0.42, duration: 0.16, ease: ease.out }, default: { delay: 0.46, duration: 0.3, ease: ease.inOut } },
                },
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
          bindHeader={bind(m.id)}
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
          onWait={waiter ? () => waitOn(m) : undefined}
          waitName={waiter ? first(waiter.name) : undefined}
          onChanged={() => schedule(200)}
          onOpened={() => revealCard(m.id)}
        />
      </motion.li>
    );
  };

  const list = (moves: Move[], offset = 0) => (
    <ul className="relative space-y-3">
      <AnimatePresence initial={reveal} custom={exits}>
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
  const next = useMemo(() => (deskCount === 0 ? nextUp(ws, new Date(now)) : []), [deskCount, ws, now]);
  const moves = [...top, ...overdue];
  const laneCleared = progress.replies.done;

  return (
    <Column>
      <div key={phase === "skipped" ? "final" : "live"}>
        <Masthead
          ws={ws}
          dateLabel={dateLabel}
          brief={brief}
          greeting={greeting}
          star={star}
          since={since}
          reveal={reveal}
          working={briefWorking}
          preparing={refreshing}
          error={error}
          onRefresh={() => {
            setRefreshing(true);
            void prepare("refresh").finally(() => setRefreshing(false));
          }}
          targetOf={targetOf}
          onOpen={(t) => {
            if (t.moveId) open(t.moveId, { scroll: true });
          }}
          onSeen={markSeen}
          tools={
            <>
              <WaitingOn ws={ws} now={now} />
              <LearnedButton ws={ws} today={today} visible={visible} />
            </>
          }
        />

        <MoveExits.Provider value={exits}>
          <div
            ref={deskRef}
            onBlur={(e) => {
              // Focus left the desk (a click elsewhere, a popover): its single-key shortcuts stand down.
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusId(null);
            }}
          >
            <RepliesLane
              ws={ws}
              rows={rows}
              now={now}
              today={today}
              weekStart={weekStart}
              focusId={focusId}
              expandedId={expandedId}
              skipFor={skipFor}
              open={laneOpen}
              cleared={laneCleared}
              reveal={reveal}
              bindRow={(id, el) => bind(id)(el)}
              onToggleOpen={() => setLaneOpen((o) => !o)}
              onFocus={setFocusId}
              onToggle={(id) => {
                setFocusId(id);
                setExpandedId((x) => (x === id ? null : id));
              }}
              onAction={(row, id) => void laneAction(row, id)}
              onIntent={setIntent}
              onSkip={(row, reason) => void finish(row.move, "skip", { reason })}
              onSkipCancel={() => setSkipFor(null)}
              onComplete={(row) => void finish(row.move, "done", { quiet: true })}
              onChanged={() => schedule(200)}
              onOpened={revealCard}
            />

            <section className="mt-8" aria-label="Your moves">
              {dayOne && <DayOne warm={!!ws.network} networkCard={visible.some((m) => m.rule === "today.network")} />}
              {moves.length > 0 && (
                <div className={cn(dayOne && "mt-6")}>
                  <SectionLabel
                    right={
                      <span className="flex items-center gap-3 font-mono text-[12px] tnum text-fg-3">
                        {progress.done > 0 && (
                          <span className="hidden items-center gap-2 sm:flex" title={progressLine(progress)}>
                            <span
                              role="progressbar"
                              aria-label="Done today"
                              aria-valuenow={progress.done}
                              aria-valuemin={0}
                              aria-valuemax={progress.total}
                              aria-valuetext={progressLine(progress)}
                              className="progress-track w-12"
                            >
                              <span className="progress-fill block" style={{ transform: `scaleX(${progress.total ? progress.done / progress.total : 0})` }} />
                            </span>
                            {progress.done} of {progress.total} done
                          </span>
                        )}
                        <span>about {minutes} min</span>
                      </span>
                    }
                  >
                    {movesHeading({ dayOne, discovering })}
                  </SectionLabel>
                  {list(top)}
                  {overdue.length > 0 && (
                    <div className="mt-6">
                      <SectionLabel>
                        <span className="text-danger">Overdue</span> <span className="font-mono text-[12px] tnum text-fg-3">({overdue.length})</span>
                      </SectionLabel>
                      {list(overdue, top.length)}
                    </div>
                  )}
                </div>
              )}
              {deskCount === 0 && !dayOne && <DeskEnd progress={progress} next={next} justCleared={justCleared} consumer={consumer} worth={worth} />}
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
                    {laterGroups.map(([kind, ms]) => (
                      <div key={kind}>
                        <SectionLabel>{KIND_LABELS[kind]}</SectionLabel>
                        {list(ms, top.length + overdue.length)}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </MoveExits.Provider>

        {weekReviews[0] && <WeekCard ws={ws} review={weekReviews[0]} kind={weekReviews[0].reviewKind === "monday" || weekReviews[0].reviewKind === "growth" ? weekReviews[0].reviewKind : "friday"} />}

        {deskCount > 0 && (
          <Keys
            className="mt-12"
            items={[
              ["J", "next"],
              ["K", "previous"],
              ["Enter", "open"],
              ...(rows.length ? ([["1–4", "act on a reply"]] as [string, string][]) : []),
              ["A", "done"],
              ["X", "skip"],
              ["S", "tomorrow"],
              ["W", "until they reply"],
              ...(rows.length ? ([["R", "replies"]] as [string, string][]) : []),
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

/** Matches the final layout; appears only after 150ms so fast loads never flash. */
function TodaySkeleton() {
  return (
    <Column className="opacity-0 animate-[fade-in_150ms_var(--ease-out)_150ms_forwards]">
      <LoadingSignal label="Preparing your daily brief" className="mb-5" />
      <Skeleton className="h-3 w-56 max-w-full" />
      <Skeleton className="mt-4 h-6 w-96 max-w-full" />
      <Skeleton className="mt-4 h-4 w-80 max-w-full" />
      <div className="mt-8 space-y-2">
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
