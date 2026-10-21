"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, MapPin, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useActiveRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
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

function EventCard({ ev, ws, index, animate, planningTitle }: { ev: GtmEvent; ws: Workspace; index: number; animate: boolean; planningTitle?: string }) {
  const theme = ev.plan?.themes[ev.chosenThemeIdx ?? 0];
  const funnel = funnelOf(ev, ws);
  const task = nextTask(ev);
  const today = todayISO();
  const overdue = task && task.due < today;
  const where = ev.kind === "dinner" ? (ev.venue?.name ?? ev.plan?.city ?? ev.request?.city) : "Virtual";

  return (
    <motion.li variants={listItem} initial={animate ? "hidden" : false} animate="show" custom={index}>
      <Link
        href={`/events/${ev.id}`}
        className="group flex h-full flex-col rounded-lg bg-surface p-4 shadow-sm ring-1 ring-border transition-[box-shadow,transform] duration-150 ease-out hover:shadow-md active:scale-[0.995] md:p-5"
      >
        <div className="flex min-w-0 items-center gap-2 whitespace-nowrap text-[12px] text-fg-3">
          <KindIcon kind={ev.kind} />
          <span>{KIND_LABEL[ev.kind]}</span>
          <span aria-hidden>·</span>
          <span className="font-mono tnum">{formatEventDate(ev)}</span>
          {where && (
            <>
              <span aria-hidden className="hidden sm:inline">
                ·
              </span>
              <span className="hidden min-w-0 items-center gap-1 truncate sm:inline-flex">
                <MapPin className="size-3" />
                <span className="truncate">{where}</span>
              </span>
            </>
          )}
          <span className="ml-auto">
            <StatusBadge status={ev.status} />
          </span>
        </div>

        <h3 className="mt-3 text-[15px] font-semibold leading-5 tracking-[-0.01em] text-fg">{theme && theme.title !== "Write the question" ? theme.title : ev.title}</h3>
        {theme ? (
          <p className="mt-1 line-clamp-2 font-serif text-[16px] leading-[23px] text-fg-2">{theme.question}</p>
        ) : planningTitle ? (
          <p className="mt-2 flex items-center gap-2 text-[13px]">
            <Orb state="working" size={14} />
            <span className="shimmer-text">{planningTitle}</span>
          </p>
        ) : (
          <p className="mt-1 text-[13px] text-fg-3">No plan yet. Open it to plan the room.</p>
        )}

        <FunnelBar funnel={funnel} className="mt-4" size="sm" />

        <div className="mt-4 flex items-center gap-2 border-t border-border pt-3 text-[12.5px]">
          {task ? (
            <>
              <span className={cn("min-w-0 flex-1 truncate", overdue ? "text-danger" : "text-fg-2")}>
                <span className="text-fg-3">Next · </span>
                {task.task}
              </span>
              <span className={cn("shrink-0 font-mono text-[11.5px] tnum", overdue ? "text-danger" : "text-fg-3")}>{task.due <= today ? (overdue ? "overdue" : "today") : shortDate(task.due)}</span>
            </>
          ) : (
            <span className="flex-1 text-fg-3">{ev.plan ? "Every task is done." : "Waiting for the plan."}</span>
          )}
          <ChevronRight className="size-3.5 shrink-0 text-fg-4 transition-transform duration-150 group-hover:translate-x-0.5" />
        </div>
      </Link>
    </motion.li>
  );
}

