"use client";

import { ChevronDown, Star } from "lucide-react";
import { useState } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { AiBadge, Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/misc";
import { SourceChip } from "@/components/ui/source";
import { cn } from "@/lib/client/cn";
import { shortDate } from "@/lib/client/format";
import { CALL_TYPE_LABEL } from "@/lib/deals/rules";
import type { Meeting, MeetingBrief } from "@/lib/domain/types";
import { Section, useEvidence, useFlagWrong } from "./shared";

/** The call brief: a 5-minute read. Agent prose in the reading face; lines the founder will say out loud in Inter. */
export function BriefView({ meeting, brief }: { meeting: Meeting; brief: MeetingBrief }) {
  const { dispatch } = useWorkspace();
  const starred = new Set(meeting.starred ?? []);
  // Patches the server's copy (guarded by this brief's timestamp), never the whole meeting.
  const toggleStar = (i: number) => void dispatch({ type: "meeting.toggleStar", id: meeting.id, briefAt: brief.generatedAt, index: i });
  const totalMinutes = brief.agenda.reduce((n, a) => n + a.minutes, 0) || 1;

  return (
    <div className="space-y-7">
      <div>
        <p className="mb-2 flex flex-wrap items-center gap-2 font-mono text-[11.5px] text-fg-3">
          <AiBadge />
          <Badge tone="outline">{CALL_TYPE_LABEL[brief.callType]}</Badge>
          prepared {shortDate(brief.generatedAt)}
        </p>
        <p className="prose-agent text-pretty">{brief.fiveMinuteSummary}</p>
        <p className="mt-3 rounded-md bg-bg-subtle px-3 py-2 text-[13px] text-fg">
          <span className="text-fg-3">If you learn one thing: </span>
          {brief.oneThingToLearn}
        </p>
      </div>

      {brief.goals.length > 0 && (
        <Section label="Goals for this call">
          <ol className="list-decimal space-y-1 pl-5 font-serif text-[16px] leading-[24px] text-fg">
            {brief.goals.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ol>
        </Section>
      )}

      <Section label="Open with this" right={<CopyButton text={brief.upfrontContract} />}>
        <p className="text-[15px] leading-6 text-fg">{brief.upfrontContract}</p>
      </Section>

      {brief.agenda.length > 0 && (
        <Section label={`Agenda · ${totalMinutes} min`}>
          <ul className="space-y-1.5">
            {brief.agenda.map((a, i) => (
              <li key={i} className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3 text-[13px]">
                <span className="font-mono text-[12px] tnum text-fg-3">{a.minutes} min</span>
                <span className="flex items-center gap-2">
                  <span className="h-1 shrink-0 rounded-full bg-fg-4" style={{ width: `${Math.max(6, (a.minutes / totalMinutes) * 160)}px` }} aria-hidden />
                  <span className="truncate text-fg">{a.block}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {brief.questions.length > 0 && (
        <Section label={`Questions · ${brief.questions.length}`} right={<span className="text-[11.5px] text-fg-3">Star the ones to check off in the debrief</span>}>
          <ol className="space-y-1">
            {brief.questions.map((q, i) => (
              <QuestionRow key={i} index={i} q={q} starred={starred.has(i)} onStar={() => toggleStar(i)} />
            ))}
          </ol>
        </Section>
      )}

      {brief.whatsNew.length > 0 && (
        <Section label="What's new">
          <ul className="space-y-2">
            {brief.whatsNew.map((n, i) => (
              <CitedLine key={i} text={n.text} evidenceId={n.evidenceId} url={n.url} date={n.date} />
            ))}
          </ul>
        </Section>
      )}

      {brief.attendees.length > 0 && (
        <Section label="Who's on the call">
          <ul className="space-y-3">
            {brief.attendees.map((a, i) => (
              <li key={i} className="rounded-md bg-surface px-3 py-2.5 ring-1 ring-border">
                <p className="text-[14px]">
                  <span className="font-medium text-fg">{a.name}</span>
                  {a.title && <span className="text-fg-2"> · {a.title}</span>}
                </p>
                {a.background.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {a.background.map((b, j) => (
                      <CitedLine key={j} text={b} evidenceId={a.sources?.[j]?.evidenceId} url={a.sources?.[j]?.url} small />
                    ))}
                  </ul>
                )}
                <p className="mt-1.5 font-serif text-[14.5px] italic leading-[21px] text-fg-3">Likely wants: {a.likelyWants}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {brief.objections.length > 0 && (
        <Section label="Likely objections">
          <ul className="space-y-3">
            {brief.objections.map((o, i) => (
              <li key={i}>
                <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-fg">
                  “{o.objection}”{!o.approved && <Badge tone="outline">Draft · not in your Playbook yet</Badge>}
                </p>
                <p className="mt-0.5 text-[14px] leading-[21px] text-fg-2">{o.response}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section label="About us, in 60 seconds" right={<CopyButton text={brief.aboutUs60s} />}>
        <p className="text-[15px] leading-6 text-fg">{brief.aboutUs60s}</p>
      </Section>

      {(brief.landmines.length > 0 || brief.coaching.length > 0) && (
        <div className="grid gap-7 sm:grid-cols-2">
          {brief.landmines.length > 0 && (
            <Section label="Avoid">
              <ul className="space-y-1.5 font-serif text-[15.5px] leading-[23px] text-fg">
                {brief.landmines.map((l, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden className="mt-[10px] size-1 shrink-0 rounded-full bg-warning" />
                    {l}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {brief.coaching.length > 0 && (
            <Section label="Coaching">
              <ul className="space-y-1.5 font-serif text-[15.5px] leading-[23px] text-fg">
                {brief.coaching.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}

      <div className="rounded-md bg-bg-subtle px-3 py-2.5">
        <p className="text-[12px] text-fg-3">Don&apos;t hang up without</p>
        <p className="mt-0.5 text-[14px] font-medium text-fg">{brief.desiredNextStep}</p>
      </div>
    </div>
  );
}

function QuestionRow({ index, q, starred, onStar }: { index: number; q: MeetingBrief["questions"][number]; starred: boolean; onStar: () => void }) {
  const [open, setOpen] = useState(false);
  const ev = useEvidence();
  const flag = useFlagWrong();
  const e = ev([q.evidenceId])[0];
  return (
    <li className="rounded-md transition-colors hover:bg-bg-subtle">
      <div className="flex items-start gap-2 px-2 py-1.5">
        <button onClick={onStar} aria-pressed={starred} aria-label={starred ? "Unstar question" : "Star question"} className="mt-0.5 shrink-0 text-fg-3 hover:text-fg">
          <Star className={cn("size-3.5", starred && "fill-fg text-fg")} />
        </button>
        <span className="w-5 shrink-0 pt-px font-mono text-[11.5px] tnum text-fg-3">{index + 1}</span>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="min-w-0 flex-1 text-left">
          <span className="text-[14px] leading-[21px] text-fg">{q.q}</span>
          <span className="ml-2 inline-flex items-center gap-1.5 align-middle">
            {q.mandatory && <Badge tone="neutral">Must ask</Badge>}
            <span className="text-[11.5px] text-fg-3">{q.category.replace("_", " ")}</span>
          </span>
        </button>
        <ChevronDown className={cn("mt-1 size-3.5 shrink-0 text-fg-3 transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </div>
      {open && (
        <dl className="grid gap-x-3 gap-y-1 pb-2.5 pl-[52px] pr-2 text-[13px] sm:grid-cols-[96px_minmax(0,1fr)]">
          <dt className="text-fg-3">Tests</dt>
          <dd className="text-fg-2">{q.why}</dd>
          {q.goodAnswer && (
            <>
              <dt className="text-fg-3">Good answer</dt>
              <dd className="text-fg-2">{q.goodAnswer}</dd>
            </>
          )}
          <dt className="text-fg-3">Then ask</dt>
          <dd className="text-fg-2">{q.probe}</dd>
          {e && (
            <>
              <dt className="text-fg-3">Based on</dt>
              <dd>
                <SourceChip url={e.url} publishedAt={e.publishedAt} quote={e.quote} claim={e.claim} confidence={e.confidence} onFlagWrong={() => flag(e.id)} />
              </dd>
            </>
          )}
        </dl>
      )}
    </li>
  );
}

function CitedLine({ text, evidenceId, url, date, small }: { text: string; evidenceId?: string; url?: string; date?: string; small?: boolean }) {
  const ev = useEvidence();
  const flag = useFlagWrong();
  const e = ev([evidenceId])[0];
  if (evidenceId && !e && !url) return null; // its only source was flagged wrong
  return (
    <li className={cn("flex flex-wrap items-baseline gap-x-1.5", small ? "text-[13px] leading-5 text-fg-2" : "font-serif text-[16px] leading-[24px] text-fg")}>
      <span>{text}</span>
      {e ? (
        <SourceChip url={e.url} publishedAt={e.publishedAt} quote={e.quote} claim={e.claim} confidence={e.confidence} onFlagWrong={() => flag(e.id)} />
      ) : url ? (
        <SourceChip url={url} publishedAt={date} />
      ) : null}
    </li>
  );
}
