"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ChevronLeft, MapPin, MoreHorizontal, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button, IconButton } from "@/components/ui/button";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { EmptyState, Segmented, Skeleton } from "@/components/ui/misc";
import { WorkLog } from "@/components/ui/work-log";
import { cn } from "@/lib/client/cn";
import { todayISO } from "@/lib/domain/ids";
import type { GtmEvent } from "@/lib/domain/types";
import { ease } from "@/lib/motion";
import { AfterTab } from "./after-tab";
import { FunnelBar } from "./funnel-bar";
import { GuestsTab } from "./guests-tab";
import { NearbyTab } from "./nearby-tab";
import { KIND_LABEL, STATUS_LABEL, eventDay, formatEventDate, funnelOf } from "./plan-math";
import { PlanTab } from "./plan-tab";
import { RoomTab } from "./room-tab";
import { TimelineTab } from "./timeline-tab";
import { KindIcon, StatusBadge, SummaryReceipt, useEventRuns } from "./ui";

const TABS = ["plan", "guests", "nearby", "timeline", "room", "after"] as const;
type Tab = (typeof TABS)[number];

/** Re-plan with the inputs the founder gave last time (and the date they may have moved since). */
export function replanArgs(ev: GtmEvent) {
  return {
    eventId: ev.id,
    kind: ev.kind,
    city: ev.kind === "dinner" ? (ev.request?.city ?? ev.plan?.city ?? undefined) || undefined : undefined,
    month: ev.request?.month,
    date: eventDay(ev),
    goal: ev.plan?.goal ?? ev.request?.goal,
    budgetUsd: ev.request?.budgetUsd,
    coHost: ev.plan?.coHost?.name ?? ev.request?.coHost,
  };
}

function Header({ ev, planning, onReplan }: { ev: GtmEvent; planning: boolean; onReplan: () => void }) {
  const { ws, dispatch } = useWorkspace();
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const theme = ev.plan?.themes[ev.chosenThemeIdx ?? 0];
  const where = ev.kind === "dinner" ? (ev.venue?.name ?? ev.plan?.city ?? ev.request?.city) : ev.venue?.address ? "Video call" : "Virtual";
  const funnel = useMemo(() => (ws ? funnelOf(ev, ws) : null), [ev, ws]);

  return (
    <header>
      <Link href="/events" className="-ml-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-[13px] text-fg-3 transition-colors hover:text-fg">
        <ChevronLeft className="size-3.5" />
        Events
      </Link>

      <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-fg-3">
        <KindIcon kind={ev.kind} />
        <span>{KIND_LABEL[ev.kind]}</span>
        <span aria-hidden>·</span>
        <span className="font-mono tnum">{formatEventDate(ev, { time: true })}</span>
        {where && (
          <>
            <span aria-hidden>·</span>
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin className="size-3" />
              <span className="truncate">{where}</span>
            </span>
          </>
        )}
        <Menu
          align="start"
          trigger={
            <button className="ml-1 inline-flex items-center gap-0.5 rounded-xs transition-opacity hover:opacity-80" aria-label="Change status">
              <StatusBadge status={ev.status} />
              <ChevronDown className="size-3" />
            </button>
          }
        >
          {(Object.keys(STATUS_LABEL) as GtmEvent["status"][]).map((s) => (
            <MenuItem key={s} onSelect={() => void dispatch({ type: "event.update", id: ev.id, patch: { status: s } })} hint={s === ev.status ? "Current" : undefined}>
              {STATUS_LABEL[s]}
            </MenuItem>
          ))}
        </Menu>
      </div>

      <div className="mt-3 flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-[32px] leading-[36px] tracking-[-0.02em] text-balance">{theme && theme.title !== "Write the question" ? theme.title : ev.title}</h1>
          {theme && <p className="mt-2 max-w-[60ch] font-serif text-[19px] italic leading-[27px] text-fg-2 text-pretty">{theme.question}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {ev.plan && (
            <Button variant="secondary" size="sm" icon={<RefreshCw className="size-3.5" />} onClick={onReplan} disabled={planning} className="hidden sm:inline-flex">
              Re-plan
            </Button>
          )}
          <Menu
            trigger={
              <IconButton label="More">
                <MoreHorizontal className="size-4" />
              </IconButton>
            }
          >
            {ev.plan && (
              <MenuItem icon={<RefreshCw className="size-3.5" />} onSelect={onReplan}>
                Re-plan guests and copy
              </MenuItem>
            )}
            {ev.status !== "cancelled" && <MenuItem onSelect={() => void dispatch({ type: "event.update", id: ev.id, patch: { status: "cancelled" } })}>Cancel event</MenuItem>}
            <MenuSeparator />
            <MenuItem danger onSelect={() => setConfirmDelete(true)}>
              Delete event
            </MenuItem>
          </Menu>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ duration: 0.16, ease: ease.out }}
            className="mt-4 flex flex-wrap items-center gap-3 rounded-md bg-danger-subtle px-3 py-2.5 text-[13px] text-fg"
            role="alert"
          >
            <span className="flex-1">Delete this event, its guest list and its timeline? This can&apos;t be undone.</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                router.push("/events");
                await dispatch({ type: "event.remove", id: ev.id });
              }}
            >
              Delete
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {funnel && ev.plan && <FunnelBar funnel={funnel} className="mt-6 max-w-[560px]" />}
    </header>
  );
}

