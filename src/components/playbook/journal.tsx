"use client";

import { motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Markdown } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { shortDate } from "@/lib/client/format";
import { nowISO } from "@/lib/domain/ids";
import type { Brief, FoundationVersion, FounderQuestion, SegmentBet } from "@/lib/domain/types";
import { BET_MIN_PER_ARM, DIMENSION_LABELS, betReadout, readoutLine, startedBets } from "@/lib/learning/bets";
import { spring } from "@/lib/motion";
import { usePlaybook } from "./context";
import { RefreshBet, useReviseAfterAnswer } from "./refresh";
import { plural } from "./model";
import { FieldLabel, Section, Sub, undoable } from "./ui";

const REVIEW_LABELS: Record<Brief["kind"], string> = { monday: "Pipeline review", friday: "Learning review", daily: "Daily brief", monthly: "Monthly review", refresh: "Bet refresh" };
const VERDICTS: Record<NonNullable<SegmentBet["verdict"]>, string> = { keep: "Kept", adjust: "Adjusted", switch: "Switched" };
const AFFECTS: Record<FounderQuestion["affects"][number], string> = { icp: "ICP", positioning: "Positioning", pricing: "Pricing", channel_plan: "Channels" };

function longDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export function JournalSection() {
  const { f } = usePlaybook();
  return (
    <Section
      id="journal"
      title="Journal"
      kicker={
        <p className="font-mono text-[11.5px] text-fg-3">
          Playbook v{f.version} · first written {shortDate(f.generatedAt)}
          {f.revisedAt && ` · revised ${shortDate(f.revisedAt)}`} · confidence {f.confidence}
        </p>
      }
    >
      <Questions />
      <Reviews />
      <Bets />
      <MessageBets />
      <Versions />
    </Section>
  );
}

/* ───────────────────────────── Founder questions ───────────────────────────── */

