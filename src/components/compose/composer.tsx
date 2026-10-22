"use client";

import { motion } from "motion/react";
import { ArrowUpRight, Check, ExternalLink, MoreHorizontal, PenLine, RotateCcw, Send, Shuffle, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { toast } from "sonner";
import { ForgetPerson } from "@/components/people/forget-person";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { CopyButton, Skeleton } from "@/components/ui/misc";
import { Orb } from "@/components/ui/orb";
import { MarginNote, SourceChip } from "@/components/ui/source";
import { WorkLog } from "@/components/ui/work-log";
import { cn } from "@/lib/client/cn";
import { ledger } from "@/lib/intros/rules";
import { firstName, shortDate } from "@/lib/client/format";
import type { Action } from "@/lib/domain/actions";
import { newId, nowISO, todayISO } from "@/lib/domain/ids";
import { OPEN_STAGES, type DraftStep, type OutreachPackage, type Person, type Workspace } from "@/lib/domain/types";
import { currentStep, lintStep } from "@/lib/quality/context";
import { PERSONAL_DOMAINS, footerPromisesDeletion, jurisdictionFor, outgoingText, preflight, resolveEmail, signOff } from "@/lib/quality/gates";
import { LIMITS, limitsFor } from "@/lib/quality/lint";
import { nextFollowUp, recentFirstTouch, repliedSinceFirstTouch, senderOwnsSequence, sequenceOwnerName } from "@/lib/quality/sequence";
import { ease } from "@/lib/motion";
import { CheckDetails, CheckLine, type Count } from "./check-line";
import { AvailabilityForm, PovForm, RecipientForm, SenderForm, VerifyGuess } from "./fix-forms";
import { copyText, enabledSequencer, gmailComposeUrl, gmailFromUrl, gmailThreadUrl, mailtoUrl, pushToSequencer } from "./handoff";
import { SpanEditor, type SpanMark } from "./span-editor";
import { useCompose } from "./use-compose";
import { VoicePrompt } from "./voice-prompt";

/* ─────────────────────────────── DraftView ─────────────────────────────── */

/**
 * Shows one draft (a step of an OutreachPackage) the way the founder will send it:
 * subject + body in Inter (what the recipient reads), blue-pencil underlines and margin notes for
 * every personalized span, live lint as a single line ("Ready" or the worst issue), blockers as
 * tiny inline forms, the code-generated footer, and the handoff (Mark as sent / Open in Gmail /
 * Copy / Push to a connected sequencer). `focused` turns on the wash and the A/E/]/[ keys.
 * `moveId`: the Today card this draft finishes, so Undo after "Mark as sent" puts the card back.
 */
export function DraftView({ pkg, step, focused, onApproved, moveId }: { pkg: OutreachPackage; step?: number; focused?: boolean; onApproved?: () => void; moveId?: string }) {
  const { ws, dispatch } = useWorkspace();
  const live = ws?.outreach[pkg.id] ?? pkg;
  const current = currentStep(live, step);
  // Bumped on every swap so the editor remounts with the swapped-in text.
  const [version, setVersion] = useState(0);
  const [lastSwap, setLastSwap] = useState<number | null>(null);

  const swap = useCallback(
    (index: number) => {
      setLastSwap(index);
      // Remount only once the swapped text is in the workspace (a fresh alternate may exist only on
      // the server until this round-trip returns).
      void dispatch({ type: "outreach.swapAlternate", packageId: pkg.id, index }).then(() => setVersion((v) => v + 1));
    },
    [dispatch, pkg.id],
  );

  if (!ws) return <DraftSkeleton />;
  // "Delete their details" took the draft with the person.
  if (!ws.outreach[pkg.id] && pkg.personId && !ws.people[pkg.personId]) return <ForgottenNote />;
  if (!current) return live.mode === "reply" ? <ReplyOnly ws={ws} pkg={live} /> : null;
  return (
    <DraftBody
      key={`${live.id}:${current.step}:${version}`}
      ws={ws}
      pkg={live}
      step={current}
      focused={Boolean(focused)}
      onApproved={onApproved}
      moveId={moveId}
      onSwap={swap}
      lastSwap={lastSwap}
      animateIn={version === 0}
    />
  );
}

const TYPING = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

function stepLabel(pkg: OutreachPackage, step: DraftStep): string {
  if (pkg.mode === "reply") return "Reply";
  if (pkg.mode === "linkedin") return "LinkedIn";
  if (pkg.mode === "warm_intro") return pkg.intro?.connectorName ? `Intro ask to ${firstName(pkg.intro.connectorName)}` : "Intro ask";
  if (step.step === 1) return "First touch";
  return step.step === 3 ? "Last follow-up" : `Follow-up ${step.step - 1}`;
}

function DraftBody({
  ws,
  pkg,
  step,
  focused,
  onApproved,
  moveId,
  onSwap,
  lastSwap,
  animateIn,
}: {
  ws: Workspace;
  pkg: OutreachPackage;
  step: DraftStep;
  focused: boolean;
  onApproved?: () => void;
  moveId?: string;
  onSwap: (index: number) => void;
  lastSwap: number | null;
  /** Off after a swap: "]" is a keyboard action, and those don't animate. */
  animateIn: boolean;
}) {
  const { dispatch, refresh } = useWorkspace();
  const compose = useCompose();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [subject, setSubject] = useState(step.subject);
  const [body, setBody] = useState(step.body);
  const [note, setNote] = useState(pkg.linkedin?.note ?? null);
  const [wrapper, setWrapper] = useState(pkg.intro?.wrapper ?? "");
  const [showNote, setShowNote] = useState(Boolean(pkg.linkedin?.note));
  const [details, setDetails] = useState(false);
  const [pushing, setPushing] = useState(false);
  // True once the text has left the app (Gmail, mail app, copy, push): only then is "Mark as sent" the next step.
  const [handedOff, setHandedOff] = useState(false);
  // compose.busy turns true only after the run starts; this covers the gap, so a double click can't pay twice or log twice.
  const startingRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const pending = useRef<{ timer: ReturnType<typeof setTimeout> | null; flush: (() => Promise<void>) | null }>({ timer: null, flush: null });

  const editable = step.status === "draft";
  // While this draft's alternate is being written, edits would land on the outgoing text after the swap.
  const locked = !editable || compose.busy || starting;
  const person = pkg.personId ? ws.people[pkg.personId] : undefined;
  const account = ws.accounts[pkg.accountDomain];
  const isEmail = pkg.mode === "cold" || pkg.mode === "follow_up" || pkg.mode === "reply";
  // LinkedIn: the invite goes first; the message waits until they accept.
  const invite = pkg.mode === "linkedin" ? ws.activities.find((a) => a.kind === "linkedin_connect" && a.draftRef?.packageId === pkg.id) : undefined;
  const invitePending = pkg.mode === "linkedin" && editable && !invite;

  /* Edits: optimistic, debounced, flushed before any handoff. */
  const schedule = useCallback(
    (patch: { subject?: string | null; body?: string; linkedinNote?: string | null; postAcceptDm?: string; introWrapper?: string }) => {
      const p = pending.current;
      if (p.timer) clearTimeout(p.timer);
      const run = async () => {
        p.timer = null;
        p.flush = null;
        const actions = [];
        if (patch.subject !== undefined || patch.body !== undefined) actions.push({ type: "outreach.editStep" as const, packageId: pkg.id, step: step.step, subject: patch.subject, body: patch.body });
        if (patch.linkedinNote !== undefined || patch.postAcceptDm !== undefined || patch.introWrapper !== undefined)
          actions.push({ type: "outreach.editExtra" as const, packageId: pkg.id, linkedinNote: patch.linkedinNote, postAcceptDm: patch.postAcceptDm, introWrapper: patch.introWrapper });
        if (actions.length) await dispatch(actions);
      };
      p.flush = run;
      p.timer = setTimeout(() => void run(), 600);
    },
    [dispatch, pkg.id, step.step],
  );
  const flush = useCallback(async () => {
    const p = pending.current;
    if (p.timer) clearTimeout(p.timer);
    const f = p.flush;
    p.timer = null;
    p.flush = null;
    if (f) await f();
  }, []);
  useEffect(() => () => void flush(), [flush]);

  // Every field the debounce writes, so one flush carries all of them.
  const edit = (next: { subject?: string | null; body?: string; note?: string | null; wrapper?: string }) => {
    const s = next.subject !== undefined ? next.subject : subject;
    const b = next.body ?? body;
    const n = next.note !== undefined ? next.note : note;
    const w = next.wrapper ?? wrapper;
    if (next.subject !== undefined) setSubject(next.subject);
    if (next.body !== undefined) setBody(next.body);
    if (next.note !== undefined) setNote(next.note);
    if (next.wrapper !== undefined) setWrapper(next.wrapper);
    schedule({
      subject: s,
      body: b,
      ...(pkg.linkedin ? { linkedinNote: n, postAcceptDm: b } : {}),
      ...(pkg.intro ? { introWrapper: w } : {}),
    });
  };

  /* Live checks: the same lint and gates the workflow ran. */
  const lint = useMemo(() => lintStep(ws, pkg, step, { subject, body, linkedinNote: showNote ? note : null, introWrapper: wrapper }), [ws, pkg, step, subject, body, note, showNote, wrapper]);
  const pf = useMemo(() => preflight(ws, pkg, step), [ws, pkg, step]);
  const blocker = pf.blockers[0];
  const limits = limitsFor({ kind: pkg.mode === "warm_intro" ? "intro_forwardable" : "email", frame: step.frame, step: step.step });
  const count: Count | null =
    pkg.mode === "linkedin"
      ? { value: body.length, max: LIMITS.liDmChars, hard: LIMITS.liDmChars, unit: "characters" }
      : limits
        ? { value: lint.stats.words, max: limits.max, hard: limits.hard, unit: "words" }
        : null;

  const so = signOff(ws);
  const outgoing = pkg.mode === "linkedin" ? body.trim() : isEmail ? outgoingText(ws, body, pf.footer) : `${body.trim()}${so ? `\n\n${so}` : ""}`;
  const firstSubject = pkg.steps.find((s) => s.step === 1)?.subject ?? null;
  const sequencer = isEmail && pkg.mode !== "reply" ? enabledSequencer(ws) : null;
  const pushed = sequencer ? pkg.pushedTo?.find((p) => p.integrationId === sequencer.id) : undefined;

  /* Spans → margin notes (wide) or chips (narrow). Source notes render from spans, never from loose ids. */
  const spanMarks: SpanMark[] = useMemo(
    () =>
      // A phrase whose citation didn't resolve gets no blue pencil: lint flags it instead.
      step.personalizedSpans.filter((s) => ws.evidence[s.evidenceId]).map((s) => {
        const ev = ws.evidence[s.evidenceId];
        return { text: s.text, note: ev && !ev.flaggedWrong ? <MarginNote url={ev.url} publishedAt={ev.publishedAt} quote={ev.quote} /> : undefined };
      }),
    [step.personalizedSpans, ws.evidence],
  );
  const chips = step.personalizedSpans
    .map((s) => ({ span: s, ev: ws.evidence[s.evidenceId] }))
    .filter((x) => x.ev && !x.ev.flaggedWrong && body.toLowerCase().includes(x.span.text.toLowerCase().trim()));

  /* Different angle: next unused angle lazily (a run), else rotate through drafts already written. */
  const used = new Set([pkg.angleId, step.angleId, ...pkg.alternates.map((a) => a.angleId)].filter(Boolean));
  const unused = (pkg.angleOrder ?? []).filter((id) => !used.has(id));
  const canAngle = pkg.mode === "cold" && step.step === 1 && editable;
  const angleAvailable = canAngle && (unused.length > 0 || pkg.alternates.length > 0);
  /** Runs one paid or logged action at a time; repeats while it starts are dropped. */
  const once = async (fn: () => Promise<void>) => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    try {
      await fn();
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };
  // Pending keystrokes land on the outgoing draft before it moves into the alternates.
  const swapWhenDone = (r: { alternateIndex?: number }) => {
    const i = r.alternateIndex;
    if (i !== undefined) void flush().then(() => onSwap(i));
  };
  const differentAngle = () =>
    once(async () => {
      if (!angleAvailable || compose.busy) return;
      await flush();
      if (unused.length) {
        await compose.begin({ domain: pkg.accountDomain, personId: pkg.personId, packageId: pkg.id, alternate: true }, swapWhenDone);
      } else {
        onSwap(lastSwap === null ? 0 : (lastSwap + 1) % pkg.alternates.length);
      }
    });
  const previousAngle = async () => {
    if (!canAngle || lastSwap === null || compose.busy) return;
    await flush();
    onSwap(lastSwap);
  };
  const rewriteWithPov = () =>
    once(async () => {
      await compose.begin({ domain: pkg.accountDomain, personId: pkg.personId, packageId: pkg.id, alternate: true, angleId: step.angleId ?? pkg.angleId }, swapWhenDone);
    });

  /* Handoff */
  const canApprove = editable && !pf.blockers.length && !compose.busy && !starting;
  const approve = () =>
    once(async () => {
      if (!canApprove) return;
      await flush();
      await copyText(pkg.mode === "warm_intro" ? introText() : outgoing);
      const activityId = newId("act");
      // Answering a yes opens a deal at Talking when there's no open one (see the reducer).
      const opensDeal = pkg.mode === "reply" && pkg.replyAction === "book" && !(account?.dealId && OPEN_STAGES.includes(ws.deals[account.dealId]?.stage));
      const ok = await dispatch({ type: "outreach.approveStep", packageId: pkg.id, step: step.step, at: nowISO(), activityId });
      if (!ok) return;
      const sentTo =
        pkg.mode === "warm_intro"
          ? `Asked ${firstName(pkg.intro?.connectorName || "your connector")}. I'll track it in Intros and tell you when it's your move.`
          : opensDeal
            ? `Marked as sent and copied. ${account?.name ?? "They"} ${account ? "is" : "are"} now a deal at Talking; I'll keep it on Today until the call is booked.`
            : `Marked as sent${person ? ` to ${firstName(person.name)}` : ""}. Copied to your clipboard.`;
      toast(sentTo, {
        duration: 10_000,
        // Undo also reopens the card this approval finished (onApproved marks it done).
        action: { label: "Undo", onClick: () => void dispatch({ type: "outreach.unapproveStep", packageId: pkg.id, step: step.step, activityId, ...(moveId ? { moveIds: [moveId] } : {}) }) },
      });
      onApproved?.();
    });
  /** LinkedIn, step one of two: the invite went out. The message stays a draft until they accept. */
  const inviteSent = () =>
    once(async () => {
      if (!invitePending) return;
      await flush();
      const withNote = showNote && note?.trim() ? note.trim() : undefined;
      const copied = withNote ? await copyText(withNote) : false;
      const id = newId("act");
      const moveId = `mv_li_${pkg.id}`;
      const closeMove = ws.moves[moveId]?.status === "open";
      const ok = await dispatch([
        {
          type: "activity.log",
          activity: {
            id,
            at: nowISO(),
            kind: "linkedin_connect",
            channel: "linkedin",
            personId: pkg.personId,
            accountDomain: pkg.accountDomain,
            dealId: ws.accounts[pkg.accountDomain]?.dealId,
            draftRef: { packageId: pkg.id, step: step.step },
            body: withNote,
            summary: `LinkedIn invite to ${person?.name ?? account?.name ?? pkg.accountDomain}`,
            source: "founder",
          },
        },
        ...(closeMove ? [{ type: "move.done" as const, id: moveId }] : []),
      ]);
      if (!ok) return;
      toast(`Invite logged${copied ? " and the note copied" : ""}. Send the message once ${person ? firstName(person.name) : "they"} accept${person ? "s" : ""}.`, {
        duration: 10_000,
        action: {
          label: "Undo",
          onClick: () => void dispatch([{ type: "activity.remove", id }, ...(closeMove ? [{ type: "move.reopen" as const, id: moveId }] : [])]),
        },
      });
      onApproved?.();
    });
  const openGmail = async () => {
    await flush();
    setHandedOff(true);
    if (pkg.mode === "reply" && pf.to) {
      await copyText(outgoing);
      window.open(gmailFromUrl(ws, pf.to), "_blank", "noopener,noreferrer");
      toast("Copied. Paste it as your reply in their thread.");
      return;
    }
    if (step.thread === "reply") {
      await copyText(outgoing);
      window.open(gmailThreadUrl(ws, pf.to, firstSubject), "_blank", "noopener,noreferrer");
      toast("Copied. Open your first email and paste it as a reply, so it stays on one thread.");
      return;
    }
    const subj = pkg.mode === "warm_intro" ? `Intro to ${person?.name ?? account?.name ?? pkg.accountDomain}?` : subject;
    const text = pkg.mode === "warm_intro" ? introText() : outgoing;
    const url = gmailComposeUrl(ws, { to: pkg.mode === "warm_intro" ? (ws.connectors.find((c) => c.id === pkg.connectorId)?.email ?? null) : pf.to, subject: subj, body: text });
    if (!url) {
      await copyText(text);
      toast("Too long for a Gmail link, so I copied it instead.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };
  const openMailApp = async () => {
    await flush();
    setHandedOff(true);
    const url = mailtoUrl({ to: pf.to, subject: step.thread === "reply" && firstSubject ? `Re: ${firstSubject}` : subject, body: outgoing });
    if (url) window.location.href = url;
    else {
      await copyText(outgoing);
      toast("Too long for a mail link, so I copied it instead.");
    }
  };
  const push = async () => {
    if (!sequencer || pushing) return;
    await flush();
    setPushing(true);
    const r = await pushToSequencer(pkg.id, step.step, sequencer.id);
    setPushing(false);
    if (r.ok) {
      setHandedOff(true);
      toast(`Pushed to ${sequencer.label}. It sends from there.`);
      void refresh();
    } else toast(r.message);
  };
  const introText = () =>
    [wrapper.trim(), "", "---", "", subject ? `Subject: ${subject}` : "", "", body.trim(), so ? `\n${so}` : ""].filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");

  /* Keys: A approve · E edit · ] different angle · [ previous. Never while typing. */
  const onKey = (e: KeyboardEvent | ReactKeyboardEvent) => {
    if (e.repeat) return;
    if (e.metaKey || e.ctrlKey || e.altKey || TYPING(e.target)) return;
    if (e.key === "a" || e.key === "A") {
      e.preventDefault();
      void (invitePending ? inviteSent() : approve());
    } else if (e.key === "e" || e.key === "E") {
      e.preventDefault();
      bodyRef.current?.focus();
    } else if (e.key === "]") {
      e.preventDefault();
      void differentAngle();
    } else if (e.key === "[") {
      e.preventDefault();
      void previousAngle();
    }
  };
  const keyRef = useRef(onKey);
  useEffect(() => {
    keyRef.current = onKey;
  });
  useEffect(() => {
    if (!focused) return;
    const listener = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return; // palette, Ask or a sheet owns the keyboard (same guard as Today)
      keyRef.current(e);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [focused]);

  const fixable = pf.blockers.filter((b) => b.fix);
  // Suppression is a hard block: no copy, no Gmail, no push. The check line says why.
  const hardBlocked = pf.blockers.some((b) => b.code === "suppressed" || b.code === "do_not_contact");
  const povMissing = lint.violations.some((v) => v.code === "POV_MISSING") && !ws.povs.length && !ws.claims.some((c) => c.approved && c.kind === "credential");
  const next = step.status === "sent" ? nextFollowUp(pkg, undefined, ws.activities) : null;
  const replied = pkg.mode === "cold" && step.status === "sent" && repliedSinceFirstTouch(pkg, ws.activities);
  const ink = step.edited || !editable;

  return (
    <motion.div
      initial={animateIn ? { opacity: 0, y: 4 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: ease.out }}
      onKeyDown={focused ? undefined : onKey}
      className="@container"
    >
      <div className={cn("relative rounded-md py-3 pr-3 pl-4 transition-colors duration-200", focused ? "draft-wash" : "draft-rule")}>
        <div className="max-w-[68ch]">
          {/* Header */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-5">
            <span className={cn("font-medium", editable ? "text-accent-text" : "text-fg-3")}>
              {step.status === "sent"
                ? `Sent ${shortDate(step.sentAt)}`
                : step.status === "approved"
                  ? "Handed off"
                  : step.status === "skipped"
                    ? "Skipped"
                    : step.status === "cancelled_by_reply"
                      ? "Stopped"
                      : "Draft"}
            </span>
            <span className="text-fg-4">·</span>
            <span className="text-fg-2">{stepLabel(pkg, step)}</span>
            {person && (
              <>
                <span className="text-fg-4">·</span>
                <span className="min-w-0 truncate text-fg-2">
                  {pkg.mode === "warm_intro" ? "for " : "to "}
                  <span className="text-fg">{person.name}</span>
                  {person.title && <span className="text-fg-3">, {person.title}</span>}
                </span>
              </>
            )}
            {pf.to && pkg.mode !== "linkedin" && pkg.mode !== "warm_intro" && <span className="max-w-full truncate font-mono text-[11.5px] text-fg-3">{pf.to}</span>}
            {step.sendOn && editable && step.step > 1 && <Badge tone="outline">due {shortDate(step.sendOn)}</Badge>}
            {pushed && <Badge tone="neutral">In {sequencer?.label}</Badge>}
          </div>

          {/* Drafts another agent submitted through the API: say so before the founder reads a word. */}
          {pkg.origin?.kind === "agent" && step.status === "draft" && (
            <p className="mt-1.5 text-[12px] leading-[18px] text-warning">
              Written by {pkg.origin.keyName}, not by me. Check every fact and claim before you approve it.
              {pkg.origin.note && <span className="text-fg-3"> Their note: {pkg.origin.note}</span>}
            </p>
          )}

          {compose.run && (compose.busy || compose.run.status === "error") && <WorkLog run={compose.run} defaultOpen className="mt-3" />}

          {pkg.mode === "reply" && pkg.reply && <QuotedReply ws={ws} pkg={pkg} />}

          {/* Warm intro: the note to the connector first */}
          {pkg.mode === "warm_intro" && pkg.intro && (
            <div className="mt-3">
              <p className="mb-1 text-[11.5px] font-medium text-fg-3">To {pkg.intro.connectorName || "your connector"}</p>
              {editable && <ConnectorAdvice ws={ws} connectorId={pkg.connectorId} />}
              <div className={cn(ink ? "text-fg" : "text-fg-2")}>
                <SpanEditor value={wrapper} onChange={(v) => edit({ wrapper: v })} onBlur={() => void flush()} spans={[]} readOnly={locked} ariaLabel="Note to the connector" />
              </div>
              <p className="mt-3 mb-1 text-[11.5px] font-medium text-fg-3">The note they can forward</p>
            </div>
          )}

          {/* LinkedIn: invite note, or the recommendation to send none */}
          {pkg.mode === "linkedin" && pkg.linkedin && (
            <div className="mt-3">
              <p className="mb-1 text-[11.5px] font-medium text-fg-3">
                Connection request
                {invite && <span className="font-normal text-fg-4"> · Invite sent {shortDate(invite.at)}</span>}
              </p>
              {showNote ? (
                <div className={cn(ink ? "text-fg" : "text-fg-2")}>
                  <SpanEditor value={note ?? ""} onChange={(v) => edit({ note: v })} onBlur={() => void flush()} spans={[]} readOnly={locked || Boolean(invite)} ariaLabel="Connection note" placeholder="A short note, no pitch." />
                  {!invite && (
                    <div className="mt-1 flex items-center justify-between text-[11.5px]">
                      <button
                        type="button"
                        onClick={() => {
                          setShowNote(false);
                          edit({ note: null });
                        }}
                        className="text-fg-3 hover:text-fg-2"
                        disabled={locked}
                      >
                        Send without a note
                      </button>
                      <span className={cn("font-mono tnum", (note?.length ?? 0) > LIMITS.liNoteChars ? "text-danger" : "text-fg-3")}>
                        {note?.length ?? 0}/{LIMITS.liNoteChars}
                      </span>
                    </div>
                  )}
                </div>
              ) : !invite ? (
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <p className="font-serif text-[15px] leading-[22px] text-fg-2">
                    Send the invite without a note. A note doesn&apos;t raise acceptance (about 26% either way), and free accounts get 3 a month.
                  </p>
                  {editable && (
                    <button type="button" onClick={() => setShowNote(true)} className="text-[12px] text-accent-text hover:underline">
                      Write a note anyway
                    </button>
                  )}
                </div>
              ) : null}
              <p className="mt-4 mb-1 text-[11.5px] font-medium text-fg-3">After they accept (wait a day)</p>
            </div>
          )}

          {/* Subject */}
          {isEmail || pkg.mode === "warm_intro" ? (
            step.thread === "reply" ? (
              <p className="mt-3 text-[13px] text-fg-3">
                {firstSubject ? <>Re: {firstSubject}</> : "Reply"} <span className="text-fg-4">· same thread</span>
              </p>
            ) : (
              <input
                value={subject ?? ""}
                onChange={(e) => edit({ subject: e.target.value })}
                onBlur={() => void flush()}
                readOnly={locked}
                aria-label="Subject"
                placeholder="Subject"
                className={cn(
                  "mt-3 w-full bg-transparent text-[15px] leading-6 font-semibold outline-none placeholder:font-normal placeholder:text-fg-4",
                  ink ? "text-fg" : "text-fg-2",
                )}
              />
            )
          ) : null}

          {/* Body */}
          <div className={cn(isEmail || pkg.mode === "warm_intro" ? "mt-1.5" : "mt-0", ink ? "text-fg" : "text-fg-2", "transition-colors duration-200")}>
            <SpanEditor
              ref={bodyRef}
              value={body}
              onChange={(v) => edit({ body: v })}
              onBlur={() => void flush()}
              spans={spanMarks}
              readOnly={locked}
              ariaLabel={pkg.mode === "linkedin" ? "Message after they accept" : "Email body"}
              gutterClassName="hidden @min-[800px]:block"
            />
          </div>

          {/* Narrow layouts: sources as chips */}
          {chips.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 @min-[800px]:hidden">
              {chips.map(({ span, ev }) => (
                <SourceChip
                  key={span.evidenceId + span.text}
                  url={ev!.url}
                  publishedAt={ev!.publishedAt}
                  quote={ev!.quote}
                  claim={span.text}
                  confidence={ev!.confidence}
                  onFlagWrong={() => void dispatch({ type: "evidence.flagWrong", id: ev!.id, at: nowISO() })}
                />
              ))}
            </div>
          )}

          {/* Sign-off + footer: code-generated, shown exactly as it will go out */}
          {isEmail && pkg.mode !== "reply" && (so || pf.footer) && (
            <div className="mt-4 border-t border-dashed border-border pt-3">
              {so && <p className={cn("text-[15px] leading-6", ink ? "text-fg" : "text-fg-2")}>{so}</p>}
              {pf.footer && <p className="mt-2 text-[12.5px] leading-[19px] whitespace-pre-line text-fg-3">{pf.footer}</p>}
              {pf.footer && (
                <p className="mt-1.5 text-[11px] text-fg-4">
                  Footer added on send
                  {pf.jurisdiction.value === "US" ? " · CAN-SPAM" : pf.jurisdiction.value === "EU" || pf.jurisdiction.value === "UK" ? " · GDPR Art. 14" : pf.jurisdiction.value === "unknown" ? " · strictest wording, location unknown" : ""}
                </p>
              )}
            </div>
          )}
          {pkg.mode === "reply" && so && <p className={cn("mt-3 text-[15px] leading-6", ink ? "text-fg" : "text-fg-2")}>{so}</p>}

          {/* One-line check */}
          {editable && (
            <div className="mt-4">
              <CheckLine lint={lint} blocker={blocker} count={count} open={details} onToggle={() => setDetails((d) => !d)} />
              {details && <CheckDetails lint={lint} blockers={pf.blockers} warnings={[...pf.warnings, ...pkg.warnings.filter((w) => !pf.warnings.includes(w))]} />}
            </div>
          )}

          {/* Blockers you can fix right here */}
          {editable && (fixable.length > 0 || povMissing) && (
            <div className="mt-3 space-y-2.5">
              {fixable.map((b) =>
                b.fix === "sender" ? (
                  <SenderForm key={b.code} />
                ) : b.fix === "recipient" ? (
                  <RecipientForm key={b.code} pkg={pkg} />
                ) : b.fix === "email" && person ? (
                  <RecipientForm key={b.code} pkg={pkg} person={person} />
                ) : b.fix === "verify" && person && pf.to ? (
                  <VerifyGuess key={b.code} person={person} address={pf.to} />
                ) : b.fix === "linkedin" ? (
                  <div key={b.code} className="rounded-md bg-bg-subtle p-3 ring-1 ring-border">
                    <p className="mb-2.5 text-[13px] text-fg">{b.text}</p>
                    <ComposeButton domain={pkg.accountDomain} personId={pkg.personId} angleId={pkg.angleId} mode="linkedin" label="Write a LinkedIn message instead" />
                  </div>
                ) : null,
              )}
              {povMissing && !compose.busy && <PovForm onSaved={() => void rewriteWithPov()} />}
            </div>
          )}
          {editable && pkg.mode === "reply" && pkg.replyAction === "book" && !ws.founder.availability && !ws.founder.schedulingUrl && (
            <div className="mt-3">
              <AvailabilityForm />
            </div>
          )}

          {/* Sent: what happens next */}
          {step.status === "sent" && (
            <SentFooter pkg={pkg} next={next} replied={replied} />
          )}
          {step.status === "cancelled_by_reply" && <p className="mt-3 text-[12.5px] text-fg-3">They replied, so the rest of this sequence stopped.</p>}
          {step.status === "approved" && step.step === 1 && senderOwnsSequence(pkg) && (
            <p className="mt-3 text-[12.5px] text-fg-3">In {sequenceOwnerName(pkg)}. Its campaign sends the follow-ups and stops them when they reply.</p>
          )}

          {/* Handoff */}
          {editable && !hardBlocked && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {/* Open it where it's sent first; "Mark as sent" becomes the main step once it has left the app. */}
              {pkg.mode !== "linkedin" && (
                <Button variant={!handedOff && pf.blockers.length === 0 ? "primary" : "secondary"} size="sm" icon={<ArrowUpRight className="size-3.5" />} onClick={() => void openGmail()}>
                  {step.thread === "reply" || pkg.mode === "reply" ? "Open thread in Gmail" : "Open in Gmail"}
                </Button>
              )}
              {invitePending ? (
                <Button variant="primary" size="sm" icon={<Check className="size-3.5" />} onClick={() => void inviteSent()} disabled={starting} kbd={focused ? "A" : undefined}>
                  Invite sent
                </Button>
              ) : (
                <Button
                  variant={handedOff || pkg.mode === "linkedin" ? "primary" : "secondary"}
                  size="sm"
                  icon={<Check className="size-3.5" />}
                  onClick={() => void approve()}
                  disabled={!canApprove}
                  kbd={focused ? "A" : undefined}
                >
                  {pkg.mode === "linkedin" ? "Message sent" : "Mark as sent"}
                </Button>
              )}
              {invitePending && showNote && note && <CopyButton text={note} label="Copy note" className="h-7" onCopied={() => setHandedOff(true)} />}
              <CopyButton
                text={pkg.mode === "warm_intro" ? introText() : outgoing}
                label={pkg.mode === "linkedin" ? "Copy message" : "Copy"}
                className="h-7"
                onCopied={() => setHandedOff(true)}
              />
              {pkg.mode === "linkedin" && person?.linkedinUrl && (
                <a
                  href={person.linkedinUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-[12px] font-medium text-fg-2 ring-1 ring-border transition-[background-color,transform] duration-150 hover:bg-bg-subtle active:scale-[0.97]"
                >
                  <ExternalLink className="size-3.5" /> Open profile
                </a>
              )}
              {sequencer && !pushed && (
                <Button variant="secondary" size="sm" icon={<Send className="size-3.5" />} onClick={() => void push()} loading={pushing} disabled={pf.blockers.length > 0}>
                  Push to {sequencer.label}
                </Button>
              )}
              <span className="flex-1" />
              {canAngle && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Shuffle className="size-3.5" />}
                  onClick={() => void differentAngle()}
                  disabled={!angleAvailable || compose.busy || starting}
                  title={angleAvailable ? "Write it from another angle, not a paraphrase" : "No other angle yet. Research again for fresh signals."}
                >
                  Different angle <Kbd className="ml-0.5">]</Kbd>
                </Button>
              )}
              <Menu
                trigger={
                  <IconButton label="More">
                    <MoreHorizontal className="size-4" />
                  </IconButton>
                }
              >
                {isEmail && <MenuItem onSelect={() => void openMailApp()}>Open in another mail app</MenuItem>}
                {subject && <MenuItem onSelect={() => void copyText(subject).then((ok) => ok && toast("Subject copied."))}>Copy subject</MenuItem>}
                {canAngle && lastSwap !== null && (
                  <>
                    <MenuSeparator />
                    <MenuItem icon={<RotateCcw className="size-3.5" />} hint="[" onSelect={() => void previousAngle()}>
                      Previous angle
                    </MenuItem>
                  </>
                )}
              </Menu>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function SentFooter({ pkg, next, replied }: { pkg: OutreachPackage; next: ReturnType<typeof nextFollowUp>; replied: boolean }) {
  const compose = useCompose();
  const startingRef = useRef(false);
  const [starting, setStarting] = useState(false);
  if (!next) {
    const done = pkg.mode === "cold" && pkg.steps.filter((s) => s.status === "sent").length >= 3;
    return (
      <p className="mt-3 text-[12.5px] text-fg-3">
        {replied ? "They replied, so the rest of this sequence stopped." : done ? "Sequence done. If they stay quiet, a blank LinkedIn invite is the last move." : "Logged as sent."}
      </p>
    );
  }
  const writeFollowUp = async () => {
    if (startingRef.current || compose.busy) return;
    startingRef.current = true;
    setStarting(true);
    try {
      await compose.begin({ domain: pkg.accountDomain, personId: pkg.personId, packageId: pkg.id, mode: "follow_up" });
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };
  const label = next.step === 3 ? "last follow-up" : `follow-up ${next.step - 1}`;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <p className="text-[12.5px] text-fg-3">
        {next.due ? `${label[0].toUpperCase()}${label.slice(1)} is due.` : `${label[0].toUpperCase()}${label.slice(1)} is due ${shortDate(next.dueOn)}. I'll write it then.`}
      </p>
      {next.due && !next.drafted && (
        <Button
          variant="agent"
          size="xs"
          icon={<PenLine className="size-3" />}
          loading={compose.busy || starting}
          onClick={() => void writeFollowUp()}
        >
          Write {label}
        </Button>
      )}
      {compose.run && (compose.busy || compose.run.status === "error") && <WorkLog run={compose.run} defaultOpen className="w-full" />}
    </div>
  );
}

const INTENT_LABEL: Record<NonNullable<OutreachPackage["reply"]>["intent"], string> = {
  positive: "Wants to talk",
  info_request: "Wants info",
  referral: "Referred you",
  not_now: "Not now",
  objection: "Objection",
  negative: "Not interested",
  unsubscribe: "Unsubscribe",
  ooo: "Out of office",
};

function replyLine(pkg: OutreachPackage, ws: Workspace): string {
  const intent = pkg.reply?.intent;
  switch (intent) {
    case "positive":
      return ws.founder.availability || ws.founder.schedulingUrl ? "I offered two times from your availability." : "I offered two half-days; add your availability for exact times.";
    case "info_request":
      return "I asked one qualifying question before sending anything.";
    case "referral":
      return pkg.reply?.referral?.name ? `They pointed you to ${pkg.reply.referral.name}. Thank them, then write to ${firstName(pkg.reply.referral.name)} mentioning them.` : "They pointed you elsewhere. Thank them, then write to that person.";
    case "not_now":
      return pkg.nurtureUntil ? `I asked what would make it a priority and proposed checking back ${shortDate(pkg.nurtureUntil)}.` : "I asked what would make it a priority.";
    case "objection":
      return "I acknowledged it and asked whether it's the only thing in the way.";
    case "negative":
      return "A one-line thank-you. No push.";
    case "unsubscribe":
      return "They asked not to be contacted. I won't draft anything.";
    case "ooo":
      return "An automatic out-of-office. Your sequence stays on; I'll write the next step when it's due.";
    default:
      return "";
  }
}

function QuotedReply({ ws, pkg }: { ws: Workspace; pkg: OutreachPackage }) {
  const [open, setOpen] = useState(false);
  const person = pkg.personId ? ws.people[pkg.personId] : undefined;
  if (!pkg.reply) return null;
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-fg-3">{person ? `${firstName(person.name)} replied` : "Their reply"}</span>
        <Badge tone="outline">{INTENT_LABEL[pkg.reply.intent]}</Badge>
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn("mt-1.5 w-full border-l-2 border-border pl-3 text-left text-[13px] leading-5 whitespace-pre-line text-fg-3", open ? "block" : "line-clamp-3")}
      >
        {pkg.reply.text}
      </button>
      <p className="mt-2.5 flex items-start gap-2 font-serif text-[15px] leading-[22px] text-fg-2">
        <Orb size={10} className="mt-[7px]" />
        {replyLine(pkg, ws)}
      </p>
      {pkg.reply.intent === "referral" && pkg.reply.referral?.name && <ReferralCompose ws={ws} pkg={pkg} name={pkg.reply.referral.name} email={pkg.reply.referral.email} />}
    </div>
  );
}

/** The person a referral named, if they're already in the workspace: by email first, then by name (any company). */
function referredPerson(ws: Workspace, name: string, email: string | undefined): Person | undefined {
  const people = Object.values(ws.people);
  const byEmail = email ? people.find((p) => p.email?.toLowerCase() === email || p.contactPaths.some((c) => c.value.toLowerCase() === email)) : undefined;
  return byEmail ?? people.find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());
}

/**
 * A referral is the warmest lead a founder gets: one click adds the person they named and drafts a
 * first touch that says who sent you. The draft opens inline, never in a layer on top.
 */
function ReferralCompose({ ws, pkg, name, email }: { ws: Workspace; pkg: OutreachPackage; name: string; email?: string }) {
  return <ReferralWrite ws={ws} name={name} email={email} referrerId={pkg.personId} fallbackDomain={pkg.accountDomain} />;
}

/**
 * The same one click for a referral from anywhere (a reply, a call's debrief): adds the person if
 * they're new and drafts the first touch that says who sent you. `domain` pins their company when
 * it's known; otherwise it's their email's domain, else `fallbackDomain` (the referrer's company).
 * `quote`: the referrer's words when they came from a call. `how`: appended to "Referred by …".
 */
export function ReferralWrite({
  ws,
  name,
  email: rawEmail,
  referrerId,
  personId,
  domain: pinned,
  fallbackDomain,
  quote,
  how,
  className,
}: {
  ws: Workspace;
  name: string;
  email?: string;
  referrerId?: string;
  personId?: string;
  domain?: string;
  fallbackDomain: string;
  quote?: string;
  how?: string;
  className?: string;
}) {
  const { dispatch } = useWorkspace();
  const compose = useCompose();
  const [packageId, setPackageId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const email = rawEmail?.trim().toLowerCase() || undefined;
  const referrer = referrerId ? ws.people[referrerId] : undefined;
  const known = (personId ? ws.people[personId] : undefined) ?? (pinned ? undefined : referredPerson(ws, name, email));
  const open = known ? findOpenDraft(ws, { domain: known.accountDomain, personId: known.id, mode: "cold" }) : undefined;
  const shown = packageId ? ws.outreach[packageId] : undefined;
  const first = firstName(name);

  const write = async () => {
    if (open) {
      setPackageId(open.id);
      return;
    }
    if (adding || compose.busy) return;
    setAdding(true);
    const actions: Action[] = [];
    const via = referrer?.name ?? "a referral";
    const path = email ? { kind: "published_email" as const, value: email, via, verified: false, founderConfirmed: true } : undefined;
    let person = known;
    if (!person) {
      // Their company: the email's domain unless it's a personal address, else the referrer's company.
      const host = email && !PERSONAL_DOMAINS.test(email) ? email.split("@")[1] : undefined;
      const domain = pinned || (host && (Object.keys(ws.accounts).find((d) => host === d || host.endsWith(`.${d}`)) ?? host)) || fallbackDomain;
      if (!ws.accounts[domain]) {
        actions.push({
          type: "account.add",
          account: {
            domain,
            name: domain.split(".")[0].replace(/^./, (c) => c.toUpperCase()),
            status: "new",
            source: "referral",
            sourceDetail: referrer ? `Referred by ${referrer.name}` : undefined,
            addedAt: nowISO(),
            fitScore: 0,
            tier: "C",
            criteria: [],
            signals: [],
            whyNow: null,
            whyNowScore: 0,
            peopleIds: [],
            warmPathCount: 0,
            watch: false,
          },
        });
      }
      person = {
        id: newId("per"),
        accountDomain: domain,
        name: name.trim(),
        title: "",
        email,
        evidenceIds: [],
        confidence: "medium",
        mayHaveLeft: false,
        contactPaths: path ? [path] : [],
        jurisdiction: "unknown",
        doNotContact: false,
        notes: `Referred by ${via}${how ? ` ${how}` : ""}`,
        source: "referral",
      };
      actions.push({ type: "person.upsert", person });
    } else if (path && !resolveEmail(person).to) {
      person = { ...person, email, contactPaths: [...person.contactPaths, path] };
      actions.push({ type: "person.upsert", person });
    }
    const ok = actions.length ? await dispatch(actions) : true;
    setAdding(false);
    if (!ok) return;
    await compose.begin({ domain: person.accountDomain, personId: person.id, mode: "cold", referredBy: referrer?.id, ...(quote ? { referralQuote: quote } : {}) }, (r) => setPackageId(r.packageId));
  };

  return (
    // Keys inside this draft belong to it, not to the reply draft around it.
    <div className={cn("mt-2.5 space-y-3", className)} onKeyDown={(e) => e.stopPropagation()}>
      {!shown && (
        <Button variant="agent" size="xs" icon={<PenLine className="size-3" />} onClick={() => void write()} loading={adding || compose.busy}>
          {open ? `Open your draft to ${first}` : `Write to ${first}`}
        </Button>
      )}
      {compose.run && (compose.busy || compose.run.status === "error") && <WorkLog run={compose.run} defaultOpen />}
      {shown && <DraftView pkg={shown} />}
    </div>
  );
}

/** Reply packages without a draft (unsubscribe, out of office). */
function ReplyOnly({ ws, pkg }: { ws: Workspace; pkg: OutreachPackage }) {
  const { dispatch } = useWorkspace();
  const person = pkg.personId ? ws.people[pkg.personId] : undefined;
  const email = resolveEmail(person).to;
  // One person opting out suppresses that address (and marks them do-not-contact), never their whole company.
  const suppressed = Boolean(person?.doNotContact) || ws.suppression.some((s) => (email && s.email?.toLowerCase() === email.toLowerCase()) || (!person && s.domain === pkg.accountDomain));
  // EU, UK and unknown places got the footer that promises deletion on "stop": offer it first there.
  const promised = person ? footerPromisesDeletion(jurisdictionFor(ws, person, pkg.accountDomain).value) : false;
  const [forgetting, setForgetting] = useState(promised);
  return (
    <div className="draft-rule rounded-md py-3 pr-3 pl-4">
      <div className="max-w-[68ch]">
        <QuotedReply ws={ws} pkg={pkg} />
        {pkg.replyAction === "suppress" && person && forgetting && (
          <div className="mt-3 animate-[fade-in_150ms_var(--ease-out)]">
            {promised && <p className="mb-1.5 text-[12.5px] font-medium text-fg">Your footer told {firstName(person.name)} you&apos;d delete their details if they asked.</p>}
            <ForgetPerson person={person} onCancel={promised ? undefined : () => setForgetting(false)} reveal={!promised} />
          </div>
        )}
        {pkg.replyAction === "suppress" && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {suppressed ? (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-2">
                <Check className="size-3.5 text-success" /> On your suppression list. I won&apos;t draft to them again.
              </span>
            ) : (
              <Button
                variant={promised ? "secondary" : "primary"}
                size="sm"
                onClick={() => {
                  const at = nowISO();
                  void dispatch([
                    ...(email || !person ? [{ type: "suppression.add" as const, entry: { id: newId("sup"), email: email ?? undefined, domain: email ? undefined : pkg.accountDomain, reason: "unsubscribe" as const, at } }] : []),
                    ...(person ? [{ type: "person.upsert" as const, person: { ...person, doNotContact: true } }] : []),
                  ]);
                }}
              >
                {promised && person ? `Only suppress ${firstName(person.name)}` : `Add ${person ? firstName(person.name) : "them"} to your suppression list`}
              </Button>
            )}
            {person && !forgetting && (
              <button type="button" onClick={() => setForgetting(true)} className="h-7 px-1 text-[12.5px] text-fg-2 underline-offset-4 hover:text-fg hover:underline">
                Delete their details
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** In place of a draft whose person was deleted at their request. */
function ForgottenNote() {
  return (
    <p className="flex items-center gap-1.5 py-1 text-[12.5px] text-fg-2 animate-[fade-in_150ms_var(--ease-out)]">
      <Check className="size-3.5 text-success" aria-hidden /> Their details are deleted. Only their email stays, on your suppression list.
    </p>
  );
}

function DraftSkeleton() {
  return (
    <div className="draft-rule rounded-md py-3 pr-3 pl-4 opacity-0 animate-[fade-in_150ms_150ms_var(--ease-out)_forwards]" aria-busy aria-label="Loading draft">
      <div className="max-w-[68ch] space-y-3">
        <Skeleton className="h-3.5 w-48" />
        <Skeleton className="h-5 w-56" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-[94%]" />
          <Skeleton className="h-4 w-[88%]" />
          <Skeleton className="h-4 w-[60%]" />
        </div>
        <Skeleton className="h-3.5 w-28" />
        <div className="flex gap-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-7 w-16" />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── ComposeButton ─────────────────────────────── */

/** The newest reply the founder logged with its text (Check replies, the timeline), if any. */
function latestLoggedReply(ws: Workspace, domain: string, personId?: string) {
  return ws.activities
    .filter((a) => a.kind === "reply_received" && a.body && (personId ? a.personId === personId : a.accountDomain === domain))
    .sort((a, b) => b.at.localeCompare(a.at))[0];
}

/** An open draft we can reuse instead of paying for a new one. */
function findOpenDraft(ws: Workspace, q: { domain: string; personId?: string; angleId?: string; mode: OutreachPackage["mode"]; connectorId?: string }): OutreachPackage | undefined {
  if (q.mode === "reply") {
    const reply = latestLoggedReply(ws, q.domain, q.personId);
    if (!reply) return undefined;
    return Object.values(ws.outreach).find((p) => p.mode === "reply" && p.accountDomain === q.domain && p.reply?.text === reply.body?.slice(0, 4000));
  }
  // One cold thread per person: their open draft, or the sequence under way (its follow-ups live there),
  // whichever angle card or person row asked. Different angles are reached with "]" inside the draft.
  if (q.mode === "cold" && q.personId) {
    return Object.values(ws.outreach)
      .filter((p) => p.mode === "cold" && p.personId === q.personId && (p.steps.some((s) => s.status === "draft") || recentFirstTouch(p) !== undefined))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }
  const wanted = q.mode === "follow_up" ? "cold" : q.mode;
  return Object.values(ws.outreach)
    .filter((p) => p.accountDomain === q.domain && p.mode === wanted && (!q.personId || p.personId === q.personId))
    // An intro ask through a named connector opens that connector's draft, not another path's.
    .filter((p) => !q.connectorId || p.connectorId === q.connectorId)
    .filter((p) => !q.angleId || p.angleId === q.angleId || [...p.steps, ...p.alternates].some((s) => s.angleId === q.angleId))
    .filter((p) => (q.mode === "follow_up" ? p.steps.some((s) => s.step > 1 && s.status === "draft") : p.steps.some((s) => s.status === "draft")))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/**
 * Starts the compose workflow for a company/person/angle and shows the live work log, then the
 * resulting draft inline. Never opens a modal on top of a sheet. Reuses an open draft when one
 * exists (no tokens spent). Before the first draft ever, asks for 2–3 of the founder's emails.
 */
export function ComposeButton({
  domain,
  personId,
  angleId,
  mode = "cold",
  label = "Write outreach",
  connectorId,
  ensureConnector,
  variant,
}: {
  domain: string;
  personId?: string;
  angleId?: string;
  mode?: OutreachPackage["mode"];
  label?: string;
  /** Warm intros: ask through this connector. */
  connectorId?: string;
  /** Warm intros through someone not yet listed as a connector: files them, then returns their id. */
  ensureConnector?: () => Promise<string | undefined>;
  variant?: "agent" | "secondary";
}) {
  const { ws } = useWorkspace();
  const { runs, start } = useRuns();
  const compose = useCompose();
  const [phase, setPhase] = useState<"idle" | "voice" | "paste" | "work" | "draft">("idle");
  const [packageId, setPackageId] = useState<string | null>(null);
  const [researchId, setResearchId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [receivedAt, setReceivedAt] = useState("");

  const existing = useMemo(() => (ws && (connectorId || !ensureConnector) ? findOpenDraft(ws, { domain, personId, angleId, mode, connectorId }) : undefined), [ws, domain, personId, angleId, mode, connectorId, ensureConnector]);
  const pkg = packageId ? ws?.outreach[packageId] : undefined;
  const account = ws?.accounts[domain];
  const research = researchId ? runs[researchId] : undefined;

  const run = async (replyText?: string) => {
    setPhase("work");
    const via = connectorId ?? (ensureConnector ? await ensureConnector() : undefined);
    const state = await compose.begin(
      {
        domain,
        personId,
        angleId,
        mode,
        ...(via ? { connectorId: via } : {}),
        replyText,
        receivedAt: replyText && receivedAt ? new Date(receivedAt).toISOString() : undefined,
      },
      (r) => {
        setPackageId(r.packageId);
        setPhase("draft");
      },
    );
    if (!state) setPhase("idle");
  };

  const open = () => {
    if (existing) {
      setPackageId(existing.id);
      setPhase("draft");
      return;
    }
    if (mode === "reply") {
      // Already logged with its text: read that one instead of asking for it again.
      if (ws && latestLoggedReply(ws, domain, personId)) void run();
      else setPhase("paste");
      return;
    }
    const firstEver = ws && Object.keys(ws.outreach).length === 0 && !ws.voice?.samples.length;
    if (firstEver && mode !== "follow_up") {
      setPhase("voice");
      return;
    }
    void run();
  };

  const researchFirst = async () => {
    const state = await start("dossier", { domain }, { notify: false, onResult: () => void run() });
    if (state) setResearchId(state.id);
  };

  const needsPremise = compose.run?.status === "error" && /research it first/i.test(compose.run.error?.message ?? "");
  // EU/UK guessed address, Canada (CASL), or guesses paused by bounces: retrying email fails the same way.
  const needsLinkedIn = mode !== "linkedin" && compose.run?.status === "error" && /LinkedIn or (a warm |an )?intro|Try LinkedIn|guessed addresses are paused/i.test(compose.run.error?.message ?? "");

  return (
    // Once open, take a full row: in flex-wrap parents (person rows, angle cards) the draft must never be squeezed beside other content.
    <div className={cn("min-w-0 space-y-3", phase !== "idle" && "w-full basis-full")}>
      {phase === "idle" && (
        <Button variant={existing ? "secondary" : (variant ?? "agent")} size="sm" icon={<PenLine className="size-3.5" />} onClick={open} disabled={!ws}>
          {existing ? (mode === "follow_up" ? "Open follow-up" : existing.steps.some((s) => s.status === "draft") ? "Open draft" : "Open sequence") : label}
        </Button>
      )}

      {phase === "voice" && <VoicePrompt onContinue={() => void run()} />}

      {phase === "paste" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reply.trim().length > 1) void run(reply.trim());
          }}
          className="rounded-lg bg-surface p-3 ring-1 ring-border animate-[rise-in_180ms_var(--ease-out)]"
        >
          <Label htmlFor={`reply-${domain}`}>Paste their reply</Label>
          <Textarea id={`reply-${domain}`} value={reply} onChange={(e) => setReply(e.target.value)} className="min-h-24" placeholder="Their whole reply, as it arrived." autoFocus />
          <div className="mt-2.5 flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor={`reply-at-${domain}`} hint="Optional">
                Received
              </Label>
              <Input id={`reply-at-${domain}`} type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} className="w-auto font-mono text-[12px]" />
            </div>
            <span className="flex-1" />
            <Button type="button" variant="ghost" size="sm" onClick={() => setPhase("idle")}>
              Cancel
            </Button>
            <Button type="submit" variant="agent" size="sm" disabled={reply.trim().length < 2}>
              Read it and draft a reply
            </Button>
          </div>
        </form>
      )}

      {phase === "work" && compose.run && <WorkLog run={compose.run} defaultOpen />}
      {phase === "work" && compose.run?.status === "error" && (
        <div className="flex flex-wrap items-center gap-2">
          {needsPremise ? (
            <Button variant="agent" size="sm" onClick={() => void researchFirst()} loading={research?.status === "running" || research?.status === "queued"}>
              Research {account?.name ?? domain}, then write
            </Button>
          ) : needsLinkedIn ? (
            <ComposeButton domain={domain} personId={personId} angleId={angleId} mode="linkedin" label="Write a LinkedIn message instead" />
          ) : (
            <Button variant="secondary" size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => void run(mode === "reply" ? reply.trim() : undefined)}>
              Try again
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              compose.reset();
              setPhase("idle");
            }}
          >
            Dismiss
          </Button>
        </div>
      )}
      {research && (research.status === "running" || research.status === "queued") && <WorkLog run={research} defaultOpen />}

      {phase === "draft" && (
        <div className="space-y-2">
          <div className="flex min-h-6 items-center gap-2">
            {compose.run ? (
              <WorkLog run={compose.run} className="min-w-0 flex-1" />
            ) : (
              <span className="min-w-0 flex-1 truncate text-[12px] text-fg-3">{pkg ? `Drafted ${shortDate(pkg.createdAt)}` : ""}</span>
            )}
            <Button variant="ghost" size="xs" icon={<X className="size-3" />} onClick={() => setPhase("idle")}>
              Hide
            </Button>
          </div>
          {pkg ? <DraftView pkg={pkg} /> : personId && ws && !ws.people[personId] ? <ForgottenNote /> : <DraftSkeleton />}
        </div>
      )}
    </div>
  );
}

/** Before an intro ask goes out: is this connector already carrying one, resting, or owed a give? */
function ConnectorAdvice({ ws, connectorId }: { ws: Workspace; connectorId?: string }) {
  const connector = connectorId ? ws.connectors.find((c) => c.id === connectorId) : undefined;
  if (!connector) return null;
  const l = ledger(ws, connector, todayISO());
  // The ask being drafted is still a draft, so an "in flight" ask here is a different one.
  if (l.status === "ready" || !l.advice) return null;
  return <p className="mb-2 rounded-sm bg-warning-subtle px-2.5 py-1.5 text-[12.5px] leading-[18px] text-warning">{l.advice}</p>;
}
