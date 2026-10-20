"use client";

import { motion } from "motion/react";
import { Pencil, Quote } from "lucide-react";
import { useState } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/menu";
import { Num } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/client/cn";
import { CommitInput } from "./shared";
import {
  FIELD_META,
  SCORED_FIELDS,
  STAGE_RANK,
  computeQualification,
  emptyCard,
  hasDatedNextStep,
  scoreOf,
  scoresFrom,
  type CardField,
  type ScoredField,
} from "@/lib/deals/rules";
import { nowISO } from "@/lib/domain/ids";
import { ease } from "@/lib/motion";
import type { Deal, Field, QualificationCard } from "@/lib/domain/types";

/** 0–12 ring. Ink on paper; it turns warning only when a deal past Talking scores under 8 (at risk). */
export function ScoreRing({ total, atRisk, size = 52 }: { total: number; atRisk?: boolean; size?: number }) {
  const r = (size - 6) / 2;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Qualification score ${total} of 12`}>
      <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90" width={size} height={size} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={4} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={atRisk ? "var(--warning)" : "var(--fg)"}
          strokeWidth={4}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: Math.max(0.0001, total / 12) }}
          transition={{ duration: 0.6, ease: ease.out }}
        />
        {/* the qualified threshold, 8/12 */}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fg-3)" strokeWidth={6} pathLength={1} strokeDasharray="0.006 0.994" strokeDashoffset={-0.6667} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[15px] font-medium tnum text-fg">
        <Num value={total} />
      </span>
    </div>
  );
}

/** The ONE qualification card: six scored fields (0–2) plus decision & paper process. Founder can edit any field. */
export function QualificationCardView({ deal, today }: { deal: Deal; today: string }) {
  const { dispatch } = useWorkspace();
  const card = deal.card ?? emptyCard();
  const total = deal.qualification?.total ?? 0;
  const qualified = deal.qualification?.qualified ?? false;
  const atRisk = STAGE_RANK[deal.stage] >= 1 && STAGE_RANK[deal.stage] <= 3 && total < 8;
  const [editing, setEditing] = useState<CardField | null>(null);

  const save = (nextCard: QualificationCard, scores = scoresFrom(deal.qualification)) =>
    dispatch({
      type: "deal.update",
      id: deal.id,
      patch: { card: nextCard, qualification: computeQualification(scores, hasDatedNextStep(deal.nextStep, today)) },
      at: nowISO(),
    });

  const setScore = (f: ScoredField, s: 0 | 1 | 2) => {
    const scores = { ...scoresFrom(deal.qualification), [f]: s };
    void save(card, scores);
  };

  const updateField = (f: CardField, patch: Partial<Field> & Record<string, unknown>) => {
    const prev = card[f];
    const value = patch.value !== undefined ? patch.value : prev.value;
    const next = { ...prev, ...patch, value, status: value ? (prev.status === "not_covered" ? "captured" : prev.status) : "not_covered" } as Field;
    void save({ ...card, [f]: next } as QualificationCard);
  };

  return (
    <div className="rounded-lg bg-surface ring-1 ring-border">
      <div className="flex items-center gap-4 border-b border-border px-4 py-3">
        <ScoreRing total={total} atRisk={atRisk} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-fg">Qualification</p>
          <p className="text-[12.5px] text-fg-2">
            {qualified ? "Qualified: 8 or more of 12, with a dated next step." : total >= 8 ? "Score is there. It needs a dated next step to count." : `${8 - total} more point${8 - total === 1 ? "" : "s"} to qualify (8 of 12).`}
          </p>
        </div>
        {qualified ? <Badge tone="success">Qualified</Badge> : atRisk ? <Badge tone="warning">At risk</Badge> : null}
      </div>
      <ul className="divide-y divide-border">
        {SCORED_FIELDS.map((f) => (
          <FieldRow key={f} field={f} card={card} score={scoreOf(deal.qualification, f)} editing={editing === f} onEdit={() => setEditing(editing === f ? null : f)} onScore={(s) => setScore(f, s)} onChange={(p) => updateField(f, p)} />
        ))}
        <FieldRow field="decisionProcess" card={card} editing={editing === "decisionProcess"} onEdit={() => setEditing(editing === "decisionProcess" ? null : "decisionProcess")} onChange={(p) => updateField("decisionProcess", p)} />
      </ul>
    </div>
  );
}

function FieldRow({
  field,
  card,
  score,
  editing,
  onEdit,
  onScore,
  onChange,
}: {
  field: CardField;
  card: QualificationCard;
  score?: 0 | 1 | 2;
  editing: boolean;
  onEdit: () => void;
  onScore?: (s: 0 | 1 | 2) => void;
  onChange: (patch: Partial<Field> & Record<string, unknown>) => void;
}) {
  const meta = FIELD_META[field];
  const f = card[field];
  const covered = f.status !== "not_covered" && !!f.value;
  const extra =
    field === "champion" && card.champion.name
      ? `${card.champion.name} · ${card.champion.championStatus ?? "untested"}`
      : field === "economicBuyer" && card.economicBuyer.name
        ? `${card.economicBuyer.name}${card.economicBuyer.engaged ? " · engaged" : ""}`
        : field === "criticalEvent" && card.criticalEvent.date
          ? `${card.criticalEvent.date}${card.criticalEvent.consequence ? ` · if missed: ${card.criticalEvent.consequence}` : ""}`
          : field === "pain" && card.pain.impact
            ? `Impact: ${card.pain.impact}`
            : null;

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-[13px] font-medium text-fg">
          {meta.label}
          {!onScore && <span className="ml-1.5 font-normal text-fg-3">not scored</span>}
          {f.status === "partial" && <span className="ml-1.5 font-normal text-fg-3">partial</span>}
        </span>
        {f.quotes.length > 0 && (
          <Popover
            align="end"
            className="w-80"
            trigger={
              <button className="inline-flex h-6 items-center gap-1 rounded-xs px-1.5 font-mono text-[11px] text-fg-3 hover:bg-bg-subtle hover:text-fg-2" aria-label={`${f.quotes.length} quote${f.quotes.length === 1 ? "" : "s"}`}>
                <Quote className="size-3" aria-hidden />
                {f.quotes.length}
              </button>
            }
          >
            <ul className="space-y-2">
              {f.quotes.map((q, i) => (
                <li key={i} className="border-l-2 border-accent/40 pl-2.5 font-serif text-[14px] leading-[20px] text-fg-2">
                  “{q}”
                </li>
              ))}
            </ul>
          </Popover>
        )}
        {onScore && meta.rubric && (
          <div role="radiogroup" aria-label={`${meta.label} score`} className="flex items-center gap-0.5 rounded-sm bg-bg-subtle p-0.5 ring-1 ring-border">
            {([0, 1, 2] as const).map((s) => (
              <Tooltip key={s} content={`${s} · ${meta.rubric![s]}`}>
                <button
                  role="radio"
                  aria-checked={score === s}
                  aria-label={`${s}: ${meta.rubric![s]}`}
                  onClick={() => onScore(s)}
                  className={cn(
                    "h-5 w-6 rounded-[4px] font-mono text-[11px] tnum transition-[background-color,color] duration-150",
                    score === s ? "bg-surface text-fg shadow-xs ring-1 ring-border" : "text-fg-3 hover:text-fg-2",
                  )}
                >
                  {s}
                </button>
              </Tooltip>
            ))}
          </div>
        )}
        <button onClick={onEdit} aria-label={`Edit ${meta.label}`} aria-expanded={editing} className="inline-flex size-6 items-center justify-center rounded-xs text-fg-3 hover:bg-bg-subtle hover:text-fg">
          <Pencil className="size-3" />
        </button>
      </div>
      {!editing &&
        (covered ? (
          <>
            <p className="mt-1 text-[13px] leading-5 text-fg-2">{f.value}</p>
            {extra && <p className="mt-0.5 text-[12px] text-fg-3">{extra}</p>}
          </>
        ) : (
          <button onClick={onEdit} className="mt-1 text-left text-[13px] leading-5 text-fg-3 hover:text-fg-2">
            Not covered yet. {meta.question}
          </button>
        ))}
      {editing && (
        <div className="mt-2 space-y-2 animate-[fade-in_150ms_var(--ease-out)]">
          <CommitInput multiline value={f.value ?? ""} onCommit={(v) => onChange({ value: v.trim() || null })} ariaLabel={meta.label} placeholder={meta.question} className="ring-border" />
          {field === "pain" && <CommitInput value={card.pain.impact ?? ""} onCommit={(v) => onChange({ impact: v.trim() || undefined })} ariaLabel="Impact" placeholder="Impact, as they put it: 20 hours a week, $40K a quarter…" className="ring-border" />}
          {field === "criticalEvent" && (
            <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
              <CommitInput type="date" value={card.criticalEvent.date ?? ""} onCommit={(v) => onChange({ date: v || undefined })} ariaLabel="Critical event date" className="ring-border" />
              <CommitInput value={card.criticalEvent.consequence ?? ""} onCommit={(v) => onChange({ consequence: v.trim() || undefined })} ariaLabel="Consequence" placeholder="What happens if they miss it" className="ring-border" />
            </div>
          )}
          {field === "champion" && (
            <div className="flex flex-wrap items-center gap-2">
              <CommitInput value={card.champion.name ?? ""} onCommit={(v) => onChange({ name: v.trim() || undefined })} ariaLabel="Champion name" placeholder="Name" className="w-48 ring-border" />
              {(["coach", "untested", "tested"] as const).map((s) => (
                <Button key={s} size="xs" variant={card.champion.championStatus === s ? "primary" : "secondary"} onClick={() => onChange({ championStatus: s })}>
                  {s === "tested" ? "Tested" : s === "untested" ? "Untested" : "Coach"}
                </Button>
              ))}
            </div>
          )}
          {field === "economicBuyer" && (
            <div className="flex flex-wrap items-center gap-3">
              <CommitInput value={card.economicBuyer.name ?? ""} onCommit={(v) => onChange({ name: v.trim() || undefined })} ariaLabel="Economic buyer name" placeholder="Name" className="w-48 ring-border" />
              <label className="flex items-center gap-1.5 text-[13px] text-fg-2">
                <input type="checkbox" checked={!!card.economicBuyer.engaged} onChange={(e) => onChange({ engaged: e.target.checked })} className="accent-[var(--fg)]" />
                Engaged with us
              </label>
            </div>
          )}
          <p className="text-[12px] text-fg-3">{meta.question} Saves when you leave the field.</p>
        </div>
      )}
    </li>
  );
}