function FirstRoom({ ws, onPlan }: { ws: Workspace; onPlan: () => void }) {
  const won = Object.values(ws.deals).some((d) => d.stage === "won");
  return (
    <section className="mt-10 rounded-xl bg-surface px-6 py-12 text-center shadow-sm ring-1 ring-border md:px-12 md:py-16">
      <h2 className="mx-auto max-w-[22ch] font-serif text-[30px] leading-[36px] tracking-[-0.015em] text-balance">Turn a small room into pipeline</h2>
      <p className="mx-auto mt-3 max-w-[54ch] text-[14px] leading-[22px] text-fg-2">
        {won
          ? "You have a customer who can host. I'll pick the guests from your accounts and network, write the question and every invite, and date each task so it shows up on Today."
          : "Start with a 60-minute virtual roundtable for 6–8 peers: no customers needed, no cost. I'll pick the guests, write the question and every invite, and date each task so it shows up on Today."}
      </p>
      <div className="mt-6">
        <Button variant="agent" size="lg" onClick={onPlan}>
          {won ? "Plan a dinner" : "Plan a roundtable"}
        </Button>
      </div>
      <dl className="mx-auto mt-10 grid max-w-[620px] gap-4 border-t border-border pt-6 text-left sm:grid-cols-3">
        {[
          ["The room", "6–8 peers, 60 minutes, one live question"],
          ["The invites", "15–25 personal notes, warm paths first"],
          ["The bar", "35% of attendees take a meeting"],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-[11.5px] text-fg-3">{k}</dt>
            <dd className="mt-0.5 text-[13px] leading-5 text-fg">{v}</dd>
          </div>
        ))}
      </dl>
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
    <div className="mx-auto w-full max-w-[1080px] px-6 pb-24 pt-8 md:px-10 md:pt-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-[32px] leading-[36px] tracking-[-0.02em]">Events</h1>
          <p className="mt-1.5 text-[14px] text-fg-2">Roundtables and dinners that turn into meetings.</p>
        </div>
        {!open && (upcoming.length > 0 || past.length > 0) && (
          <Button variant="primary" icon={<Plus className="size-4" />} kbd="N" onClick={() => setFormOpen(true)}>
            Plan an event
          </Button>
        )}
      </header>

      <AnimatePresence initial={false}>{open && ws && <PlanForm key="form" ws={ws} onClose={close} initialCity={params.get("city")?.trim().slice(0, 80) || undefined} />}</AnimatePresence>

      {error && !ws && <p className="mt-10 text-[13px] text-danger">{error} Reload the page to try again.</p>}

      {loading && !ws ? (
        <div className="mt-8 grid gap-3 md:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-lg bg-surface p-5 ring-1 ring-border">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="mt-4 h-4 w-3/4" />
              <Skeleton className="mt-2 h-4 w-1/2" />
              <Skeleton className="mt-6 h-1.5 w-full" />
            </div>
          ))}
        </div>
      ) : ws && !upcoming.length && !past.length ? (
        !open && <FirstRoom ws={ws} onPlan={() => setFormOpen(true)} />
      ) : (
        ws && (
          <>
            {upcoming.length > 0 ? (
              <ul className="mt-8 grid gap-3 md:grid-cols-2">
                {upcoming.map((ev, i) => (
                  <EventCard key={ev.id} ev={ev} ws={ws} index={i} animate planningTitle={planningTitle(ev.id)} />
                ))}
              </ul>
            ) : (
              <p className="mt-8 rounded-lg px-1 text-[14px] text-fg-2">
                Nothing on the calendar.{" "}
                <button onClick={() => setFormOpen(true)} className="text-fg-2 underline-offset-4 hover:text-fg hover:underline">
                  Plan the next room
                </button>
              </p>
            )}
            {past.length > 0 && (
              <section className="mt-10">
                <button
                  onClick={() => setShowPast((v) => !v)}
                  aria-expanded={showPast}
                  className="flex items-center gap-1.5 text-[12px] font-medium text-fg-3 transition-colors hover:text-fg-2"
                >
                  <ChevronRight className={cn("size-3.5 transition-transform duration-150", showPast && "rotate-90")} />
                  Past and cancelled · {past.length}
                </button>
                {showPast && (
                  <ul className="mt-3 grid gap-3 md:grid-cols-2">
                    {past.map((ev, i) => (
                      <EventCard key={ev.id} ev={ev} ws={ws} index={i} animate={false} />
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )
      )}
    </div>
  );
}