function Questions() {
  const { p } = usePlaybook();
  const open = p.founderQuestions.filter((q) => !q.answer);
  const answered = p.founderQuestions.filter((q) => q.answer).sort((a, b) => (b.answeredAt ?? "").localeCompare(a.answeredAt ?? ""));
  return (
    <Sub id="questions" title="Questions for you" hint="Only questions whose answers would change who you sell to, how you position or what you charge.">
      {p.founderQuestions.length === 0 && <p className="text-[13px] text-fg-3">No open questions. I&apos;ll ask when an answer would change the bet.</p>}
      <div className="space-y-3">
        {open.map((q) => (
          <OpenQuestion key={q.id} q={q} />
        ))}
      </div>
      {answered.length > 0 && (
        <dl className={cn("space-y-4", open.length > 0 && "mt-6")}>
          {answered.map((q) => (
            <div key={q.id}>
              <dt className="text-[13.5px] font-medium text-fg-2">{q.question}</dt>
              <dd className="mt-0.5 text-[14px] leading-[22px] text-fg">
                {q.answer}
                {q.answeredAt && <span className="ml-2 font-mono text-[11px] text-fg-3">{shortDate(q.answeredAt)}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Sub>
  );
}

function OpenQuestion({ q }: { q: FounderQuestion }) {
  const { ws, dispatch } = usePlaybook();
  const revise = useReviseAfterAnswer();
  const [answer, setAnswer] = useState("");
  const save = async () => {
    if (!answer.trim()) return;
    if (!(await dispatch({ type: "foundation.answerQuestion", questionId: q.id, answer: answer.trim(), at: nowISO() }))) return;
    revise(q.id);
    toast(ws.sample ? "Saved. Every draft and review uses it from now on." : "Saved. I'm checking whether it changes the bet; any change waits for you under Who.");
  };
  return (
    <div className="rounded-lg bg-surface p-4 ring-1 ring-border sm:p-5">
      <p className="font-serif text-[18px] leading-[27px] text-fg">{q.question}</p>
      <p className="mt-1 text-[12.5px] leading-[18px] text-fg-3">
        {q.whyItMatters}
        {q.affects.length > 0 && <span className="ml-1">Changes: {q.affects.map((a) => AFFECTS[a] ?? a).join(", ")}.</span>}
      </p>
      <Textarea
        aria-label={`Answer: ${q.question}`}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void save();
          }
        }}
        placeholder="A sentence or two is plenty"
        className="mt-3 min-h-16 text-[14px] leading-[21px]"
      />
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant="primary" kbd="⌘↵" disabled={!answer.trim()} onClick={() => void save()}>
          Save answer
        </Button>
      </div>
    </div>
  );
}

/* ───────────────────────────── Reviews ───────────────────────────── */

function Reviews() {
  const { ws } = usePlaybook();
  // Each review is its own record (a Monday and a Friday review, or two refreshes, can share a date): key by the record.
  const reviews = Object.entries(ws.briefs)
    .filter(([, b]) => b.review?.trim())
    .sort(([, a], [, b]) => b.date.localeCompare(a.date) || b.generatedAt.localeCompare(a.generatedAt))
    .slice(0, 26)
    .map(([key, b]) => ({ ...b, key }));
  const keyOf = (b: (typeof reviews)[number]) => b.key;
  const [open, setOpen] = useState<string | null>(reviews[0] ? keyOf(reviews[0]) : null);
  return (
    <Sub id="reviews" title="Reviews" hint="The Monday pipeline review, the Friday learning review, the monthly review and every bet refresh, kept here so the reasoning behind each change stays visible.">
      {reviews.length === 0 ? (
        <p className="text-[13px] leading-5 text-fg-3">Your first pipeline review lands on Monday, and the first learning review on Friday afternoon.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {reviews.map((r) => {
            const k = keyOf(r);
            const isOpen = open === k;
            return (
              <li key={k}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : k)}
                  className="flex w-full items-baseline gap-3 py-3 text-left transition-colors duration-150 hover:text-fg"
                >
                  <span className="min-w-0 flex-1 font-serif text-[17px] leading-6 text-fg">{longDay(r.date)}</span>
                  <span className="text-[12.5px] text-fg-3">{REVIEW_LABELS[r.reviewKind ?? r.kind]}</span>
                  <ChevronDown className={cn("size-4 shrink-0 self-center text-fg-3 transition-transform duration-200", isOpen && "rotate-180")} aria-hidden />
                </button>
                <motion.div initial={false} animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }} transition={spring.smooth} className="overflow-hidden">
                  {isOpen && (
                    <div className="pb-5">
                      <Markdown>{r.review!}</Markdown>
                    </div>
                  )}
                </motion.div>
              </li>
            );
          })}
        </ul>
      )}
    </Sub>
  );
}

/* ───────────────────────────── Segment bets ───────────────────────────── */

