"use client";

import { ArrowUp, Globe, History, Sparkles, SquarePen, Square, X, Zap } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { RunState } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { AiBadge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { Popover } from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/misc";
import { Orb } from "@/components/ui/orb";
import { SourceChip } from "@/components/ui/source";
import { Tooltip } from "@/components/ui/tooltip";
import { WorkLog } from "@/components/ui/work-log";
import { cn } from "@/lib/client/cn";
import { duration, relativeTime, usd } from "@/lib/client/format";
import { MODEL_LABELS, costOf, emptyUsage } from "@/lib/ai/models";
import type { AskThreadSummary, AskTurn, EntityRef, Workspace } from "@/lib/domain/types";
import { AnswerText, countWords, settledText, useWordReveal } from "./answer-text";
import { ProposalChip } from "./proposal-chip";
import { fetchThreads, useConversation, type ConversationState, type SendOptions } from "./use-conversation";

/* ─────────────────────────────── Context helpers (code, no model) ─────────────────────────────── */

const SECTION_LABELS: Record<string, string> = {
  foundation: "your playbook",
  positioning: "positioning",
  icp: "your ICP",
  personas: "personas",
  messaging: "messaging",
  questions: "open questions",
  plan: "the plan",
  commercial: "commercial terms",
  competitors: "competitors",
  voice: "your voice",
};

export function contextMeta(ws: Workspace | null, ref: EntityRef | undefined): { label: string; domain?: string; href?: string } | null {
  if (!ref) return null;
  switch (ref.kind) {
    case "account": {
      const a = ws?.accounts[ref.id];
      return { label: a?.name ?? ref.id, domain: ref.id, href: `/companies?c=${encodeURIComponent(ref.id)}` };
    }
    case "deal": {
      const d = ws?.deals[ref.id];
      return d ? { label: d.name, domain: d.accountDomain, href: `/companies?c=${encodeURIComponent(d.accountDomain)}` } : { label: "this deal" };
    }
    case "person": {
      const p = ws?.people[ref.id];
      return p ? { label: p.name, domain: p.accountDomain, href: `/companies?c=${encodeURIComponent(p.accountDomain)}` } : { label: "this person" };
    }
    case "meeting":
      return { label: ws?.meetings[ref.id]?.title ?? "this meeting" };
    case "event":
      return { label: ws?.events[ref.id]?.title ?? "this event", href: `/events/${encodeURIComponent(ref.id)}` };
    case "playbook":
      return { label: SECTION_LABELS[ref.id] ?? (ref.id.startsWith("asset") ? "your assets" : "your playbook"), href: "/playbook" };
    default:
      return { label: "this" };
  }
}

interface Suggestion {
  text: string;
  /** Answered in code, for free. */
  instant?: boolean;
}

function suggestionsFor(ws: Workspace | null, ref: EntityRef | undefined, label: string | undefined): Suggestion[] {
  if (!ref || !label) {
    return [
      { text: "Which deals are missing a next step?", instant: true },
      { text: "How am I doing this week?", instant: true },
      { text: "What should I charge for a paid pilot?" },
      { text: "Plan a virtual roundtable for next month" },
    ];
  }
  if (ref.kind === "account" || ref.kind === "deal" || ref.kind === "person") {
    const domain = ref.kind === "account" ? ref.id : ref.kind === "deal" ? ws?.deals[ref.id]?.accountDomain : ws?.people[ref.id]?.accountDomain;
    const deal = domain ? Object.values(ws?.deals ?? {}).find((d) => d.accountDomain === domain && ["talking", "qualified", "pilot", "proposal"].includes(d.stage)) : undefined;
    if (deal) {
      return [
        { text: `What's the biggest risk in the ${label} deal right now?` },
        { text: `Draft success criteria for a paid ${label} pilot` },
        { text: `How do I answer if ${label} pushes back on price?` },
        { text: `Who else should I bring in at ${label}?` },
      ];
    }
    return [
      { text: `Is ${label} worth my time this week?` },
      { text: `Who should I talk to first at ${label}, and why?` },
      { text: `What's my strongest angle into ${label}?` },
    ];
  }
  if (ref.kind === "event") {
    return [{ text: "Who's missing from this room?" }, { text: "Write the 48-hour reminder for confirmed guests" }, { text: "What should the anchor cover in five minutes?" }];
  }
  if (ref.kind === "playbook") {
    return [{ text: `Pressure-test ${label}` }, { text: "What would the next five calls need to confirm?" }, { text: "Where is this most likely wrong?" }];
  }
  return [{ text: `What should I do next about ${label}?` }];
}

/* ─────────────────────────────── Turns ─────────────────────────────── */

export function FounderTurn({ turn }: { turn: AskTurn }) {
  const [expanded, setExpanded] = useState(false);
  const long = turn.text.length > 420 || turn.text.split("\n").length > 7;
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] rounded-lg bg-bg-subtle px-3 py-2 ring-1 ring-border/60">
        <p className={cn("whitespace-pre-wrap break-words text-[14px] leading-[21px] text-fg", long && !expanded && "line-clamp-6")}>{turn.text}</p>
        {long && (
          <button onClick={() => setExpanded((e) => !e)} className="mt-1 text-[12px] font-medium text-fg-3 hover:text-fg-2">
            {expanded ? "Show less" : "Show all"}
          </button>
        )}
        {(turn.web || turn.deep) && (
          <p className="mt-1 flex items-center gap-2 text-[11.5px] text-fg-3">
            {turn.web && (
              <span className="inline-flex items-center gap-1">
                <Globe className="size-3" /> Web
              </span>
            )}
            {turn.deep && (
              <span className="inline-flex items-center gap-1">
                <Sparkles className="size-3" /> Thought harder
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

function InstantView({ turn, last, onFollowUp, onNavigate }: { turn: AskTurn; last: boolean; onFollowUp: (text: string) => void; onNavigate?: () => void }) {
  const answer = turn.instant!;
  return (
    <div className="animate-[rise-in_200ms_var(--ease-out)_both]">
      <p className="prose-agent">{answer.title}</p>
      {answer.rows.length > 0 && (
        <ul className="mt-2.5 divide-y divide-border overflow-hidden rounded-lg bg-surface font-sans ring-1 ring-border">
          {answer.rows.map((r, i) => {
            const body = (
              <>
                {r.domain ? <Favicon domain={r.domain} name={r.label} size={16} /> : <span className="size-1.5 shrink-0 rounded-full bg-fg-4" />}
                <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-2">
                  <span className="block truncate text-[13.5px] text-fg sm:max-w-[45%] sm:shrink-0">{r.label}</span>
                  {r.detail && <span className="block truncate text-[12.5px] text-fg-3">{r.detail}</span>}
                </span>
              </>
            );
            return (
              <li key={i}>
                {r.href ? (
                  <Link href={r.href} onClick={onNavigate} className="flex min-h-10 items-center gap-2.5 px-3 py-2 transition-colors hover:bg-bg-subtle focus-visible:bg-bg-subtle">
                    {body}
                  </Link>
                ) : (
                  <div className="flex min-h-10 items-center gap-2.5 px-3 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1 font-mono text-[11.5px] text-fg-3">
          <Zap className="size-3" /> Instant · from your workspace · no AI cost
        </span>
        {last && (
          <button onClick={() => onFollowUp("What should I do about this?")} className="text-[12.5px] font-medium text-accent-text hover:underline">
            What should I do about this?
          </button>
        )}
      </div>
    </div>
  );
}

function Receipt({ turn, onNavigate, hereHref }: { turn: AskTurn; onNavigate?: () => void; hereHref?: string }) {
  const r = turn.receipt;
  if (!r) return null;
  const records = turn.records ?? [];
  const parts = [`Worked for ${duration(r.durationMs)}`, r.sources ? `${r.sources} web source${r.sources === 1 ? "" : "s"}` : null, usd(r.costUsd), r.model === "strategist" ? MODEL_LABELS.strategist : null].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-fg-3">
      <span className="font-mono">{parts.join(" · ")}</span>
      {records.length > 0 && (
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <span>· from</span>
          {records.map((rec, i) => {
            const href = rec.domain ? `/companies?c=${encodeURIComponent(rec.domain)}` : undefined;
            const chip = (
              <span className="inline-flex h-5 max-w-44 items-center gap-1 rounded-xs bg-surface px-1 text-fg-2 ring-1 ring-border">
                {rec.domain && <Favicon domain={rec.domain} name={rec.label} size={12} className="ring-0" />}
                <span className="truncate">{rec.ref.kind === "deal" ? `${rec.label} deal` : rec.label}</span>
              </span>
            );
            return href && href !== hereHref ? (
              <Link key={i} href={href} onClick={onNavigate} className="rounded-xs hover:opacity-80">
                {chip}
              </Link>
            ) : (
              <span key={i}>{chip}</span>
            );
          })}
        </span>
      )}
    </div>
  );
}

export function AgentTurn({
  turn,
  run,
  animate,
  last,
  conv,
  onNavigate,
  hereHref,
}: {
  turn: AskTurn;
  run?: RunState;
  animate: boolean;
  last: boolean;
  conv: ConversationState;
  onNavigate?: () => void;
  hereHref?: string;
}) {
  const { ws } = useWorkspace();
  const runEnded = !!run && run.status !== "running" && run.status !== "queued";
  const active = !!turn.pending && !turn.error && !runEnded;
  const raw = turn.pending ? (run?.text ?? "") : turn.text;
  const visible = settledText(raw, active);
  const shown = useWordReveal(countWords(visible), animate);
  const settled = !active && shown >= countWords(visible);
  // The server writes the final turn just before the run ends; until it's fetched, show what the run knows.
  const error = turn.error ?? (turn.pending && runEnded && run?.error ? { code: run.error.code ?? "unknown", message: run.status === "stopped" ? "Stopped." : run.error.message } : undefined);
  const interrupted = !error && turn.pending && runEnded && run?.result === undefined && !run?.text;
  const proposals = (turn.proposals ?? []).filter((p) => p.status !== "dismissed");

  if (turn.instant) {
    return (
      <div className="flex gap-3">
        <Orb size={14} className="mt-[6px]" />
        <div className="min-w-0 flex-1">
          <InstantView turn={turn} last={last} onFollowUp={(t) => void conv.send(t)} onNavigate={onNavigate} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      {active && !visible && run ? <span className="w-3.5 shrink-0" /> : <Orb size={14} className="mt-[6px]" state={active ? "working" : error ? "error" : "idle"} tick={run?.steps.length ?? 0} />}
      <div className="min-w-0 flex-1 space-y-3">
        <AnimatePresence initial={false} mode="popLayout">
          {active && !visible && (
            <motion.div key="log" exit={{ opacity: 0, transition: { duration: 0.12 } }}>
              {run ? (
                <WorkLog run={run} />
              ) : (
                <p className="flex h-7 items-center text-[13px]">
                  <span className="shimmer-text">Starting</span>
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        {visible && <AnswerText text={visible} limit={shown} animate={animate} evidence={ws?.evidence ?? {}} />}
        {active && visible && <p className="shimmer-text h-5 text-[12px]">Writing</p>}
        {(error || interrupted) && (
          <div className="flex flex-wrap items-center gap-2">
            <p className={cn("text-[13px]", error?.code === "stopped" ? "text-fg-3" : "text-danger")}>{error?.message ?? "This answer was interrupted."}</p>
            {last &&
              (error?.code === "budget" ? (
                <Link href="/settings#usage" onClick={onNavigate} className="text-[12.5px] font-medium text-fg-2 underline-offset-2 hover:underline">
                  Open Usage
                </Link>
              ) : (
                <Button size="xs" variant="ghost" onClick={() => void conv.retry(turn)} disabled={conv.busy}>
                  Try again
                </Button>
              ))}
          </div>
        )}
        {settled && (turn.citations?.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {turn.citations!.map((c) => (
              <SourceChip key={c.url} url={c.url} quote={c.quote} claim={c.title} />
            ))}
          </div>
        )}
        {settled && proposals.length > 0 && (
          <div className="space-y-1.5">
            <AnimatePresence initial={false}>
              {proposals.map((p) => (
                <ProposalChip key={p.id} proposal={p} onDecide={(status, runId) => conv.decide(p, status, runId)} onNavigate={onNavigate} hereHref={hereHref} />
              ))}
            </AnimatePresence>
          </div>
        )}
        {settled && !error && <Receipt turn={turn} onNavigate={onNavigate} hereHref={hereHref} />}
      </div>
    </div>
  );
}

/* ─────────────────────────────── Empty state ─────────────────────────────── */

function EmptyState({
  label,
  context,
  onPick,
  onOpenThread,
}: {
  label?: string;
  context?: EntityRef;
  onPick: (text: string) => void;
  onOpenThread: (t: AskThreadSummary) => void;
}) {
  const { ws } = useWorkspace();
  const [recent, setRecent] = useState<AskThreadSummary[] | null>(null);
  const key = context ? `${context.kind}:${context.id}` : "";
  useEffect(() => {
    let cancelled = false;
    void fetchThreads(context, 4).then((list) => !cancelled && setRecent(list));
    return () => {
      cancelled = true;
    };
    // `key` stands in for the context object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const suggestions = suggestionsFor(ws, context, label);
  return (
    <div className="px-1 pb-2 pt-4 animate-[fade-in_200ms_var(--ease-out)]">
      <h2 className="text-balance font-serif text-[24px] leading-[30px] tracking-[-0.01em] text-fg">{label ? `Ask about ${label}.` : "What do you want to figure out?"}</h2>
      <p className="mt-1.5 max-w-[52ch] text-[13.5px] leading-[20px] text-fg-2">
        I answer from your workspace first and show what I used. Anything I&apos;d change comes back as a suggestion you apply.
      </p>
      <ul className="mt-5 space-y-1">
        {suggestions.map((s) => (
          <li key={s.text}>
            <button
              onClick={() => onPick(s.text)}
              className="group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13.5px] text-fg-2 transition-colors hover:bg-bg-subtle hover:text-fg"
            >
              <ArrowUp className="size-3.5 shrink-0 rotate-45 text-fg-4 transition-colors group-hover:text-fg-3" />
              <span className="min-w-0 flex-1">{s.text}</span>
              {s.instant && (
                <Tooltip content="Answered from your workspace in code, with no AI cost">
                  <span className="inline-flex shrink-0 items-center gap-0.5 font-mono text-[10.5px] text-fg-3">
                    <Zap className="size-3" /> instant
                  </span>
                </Tooltip>
              )}
            </button>
          </li>
        ))}
      </ul>
      {recent && recent.length > 0 && (
        <div className="mt-6">
          <p className="mb-1 px-2.5 text-[11.5px] font-medium text-fg-3">{label ? `Earlier about ${label}` : "Recent"}</p>
          <ul className="space-y-0.5">
            {recent.map((t) => (
              <li key={t.id}>
                <button onClick={() => onOpenThread(t)} className="flex w-full items-baseline gap-3 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-bg-subtle">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{t.title}</span>
                  <span className="shrink-0 font-mono text-[11px] text-fg-3">{relativeTime(t.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── Thread menu ─────────────────────────────── */

function ThreadMenu({ currentId, onOpen }: { currentId: string; onOpen: (t: AskThreadSummary) => void }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<AskThreadSummary[] | null>(null);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void fetchThreads(undefined, 20).then(setList);
      }}
      align="end"
      className="w-[min(340px,calc(100vw-32px))] p-1"
      trigger={
        <IconButton label="Earlier conversations">
          <History className="size-4" />
        </IconButton>
      }
    >
      <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-fg-3">Earlier conversations</p>
      {!list ? (
        <div className="space-y-2 p-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : list.length === 0 ? (
        <p className="px-2 py-3 text-[13px] text-fg-3">Nothing yet. Your conversations will be here.</p>
      ) : (
        <ul className="max-h-[min(360px,50vh)] overflow-y-auto">
          {list.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => {
                  setOpen(false);
                  onOpen(t);
                }}
                className={cn("flex w-full flex-col gap-0.5 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-bg-subtle", t.id === currentId && "bg-bg-subtle")}
              >
                <span className="truncate text-[13px] text-fg">{t.title}</span>
                <span className="flex items-center gap-1.5 truncate text-[11.5px] text-fg-3">
                  {t.contextLabel && <span className="truncate">{t.contextLabel}</span>}
                  {t.contextLabel && <span>·</span>}
                  <span className="shrink-0 font-mono">{relativeTime(t.updatedAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}

/* ─────────────────────────────── Composer ─────────────────────────────── */

function Toggle({ on, onChange, icon, label, hint }: { on: boolean; onChange: (on: boolean) => void; icon: ReactNode; label: string; hint: string }) {
  return (
    <Tooltip content={hint}>
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onChange(!on)}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium ring-1 transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.97]",
          on ? "bg-accent-subtle text-accent-text ring-accent/30" : "text-fg-3 ring-border hover:bg-bg-subtle hover:text-fg-2",
        )}
      >
        {icon}
        <span>{label}</span>
      </button>
    </Tooltip>
  );
}

/** Matches the ask workflow's limit (src/lib/workflows/ask.ts), long enough for a call transcript. */
const MAX_MESSAGE = 200_000;

function Composer({
  conv,
  placeholder,
  autoFocus,
  inputRef,
  onSent,
}: {
  conv: ConversationState;
  placeholder: string;
  autoFocus?: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [web, setWeb] = useState(false);
  const [deep, setDeep] = useState(false);
  // Keep an over-long paste in the box instead of clearing it for a request the server will refuse.
  const tooLong = text.length > MAX_MESSAGE;

  // "Think harder" re-reads the whole thread on the strategist model (a cache write at its rates), so the
  // hint prices this thread rather than quoting a flat multiple.
  const threadTokens = conv.thread?.approxTokens ?? 0;
  const deepUsd = costOf("strategist", { ...emptyUsage(), cacheWriteTokens: threadTokens + 13_000, outputTokens: 2_000 });
  const deepHint = `For this message only: ${MODEL_LABELS.strategist} with more thinking. Re-reads this conversation on ${MODEL_LABELS.strategist}, about ${usd(deepUsd)}.${threadTokens > 30_000 ? " Start fresh first to keep it cheap." : ""}`;

  const submit = () => {
    if (!text.trim() || conv.busy || tooLong) return;
    const o: SendOptions = { web, deep };
    setText("");
    setWeb(false);
    setDeep(false);
    onSent();
    void conv.send(text, o);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    if (e.metaKey || e.ctrlKey || !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="rounded-lg bg-surface shadow-xs ring-1 ring-border-strong/70 transition-shadow duration-150 focus-within:ring-2 focus-within:ring-[var(--ring)]"
    >
      <label htmlFor="ask-input" className="sr-only">
        Ask
      </label>
      <textarea
        id="ask-input"
        ref={inputRef}
        rows={1}
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="block max-h-44 min-h-[44px] w-full resize-none overflow-y-auto bg-transparent px-3 pb-1 pt-2.5 text-[14px] leading-[21px] text-fg outline-none placeholder:text-fg-3"
      />
      <div className="flex items-center gap-1.5 px-2 pb-2 pt-1">
        <Toggle on={web} onChange={setWeb} icon={<Globe className="size-3.5" />} label="Search the web" hint="For this message only: up to 2 web searches, about $0.02 more." />
        <Toggle on={deep} onChange={setDeep} icon={<Sparkles className="size-3.5" />} label="Think harder" hint={deepHint} />
        <span className="flex-1" />
        {conv.busy ? (
          <Button type="button" size="sm" variant="secondary" onClick={conv.stop} icon={<Square className="size-3 fill-current" />}>
            Stop
          </Button>
        ) : (
          <Tooltip content="↵ to send · Shift ↵ for a new line">
            <Button type="submit" size="sm" variant="primary" disabled={!text.trim() || tooLong} aria-label="Send">
              <span className="hidden sm:inline">Send</span>
              <ArrowUp className="size-3.5 sm:hidden" />
              <kbd className="ml-0.5 hidden font-mono text-[11px] opacity-70 sm:inline">↵</kbd>
            </Button>
          </Tooltip>
        )}
      </div>
      {tooLong && (
        <p className="px-3 pb-2 text-[12px] text-danger">
          That&apos;s {text.length.toLocaleString()} characters; Ask takes up to {MAX_MESSAGE.toLocaleString()}. Paste the part of the call that matters.
        </p>
      )}
    </form>
  );
}

/* ─────────────────────────────── Conversation ─────────────────────────────── */

/**
 * The Ask conversation. `window` is the floating ⌘K window (header with context chip and close);
 * `inline` sits inside a record (the company sheet's Ask tab), so it never stacks a layer on a sheet.
 */
export function Conversation({
  variant,
  context: initialContext,
  threadId,
  prefill,
  onPrefillSent,
  resume,
  onClose,
  onNavigate,
  hereHref,
  className,
}: {
  variant: "window" | "inline";
  context?: EntityRef;
  threadId?: string;
  prefill?: string;
  /** The prefill went out; the owner should clear it so a remount doesn't ask it again. */
  onPrefillSent?: () => void;
  resume?: boolean;
  onClose?: () => void;
  /** Following a link out of the conversation (the window closes). */
  onNavigate?: () => void;
  hereHref?: string;
  className?: string;
}) {
  const { ws } = useWorkspace();
  const reduceMotion = useReducedMotion();
  const conv = useConversation({ threadId, context: initialContext, resume, prefill, onBoot: onPrefillSent });
  const meta = contextMeta(ws, conv.context);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow the answer as it grows, unless the founder scrolled up to read.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) scroller.scrollTop = scroller.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const lastAgentId = [...conv.turns].reverse().find((t) => t.role === "agent")?.id;
  const long = (conv.thread?.approxTokens ?? 0) > 30_000 || conv.turns.length > 40;
  const placeholder = meta ? `Ask about ${meta.label}…` : "Ask about a deal or what to do next…";
  const empty = !conv.loading && !conv.failed && conv.turns.length === 0;

  const header =
    variant === "window" ? (
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border pl-4 pr-2">
        <Orb size={16} state={conv.busy ? "working" : "idle"} />
        <span className="text-[13.5px] font-medium text-fg">Ask</span>
        <AiBadge />
        {meta && (
          <span className="ml-1 inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full bg-bg-subtle pl-2 pr-1 text-[12px] text-fg-2 ring-1 ring-border">
            {meta.domain && <Favicon domain={meta.domain} name={meta.label} size={12} className="ring-0" />}
            <span className="truncate">About {meta.label}</span>
            <button
              aria-label="Ask without this context"
              title="Ask without this context"
              onClick={() => conv.newThread(null)}
              className="inline-flex size-4 items-center justify-center rounded-full text-fg-3 hover:bg-surface hover:text-fg"
            >
              <X className="size-3" />
            </button>
          </span>
        )}
        <span className="flex-1" />
        <ThreadMenu currentId={conv.threadId} onOpen={(t) => conv.openThread(t.id, t.context)} />
        <IconButton label="New conversation" onClick={() => conv.newThread()} disabled={conv.turns.length === 0}>
          <SquarePen className="size-4" />
        </IconButton>
        {onClose && (
          <IconButton label="Close (Esc)" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        )}
      </div>
    ) : (
      <div className="flex shrink-0 items-center gap-1 pb-2">
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-fg-3">{conv.thread && conv.turns.length ? conv.thread.title : ""}</span>
        <ThreadMenu currentId={conv.threadId} onOpen={(t) => conv.openThread(t.id, t.context)} />
        <IconButton label="New conversation" onClick={() => conv.newThread()} disabled={conv.turns.length === 0}>
          <SquarePen className="size-4" />
        </IconButton>
      </div>
    );

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {header}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", variant === "window" ? "px-4 sm:px-5" : "px-0.5")}
      >
        {/* Streaming words aren't announced one by one; the status line below says when an answer is ready. */}
        <p className="sr-only" aria-live="polite">
          {conv.turns.length ? (conv.busy ? "Working on an answer." : "Answer ready.") : ""}
        </p>
        <div ref={contentRef} aria-busy={conv.busy} className="space-y-6 py-4">
          {conv.loading && (
            <div className="space-y-3 py-2" aria-label="Loading the conversation">
              <Skeleton className="ml-auto h-9 w-1/2 rounded-lg" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}
          {conv.failed && (
            <div className="py-6 text-center">
              <p className="text-[13.5px] text-fg-2">{conv.failed}</p>
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => conv.newThread()}>
                Start a new conversation
              </Button>
            </div>
          )}
          {empty && (
            <EmptyState
              label={meta?.label}
              context={conv.context}
              onPick={(t) => {
                pinned.current = true;
                void conv.send(t);
              }}
              onOpenThread={(t) => conv.openThread(t.id, t.context)}
            />
          )}
          {!conv.loading &&
            conv.turns.map((turn) => (
              <div key={turn.id} className="animate-[rise-in_200ms_var(--ease-out)_both]">
                {turn.role === "founder" ? (
                  <FounderTurn turn={turn} />
                ) : (
                  <AgentTurn
                    turn={turn}
                    run={turn.pending ? conv.liveRun : undefined}
                    animate={conv.liveIds.has(turn.id) && !reduceMotion}
                    last={turn.id === lastAgentId}
                    conv={conv}
                    onNavigate={onNavigate}
                    hereHref={hereHref}
                  />
                )}
              </div>
            ))}
        </div>
      </div>
      <div className={cn("shrink-0", variant === "window" ? "border-t border-border bg-surface-raised p-3" : "pt-2")}>
        <AnimatePresence initial={false}>
          {long && !conv.busy && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden text-[12px] text-fg-3"
            >
              <span className="mb-2 flex items-center gap-1.5">
                This conversation is long, so each answer re-reads more of it.
                <button onClick={() => conv.newThread()} className="font-medium text-fg-2 underline-offset-2 hover:underline">
                  Start fresh
                </button>
              </span>
            </motion.p>
          )}
        </AnimatePresence>
        <Composer conv={conv} placeholder={placeholder} autoFocus={variant === "window"} inputRef={inputRef} onSent={() => (pinned.current = true)} />
      </div>
    </div>
  );
}
