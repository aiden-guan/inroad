"use client";

import { CalendarDays, RefreshCw, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { FieldError, Input } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { Segmented, Skeleton } from "@/components/ui/misc";
import { unlessSheetOpen } from "@/components/companies/sheet/open-sheet";
import { cn } from "@/lib/client/cn";
import { relativeTime } from "@/lib/client/format";
import { normalizeAddress } from "@/lib/calendar/address";
import type { AgendaItem, CalendarDigest, ReviewCompany } from "@/lib/calendar/types";
import type { CalendarCandidate } from "@/lib/transcripts/match";
import { Ago, Callout, ConfirmButton, ExternalLink, Step, SubLabel } from "./parts";
import type { RowStatus } from "./row";
import { useNow } from "./use-hub";

/* ───────────── Data ───────────── */

interface CalendarResponse {
  digest: CalendarDigest;
  pending: CalendarCandidate[];
}

const NONE: CalendarCandidate[] = [];

/** GET /api/calendar, plus a setter for the digest each action returns. */
export function useCalendar() {
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.digest) throw new Error(body?.error ?? "Couldn't load your calendar.");
      setData(body as CalendarResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your calendar.");
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/calendar", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !body?.digest) setError(body?.error ?? "Couldn't load your calendar.");
        else setData(body as CalendarResponse);
      })
      .catch(() => !cancelled && setError("Couldn't load your calendar."));
    return () => {
      cancelled = true;
    };
  }, []);
  const setDigest = useCallback((digest: CalendarDigest) => setData((d) => ({ pending: d?.pending ?? [], digest })), []);
  return { digest: data?.digest ?? null, pending: data?.pending ?? NONE, error, reload, setDigest };
}

export function calendarStatus(digest: CalendarDigest | null, enabled: boolean, lastError?: string): RowStatus {
  if (digest?.state === "sample") return { tone: "on", label: "Sample calendar" };
  if (!enabled) return { tone: "off", label: "Not connected" };
  if (lastError || digest?.lastError) return { tone: "error", label: "Needs attention" };
  if (!digest?.lastSyncAt) return { tone: "waiting", label: "Reading your calendar" };
  return {
    tone: "on",
    label: (
      <>
        {digest.source?.label ?? "Connected"} · synced <Ago iso={digest.lastSyncAt} />
      </>
    ),
  };
}

async function post<T>(url: string, body?: unknown, method: "POST" | "DELETE" = "POST"): Promise<T> {
  const res = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? "That didn't work. Try again.");
  return json as T;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/* ───────────── Connect ───────────── */

type Provider = "google" | "outlook" | "icloud" | "other";

const HOW: Record<Provider, { path: string; note?: string; link?: { href: string; label: string } }> = {
  google: {
    path: "Google Calendar on the web → Settings → under Settings for my calendars, pick your calendar → Integrate calendar → Secret address in iCal format.",
    note: "On a work account, an admin can turn the secret address off. If it's missing, ask them, or use another calendar that has your meetings.",
    link: { href: "https://support.google.com/calendar/answer/37648", label: "Google's guide" },
  },
  outlook: {
    path: "Outlook on the web → Settings → Calendar → Shared calendars → Publish a calendar → pick your calendar and Can view all details → Publish → copy the ICS link.",
    note: "Published Outlook calendars can leave out guest lists. Then I can only match a meeting by who organized it.",
  },
  icloud: {
    path: "Calendar on your Mac → Control-click the calendar → Share Calendar → Public Calendar → copy the webcal:// address.",
    note: "Anyone with that address can see the calendar, so treat it like a password.",
  },
  other: {
    path: "Fastmail, Proton, Zoho and most calendar apps can share a calendar as an iCal (.ics) address. Look for Share, Export or Publish in the calendar's settings.",
  },
};

