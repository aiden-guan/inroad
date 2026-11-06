"use client";

import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, MapPin, Plus, Video } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useActiveRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { Orb } from "@/components/ui/orb";
import { cn } from "@/lib/client/cn";
import { shortDate } from "@/lib/client/format";
import { todayISO } from "@/lib/domain/ids";
import type { GtmEvent, Workspace } from "@/lib/domain/types";
import { listItem } from "@/lib/motion";
import { FunnelBar } from "./funnel-bar";
import { KIND_LABEL, eventDay, formatEventDate, funnelOf } from "./plan-math";
import { PlanForm } from "./plan-form";
import { KindIcon, StatusBadge } from "./ui";

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

function nextTask(ev: GtmEvent) {
  const t = ev.plan?.timeline.find((x) => !x.done);
  return t;
}

/** Weekday, day and month on a small calendar leaf, so the list scans by date. Wide screens only; phones read the line. */
function DateLeaf({ day }: { day?: string }) {
  if (!day) {
    return (
      <span aria-hidden className="hidden w-16 shrink-0 flex-col items-center justify-center rounded-lg bg-bg-subtle py-2.5 text-center ring-1 ring-inset ring-border md:flex">
        <span className="text-[12px] leading-4 text-fg-3">Date</span>
        <span className="text-[12px] leading-4 text-fg-3">to set</span>
      </span>
    );
  }
  const d = new Date(`${day}T12:00:00`);
  return (
    <span aria-hidden className="hidden w-16 shrink-0 flex-col items-center rounded-lg bg-bg-subtle py-2 text-center ring-1 ring-inset ring-border md:flex">
      <span className="font-mono text-[11px] uppercase leading-4 tracking-[0.12em] text-fg-3">{d.toLocaleDateString("en-US", { weekday: "short" })}</span>
      <span className="font-serif text-[26px] leading-8 tracking-[-0.02em] text-fg tnum">{d.getDate()}</span>
      <span className="text-[12px] leading-4 text-fg-3">{d.toLocaleDateString("en-US", { month: "short" })}</span>
    </span>
  );
}

/**
 * One event as a full-width row: the date, what the room is about, how the guest list is filling and the next task.
 * A list reads the same with one event as with ten, where a two-column grid left a lone half-width card.
 */
function EventRow({ ev, ws, index, animate, planningTitle }: { ev: GtmEvent; ws: Workspace; index: number; animate: boolean; planningTitle?: string }) {
  const theme = ev.plan?.themes[ev.chosenThemeIdx ?? 0];
  const funnel = funnelOf(ev, ws);
  const task = nextTask(ev);
  const today = todayISO();
  const overdue = task && task.due < today;
  const where = ev.kind === "dinner" ? (ev.venue?.name ?? ev.plan?.city ?? ev.request?.city) : "Virtual";
  const title = theme && theme.title !== "Write the question" ? theme.title : ev.title;

  return (
    <motion.li variants={listItem} initial={animate ? "hidden" : false} animate="show" custom={index}>
      <Link
        href={`/events/${ev.id}`}
        className="group flex gap-6 rounded-xl bg-surface p-5 shadow-sm ring-1 ring-inset ring-border transition-[box-shadow,transform] duration-200 ease-out hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] active:scale-[0.995] md:p-6"
      >
        <DateLeaf day={eventDay(ev)} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-3">
            <KindIcon kind={ev.kind} />
            <span>{KIND_LABEL[ev.kind]}</span>
            <span aria-hidden>·</span>
            <span className="font-mono tnum">{formatEventDate(ev, { time: true })}</span>
            {where && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                  <MapPin className="size-3 shrink-0" aria-hidden />
                  <span className="truncate" title={where}>
                    {where}
                  </span>
                </span>
              </>
            )}
            <span className="ml-auto pl-2">
              <StatusBadge status={ev.status} />
            </span>
          </div>

          <h3 className="mt-3 text-pretty text-[18px] font-medium leading-6 tracking-[-0.02em] text-fg">{title}</h3>
          {theme ? (
            <p className="mt-1 line-clamp-2 max-w-[68ch] font-serif text-[16px] leading-[23px] text-fg-2" title={theme.question}>
              {theme.question}
            </p>
          ) : planningTitle ? (
            <p className="mt-2 flex items-center gap-2 text-[13px]">
              <Orb state="working" size={14} />
              <span className="shimmer-text">{planningTitle}</span>
            </p>
          ) : (
            <p className="mt-1 text-[13px] text-fg-3">No plan yet. Open it to plan the room.</p>
          )}

          {ev.plan && <FunnelBar funnel={funnel} className="mt-5 max-w-[560px]" size="sm" />}

          <div className="mt-5 flex items-center gap-2 border-t border-border pt-4 text-[12.5px]">
            {task ? (
              <>
                <span className={cn("min-w-0 flex-1 truncate", overdue ? "text-danger" : "text-fg-2")} title={task.task}>
                  <span className="text-fg-3">Next · </span>
                  {task.task}
                </span>
                <span className={cn("shrink-0 font-mono text-[12px] tnum", overdue ? "text-danger" : "text-fg-3")}>{task.due <= today ? (overdue ? "overdue" : "today") : shortDate(task.due)}</span>
              </>
            ) : (
              <span className="flex-1 text-fg-3">{ev.plan ? "Every task is done." : "Waiting for the plan."}</span>
            )}
            <ChevronRight className="size-3.5 shrink-0 text-fg-3 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
          </div>
        </div>
      </Link>
    </motion.li>
  );
}

