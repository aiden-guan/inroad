"use client";

import { CalendarDays, CalendarPlus, ChevronDown, FileText, FileUp, Phone, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useRuns, type RunState } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea, Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/misc";
import { WorkLog } from "@/components/ui/work-log";
import { cn } from "@/lib/client/cn";
import { relativeTime } from "@/lib/client/format";
import { looksLikeTranscript, newDeal } from "@/lib/deals/rules";
import type { Action } from "@/lib/domain/actions";
import { newId, nowISO, todayISO } from "@/lib/domain/ids";
import type { Account, Deal, Meeting, Person } from "@/lib/domain/types";
import { readTranscriptFile, TalkShare, TRANSCRIPT_ACCEPT } from "@/components/transcripts/transcript-intake";
import { matchTranscript } from "@/lib/transcripts/match";
import { parseTranscript, type ParsedTranscript } from "@/lib/transcripts/parse";
import { BriefView } from "./brief-view";
import { DebriefReview } from "./debrief-review";
import { Section, useNow } from "./shared";

const pad = (n: number) => String(n).padStart(2, "0");
function toLocalInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function when(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

/** Runs about this deal's meetings, newest first. */
function useMeetingRuns(meetingIds: string[]) {
  const { runs } = useRuns();
  return useMemo(() => {
    const ids = new Set(meetingIds);
    return Object.values(runs)
      .filter((r) => r.ref?.kind === "meeting" && ids.has(r.ref.id))
      .sort((a, b) => b.startedAt - a.startedAt);
  }, [runs, meetingIds]);
}

export function MeetingsSection({ deal, account, today, focusLog }: { deal: Deal; account: Account; today: string; focusLog: boolean }) {
  const { ws } = useWorkspace();
  const now = useNow();
  const [adding, setAdding] = useState(false);
  const [logging, setLogging] = useState(focusLog);
  // A transcript dropped on a meeting row opens Log a call with it read and that meeting picked.
  const [dropped, setDropped] = useState<{ meetingId: string; text: string; fileName: string; n: number } | null>(null);
  const meetings = useMemo(
    () =>
      deal.meetingIds
        .map((id) => ws?.meetings[id])
        .filter((m): m is Meeting => !!m)
        .sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
    [deal.meetingIds, ws],
  );
  const runs = useMeetingRuns(deal.meetingIds);
  // ⌘K "Prep for…" lands on its meeting, opened.
  const params = useSearchParams();
  const focusId = params.get("intent") === "prep" || params.get("intent") === "debrief" ? params.get("ref") : null;
  const needsDebrief = meetings.find((m) => !m.debrief && new Date(m.startsAt).getTime() <= now);
  const next = [...meetings].reverse().find((m) => new Date(m.startsAt).getTime() > now);

  return (
    <Section
      label="Meetings"
      right={
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" icon={<CalendarPlus className="size-3.5" />} onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
            Add meeting
          </Button>
          <Button
            size="sm"
            variant={needsDebrief || !next ? "primary" : "secondary"}
            icon={<Phone className="size-3.5" />}
            onClick={() => {
              setLogging((l) => !l);
              setDropped(null);
            }}
            aria-expanded={logging}
          >
            Log a call
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {adding && <AddMeeting deal={deal} account={account} onDone={() => setAdding(false)} />}
        {logging && (
          <LogCall
            key={dropped?.n ?? 0}
            deal={deal}
            account={account}
            meetings={meetings}
            defaultMeetingId={dropped?.meetingId ?? needsDebrief?.id}
            initial={dropped ?? undefined}
            autoFocus={focusLog || logging}
            onClose={() => {
              setLogging(false);
              setDropped(null);
            }}
          />
        )}
        {meetings.length === 0 && !adding && !logging && (
          <p className="rounded-md bg-bg-subtle px-3 py-3 text-[13px] text-fg-2">No meetings yet. Add the next one and I&apos;ll prep a brief, or log a call that already happened.</p>
        )}
        <ul className="space-y-2">
          {meetings.map((m) => (
            <MeetingRow
              key={m.id}
              meeting={m}
              deal={deal}
              now={now}
              today={today}
              run={runs.find((r) => r.ref?.id === m.id)}
              focus={m.id === focusId}
              onTranscript={(file) => {
                setDropped((d) => ({ meetingId: m.id, ...file, n: (d?.n ?? 0) + 1 }));
                setLogging(true);
              }}
            />
          ))}
        </ul>
      </div>
    </Section>
  );
}

function MeetingRow({
  meeting,
  deal,
  now,
  today,
  run,
  focus,
  onTranscript,
}: {
  meeting: Meeting;
  deal: Deal;
  now: number;
  today: string;
  run?: RunState;
  focus?: boolean;
  onTranscript?: (file: { text: string; fileName: string }) => void;
}) {
  const { start } = useRuns();
  const row = useRef<HTMLLIElement>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (focus) row.current?.scrollIntoView({ block: "nearest" });
  }, [focus]);
  const upcoming = new Date(meeting.startsAt).getTime() > now;
  const active = run && (run.status === "running" || run.status === "queued");
  const unapplied = !!meeting.debrief && !meeting.debrief.appliedAt;
  const soon = upcoming && new Date(meeting.startsAt).getTime() - now < 36 * 3_600_000;
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? (!!focus || unapplied || !!active || (soon && !!meeting.brief));
  const [view, setView] = useState<"brief" | "debrief" | null>(null);
  const shown = meeting.debrief && meeting.brief ? (view ?? (upcoming && !unapplied ? "brief" : "debrief")) : meeting.debrief ? "debrief" : "brief";

  const prep = () => {
    setOpen(true);
    setView("brief");
    void start("prep", { meetingId: meeting.id });
  };

  const drop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file || !onTranscript) return;
    if (upcoming) return void toast.error("That call hasn't happened yet. Drop the transcript on the meeting it came from.");
    const r = await readTranscriptFile(file);
    if ("error" in r) toast.error(r.error);
    else onTranscript(r);
  };

  return (
    <li
      ref={row}
      onDragOver={(e) => {
        if (!onTranscript || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        if (!upcoming) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => void drop(e)}
      className={cn("relative scroll-mt-16 rounded-lg bg-surface ring-1 transition-shadow duration-150", dragging ? "ring-2 ring-accent" : unapplied || focus ? "ring-border-strong" : "ring-border")}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-surface/90 text-[13px] font-medium text-accent-text" aria-hidden>
          Drop the transcript to debrief this call
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <button onClick={() => setOpen(!expanded)} aria-expanded={expanded} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown className={cn("size-3.5 shrink-0 text-fg-3 transition-transform duration-200", !expanded && "-rotate-90")} aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-medium text-fg">{meeting.title}</span>
            <span className="block truncate font-mono text-[12px] text-fg-3">
              {when(meeting.startsAt)} · {relativeTime(meeting.startsAt, now)}
              {meeting.attendees.length > 0 && <span className="font-sans"> · {meeting.attendees.map((a) => a.name).join(", ")}</span>}
              {meeting.source === "calendar" && (
                <span className="font-sans" title="Came in from your calendar">
                  {" · "}
                  <CalendarDays className="mb-px inline size-3" aria-hidden /> Calendar
                </span>
              )}
            </span>
          </span>
        </button>
        <div className="flex items-center gap-1.5">
          {meeting.debrief ? (
            unapplied ? <Badge tone="neutral">Review the debrief</Badge> : <Badge tone="outline">Debriefed</Badge>
          ) : !upcoming ? (
            <Badge tone="warning">Needs a debrief</Badge>
          ) : meeting.brief ? (
            <Badge tone="outline">Brief ready</Badge>
          ) : null}
          {upcoming && !meeting.brief && !active && (
            <Button size="sm" variant="agent" onClick={prep} icon={<FileText className="size-3.5" />}>
              Prep
            </Button>
          )}
          {meeting.brief && !active && (
            <Button size="sm" variant="ghost" onClick={prep} title="Write a fresh brief">
              Re-prep
            </Button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="space-y-4 border-t border-border px-3 pb-4 pt-3 sm:px-4">
          {run && (active || run.status === "error") && <WorkLog run={run} />}
          {meeting.brief && meeting.debrief && (
            <Segmented
              layoutId={`meeting-view-${meeting.id}`}
              value={shown}
              onChange={setView}
              options={[
                { value: "debrief", label: "Debrief" },
                { value: "brief", label: "Brief" },
              ]}
            />
          )}
          {shown === "debrief" && meeting.debrief && <DebriefReview deal={deal} meeting={meeting} debrief={meeting.debrief} today={today} />}
          {shown === "brief" && meeting.brief && <BriefView meeting={meeting} brief={meeting.brief} />}
          {!meeting.brief && !meeting.debrief && !active && (
            <p className="text-[13px] text-fg-2">
              {upcoming
                ? "No brief yet. Prep writes a 5-minute read: goals, an agenda, 8–12 questions, likely objections and the next step to ask for."
                : "Log what happened and I'll update the card, draft the recap and check the next step. Drop the call's transcript on this meeting to debrief it."}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function AddMeeting({ deal, account, onDone }: { deal: Deal; account: Account; onDone: () => void }) {
  const { ws, dispatch } = useWorkspace();
  const { start } = useRuns();
  const people = account.peopleIds.map((id) => ws?.people[id]).filter((p): p is Person => !!p);
  const [title, setTitle] = useState(`${account.name} <> ${ws?.company?.name ?? "us"}`);
  const [startsAt, setStartsAt] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set(deal.contacts.map((c) => c.personId)));
  const [extra, setExtra] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async (andPrep: boolean) => {
    if (!title.trim()) return setError("Give it a title.");
    if (!startsAt) return setError("Pick a date and time.");
    const attendees = [
      ...people.filter((p) => picked.has(p.id)).map((p) => ({ personId: p.id, name: p.name, title: p.title || undefined })),
      ...extra
        .split(/\n|;/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const [name, ...rest] = s.split(",");
          return { name: name.trim(), title: rest.join(",").trim() || undefined };
        }),
    ];
    const meeting: Meeting = { id: newId("mtg"), dealId: deal.id, title: title.trim(), startsAt: new Date(startsAt).toISOString(), attendees };
    const ok = await dispatch({ type: "meeting.upsert", meeting });
    if (!ok) return;
    if (andPrep) void start("prep", { meetingId: meeting.id });
    toast(andPrep ? "Meeting added. Prepping the brief." : "Meeting added");
    onDone();
  };

  return (
    <div className="rounded-lg bg-surface p-3 ring-1 ring-border animate-[fade-in_150ms_var(--ease-out)]">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
        <div>
          <Label htmlFor="mtg-title">Title</Label>
          <Input id="mtg-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="mtg-when">When</Label>
          <Input
            id="mtg-when"
            type="datetime-local"
            value={startsAt}
            onFocus={() => !startsAt && setStartsAt(toLocalInput(new Date(Date.now() + 86_400_000)))}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-3">
        <Label hint="Name, Title — one per line">Who&apos;s joining</Label>
        {people.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {people.slice(0, 10).map((p) => {
              const on = picked.has(p.id);
              return (
                <button
                  key={p.id}
                  aria-pressed={on}
                  onClick={() =>
                    setPicked((s) => {
                      const n = new Set(s);
                      if (on) n.delete(p.id);
                      else n.add(p.id);
                      return n;
                    })
                  }
                  className={cn("inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] ring-1 transition-colors", on ? "bg-primary text-primary-fg ring-primary" : "text-fg-2 ring-border hover:bg-bg-subtle")}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        )}
        <Textarea value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={"Dana Kim, VP Engineering\nSam Ortiz, CFO"} className="min-h-14" />
      </div>
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void save(false)}>
          Add meeting
        </Button>
        <Button size="sm" variant="agent" onClick={() => void save(true)}>
          Add and prep
        </Button>
      </div>
    </div>
  );
}

const NEW_CALL = "__new";

/** A file format a call recorder writes (not text someone typed): worth reading in code before it's shown. */
const EXPORTS = new Set<ParsedTranscript["format"]>(["zoom_vtt", "teams_vtt", "vtt", "srt", "zoom_txt", "fathom", "otter", "meet", "granola", "speaker_text"]);

function readExport(text: string, fileName: string | undefined, founderNames: string[]): ParsedTranscript | null {
  const p = parseTranscript(text, { fileName, now: new Date(), founderNames });
  return p.isTranscript && EXPORTS.has(p.format) ? p : null;
}

const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * Paste notes or a transcript, or drop the transcript file (Zoom, Meet, Teams, Fathom, Granola, Otter): a file
 * is read in code first, its call matched to one of this deal's meetings by date and who spoke. The source
 * is detected (speaker labels, timestamps) and editable.
 */
export function LogCall({
  deal,
  account,
  meetings,
  defaultMeetingId,
  initial,
  autoFocus,
  onClose,
}: {
  deal?: Deal;
  account: Account;
  meetings: Meeting[];
  defaultMeetingId?: string;
  /** A transcript dropped on a meeting row. */
  initial?: { text: string; fileName?: string };
  autoFocus?: boolean;
  onClose: () => void;
}) {
  const { start } = useRuns();
  const { ws, dispatch } = useWorkspace();
  const founders = useMemo(() => [ws?.founder.name, ws?.sender?.name].filter((n): n is string => !!n && !!n.trim()), [ws]);
  const [loaded, setLoaded] = useState<ParsedTranscript | null>(() => (initial ? readExport(initial.text, initial.fileName, founders) : null));
  const [text, setText] = useState(() => loaded?.text ?? initial?.text ?? "");
  const [override, setOverride] = useState<"transcript" | "founder_notes" | null>(() => (loaded ? "transcript" : null));
  const [meetingId, setMeetingId] = useState(defaultMeetingId ?? NEW_CALL);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const detected = looksLikeTranscript(text) ? "transcript" : "founder_notes";
  const source = override ?? detected;
  const picked = meetingId !== NEW_CALL ? meetings.find((m) => m.id === meetingId) : undefined;
  const offBy = loaded?.when && picked ? Math.abs(Math.round((Date.parse(`${loaded.when.date}T12:00:00`) - Date.parse(`${todayISO(new Date(picked.startsAt))}T12:00:00`)) / 86_400_000)) : 0;

  /** A transcript file or export: read in code, shown clean, matched to its meeting. */
  const ingest = (raw: string, fileName?: string) => {
    const p = readExport(raw, fileName, founders);
    setFileError(null);
    if (!p) {
      setText(raw);
      setLoaded(null);
      return;
    }
    setLoaded(p);
    setText(p.text);
    setOverride("transcript");
    if (!ws) return;
    const m = matchTranscript(p, { ws, now: new Date(), founderNames: founders, meetingIds: meetings.map((x) => x.id) });
    if (m.best?.meetingId) setMeetingId(m.best.meetingId);
    else if (p.when) setMeetingId(NEW_CALL);
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    const r = await readTranscriptFile(file);
    if ("error" in r) return setFileError(r.error);
    ingest(r.text, r.fileName);
  };

  // The call becomes a meeting first (and the deal, if this is the first conversation), so the
  // meeting row can show the live work log and then the review.
  const submit = async () => {
    if (text.trim().length < 20 || busy) return;
    setBusy(true);
    const at = nowISO();
    const actions: Action[] = [];
    let dealId = deal?.id;
    if (!dealId) {
      const d = newDeal(account, newId("deal"), at);
      actions.push({ type: "deal.create", deal: d });
      dealId = d.id;
    }
    let mid = meetingId !== NEW_CALL ? meetingId : null;
    if (!mid) {
      // Dated, titled and attended from the transcript when there is one.
      const when = loaded?.when?.iso ?? (loaded?.when ? new Date(`${loaded.when.date}T${loaded.when.time ?? "12:00"}:00`).toISOString() : at);
      const people = account.peopleIds.map((id) => ws?.people[id]).filter((p): p is Person => !!p);
      const attendees = (loaded?.speakers ?? [])
        .filter((sp) => !sp.founder && !sp.generic)
        .map((sp) => {
          const person = people.find((p) => p.name.toLowerCase() === sp.name.toLowerCase());
          return person ? { personId: person.id, name: person.name, ...(person.title ? { title: person.title } : {}) } : { name: sp.name };
        });
      const m: Meeting = { id: newId("mtg"), dealId, title: loaded?.title ?? `Call with ${account.name}`, startsAt: when, attendees };
      actions.push({ type: "meeting.upsert", meeting: m });
      mid = m.id;
    }
    if (actions.length && !(await dispatch(actions))) return setBusy(false);
    const state = await start("debrief", { meetingId: mid, notes: text.trim(), source });
    setBusy(false);
    if (state) {
      setText("");
      setLoaded(null);
      onClose();
    }
  };

  return (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void loadFile(e.dataTransfer.files?.[0]);
      }}
      className={cn("rounded-lg bg-surface p-3 ring-1 transition-shadow duration-150 animate-[fade-in_150ms_var(--ease-out)]", dragging ? "ring-2 ring-accent" : "ring-border")}
    >
      <input ref={fileRef} type="file" accept={TRANSCRIPT_ACCEPT} className="hidden" onChange={(e) => void loadFile(e.target.files?.[0]).finally(() => (e.target.value = ""))} />
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[13px] font-semibold text-fg">Log a call</p>
        <Button size="xs" variant="ghost" icon={<FileUp className="size-3.5" />} onClick={() => fileRef.current?.click()} title="A .vtt, .srt, .txt or .md transcript from Zoom, Meet, Teams, Fathom, Granola or Otter">
          Upload transcript
        </Button>
        {meetings.length > 0 && (
          <Select
            value={meetingId}
            onChange={(e) => setMeetingId(e.target.value)}
            aria-label="Which call"
            className="h-7 max-w-56 rounded-sm bg-surface px-2 text-[12px] text-fg ring-1 ring-border-strong/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} · {new Date(m.startsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                {m.debrief ? " · redo debrief" : ""}
              </option>
            ))}
            <option value={NEW_CALL}>{loaded?.when ? `A new call on ${dayLabel(loaded.when.date)}` : "A new call today"}</option>
          </Select>
        )}
        <Segmented
          layoutId="log-call-source"
          value={source}
          onChange={setOverride}
          options={[
            { value: "transcript", label: "Transcript" },
            { value: "founder_notes", label: "My notes" },
          ]}
        />
        <button onClick={onClose} aria-label="Close" className="inline-flex size-7 items-center justify-center rounded-sm text-fg-3 hover:bg-bg-subtle hover:text-fg">
          <X className="size-4" />
        </button>
      </div>
      {loaded && (
        <div className="mb-2 rounded-md bg-bg-subtle px-3 py-2">
          <p className="text-[12px] text-fg-2">
            {loaded.formatLabel}
            {loaded.durationSec ? ` · ${Math.round(loaded.durationSec / 60)} min` : ""}
            {` · ${loaded.words.toLocaleString("en-US")} words`}
            {loaded.when ? ` · ${dayLabel(loaded.when.date)}${loaded.when.time ? ` ${loaded.when.time}` : ""}` : ""}
          </p>
          <TalkShare p={loaded} className="mt-1.5" />
          {offBy >= 2 && picked && (
            <p className="mt-1.5 text-[12px] text-warning">
              This transcript looks like it&apos;s from {dayLabel(loaded.when!.date)}, but this meeting was {dayLabel(todayISO(new Date(picked.startsAt)))}. Check the call above.
            </p>
          )}
          {loaded.warnings.map((w) => (
            <p key={w} className="mt-1 text-[12px] text-fg-3">
              {w}
            </p>
          ))}
        </div>
      )}
      <Textarea
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          // A raw export pasted in (WebVTT cues, a Fathom or Otter copy) is read in code, like a dropped file.
          const pasted = e.clipboardData.getData("text");
          if (!text.trim() && pasted.length > 40 && readExport(pasted, undefined, founders)) {
            e.preventDefault();
            ingest(pasted);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        disabled={busy}
        placeholder="Paste the transcript or your notes, or drop the transcript file here. Speaker labels and timestamps are detected automatically."
        className="max-h-[50vh] min-h-36 overflow-y-auto text-[13px] leading-5"
      />
      {fileError && <p className="mt-1.5 text-[12px] text-danger">{fileError}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[12px] text-fg-3">
          {source === "transcript" ? "Quotes will be verbatim, checked against the transcript." : "Your notes stay your words; I won't present them as theirs."}
          {!override && text.trim() && " (detected)"}
        </p>
        <Button variant="agent" onClick={() => void submit()} disabled={text.trim().length < 20 || busy} loading={busy} kbd="⌘↵">
          Debrief this call
        </Button>
      </div>
    </div>
  );
}