function ConnectCalendar({ sample, onConnected, onCancel }: { sample: boolean; onConnected: (d: CalendarDigest) => void; onCancel?: () => void }) {
  const { refresh } = useWorkspace();
  const [provider, setProvider] = useState<Provider>("google");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const how = HOW[provider];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const check = normalizeAddress(url);
    if (!check.ok) return setError(check.message);
    setBusy(true);
    setError(null);
    try {
      const body = await post<{ digest: CalendarDigest; summary?: string }>("/api/calendar", { url: check.url });
      setUrl("");
      await refresh();
      onConnected(body.digest);
      const d = body.digest;
      toast.success("Calendar connected", { description: `${plural(d.upcoming.total, "external meeting")} in the next ${d.window.futureDays} days.` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that calendar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="max-w-[62ch] text-pretty text-[13px] leading-[19px] text-fg-2">
        Paste your calendar&apos;s private address. Every 15 minutes while Inroad is open, I read it, match each meeting with someone outside your company to its company, and have the brief ready before the call. Nothing is written to your calendar.
      </p>
      <Step n={1} title="Copy your calendar's private address">
        <Segmented
          layoutId="calendar-provider"
          value={provider}
          onChange={setProvider}
          options={[
            { value: "google", label: "Google" },
            { value: "outlook", label: "Outlook" },
            { value: "icloud", label: "iCloud" },
            { value: "other", label: "Other" },
          ]}
        />
        <p className="mt-2.5 text-pretty text-[13px] leading-[19px] text-fg-2">{how.path}</p>
        {how.link && (
          <div className="mt-1.5">
            <ExternalLink href={how.link.href}>{how.link.label}</ExternalLink>
          </div>
        )}
        {how.note && <p className="mt-2 text-pretty text-[12px] leading-[18px] text-fg-3">{how.note}</p>}
      </Step>
      <Step n={2} title="Paste it here">
        {sample ? (
          <p className="text-[13px] leading-[19px] text-fg-3">This is the sample workspace, so its calendar is made up. Start with your own company to connect yours.</p>
        ) : (
          <>
            <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="password"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics"
                aria-label="Your calendar's private iCal address"
                aria-invalid={Boolean(error)}
                autoComplete="off"
                spellCheck={false}
                data-1p-ignore
                className="font-mono text-[12px]"
              />
              <div className="flex shrink-0 gap-2">
                <Button type="submit" variant="primary" loading={busy}>
                  Connect
                </Button>
                {onCancel && (
                  <Button type="button" variant="ghost" onClick={onCancel}>
                    Cancel
                  </Button>
                )}
              </div>
            </form>
            {busy ? (
              <p className="mt-2 text-[12px]" aria-live="polite">
                <span className="shimmer-text">Reading your calendar, 60 days back and 30 ahead…</span>
              </p>
            ) : error ? (
              <FieldError>{error}</FieldError>
            ) : (
              <p className="mt-2 text-pretty text-[12px] leading-[18px] text-fg-3">The address works like a password. It stays on this computer, outside your workspace file, and only its last four characters are shown here.</p>
            )}
          </>
        )}
      </Step>
    </div>
  );
}

/* ───────────── What it found ───────────── */

function Headline({ d }: { d: CalendarDigest }) {
  const n = (v: number) => <span className="font-mono tnum text-fg">{v}</span>;
  return (
    <div>
      <p className="text-pretty text-[14px] leading-[21px] text-fg-2">
        {n(d.upcoming.total)} external meeting{d.upcoming.total === 1 ? "" : "s"} in the next {d.window.futureDays} days
        <span aria-hidden className="mx-1.5 text-fg-4">·</span>
        {n(d.upcoming.pipeline)} with compan{d.upcoming.pipeline === 1 ? "y" : "ies"} in your pipeline
        <span aria-hidden className="mx-1.5 text-fg-4">·</span>
        {n(d.upcoming.newCompanies)} new compan{d.upcoming.newCompanies === 1 ? "y" : "ies"}
      </p>
      <p className="mt-1 text-pretty text-[12px] leading-[18px] text-fg-3">
        Last {d.window.pastDays} days: {plural(d.past.total, "external meeting")}, {d.past.onDeals} on deals. Left out: {d.hidden.internal} internal, {d.hidden.solo} with no guests, {d.hidden.allDay} all-day
        {d.hidden.declined ? `, ${d.hidden.declined} declined` : ""}.{d.upcoming.personal ? ` ${plural(d.upcoming.personal, "upcoming meeting is", "upcoming meetings are")} with personal addresses only, so ${d.upcoming.personal === 1 ? "it isn't" : "they aren't"} matched to a company.` : ""}
      </p>
    </div>
  );
}

const STATUS_LABEL: Record<ReviewCompany["status"], string> = { new: "New", known: "Tracked, no deal", customer: "Customer" };

function ReviewList({ review, busy, onTrack, onIgnore }: { review: ReviewCompany[]; busy: string | null; onTrack: (r: ReviewCompany) => void; onIgnore: (r: ReviewCompany) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? review : review.slice(0, 5);
  const now = useNow();
  const onKey = (e: KeyboardEvent<HTMLLIElement>, r: ReviewCompany) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "t") {
      e.preventDefault();
      onTrack(r);
    } else if (k === "x") {
      e.preventDefault();
      onIgnore(r);
    } else if (k === "j" || k === "arrowdown") {
      e.preventDefault();
      (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
    } else if (k === "k" || k === "arrowup") {
      e.preventDefault();
      (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
    }
  };
  return (
    <section aria-labelledby="calendar-review-label">
      <SubLabel
        right={
          <span className="hidden items-center gap-1 text-[11px] text-fg-3 md:pointer-fine:flex">
            <Kbd>T</Kbd> track <Kbd>X</Kbd> ignore
          </span>
        }
      >
        <span id="calendar-review-label">Not in your pipeline yet · {review.length}</span>
      </SubLabel>
      <ul className="divide-y divide-border overflow-hidden rounded-lg bg-surface ring-1 ring-border">
        {shown.map((r) => {
          const meeting = r.next ?? r.last;
          const upcoming = !!r.next;
          return (
            <li
              key={r.domain}
              tabIndex={0}
              onKeyDown={(e) => onKey(e, r)}
              aria-label={`${r.name}, ${STATUS_LABEL[r.status]}`}
              className="flex flex-col gap-2 px-3 py-2.5 outline-none transition-colors duration-150 focus-visible:bg-bg-subtle focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] sm:flex-row sm:items-center sm:gap-3"
            >
              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                <Favicon domain={r.domain} name={r.name} size={20} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="truncate text-[13.5px] font-medium text-fg">{r.name}</span>
                    <span className="truncate font-mono text-[11.5px] text-fg-3">{r.domain}</span>
                    {r.status !== "new" && <Badge tone="outline">{STATUS_LABEL[r.status]}</Badge>}
                  </p>
                  {meeting && (
                    <p className="mt-0.5 truncate text-[12px] text-fg-3">
                      <span className={cn("font-mono tnum", upcoming && "text-fg-2")}>
                        {upcoming ? `${day(meeting.start)}, ${time(meeting.start)}` : `Met ${day(meeting.start)}${now ? ` (${relativeTime(meeting.start, now)})` : ""}`}
                      </span>
                      {" · "}
                      {meeting.title || "Meeting"}
                    </p>
                  )}
                  {r.guests.length > 0 && <p className="mt-0.5 truncate text-[12px] text-fg-3">{r.guests.map((g) => g.name ?? g.email).join(", ")}</p>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 pl-[30px] sm:pl-0">
                <Button size="xs" variant="primary" loading={busy === r.domain} disabled={!!busy && busy !== r.domain} onClick={() => onTrack(r)}>
                  Track
                </Button>
                <Button size="xs" variant="ghost" disabled={!!busy} onClick={() => onIgnore(r)}>
                  Ignore
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {review.length > 5 && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-1.5 rounded-sm px-1 text-[12px] font-medium text-fg-3 hover:text-fg-2">
          {all ? "Show fewer" : `Show ${review.length - 5} more`}
        </button>
      )}
      <p className="mt-2 px-1 text-pretty text-[12px] leading-[18px] text-fg-3">Track adds the company, the people on the invite and its meetings, and starts the deal at Talking. Ignore keeps that domain out for good.</p>
    </section>
  );
}

function Agenda({ items }: { items: AgendaItem[] }) {
  const { ws } = useWorkspace();
  const { start, runs } = useRuns();
  const router = useRouter();
  const [all, setAll] = useState(false);
  if (!ws) return null;
  const shown = all ? items : items.slice(0, 8);
  const prepping = (id: string) => Object.values(runs).some((r) => r.ref?.kind === "meeting" && r.ref.id === id && (r.status === "running" || r.status === "queued"));
  const open = (it: AgendaItem) => {
    if (!it.domain || !it.meetingId) return;
    router.push(`/companies?c=${encodeURIComponent(it.domain)}&intent=prep&ref=${encodeURIComponent(it.meetingId)}`);
  };
  return (
    <section aria-labelledby="calendar-agenda-label">
      <SubLabel>
        <span id="calendar-agenda-label">Coming up</span>
      </SubLabel>
      {items.length === 0 ? (
        <p className="rounded-md bg-bg-subtle px-3 py-2.5 text-[13px] text-fg-3">No external meetings in the next two weeks.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg bg-surface ring-1 ring-border">
          {shown.map((it) => {
            const meeting = it.meetingId ? ws.meetings[it.meetingId] : undefined;
            const busy = it.meetingId ? prepping(it.meetingId) : false;
            const state =
              it.kind === "personal" ? (
                <span className="text-[11.5px] text-fg-3">Personal address</span>
              ) : it.kind === "ignored" ? (
                <span className="text-[11.5px] text-fg-3">Ignored</span>
              ) : it.kind === "review" ? (
                <Badge tone="warning">Not tracked</Badge>
              ) : meeting?.debrief ? (
                <Badge tone="outline">Debriefed</Badge>
              ) : meeting?.brief ? (
                <Badge tone="outline">Brief ready</Badge>
              ) : meeting ? (
                <Button
                  size="xs"
                  variant="agent"
                  loading={busy}
                  title="Write the brief"
                  onClick={(e) => {
                    e.stopPropagation();
                    void start("prep", { meetingId: meeting.id }, { notify: it.domain ? unlessSheetOpen(it.domain) : true });
                  }}
                >
                  Prep
                </Button>
              ) : (
                <span className="text-[11.5px] text-fg-3">Adding to the deal</span>
              );
            return (
              <li key={it.id} className="flex items-center gap-3 px-3 py-2">
                <span className="w-[88px] shrink-0 font-mono text-[11.5px] leading-4 tnum text-fg-3">
                  {day(it.start).replace(/,.*/, "")}
                  <br />
                  {time(it.start)}
                </span>
                <button type="button" onClick={() => open(it)} disabled={!meeting} className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default">
                  {it.domain ? <Favicon domain={it.domain} name={it.company} size={16} /> : <CalendarDays className="size-4 shrink-0 text-fg-3" aria-hidden />}
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-fg">{it.title || "Meeting"}</span>
                    <span className="flex items-center gap-1 truncate text-[11.5px] text-fg-3">
                      {it.company ?? it.guests.map((g) => g.name ?? g.email).join(", ")}
                      {it.conference && (
                        <>
                          <span aria-hidden>·</span>
                          <Video className="size-3 shrink-0" aria-hidden />
                          {it.conference}
                        </>
                      )}
                    </span>
                  </span>
                </button>
                <span className="shrink-0">{state}</span>
              </li>
            );
          })}
        </ul>
      )}
      {items.length > 8 && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-1.5 rounded-sm px-1 text-[12px] font-medium text-fg-3 hover:text-fg-2">
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </section>
  );
}

/* ───────────── The panel ───────────── */

export function CalendarPanel({ digest, error, onDigest, onReload }: { digest: CalendarDigest | null; error: string | null; onDigest: (d: CalendarDigest) => void; onReload: () => Promise<void> }) {
  const { ws, refresh } = useWorkspace();
  const router = useRouter();
  const [replacing, setReplacing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const reviewRef = useRef<HTMLDivElement>(null);
  const review = useMemo(() => (digest?.review ?? []).filter((r) => !hidden.has(r.domain)), [digest, hidden]);

  // From a Today card (?calendar=review): land on the companies waiting for a decision.
  useEffect(() => {
    if (!digest || typeof window === "undefined") return;
    if (new URL(window.location.href).searchParams.get("calendar") !== "review") return;
    const frame = requestAnimationFrame(() => reviewRef.current?.scrollIntoView({ block: "center" }));
    return () => cancelAnimationFrame(frame);
  }, [digest]);

  if (error && !digest) {
    return (
      <div>
        <FieldError>{error}</FieldError>
        <Button size="sm" variant="ghost" className="-ml-2 mt-1" onClick={() => void onReload()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!digest || !ws) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="mt-3 h-24" />
      </div>
    );
  }

  const sample = digest.state === "sample";
  if (digest.state === "off" || replacing) {
    return (
      <ConnectCalendar
        sample={sample}
        onConnected={(d) => {
          setReplacing(false);
          onDigest(d);
        }}
        onCancel={replacing ? () => setReplacing(false) : undefined}
      />
    );
  }

  const track = async (r: ReviewCompany) => {
    if (busy) return;
    setBusy(r.domain);
    try {
      const body = await post<{ name: string; meetings: number; meetingIds: Record<string, string>; digest: CalendarDigest }>("/api/calendar/track", { domain: r.domain });
      setHidden((h) => new Set(h).add(r.domain));
      onDigest(body.digest);
      await refresh();
      toast.success(`${body.name} is tracked`, {
        description: body.meetings ? `${plural(body.meetings, "meeting")} added to its deal at Talking.` : "It's on your list.",
        action: { label: "Open", onClick: () => router.push(`/companies?c=${encodeURIComponent(r.domain)}`) },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't track that company.");
    } finally {
      setBusy(null);
    }
  };

  const ignore = async (r: ReviewCompany) => {
    if (busy) return;
    setHidden((h) => new Set(h).add(r.domain));
    try {
      const body = await post<{ digest: CalendarDigest }>("/api/calendar/ignore", { domain: r.domain });
      onDigest(body.digest);
      void refresh();
      toast(`${r.domain} won't come up again`, {
        action: {
          label: "Undo",
          onClick: () => {
            void post<{ digest: CalendarDigest }>("/api/calendar/ignore", { domain: r.domain, undo: true }).then((b) => {
              setHidden((h) => {
                const n = new Set(h);
                n.delete(r.domain);
                return n;
              });
              onDigest(b.digest);
            });
          },
        },
      });
    } catch (e) {
      setHidden((h) => {
        const n = new Set(h);
        n.delete(r.domain);
        return n;
      });
      toast.error(e instanceof Error ? e.message : "Couldn't ignore that company.");
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const body = await post<{ digest: CalendarDigest; summary?: string; changed?: boolean }>("/api/calendar/sync");
      onDigest(body.digest);
      if (body.changed) await refresh();
      toast(body.summary ?? "Your calendar is up to date.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't read your calendar.");
      await onReload();
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = async () => {
    try {
      const body = await post<{ digest: CalendarDigest }>("/api/calendar", undefined, "DELETE");
      onDigest(body.digest);
      await refresh();
      toast("Calendar disconnected. Meetings already on deals stay there.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't disconnect.");
    }
  };

  const nothingYet = digest.upcoming.total === 0 && digest.past.total === 0;

  return (
    <div className="space-y-6">
      {sample && <Callout tone="neutral">This is Priya&apos;s calendar in the sample workspace. Track and Ignore work here; nothing leaves this computer.</Callout>}
      {digest.lastError && (
        <p role="alert" className="rounded-md bg-danger-subtle px-3 py-2 text-[13px] leading-[19px] text-danger">
          {digest.lastError}
        </p>
      )}
      {nothingYet ? (
        <p className="text-pretty text-[13px] leading-[19px] text-fg-2">
          No meetings with people outside your company in the last {digest.window.pastDays} days or the next {digest.window.futureDays}. Internal, all-day and declined events are left out. If your meetings do have guests, your calendar may hide guest lists.
        </p>
      ) : (
        <Headline d={digest} />
      )}
      {digest.notes.length > 0 && (
        <Callout>
          <ul className="space-y-1">
            {digest.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Callout>
      )}
      {review.length > 0 && !digest.consumer && (
        <div ref={reviewRef} className="scroll-mt-24">
          <ReviewList review={review} busy={busy} onTrack={(r) => void track(r)} onIgnore={(r) => void ignore(r)} />
        </div>
      )}
      <Agenda items={digest.agenda.filter((a) => !a.domain || !hidden.has(a.domain) || a.kind === "pipeline")} />

      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-border pt-3 text-[12px] text-fg-3">
        <span className="mr-2 min-w-0 max-w-full truncate">
          <span className="text-fg-2">{digest.source?.name ?? digest.source?.label ?? "Calendar"}</span>
          {digest.source && (
            <span className="font-mono">
              {" "}
              · {digest.source.host} {digest.source.hint}
            </span>
          )}
          {digest.lastSyncAt && (
            <>
              {" · read "}
              <Ago iso={digest.lastSyncAt} />
            </>
          )}
        </span>
        {!sample && (
          <>
            <button type="button" onClick={() => void syncNow()} disabled={syncing} className="inline-flex h-7 items-center gap-1 rounded-sm px-2 font-medium text-fg-3 transition-colors duration-150 hover:bg-bg-subtle hover:text-fg-2 disabled:opacity-50">
              <RefreshCw className={cn("size-3", syncing && "animate-spin")} aria-hidden />
              {syncing ? "Reading…" : "Sync now"}
            </button>
            <button type="button" onClick={() => setReplacing(true)} className="inline-flex h-7 items-center rounded-sm px-2 font-medium text-fg-3 transition-colors duration-150 hover:bg-bg-subtle hover:text-fg-2">
              Replace address
            </button>
            <ConfirmButton confirmLabel="Disconnect the calendar?" onConfirm={() => void disconnect()}>
              Disconnect
            </ConfirmButton>
          </>
        )}
      </div>
    </div>
  );
}