/** What a planned room looks like, ghosted beside the one button that plans it. */
function GhostRow() {
  return (
    <div aria-hidden className="min-w-0 select-none">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-3">What you get</p>
      <div className="flex gap-4 rounded-xl bg-bg-subtle/60 p-4 opacity-75 ring-1 ring-inset ring-border [border-style:dashed]">
        <span className="flex w-14 shrink-0 flex-col items-center rounded-lg bg-surface py-1.5 text-center ring-1 ring-inset ring-border">
          <span className="font-mono text-[11px] uppercase leading-4 tracking-[0.12em] text-fg-3">Tue</span>
          <span className="font-serif text-[22px] leading-7 text-fg-2">18</span>
          <span className="text-[12px] leading-4 text-fg-3">Nov</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[12px] text-fg-3">
            <Video className="size-3.5" />
            Virtual roundtable · 60 minutes
          </p>
          <p className="mt-2 text-[14px] font-medium leading-5 text-fg-2">The question your buyers are arguing about</p>
          <p className="mt-1 font-serif text-[14px] leading-5 text-fg-3">Picked from their job posts, news and your deals, never a pitch.</p>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-border/60">
            <span className="block h-full w-2/5 rounded-full bg-fg-4" />
          </div>
          <p className="mt-2 text-[12px] text-fg-3">8 of 20 invited · Next: personal notes to the first 12</p>
        </div>
      </div>
    </div>
  );
}

