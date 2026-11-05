"use client";

import { FileUp, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { unlessSheetOpen } from "@/components/companies/sheet/open-sheet";
import { useNow } from "@/components/companies/sheet/shared";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { Input, Select, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/client/cn";
import { newDeal } from "@/lib/deals/rules";
import type { Action } from "@/lib/domain/actions";
import { newId, nowISO } from "@/lib/domain/ids";
import { OPEN_STAGES, type Meeting, type Workspace } from "@/lib/domain/types";
import { matchTranscript, type CalendarCandidate, type MatchCandidate } from "@/lib/transcripts/match";
import { parseTranscript, renameSpeakers, type ParsedTranscript } from "@/lib/transcripts/parse";

/**
 * Debrief a call from its transcript: drop or paste it (.vtt, .srt, .txt, .md; Zoom, Meet, Teams, Fathom,
 * Granola, Otter), see what code read from it (format, length, who spoke and how much), confirm the call it
 * belongs to, and the debrief starts with source "transcript" so its quotes count as verbatim. Parsing and
 * matching run in this tab and cost nothing; only the debrief uses the AI key.
 */

export const TRANSCRIPT_ACCEPT = ".vtt,.srt,.txt,.md,.markdown,.text,text/vtt,text/plain,text/markdown,application/x-subrip";
const MAX_FILE = 5 * 1024 * 1024;

/** Reads a dropped or picked file as text, refusing what can't be a transcript. */
export async function readTranscriptFile(file: File): Promise<{ text: string; fileName: string } | { error: string }> {
  const name = file.name || "transcript.txt";
  if (/\.(docx?|pdf|rtf|pages)$/i.test(name)) return { error: `${name} is a document, not text. Download the transcript as .vtt or .txt instead (Teams and Zoom both offer it).` };
  if (/\.(mp3|m4a|wav|mp4|mov|webm|ogg)$/i.test(name) || file.type.startsWith("audio/") || file.type.startsWith("video/")) return { error: "That's a recording. Drop the transcript file instead (.vtt, .srt or .txt)." };
  if (file.size > MAX_FILE) return { error: "That file is larger than 5 MB. A transcript is usually well under 1 MB." };
  const text = await file.text();
  if (/\u0000/.test(text.slice(0, 2000))) return { error: `${name} isn't a text file.` };
  return { text, fileName: name };
}

function founderNames(ws: Workspace): string[] {
  return [ws.founder.name, ws.sender?.name].filter((n): n is string => !!n && !!n.trim());
}

const fmtDate = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function duration(sec: number | undefined) {
  if (!sec) return null;
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

/** Who talked how much, from the words in the transcript. */
export function TalkShare({ p, className }: { p: ParsedTranscript; className?: string }) {
  const shown = p.speakers.filter((s) => s.share >= 0.01).slice(0, 5);
  if (!shown.length) return null;
  const tones = ["bg-fg", "bg-fg-3", "bg-fg-4", "bg-border-strong", "bg-border"];
  return (
    <div className={className}>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-bg-subtle" aria-hidden>
        {shown.map((s, i) => (
          <span key={s.name} className={cn("h-full", s.founder ? "bg-accent" : tones[i % tones.length])} style={{ width: `${s.share * 100}%` }} />
        ))}
      </div>
      <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-fg-3">
        {shown.map((s) => (
          <span key={s.name} className="min-w-0 truncate">
            <span className={cn(s.founder ? "text-accent-text" : "text-fg-2")}>{s.founder ? `${s.name} (you)` : s.name}</span> <span className="font-mono tnum">{Math.round(s.share * 100)}%</span>
            {s.founder && s.questions > 0 && <span> · {s.questions} questions</span>}
          </span>
        ))}
      </p>
    </div>
  );
}

function candidateLabel(c: MatchCandidate): string {
  const when = c.startsAt ? ` · ${fmtDate(c.startsAt)}` : "";
  if (c.kind === "calendar") return `${c.company} · ${c.title || "Meeting"}${when} (on your calendar, not tracked yet)`;
  if (c.kind === "account") return `${c.company} · a new call`;
  return `${c.company} · ${c.title}${when}${c.debriefed ? " · redo the debrief" : ""}`;
}

interface Props {
  /** Only these meetings (the company sheet's), with no calendar or new-company options. */
  meetingIds?: string[];
  initial?: { text: string; fileName?: string };
  onStarted?: (r: { meetingId: string; domain: string }) => void;
  onCancel?: () => void;
  /** Meetings on the calendar with companies that aren't tracked yet (GET /api/calendar → pending). */
  calendar?: CalendarCandidate[];
  autoFocus?: boolean;
  className?: string;
}

export function TranscriptIntake({ meetingIds, initial, onStarted, onCancel, calendar: givenCalendar, autoFocus, className }: Props) {
  const { ws, dispatch, refresh } = useWorkspace();
  const { start } = useRuns();
  const [raw, setRaw] = useState(initial?.text ?? "");
  const [fileName, setFileName] = useState<string | undefined>(initial?.fileName);
  const [names, setNames] = useState<Record<string, string>>({});
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fetched, setFetched] = useState<CalendarCandidate[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const calendar = useMemo(() => givenCalendar ?? fetched ?? [], [givenCalendar, fetched]);

  // Calendar meetings with untracked companies are candidates too; read once, only for the global flow.
  useEffect(() => {
    if (givenCalendar || meetingIds) return;
    let cancelled = false;
    fetch("/api/calendar", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { pending?: CalendarCandidate[] } | null) => !cancelled && setFetched(body?.pending ?? []))
      .catch(() => !cancelled && setFetched([]));
    return () => {
      cancelled = true;
    };
  }, [givenCalendar, meetingIds]);

  const now = useNow();
  const founders = useMemo(() => (ws ? founderNames(ws) : []), [ws]);
  const parsed = useMemo(() => {
    if (!raw.trim() || raw.trim().length < 20) return null;
    return parseTranscript(raw, { fileName, now: new Date(now), founderNames: founders });
  }, [raw, fileName, founders, now]);
  const named = useMemo(() => (parsed ? renameSpeakers(parsed, names, founders) : null), [parsed, names, founders]);
  const match = useMemo(() => {
    if (!named || !ws) return null;
    return matchTranscript(named, { ws, calendar: meetingIds ? [] : calendar, now: new Date(now), founderNames: founders, meetingIds });
  }, [named, ws, calendar, founders, meetingIds, now]);

  const others = useMemo(() => {
    if (!ws) return [] as { key: string; label: string }[];
    const seen = new Set(match?.candidates.map((c) => c.key));
    const pool = meetingIds ? meetingIds.map((id) => ws.meetings[id]).filter(Boolean) : Object.values(ws.meetings);
    const meetings = pool
      .filter((m) => !!ws.deals[m.dealId] && !seen.has(`meeting:${m.id}`) && Date.parse(m.startsAt) <= now + 86_400_000)
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
      .slice(0, 40)
      .map((m) => {
        const deal = ws.deals[m.dealId];
        return { key: `meeting:${m.id}`, label: `${ws.accounts[deal.accountDomain]?.name ?? deal.name} · ${m.title} · ${fmtDate(m.startsAt)}${m.debrief ? " · redo the debrief" : ""}` };
      });
    const accounts = meetingIds
      ? []
      : Object.values(ws.accounts)
          .filter((a) => a.status !== "disqualified" && !seen.has(`account:${a.domain}`))
          .sort((a, b) => Number(!!b.dealId) - Number(!!a.dealId) || a.name.localeCompare(b.name))
          .slice(0, 80)
          .map((a) => ({ key: `account:${a.domain}`, label: `${a.name} · a new call` }));
    return [...meetings, ...accounts];
  }, [ws, match, meetingIds, now]);

  const chosenKey = pick ?? match?.best?.key ?? null;
  const chosen: MatchCandidate | { key: string; kind: "meeting" | "account"; domain: string; meetingId?: string; company: string } | null = useMemo(() => {
    if (!chosenKey || !ws) return null;
    const c = match?.candidates.find((x) => x.key === chosenKey);
    if (c) return c;
    const [kind, id] = [chosenKey.slice(0, chosenKey.indexOf(":")), chosenKey.slice(chosenKey.indexOf(":") + 1)];
    if (kind === "meeting") {
      const m = ws.meetings[id];
      const deal = m ? ws.deals[m.dealId] : undefined;
      return m && deal ? { key: chosenKey, kind: "meeting", meetingId: m.id, domain: deal.accountDomain, company: ws.accounts[deal.accountDomain]?.name ?? deal.name } : null;
    }
    if (kind === "account") return ws.accounts[id] ? { key: chosenKey, kind: "account", domain: id, company: ws.accounts[id].name } : null;
    return null;
  }, [chosenKey, match, ws]);

  const load = useCallback(async (file: File | undefined) => {
    if (!file) return;
    const r = await readTranscriptFile(file);
    if ("error" in r) return setError(r.error);
    setError(null);
    setNames({});
    setPick(null);
    setRaw(r.text);
    setFileName(r.fileName);
  }, []);

  const trySample = async () => {
    const { sampleTranscript } = await import("@/lib/sample/transcript");
    const s = sampleTranscript(new Date());
    setNames({});
    setPick(null);
    setError(null);
    setRaw(s.text);
    setFileName(s.fileName);
  };

  const reset = () => {
    setRaw("");
    setFileName(undefined);
    setNames({});
    setPick(null);
    setError(null);
  };

  /** Finds or makes the meeting this transcript is, then starts the debrief on it. */
  const submit = async () => {
    if (!ws || !named || !chosen || busy) return;
    setBusy(true);
    setError(null);
    try {
      let meetingId = chosen.meetingId;
      const domain = chosen.domain;
      if (chosen.kind === "calendar") {
        const res = await fetch("/api/calendar/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain }) });
        const body = (await res.json().catch(() => ({}))) as { error?: string; meetingIds?: Record<string, string> };
        if (!res.ok) throw new Error(body.error ?? "Couldn't add that company.");
        await refresh();
        meetingId = "eventId" in chosen && chosen.eventId ? body.meetingIds?.[chosen.eventId] : undefined;
        if (!meetingId) throw new Error("The company is tracked, but its meeting didn't come through. Open it and log the call there.");
      }
      if (!meetingId) {
        // A new call with a company on file: the deal (if none is open) and the meeting first, so the sheet can show the work.
        const acc = ws.accounts[domain];
        if (!acc) throw new Error("That company isn't in your workspace anymore.");
        const actions: Action[] = [];
        const open = acc.dealId ? ws.deals[acc.dealId] : undefined;
        let dealId = open?.id;
        if (!open || !OPEN_STAGES.includes(open.stage)) {
          const d = newDeal(acc, newId("deal"), nowISO());
          actions.push({ type: "deal.create", deal: d });
          dealId = d.id;
        }
        const when = named.when?.iso ?? (named.when ? new Date(`${named.when.date}T${named.when.time ?? "12:00"}:00`).toISOString() : nowISO());
        const people = Object.values(ws.people).filter((p) => p.accountDomain === domain);
        const attendees = named.speakers
          .filter((s) => !s.founder && !s.generic)
          .map((s) => {
            const person = people.find((p) => p.name.toLowerCase() === s.name.toLowerCase());
            return person ? { personId: person.id, name: person.name, ...(person.title ? { title: person.title } : {}) } : { name: s.name };
          });
        const m: Meeting = { id: newId("mtg"), dealId: dealId!, title: named.title ?? `Call with ${acc.name}`, startsAt: when, attendees };
        actions.push({ type: "meeting.upsert", meeting: m });
        if (!(await dispatch(actions))) throw new Error("Couldn't add the call. Try again.");
        meetingId = m.id;
      }
      const source = named.isTranscript ? "transcript" : "founder_notes";
      const state = await start("debrief", { meetingId, notes: named.text, source }, { notify: unlessSheetOpen(domain), onError: (e) => setError(e.message) });
      if (!state) return;
      reset();
      onStarted?.({ meetingId, domain });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") return;
    e.stopPropagation();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void load(e.dataTransfer.files?.[0]);
  };

  if (!ws) return null;
  // From the labels as written, so a name being typed doesn't take its own box away.
  const generic = parsed?.speakers.filter((s) => s.generic || (parsed.format === "granola" && s.name === "Me")) ?? [];

  return (
    <div
      onKeyDown={onKeyDown}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
      className={cn("relative space-y-3", className)}
    >
      <input ref={fileRef} type="file" accept={TRANSCRIPT_ACCEPT} className="hidden" onChange={(e) => void load(e.target.files?.[0]).finally(() => (e.target.value = ""))} />

      {/* A file is shown as what was read from it; pasted or typed text stays editable, with the reading below. */}
      {!(fileName && parsed) && (
        <div className={cn("rounded-lg border border-dashed p-3 transition-colors duration-150", dragging ? "border-accent bg-accent-subtle" : "border-border-strong")}>
          <Textarea
            autoFocus={autoFocus}
            aria-label="Transcript"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="Drop a transcript file here, or paste it. Zoom, Google Meet, Teams, Fathom, Granola and Otter exports all work."
            className="min-h-28 border-0 bg-transparent text-[13px] leading-5 shadow-none ring-0 focus-visible:ring-0"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" icon={<FileUp className="size-3.5" />} onClick={() => fileRef.current?.click()}>
              Choose a file
            </Button>
            <span className="text-[12px] text-fg-3">.vtt, .srt, .txt or .md</span>
            {ws.sample && (
              <Button size="sm" variant="ghost" icon={<Sparkles className="size-3.5" />} onClick={() => void trySample()} className="ml-auto">
                Try with a sample transcript
              </Button>
            )}
          </div>
        </div>
      )}
      {parsed && (
        <div className="space-y-3 rounded-lg bg-surface p-3 ring-1 ring-border">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium text-fg">{named?.title ?? fileName ?? "Pasted transcript"}</p>
              <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-[12px] text-fg-3">
                <span>{parsed.formatLabel}</span>
                {duration(parsed.durationSec) && <span>· {duration(parsed.durationSec)}</span>}
                {parsed.speakers.length > 0 && <span>· {parsed.speakers.length} speaker{parsed.speakers.length === 1 ? "" : "s"}</span>}
                <span className="font-mono tnum">· {parsed.words.toLocaleString("en-US")} words</span>
                {parsed.when && <span>· {parsed.when.iso ? fmtDate(parsed.when.iso) : new Date(`${parsed.when.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>}
              </p>
            </div>
            <button type="button" onClick={reset} aria-label="Use a different transcript" className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-3 hover:bg-bg-subtle hover:text-fg">
              <X className="size-4" />
            </button>
          </div>
          {named && <TalkShare p={named} />}
          {named?.warnings.map((w) => (
            <p key={w} className="text-pretty text-[12px] leading-[18px] text-fg-3">
              {w}
            </p>
          ))}
          {generic.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {generic.map((s) => (
                <label key={s.name} className="flex min-w-0 items-center gap-2 text-[12px] text-fg-3">
                  <span className="w-24 shrink-0 truncate">{s.name}</span>
                  <Input value={names[s.name] ?? ""} onChange={(e) => setNames((n) => ({ ...n, [s.name]: e.target.value }))} placeholder={s.name === "Me" ? (founders[0] ?? "Your name") : "Their name"} className="h-7 text-[12px]" />
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {named && (
        <div className="space-y-2">
          <p className="px-0.5 text-[11px] font-medium text-fg-3">{match?.best && !pick ? "This looks like" : "Which call is it?"}</p>
          {chosen ? (
            <div className="flex items-start gap-2.5 rounded-md bg-surface px-3 py-2.5 ring-1 ring-border-strong">
              <Favicon domain={chosen.domain} name={chosen.company} size={18} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-fg">
                  <span className="font-medium">{chosen.company}</span>
                  {"title" in chosen && chosen.title ? <span className="text-fg-2"> · {chosen.title}</span> : null}
                </p>
                <p className="mt-0.5 truncate text-[12px] text-fg-3">
                  {"startsAt" in chosen && chosen.startsAt ? fmtDate(chosen.startsAt) : chosen.kind === "account" ? "A new call, dated from the transcript" : ""}
                  {"reasons" in chosen && chosen.reasons.length ? ` · ${chosen.reasons.join(" · ")}` : ""}
                </p>
                {chosen.kind === "calendar" && <p className="mt-0.5 text-[12px] text-fg-3">From your calendar. Debriefing it tracks {chosen.company} and starts its deal at Talking.</p>}
              </div>
            </div>
          ) : (
            <p className="rounded-md bg-bg-subtle px-3 py-2 text-[12.5px] text-fg-2">I couldn&apos;t tell which call this was. Pick it below.</p>
          )}
          {(match?.candidates.length || others.length) && (
            <Select
              value={chosenKey ?? ""}
              onChange={(e) => setPick(e.target.value || null)}
              aria-label="Pick the call"
              className="h-8 w-full min-w-0 rounded-sm bg-surface px-2 text-[12.5px] text-fg ring-1 ring-border-strong/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              {!chosenKey && <option value="">Pick the call…</option>}
              {match?.candidates.length ? (
                <optgroup label="Best matches">
                  {match.candidates.map((c) => (
                    <option key={c.key} value={c.key}>
                      {candidateLabel(c)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {others.length > 0 && (
                <optgroup label="Other calls and companies">
                  {others.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      )}

      {named && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-pretty text-[12px] text-fg-3">
            {named.isTranscript ? "Quotes are checked word for word against the transcript. Nothing changes on the deal until you apply it." : "Read as your notes: nothing in it is quoted as the buyer's words."}
          </p>
          {onCancel && (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button variant="agent" onClick={() => void submit()} disabled={!chosen || busy} loading={busy} kbd="⌘↵">
            Debrief this call
          </Button>
        </div>
      )}
      {dragging && parsed && <div className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-accent" aria-hidden />}
    </div>
  );
}
