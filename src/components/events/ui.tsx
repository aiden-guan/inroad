"use client";

import { Mail, UtensilsCrossed, Video } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { toast } from "sonner";
import { useRunFor } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/misc";
import { Orb } from "@/components/ui/orb";
import { SourceChip } from "@/components/ui/source";
import { cn } from "@/lib/client/cn";
import { duration, usd } from "@/lib/client/format";
import type { Action } from "@/lib/domain/actions";
import { newId, nowISO, todayISO } from "@/lib/domain/ids";
import type { EntityRef, GtmEvent, Guest, ID, ISODate, RunSummary } from "@/lib/domain/types";
import { inviteOverCap } from "@/lib/quality/cap";
import { STATUS_LABEL, candidateKey, composeUrl, deriveStatus, missingTokens, wordCount } from "./plan-math";

export function KindIcon({ kind, className }: { kind: GtmEvent["kind"]; className?: string }) {
  const Icon = kind === "dinner" ? UtensilsCrossed : Video;
  return <Icon className={cn("size-3.5", className)} aria-hidden />;
}

export function StatusBadge({ status }: { status: GtmEvent["status"] }) {
  return (
    <Badge tone={status === "done" || status === "cancelled" ? "outline" : "neutral"} className={cn(status === "cancelled" && "line-through")}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/** The agent's short notes to the founder: orb mark + reading face. */
export function AgentNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex gap-2.5", className)}>
      <Orb size={12} className="mt-[5px]" />
      <p className="min-w-0 flex-1 font-serif text-[15px] leading-[22px] text-fg-2 text-pretty">{children}</p>
    </div>
  );
}

/** Evidence chips for a theme or guest: ledger entries first, then raw signal links. */
export function Sources({ ids = [], sources = [], className }: { ids?: ID[]; sources?: { url: string; label: string; date?: ISODate }[]; className?: string }) {
  const { ws, dispatch } = useWorkspace();
  const evidence = ids.map((id) => ws?.evidence[id]).filter((e) => e && !e.flaggedWrong);
  if (!evidence.length && !sources.length) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {evidence.map((e) => (
        <SourceChip
          key={e!.id}
          url={e!.url}
          publishedAt={e!.publishedAt}
          quote={e!.quote}
          claim={e!.claim}
          confidence={e!.confidence}
          onFlagWrong={() => void dispatch({ type: "evidence.flagWrong", id: e!.id, at: nowISO() })}
        />
      ))}
      {sources.map((s) => (
        <SourceChip key={s.url} url={s.url} publishedAt={s.date} claim={s.label} />
      ))}
    </span>
  );
}

export function Stat({ label, value, hint, className }: { label: string; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11.5px] text-fg-3">{label}</dt>
      <dd className="mt-0.5 font-mono text-[15px] tnum text-fg">{value}</dd>
      {hint && <p className="mt-0.5 text-[11.5px] leading-4 text-fg-3">{hint}</p>}
    </div>
  );
}

/**
 * Outgoing copy, set in Inter because that's what the recipient reads. Copy, open in Gmail,
 * and an optional "mark sent" that records the touch. Unfilled {tokens} are flagged.
 */
