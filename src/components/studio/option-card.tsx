"use client";

import { motion } from "motion/react";
import { ChevronDown, Eye, ImageIcon, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { CopyButton } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/client/cn";
import type { StudioLint, StudioOption, StudioPiece, Workspace } from "@/lib/domain/types";
import { FORMATS, headlineLimit, listItems, measure, type PartSpec } from "@/lib/studio/formats";
import { worstStudio } from "@/lib/studio/lint";
import { moveById } from "@/lib/studio/moves";
import { lintOption, receiptsFor } from "@/lib/studio/receipts";
import { VISUAL_FORMATS } from "@/lib/studio/visuals";
import { Preview } from "./previews";
import { VisualPanel } from "./visuals";

const EVIDENCE: Record<"tested" | "reported" | "opinion", { label: string; tone: "success" | "neutral" | "outline"; hint: string }> = {
  tested: { label: "Technique research", tone: "outline", hint: "Research supports the technique. This draft has not been tested with your audience." },
  reported: { label: "Reported example", tone: "neutral", hint: "Results reported for campaign examples, not for this draft." },
  opinion: { label: "Practitioner", tone: "outline", hint: "Advice from practitioners; no controlled evidence." },
};

/** Plain text for the clipboard: parts in order, labeled when there's more than one. */
export function optionText(piece: Pick<StudioPiece, "format">, parts: Record<string, string>): string {
  const spec = FORMATS[piece.format];
  const filled = spec.parts.filter((p) => parts[p.key]?.trim());
  if (filled.length === 1) return parts[filled[0].key].trim();
  return filled.map((p) => `${p.label}:\n${parts[p.key].trim()}`).join("\n\n");
}

function Counter({ part, text }: { part: PartSpec; text: string }) {
  const limit = headlineLimit(part);
  if (!limit?.max) return null;
  const items = part.list ? listItems(part, text) : [text];
  const n = Math.max(0, ...items.map((t) => measure(t, limit.unit)));
  const over = n > limit.max;
  const unit = limit.unit === "words" ? "words" : "chars";
  return (
    <Tooltip content={`${limit.kind === "hard" ? "Platform limit" : limit.kind === "recommended" ? "Platform recommendation" : limit.kind === "observed" ? "Where it usually gets cut off" : "What works best"}${limit.source ? ` · ${new URL(limit.source).hostname.replace(/^www\./, "")}` : ""}${part.list ? " · longest item" : ""}`}>
      <span className={cn("font-mono text-[10.5px] tnum transition-colors", over ? (limit.kind === "hard" ? "text-danger" : "text-warning") : "text-fg-4")}>
        {n}/{limit.max} {unit}
      </span>
    </Tooltip>
  );
}

/** "Ready", or the single worst issue; the rest on demand. The reader's verdict is never shown. */
function Check({ lint }: { lint: StudioLint }) {
  const [open, setOpen] = useState(false);
  const worst = worstStudio(lint);
  const warns = lint.violations.filter((v) => v.severity === "warn");
  const extra = lint.violations.length - (worst ? 1 : 0);
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="group flex min-h-7 w-full items-center gap-2 text-left text-[12.5px] leading-5">
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full transition-colors duration-150", worst ? "bg-warning" : "bg-success")} />
        <span className={cn("min-w-0 flex-1 truncate transition-colors duration-150", worst ? "text-warning" : "text-fg-2")}>
          {worst ? worst.detail : warns.length ? `Ready · ${warns.length} to consider` : "Ready"}
          {worst && extra > 0 && <span className="ml-1.5 text-fg-3">+{extra}</span>}
        </span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-fg-4 transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-1 rounded-md bg-bg-subtle px-3 py-2.5 ring-1 ring-border">
          {lint.violations.length ? (
            <ul className="space-y-1.5">
              {lint.violations.map((v, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] leading-[18px]">
                  <span aria-hidden className={cn("mt-[6px] size-1.5 shrink-0 rounded-full", v.severity === "error" ? "bg-warning" : "bg-fg-4")} />
                  <span className={v.severity === "error" ? "text-fg" : "text-fg-3"}>{v.detail}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-fg-2">Fits every limit, every specific has a receipt, and no AI tells.</p>
          )}
          <p className="mt-2 font-mono text-[11px] tnum text-fg-3">
            {lint.stats.words} words · {lint.stats.concrete} specifics · {lint.stats.vague} vague words{lint.stats.grade ? ` · grade ${Math.round(lint.stats.grade)}` : ""}
          </p>
        </div>
      )}
    </div>
  );
}