function PlanSkeleton() {
  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg bg-surface p-4 ring-1 ring-border">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-3 h-5 w-5/6" />
            <Skeleton className="mt-2 h-3 w-2/3" />
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    </div>
  );
}

export function EventPage({ id }: { id: string }) {
  const { ws, loading } = useWorkspace();
  const { start } = useRuns();
  const params = useSearchParams();
  const router = useRouter();
  const ev = ws?.events[id];
  const runs = useEventRuns(id);
  const raw = params.get("tab");
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : "plan";
  const setTab = (t: Tab) => router.replace(`/events/${encodeURIComponent(id)}${t === "plan" ? "" : `?tab=${t}`}`, { scroll: false });

  const counts = useMemo(() => {
    if (!ev) return { guests: 0, due: 0 };
    const today = todayISO();
    return {
      guests: Object.values(ev.guests).filter((g) => g.status !== "waitlist" && g.status !== "declined").length,
      due: (ev.plan?.timeline ?? []).filter((t) => !t.done && t.due <= today).length,
    };
  }, [ev]);

  if (loading && !ws) {
    return (
      <div className="mx-auto w-full max-w-[1080px] px-6 pb-24 pt-8 md:px-10 md:pt-12">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="mt-6 h-3 w-48" />
        <Skeleton className="mt-3 h-8 w-2/3" />
        <PlanSkeleton />
      </div>
    );
  }

  const replan = () => {
    if (ev) void start("dinner_plan", replanArgs(ev));
  };

  if (!ev) {
    return (
      <div className="mx-auto w-full max-w-[1080px] px-6 pb-24 pt-8 md:px-10 md:pt-12">
        <Link href="/events" className="-ml-1 inline-flex items-center gap-1 px-1 text-[13px] text-fg-3 hover:text-fg">
          <ChevronLeft className="size-3.5" />
          Events
        </Link>
        {runs.planRun && runs.planning ? (
          <>
            <h1 className="mt-8 font-serif text-[32px] leading-[36px] tracking-[-0.02em]">{runs.planRun.title}</h1>
            <WorkLog run={runs.planRun} className="mt-6 max-w-[720px]" />
            <PlanSkeleton />
          </>
        ) : (
          <EmptyState
            title="This event isn't here"
            body="It may have been deleted, or the link is from another workspace."
            action={
              <Link href="/events" className="text-[13px] text-fg-2 underline-offset-4 hover:text-fg hover:underline">
                Back to events
              </Link>
            }
          />
        )}
      </div>
    );
  }

  const planFailed = !ev.plan && !runs.planning && runs.planSummary?.status === "error";

  return (
    <div className="mx-auto w-full max-w-[1080px] px-6 pb-24 pt-8 md:px-10 md:pt-12">
      <Header ev={ev} planning={runs.planning} onReplan={replan} />

      {runs.planRun && (runs.planning || !ev.plan || runs.planRun.error) ? (
        <WorkLog run={runs.planRun} className="mt-6 max-w-[720px]" />
      ) : runs.planRun ? (
        <div className="mt-3">
          <WorkLog run={runs.planRun} />
        </div>
      ) : runs.planSummary && ev.plan ? (
        <div className="mt-3">
          <SummaryReceipt summary={runs.planSummary} />
        </div>
      ) : null}

      {!ev.plan ? (
        runs.planning ? (
          <PlanSkeleton />
        ) : planFailed ? (
          <div className="mt-8 max-w-[720px] rounded-lg bg-surface p-5 ring-1 ring-border">
            <p className="text-[14px] font-medium text-fg">The plan didn&apos;t finish.</p>
            <p className="mt-1 text-[13px] text-fg-2">{runs.planSummary?.error?.message ?? "Something went wrong."} Your inputs are saved; try again.</p>
            <Button variant="agent" className="mt-4" onClick={replan}>
              Try again
            </Button>
          </div>
        ) : (
          <EmptyState
            title="No plan yet"
            body="I'll pick the guests from your accounts and network, write the question and the invites, and date every task."
            action={
              <Button variant="agent" onClick={replan}>
                Plan this {ev.kind === "dinner" ? "dinner" : "roundtable"}
              </Button>
            }
          />
        )
      ) : (
        <>
          <div className="-mx-6 mt-8 overflow-x-auto px-6 scrollbar-none md:mx-0 md:px-0">
            <Segmented<Tab>
              className="w-max"
              layoutId={`event-tabs-${ev.id}`}
              value={tab}
              onChange={setTab}
              options={[
                { value: "plan", label: "Plan" },
                { value: "guests", label: "Guests", count: counts.guests },
                ...(ev.kind === "dinner" ? [{ value: "nearby" as const, label: "Nearby" }] : []),
                { value: "timeline", label: "Timeline", count: counts.due || undefined },
                { value: "room", label: "Room" },
                { value: "after", label: "After" },
              ]}
            />
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
              transition={{ duration: 0.16, ease: ease.out }}
              className={cn("mt-6", runs.planning && "pointer-events-none opacity-60")}
              aria-busy={runs.planning}
            >
              {tab === "plan" && <PlanTab ev={ev} />}
              {tab === "guests" && <GuestsTab ev={ev} />}
              {tab === "nearby" && <NearbyTab ev={ev} />}
              {tab === "timeline" && <TimelineTab ev={ev} />}
              {tab === "room" && <RoomTab ev={ev} />}
              {tab === "after" && <AfterTab ev={ev} />}
            </motion.div>
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