function Bets() {
  const { p } = usePlaybook();
  const bets = [...(p.icp.betHistory ?? [])].reverse();
  return (
    <Sub id="bets" title="Segment bets" hint="Every segment you bet on, how long it ran and what came of it.">
      {bets.length === 0 ? (
        <p className="text-[13px] text-fg-3">
          No bets yet.{" "}
          <a href="#icp" className="text-fg-2 underline underline-offset-2 hover:text-fg">
            Lock your first one
          </a>{" "}
          under Who.
        </p>
      ) : (
        <ol className="relative space-y-4 border-l border-border pl-5">
          {bets.map((b, i) => (
            <li key={`${b.startedAt}-${i}`} className="relative">
              <span aria-hidden className={cn("absolute -left-[23.5px] top-1.5 size-2 rounded-full ring-2 ring-bg", b.endedAt ? "bg-fg-4" : "bg-fg")} />
              <FieldLabel className="font-mono text-[11.5px] font-normal">
                {shortDate(b.startedAt)} – {b.endedAt ? shortDate(b.endedAt) : "now"}
                {b.verdict && ` · ${VERDICTS[b.verdict]}`}
              </FieldLabel>
              <p className="text-[14px] font-medium leading-[21px]">{b.segment}</p>
              {b.endedAt && (
                <p className="mt-0.5 font-mono text-[12px] tnum text-fg-3">
                  {plural(b.touches ?? 0, "touch", "touches")} · {plural(b.positiveReplies ?? 0, "positive reply", "positive replies")} · {plural(b.meetings ?? 0, "meeting")}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </Sub>
  );
}

/* ───────────────────────────── Message bets ───────────────────────────── */

const BET_VERDICTS = { keep: "Kept the variant", drop: "Dropped the variant", inconclusive: "Inconclusive" } as const;

function MessageBets() {
  const { ws, today } = usePlaybook();
  const bets = [...startedBets(ws)].reverse();
  return (
    <Sub id="message-bets" title="Message bets" hint={`One variable a month, control against variant. Every send is tagged with its arm; no verdict before ${BET_MIN_PER_ARM} sends each.`}>
      {bets.length === 0 ? (
        <p className="text-[13px] text-fg-3">No message bets yet. The Friday learning review proposes one when there&apos;s something worth testing.</p>
      ) : (
        <ol className="relative space-y-4 border-l border-border pl-5">
          {bets.map((b) => {
            const running = today <= b.endsOn;
            const r = betReadout(ws, b.id);
            return (
              <li key={b.id} className="relative">
                <span aria-hidden className={cn("absolute -left-[23.5px] top-1.5 size-2 rounded-full ring-2 ring-bg", running ? "bg-fg" : "bg-fg-4")} />
                <FieldLabel className="font-mono text-[11.5px] font-normal">
                  {shortDate(b.startedOn)} – {running ? `runs to ${shortDate(b.endsOn)}` : shortDate(b.endsOn)}
                  {b.dimension && ` · ${DIMENSION_LABELS[b.dimension]}`}
                </FieldLabel>
                <p className="text-[14px] font-medium leading-[21px]">{b.variable}</p>
                <p className="mt-0.5 text-[13px] leading-5 text-fg-2">
                  <span className="text-fg-3">Control:</span> {b.control} <span className="text-fg-3">· Variant:</span> {b.variant}
                </p>
                <p className="mt-1 font-mono text-[12px] tnum text-fg-3">{readoutLine(r)}</p>
                <p className="mt-0.5 text-[12.5px] text-fg-3">
                  {b.readout ? `${BET_VERDICTS[b.readout.verdict]}${b.readout.notes ? `. ${b.readout.notes}` : ""}` : r.enough ? "Enough sends for a verdict: the monthly review reads it." : running ? "Running. Read the replies; the count decides nothing yet." : "Ended without enough sends for a verdict."}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Sub>
  );
}

/* ───────────────────────────── Versions ───────────────────────────── */

const VERSION_SOURCES: Record<FoundationVersion["source"], string> = { refresh: "Bet refresh", monthly: "Monthly review", restore: "Restore", rebuild: "Rewritten from your site" };

function Versions() {
  const { ws, f, dispatch } = usePlaybook();
  const history = [...(ws.foundationHistory ?? [])].reverse();
  const restore = (version: number) => {
    const current = f.version;
    void dispatch({ type: "foundation.restore", version, at: nowISO() });
    undoable(`Restored v${version} as v${current + 1}.`, () => void dispatch({ type: "foundation.restore", version: current, at: nowISO() }));
  };
  return (
    <Sub
      id="versions"
      title="Versions"
      hint="Each refresh you accept starts a new version, and the one it replaced is kept (the last 10), so a change you regret is one click back."
      right={<span className="font-mono text-[12px] tnum text-fg-3">now v{f.version}</span>}
    >
      {history.length === 0 ? (
        <p className="mb-4 text-[13px] text-fg-3">No earlier versions yet. The first refresh you accept keeps this one here.</p>
      ) : (
        <ol className="mb-5 divide-y divide-border border-y border-border">
          {history.map((v) => (
            <li key={`${v.version}-${v.at}`} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="font-mono text-[11.5px] text-fg-3">
                  v{v.version} · replaced {shortDate(v.at)} · {VERSION_SOURCES[v.source]}
                </p>
                {v.changes.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[13px] leading-5 text-fg-2">
                    {v.changes.slice(0, 6).map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                )}
              </div>
              <Button size="xs" variant="secondary" className="self-start" onClick={() => restore(v.version)}>
                Restore v{v.version}
              </Button>
            </li>
          ))}
        </ol>
      )}
      <RefreshBet ws={ws} compact />
    </Sub>
  );
}