export function OptionCard({ ws, piece, option, index }: { ws: Workspace; piece: StudioPiece; option: StudioOption; index: number }) {
  const { dispatch } = useWorkspace();
  const spec = FORMATS[piece.format];
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [preview, setPreview] = useState(false);
  const graphics = Object.values(ws.studio.visuals).filter((v) => v.optionId === option.id).length;
  const [visualsOpen, setVisualsOpen] = useState(graphics > 0);
  const canDesign = !!VISUAL_FORMATS[piece.format];
  const parts = draft ?? option.parts;
  // Lint runs on every keystroke, exactly as the server does.
  const lint = useMemo(() => (draft ? lintOption(ws, piece, option, draft) : option.lint), [ws, piece, option, draft]);
  const receipts = useMemo(() => {
    const all = receiptsFor(ws);
    return option.receiptIds.map((id) => all.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r);
  }, [ws, option.receiptIds]);
  const move = moveById(option.moveId);
  const name = ws.founder.name || ws.studio.profile?.productName || ws.company?.name || "You";

  const save = () => {
    if (!draft) return;
    const changed = Object.fromEntries(Object.entries(draft).filter(([k, v]) => v !== option.parts[k]));
    if (Object.keys(changed).length) void dispatch({ type: "studio.option.edit", pieceId: piece.id, optionId: option.id, parts: changed });
    setDraft(null);
  };

  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: { delay: Math.min(index, 6) * 0.04, duration: 0.2 } }}
      className={cn("rounded-lg bg-surface p-4 ring-1 transition-shadow", option.kept ? "ring-accent/40" : "ring-border")}
    >
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[11px] tnum text-fg-4">{String(index + 1).padStart(2, "0")}</span>
            <Tooltip content={move ? `${move.line} ${move.backfires ? `Backfires: ${move.backfires}` : ""}` : "Written without a named move."}>
              <span className="text-[12.5px] font-medium text-fg">{move?.name ?? "Free angle"}</span>
            </Tooltip>
            {move && (
              <Tooltip content={`${EVIDENCE[move.evidence.level].hint} ${move.evidence.note}`}>
                <span>
                  <Badge tone={EVIDENCE[move.evidence.level].tone}>{EVIDENCE[move.evidence.level].label}</Badge>
                </span>
              </Tooltip>
            )}
            {option.edited && <Badge tone="outline">Edited</Badge>}
          </div>
          {option.why && <p className="mt-1 font-serif text-[14px] italic leading-5 text-fg-2">{option.why}</p>}
        </div>
        {canDesign && (
          <IconButton label={visualsOpen ? "Hide graphics" : graphics ? `Graphics (${graphics})` : "Make a graphic"} onClick={() => setVisualsOpen((o) => !o)} className={visualsOpen ? "text-fg" : undefined}>
            <ImageIcon className="size-4" />
          </IconButton>
        )}
        <IconButton label={preview ? "Hide preview" : "Preview where it runs"} onClick={() => setPreview((p) => !p)} className={preview ? "text-fg" : undefined}>
          <Eye className="size-4" />
        </IconButton>
        <IconButton
          label={option.kept ? "Kept: stays when you write more" : "Keep this one"}
          onClick={() => void dispatch({ type: "studio.option.keep", pieceId: piece.id, optionId: option.id, kept: !option.kept })}
          className={option.kept ? "text-accent-text" : undefined}
        >
          <Star className={cn("size-4", option.kept && "fill-current")} />
        </IconButton>
      </header>

      {preview ? (
        <div className="mt-3">
          <Preview format={piece.format} parts={parts} name={name} />
        </div>
      ) : (
        <div className="mt-3 space-y-2.5">
          {spec.parts.map((p) => {
            const value = parts[p.key] ?? "";
            if (!value && p.optional && !draft) return null;
            const rows = Math.min(14, Math.max(1, Math.ceil(value.length / 70) + (value.match(/\n/g)?.length ?? 0)));
            return (
              <div key={p.key}>
                <div className="mb-0.5 flex items-baseline justify-between gap-2">
                  <label htmlFor={`${option.id}-${p.key}`} className="text-[11px] font-medium uppercase tracking-wide text-fg-3">
                    {p.label}
                  </label>
                  <Counter part={p} text={value} />
                </div>
                <Textarea
                  id={`${option.id}-${p.key}`}
                  value={value}
                  rows={rows}
                  placeholder={p.optional ? "Optional" : p.hint}
                  onChange={(e) => setDraft({ ...(draft ?? option.parts), [p.key]: e.target.value })}
                  onBlur={save}
                  className={cn(
                    "min-h-0 bg-transparent px-1.5 py-1 ring-transparent hover:ring-border",
                    p.role === "hook" || p.role === "title" ? "font-serif text-[17px] leading-[24px]" : "text-[14px] leading-[21px]",
                  )}
                />
              </div>
            );
          })}
        </div>
      )}

      {canDesign && visualsOpen && <VisualPanel ws={ws} piece={piece} option={option} />}

      {receipts.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1">
          <span className="mr-0.5 text-[11px] text-fg-3">Rests on</span>
          {receipts.map((r) => (
            <Tooltip key={r.id} content={`${r.text}${r.source ? ` (${r.source})` : ""}`}>
              <span className="inline-flex h-5 max-w-[14rem] items-center truncate rounded-xs bg-bg-subtle px-1.5 text-[11px] text-fg-2 ring-1 ring-border">{r.label}</span>
            </Tooltip>
          ))}
        </div>
      )}

      <footer className="mt-3 flex items-center gap-2 border-t border-border pt-2.5">
        <div className="min-w-0 flex-1">
          <Check lint={lint} />
        </div>
        <CopyButton text={optionText(piece, parts)} />
      </footer>
    </motion.article>
  );
}
