"use client";

import { Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/client/cn";
import type { StudioFormatId, StudioOccasion, Workspace } from "@/lib/domain/types";
import { FORMATS, GROUPS, OCCASIONS, formatsFor } from "@/lib/studio/formats";
import { movesFor } from "@/lib/studio/moves";
import { audienceFor, competitorsFor, formatBlocked, receiptsFor } from "@/lib/studio/receipts";

export interface NewPieceArgs {
  format: StudioFormatId;
  occasion: StudioOccasion;
  brief: string;
  bold: boolean;
}

const ALL_OCCASIONS = Object.keys(OCCASIONS) as StudioOccasion[];

export function NewPiece({ ws, onWrite, onClose, busy }: { ws: Workspace; onWrite: (a: NewPieceArgs) => void; onClose?: () => void; busy?: boolean }) {
  const audience = audienceFor(ws);
  const ordered = useMemo(() => formatsFor(audience), [audience]);
  const [format, setFormat] = useState<StudioFormatId>(ordered[0].id);
  const spec = FORMATS[format];
  const occasions = spec.occasions ?? ALL_OCCASIONS;
  const [occasionPick, setOccasion] = useState<StudioOccasion>(spec.defaultOccasion);
  const occasion = occasions.includes(occasionPick) ? occasionPick : spec.defaultOccasion;
  const [brief, setBrief] = useState("");
  const [bold, setBold] = useState(false);

  const blocked = formatBlocked(ws, format);
  const moves = useMemo(
    () => movesFor({ format, audience, occasion, receipts: receiptsFor(ws), competitors: competitorsFor(ws).length, bold }),
    [ws, format, audience, occasion, bold],
  );
  const usable = moves.filter((m) => !m.missing);
  const locked = moves.filter((m) => m.missing);

  return (
    <section className="rounded-lg bg-surface p-5 ring-1 ring-border">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-medium text-fg">What are we writing?</h2>
          <p className="mt-0.5 text-[12.5px] text-fg-3">Ordered for {audience === "b2b" ? "selling to businesses" : audience === "b2c" ? "selling to consumers" : audience === "prosumer" ? "selling to professionals" : "selling to developers"}. Change it under Who it&apos;s for.</p>
        </div>
        {onClose && (
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {GROUPS.map((g) => {
          const items = ordered.filter((f) => f.group === g.id);
          if (!items.length) return null;
          return (
            <div key={g.id}>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-3">{g.label}</p>
              <div className="flex flex-wrap gap-1.5">
                {items.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFormat(f.id)}
                    aria-pressed={f.id === format}
                    className={cn(
                      "h-7 rounded-sm px-2.5 text-[12.5px] ring-1 transition-[background-color,color,box-shadow] duration-150",
                      f.id === format ? "bg-primary text-primary-fg ring-primary" : "bg-surface text-fg-2 ring-border hover:bg-bg-subtle hover:text-fg",
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[13px] leading-[19px] text-fg-2">
        {spec.blurb} <span className="text-fg-3">{spec.options} options, each written with a different move.</span>
      </p>

      {occasions.length > 1 && (
        <div className="mt-4">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-3">Why now</p>
          <div className="flex flex-wrap gap-1">
            {occasions.map((o) => (
              <Tooltip key={o} content={OCCASIONS[o].guide}>
                <button
                  onClick={() => setOccasion(o)}
                  aria-pressed={o === occasion}
                  className={cn("h-6 rounded-xs px-2 text-[12px] ring-1 transition-colors", o === occasion ? "bg-accent-subtle font-medium text-accent-text ring-accent/40" : "text-fg-3 ring-border hover:text-fg-2")}
                >
                  {OCCASIONS[o].label}
                </button>
              </Tooltip>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <Label htmlFor="studio-brief" hint="Optional, but specifics help">
          Brief
        </Label>
        <Textarea
          id="studio-brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          maxLength={2000}
          placeholder={occasion === "launch" ? "What's launching, who it's for, what's different, what's still rough…" : occasion === "funding" ? "How much, from whom, and what it changes for users…" : "What this is for, where it runs, anything I should know…"}
          className="text-[13px]"
        />
      </div>

      <div className="mt-4 rounded-md bg-bg-subtle px-3 py-2.5 ring-1 ring-border">
        <p className="text-[12px] text-fg-2">
          <span className="font-medium text-fg">{usable.length} moves fit</span>
          {usable.length > 0 && ": "}
          {usable.map((m, i) => (
            <Tooltip key={m.move.id} content={`${m.move.line} Backfires: ${m.move.backfires}`}>
              <span className="cursor-default underline decoration-border-strong decoration-dotted underline-offset-2">
                {m.move.name}
                {i < usable.length - 1 ? ", " : ""}
              </span>
            </Tooltip>
          ))}
        </p>
        {locked.length > 0 && (
          <p className="mt-1 text-[11.5px] leading-[17px] text-fg-3">
            More material unlocks: {locked.slice(0, 4).map((m) => `${m.move.name} (needs ${m.missing})`).join("; ")}
            {locked.length > 4 ? ` and ${locked.length - 4} more` : ""}.
          </p>
        )}
      </div>

      <label className="mt-3 flex items-start gap-2 text-[12px] leading-[17px] text-fg-2">
        <input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
        <span>
          Allow bold moves.{" "}
          <span className="text-fg-3">Taboo lines like “Stop Hiring Humans” buy attention and often backfire: death threats, vandalism and retractions followed the 2024–25 examples.</span>
        </span>
      </label>

      <div className="mt-4 flex items-center justify-end gap-3">
        {blocked && <p className="flex-1 text-[12.5px] text-warning">{blocked}</p>}
        <Button variant="agent" icon={<Sparkles className="size-4" />} disabled={!!blocked} loading={busy} onClick={() => onWrite({ format, occasion, brief: brief.trim(), bold })}>
          Write {spec.options} options
        </Button>
      </div>
    </section>
  );
}