export function DraftBlock({
  subject,
  body,
  to,
  bcc,
  maxWords,
  label = "Draft",
  actions,
  channel = "email",
  className,
}: {
  subject?: string;
  body: string;
  to?: string;
  bcc?: string[];
  maxWords?: number;
  label?: string;
  actions?: ReactNode;
  channel?: "email" | "text";
  className?: string;
}) {
  const { ws } = useWorkspace();
  const missing = missingTokens(`${subject ?? ""} ${body}`);
  const words = wordCount(body);
  const over = maxWords !== undefined && words > maxWords;
  return (
    <div className={cn("draft-rule rounded-r-md bg-surface py-3 pl-4 pr-3", className)}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11.5px] text-fg-3">
        <span className="font-medium text-fg-2">{label}</span>
        {to && <span className="truncate font-mono">to {to}</span>}
        <span className="flex-1" />
        <span className={cn("font-mono tnum", over && "text-warning")}>
          {words} words{maxWords ? ` · max ${maxWords}` : ""}
        </span>
      </div>
      {subject && <p className="mb-1.5 text-[14px] font-medium text-fg">{subject}</p>}
      <p className="max-w-[68ch] whitespace-pre-wrap text-[14.5px] leading-[23px] text-fg-2">{body}</p>
      {missing.length > 0 && (
        <p className="mt-2 text-[12px] text-warning">
          Fill in {missing.map((m) => `{${m}}`).join(", ")} before sending.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <CopyButton text={subject ? `${subject}\n\n${body}` : body} />
        {ws && channel === "email" && (
          <a
            href={composeUrl(ws, to, subject ?? "", body, bcc)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-[12px] font-medium text-fg-2 ring-1 ring-border transition-[background-color,transform] duration-150 hover:bg-bg-subtle active:scale-[0.97]"
          >
            <Mail className="size-3.5" />
            Open in Gmail
          </a>
        )}
        {actions}
      </div>
    </div>
  );
}

const DEBRIEF_TITLE = "Writing next-morning notes";
export const isDebriefRun = (title: string | undefined) => title === DEBRIEF_TITLE;

/** The newest dinner_plan run for this event: live state when this tab has it, else the stored summary. */
export function useEventRuns(eventId: string) {
  const { ws } = useWorkspace();
  const ref = useMemo<EntityRef>(() => ({ kind: "event", id: eventId }), [eventId]);
  const live = useRunFor(ref, "dinner_plan");
  return useMemo(() => {
    const summaries = (ws?.runs ?? []).filter((r) => r.ref?.kind === "event" && r.ref.id === eventId && r.workflow === "dinner_plan");
    const planSummary = summaries.find((r) => !isDebriefRun(r.title));
    const debriefSummary = summaries.find((r) => isDebriefRun(r.title));
    const liveIsDebrief = live ? isDebriefRun(live.title) : false;
    const planRun = live && !liveIsDebrief ? live : undefined;
    const debriefRun = live && liveIsDebrief ? live : undefined;
    const activeStatus = (s?: { status: RunSummary["status"] }) => s?.status === "running" || s?.status === "queued";
    return {
      planRun,
      debriefRun,
      planSummary,
      debriefSummary,
      planning: activeStatus(planRun) || (!planRun && activeStatus(planSummary)),
      debriefing: activeStatus(debriefRun) || (!debriefRun && activeStatus(debriefSummary)),
    };
  }, [ws, eventId, live]);
}

/** "Worked for 52s · $0.08" from a stored run summary (used after a reload). */
export function SummaryReceipt({ summary }: { summary: RunSummary }) {
  if (!summary.receipt) return null;
  const r = summary.receipt;
  const parts = [`Worked for ${duration(r.durationMs)}`, r.sources ? `${r.sources} source${r.sources === 1 ? "" : "s"}` : null, usd(r.costUsd)].filter(Boolean);
  return (
    <span className="inline-flex h-6 items-center gap-1.5 font-mono text-[11.5px] text-fg-3">
      <Orb state={summary.status === "error" ? "error" : "idle"} size={10} />
      {parts.join(" · ")}
    </span>
  );
}

/** Guest mutations that keep activity, status and the event's own status in step. */
export function useGuestActions(ev: GtmEvent | undefined) {
  const { ws, dispatch } = useWorkspace();
  return useMemo(() => {
    if (!ev) return null;
    const withStatus = (next: GtmEvent, actions: Action[]): Action[] => {
      const status = deriveStatus(next);
      return status !== ev.status ? [...actions, { type: "event.update", id: ev.id, patch: { status } }] : actions;
    };
    return {
      save(guest: Guest) {
        return dispatch({ type: "guest.upsert", eventId: ev.id, guest });
      },
      setStatus(guest: Guest, status: Guest["status"]) {
        if (guest.status === status) return;
        const today = todayISO();
        const next: Guest = {
          ...guest,
          status,
          invitedOn: status === "invited" && !guest.invitedOn ? today : guest.invitedOn,
        };
        const actions: Action[] = [{ type: "guest.upsert", eventId: ev.id, guest: next }];
        const label = guest.name ?? guest.title;
        if ((status === "invited" && !guest.invitedOn) || status === "attended") {
          actions.push({
            type: "activity.log",
            activity: {
              id: newId("act"),
              at: nowISO(),
              kind: status === "invited" ? "event_invited" : "event_attended",
              personId: guest.personId,
              accountDomain: guest.accountDomain || undefined,
              dealId: guest.dealId,
              eventId: ev.id,
              channel: ev.kind === "dinner" && status === "attended" ? "in_person" : "email",
              summary: status === "invited" ? `Invited ${label} to ${ev.title}` : `${label} attended ${ev.title}`,
              source: "founder",
            },
          });
        }
        // A cold invite uses a slot of the cold cap like a first touch (W11). Past the cap the record stays true; the next ones wait.
        const over = status === "invited" && !guest.invitedOn && ws ? inviteOverCap(ws, guest, today) : null;
        return dispatch(withStatus({ ...ev, guests: { ...ev.guests, [guest.id]: next } }, actions)).then((ok) => {
          if (ok && over) {
            const cap = over === "week" ? `${ws!.caps.firstTouchesPerWeek} a week` : `${ws!.caps.firstTouchesPerDayMax} a day`;
            toast.warning(`That's past your cold cap of ${cap}, invites included. Hold the next cold invites until ${over === "week" ? "Monday" : "tomorrow"}.`);
          }
          return ok;
        });
      },
      /** A human follow-up touch after the event (counts toward the 5-in-90-days cap). */
      logTouch(guest: Guest, what: string, body?: string) {
        const next: Guest = { ...guest, touches: [...(guest.touches ?? []), { at: todayISO(), what }] };
        return dispatch([
          { type: "guest.upsert", eventId: ev.id, guest: next },
          {
            type: "activity.log",
            activity: {
              id: newId("act"),
              at: nowISO(),
              kind: "touch_sent",
              personId: guest.personId,
              accountDomain: guest.accountDomain || undefined,
              dealId: guest.dealId,
              eventId: ev.id,
              channel: "email",
              summary: `${what} · ${guest.name ?? guest.title} after ${ev.title}`,
              body,
              source: "founder",
            },
          },
        ]);
      },
      /** The cut test: a removed candidate stays out of later re-plans. */
      remove(guest: Guest) {
        const key = candidateKey(guest);
        const actions: Action[] = [{ type: "guest.remove", eventId: ev.id, guestId: guest.id }];
        if (!guest.manual && !ev.cut?.includes(key)) actions.push({ type: "event.update", id: ev.id, patch: { cut: [...(ev.cut ?? []), key] } });
        return dispatch(actions);
      },
      /** Undo for `remove`, from the same render: the guest comes back and is no longer cut. */
      restore(guest: Guest) {
        const key = candidateKey(guest);
        return dispatch([
          { type: "guest.upsert", eventId: ev.id, guest },
          { type: "event.update", id: ev.id, patch: { cut: (ev.cut ?? []).filter((k) => k !== key) } },
        ]);
      },
    };
  }, [ev, ws, dispatch]);
}