function FirstRoom({ ws, onPlan }: { ws: Workspace; onPlan: () => void }) {
  const won = Object.values(ws.deals).some((d) => d.stage === "won");
  return (
    <section aria-labelledby="events-empty-title" className="mt-8 grid gap-8 rounded-xl bg-surface p-6 shadow-sm ring-1 ring-inset ring-border md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] md:gap-10 md:p-8">
      <div className="min-w-0">
        <h2 id="events-empty-title" className="max-w-[22ch] text-balance font-serif text-[28px] leading-[34px] tracking-[-0.015em] text-fg">
          Turn a small room into pipeline
        </h2>
        <p className="mt-3 max-w-[54ch] text-pretty text-[14px] leading-[22px] text-fg-2">
          {won
            ? "You have a customer who can host. I'll pick the guests from your accounts and network, write the question and every invite, and date each task so it shows up on Today."
            : "Start with a 60-minute virtual roundtable for 6–8 peers: no customers needed, no cost. I'll pick the guests, write the question and every invite, and date each task so it shows up on Today."}
        </p>
        <div className="mt-6">
          <Button variant="agent" size="lg" kbd="N" onClick={onPlan}>
            {won ? "Plan a dinner" : "Plan a roundtable"}
          </Button>
        </div>
        <dl className="mt-8 grid gap-4 border-t border-border pt-5 sm:grid-cols-3">
          {[
            ["The room", "6–8 peers, 60 minutes, one live question"],
            ["The invites", "15–25 personal notes, warm paths first"],
            ["The bar", "35% of attendees take a meeting"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[12px] text-fg-3">{k}</dt>
              <dd className="mt-0.5 text-[13px] leading-5 text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <GhostRow />
    </section>
  );
}

export function EventsPage() {
  const { ws, loading, error } = useWorkspace();
  const params = useSearchParams();
  const router = useRouter();
  const active = useActiveRuns();
  const [formOpen, setFormOpen] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const open = formOpen || params.get("new") === "1";

  const close = () => {
    setFormOpen(false);
    if (params.get("new")) router.replace("/events", { scroll: false });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        setFormOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { upcoming, past } = useMemo(() => {
    const today = todayISO();
    const all = Object.values(ws?.events ?? {});
    const isPast = (e: GtmEvent) => e.status === "done" || e.status === "cancelled" || ((eventDay(e) ?? "9999") < today && e.status !== "planning");
    const byDate = (a: GtmEvent, b: GtmEvent) => (eventDay(a) ?? a.createdAt).localeCompare(eventDay(b) ?? b.createdAt);
    return { upcoming: all.filter((e) => !isPast(e)).sort(byDate), past: all.filter(isPast).sort(byDate).reverse() };
  }, [ws]);

  const planningTitle = (id: string) => active.find((r) => r.ref?.kind === "event" && r.ref.id === id)?.title;

  return (
    <PageContainer>
      <PageHeader
        title="Events"
        eyebrow="Make room for a conversation"
        description="Roundtables and dinners that turn into meetings."
        actions={!open && (upcoming.length > 0 || past.length > 0) ? <Button variant="primary" icon={<Plus className="size-4" />} kbd="N" onClick={() => setFormOpen(true)}>Plan an event</Button> : undefined}
      />

      <AnimatePresence initial={false}>{open && ws && <PlanForm
            key="form"
            ws={ws}
            onClose={close}
            initialCity={params.get("city")?.trim().slice(0, 80) || undefined}
            initialKind={params.get("kind") === "roundtable" || params.get("kind") === "dinner" ? (params.get("kind") as "roundtable" | "dinner") : undefined}
            initialCoHost={params.get("cohost")?.trim().slice(0, 80) || undefined}
          />}</AnimatePresence>

      {error && !ws && (
        <p role="alert" className="mt-10 text-[13px] text-danger">
          {error} Reload the page to try again.
        </p>
      )}

      {loading && !ws ? (
        <div className="mt-8 space-y-3" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="flex gap-6 rounded-xl bg-surface p-5 ring-1 ring-inset ring-border md:p-6">
              <Skeleton className="hidden h-[84px] w-16 shrink-0 rounded-lg md:block" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3 w-48" />
                <Skeleton className="mt-4 h-5 w-2/3" />
                <Skeleton className="mt-2 h-4 w-1/2" />
                <Skeleton className="mt-6 h-1 w-full max-w-[560px]" />
              </div>
            </div>
          ))}
        </div>
      ) : ws && !upcoming.length && !past.length ? (
        !open && <FirstRoom ws={ws} onPlan={() => setFormOpen(true)} />
      ) : (
        ws && (
          <>
            {upcoming.length > 0 ? (
              <section aria-label="Upcoming" className="mt-8">
                <SectionLabel>
                  Upcoming
                  <span className="ml-1.5 font-mono text-[12px] tnum text-fg-3">{upcoming.length}</span>
                </SectionLabel>
                <ul className="space-y-3">
                  {upcoming.map((ev, i) => (
                    <EventRow key={ev.id} ev={ev} ws={ws} index={i} animate planningTitle={planningTitle(ev.id)} />
                  ))}
                </ul>
              </section>
            ) : (
              <p className="mt-8 rounded-xl bg-surface px-5 py-4 text-[14px] text-fg-2 ring-1 ring-inset ring-border">
                Nothing on the calendar. Plan the next room, or open a past one below to follow up.
              </p>
            )}
            {past.length > 0 && (
              <section className="mt-10">
                <button
                  type="button"
                  onClick={() => setShowPast((v) => !v)}
                  aria-expanded={showPast}
                  className="flex items-center gap-1.5 rounded-xs text-[12px] font-medium text-fg-3 transition-colors hover:text-fg-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  <ChevronRight className={cn("size-3.5 transition-transform duration-150", showPast && "rotate-90")} />
                  Past and cancelled · {past.length}
                </button>
                {showPast && (
                  <ul className="mt-3 space-y-3">
                    {past.map((ev, i) => (
                      <EventRow key={ev.id} ev={ev} ws={ws} index={i} animate={false} />
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )
      )}
    </PageContainer>
  );
}
