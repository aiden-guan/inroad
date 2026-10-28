"use client";

import { ArrowLeft, ImageIcon, PenLine } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/misc";
import type { StudioOption, StudioPiece, Workspace } from "@/lib/domain/types";
import { FORMATS } from "@/lib/studio/formats";
import { VISUAL_FORMATS } from "@/lib/studio/visuals";
import { VisualPanel } from "./visuals";

function message(piece: StudioPiece, option: StudioOption) {
  const part = FORMATS[piece.format].parts.find(
    (part) => part.role !== "visual" && part.key !== "alt" && option.parts[part.key]?.trim(),
  );
  return part ? option.parts[part.key].trim() : "";
}

const selectClass =
  "h-10 w-full min-w-0 rounded-md bg-surface px-3 text-[13px] text-fg ring-1 ring-border-strong/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

/** The existing design harness, with a visible entry point and the message it designs around. */
export function GraphicsStudio({
  ws,
  pieceId,
  optionId,
  onSelect,
  onWrite,
  onEdit,
}: {
  ws: Workspace;
  pieceId?: string | null;
  optionId?: string | null;
  onSelect: (pieceId: string, optionId: string) => void;
  onWrite: () => void;
  onEdit: (pieceId: string) => void;
}) {
  const pieces = useMemo(
    () => Object.values(ws.studio.pieces)
      .filter((piece) => VISUAL_FORMATS[piece.format] && piece.options.some((option) => message(piece, option)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [ws.studio.pieces],
  );
  const piece = pieces.find((piece) => piece.id === pieceId) ?? pieces[0];
  const options = piece?.options.filter((option) => message(piece, option)) ?? [];
  const option = options.find((option) => option.id === optionId) ?? options[0];

  return (
    <section aria-labelledby="studio-graphics-title">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[65ch]">
          <h2 id="studio-graphics-title" className="font-serif text-[28px] leading-9 text-fg">
            Make the finished image.
          </h2>
          <p className="mt-2 text-[14px] leading-6 text-fg-2">
            Design around a saved message with typography, your own image or AI imagery.
            Review the designs, then download PNG or SVG.
          </p>
        </div>
        {piece && (
          <Button icon={<PenLine aria-hidden className="size-3.5" />} onClick={onWrite}>
            Write a new message
          </Button>
        )}
      </header>

      {piece && option ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          <aside aria-label="Message for the graphic" className="min-w-0 rounded-lg bg-surface p-5 ring-1 ring-border">
            <Label htmlFor="graphics-piece">Saved piece</Label>
            <select
              id="graphics-piece"
              value={piece.id}
              onChange={(event) => {
                const next = pieces.find((piece) => piece.id === event.target.value)!;
                onSelect(next.id, next.options.find((option) => message(next, option))!.id);
              }}
              className={selectClass}
            >
              {pieces.map((piece) => (
                <option key={piece.id} value={piece.id}>
                  {piece.title || FORMATS[piece.format].label}
                </option>
              ))}
            </select>
            <div className="mt-4">
              <Label htmlFor="graphics-message">Message</Label>
              <select
                id="graphics-message"
                value={option.id}
                onChange={(event) => onSelect(piece.id, event.target.value)}
                className={selectClass}
              >
                {options.map((option, index) => (
                  <option key={option.id} value={option.id}>
                    {index + 1}. {message(piece, option).slice(0, 120)}
                  </option>
                ))}
              </select>
            </div>
            <p className="mt-5 font-serif text-[23px] leading-8 text-fg">
              {message(piece, option)}
            </p>
            <p className="mt-3 text-[12px] leading-5 text-fg-3">
              {FORMATS[piece.format].label} · {option.lint.passed ? "Copy checks passed" : "Copy needs review"}
            </p>
            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowLeft aria-hidden className="size-3.5" />}
              className="-ml-2.5 mt-3"
              onClick={() => onEdit(piece.id)}
            >
              Edit this message
            </Button>
          </aside>
          <div className="min-w-0" role="region" aria-label="Graphic design controls">
            <h3 className="flex items-center gap-2 text-[14px] font-semibold text-fg">
              <ImageIcon aria-hidden className="size-4" /> Design your graphic
            </h3>
            <VisualPanel key={option.id} ws={ws} piece={piece} option={option} />
          </div>
        </div>
      ) : (
        <EmptyState
          title="Start with the message"
          body="Write and choose a copy option first. Then use it here to design the image, add a screenshot or generate an image layer, and download the finished graphic."
          action={<Button variant="primary" icon={<PenLine aria-hidden className="size-4" />} onClick={onWrite}>Write a message</Button>}
        />
      )}
    </section>
  );
}
