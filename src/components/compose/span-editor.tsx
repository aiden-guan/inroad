"use client";

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/client/cn";

/**
 * A plain textarea that keeps the agent's evidence visible while the founder edits: every
 * personalized span is underlined in blue pencil (a mirror layer behind the transparent
 * textarea), and, when the container has room, each span's source sits in the right margin
 * beside its line. Below that width the parent shows chips instead.
 */

export interface SpanMark {
  text: string;
  note?: ReactNode;
}

/** Same metrics on both layers, or the underline drifts. */
const TEXT = "m-0 block w-full border-0 p-0 font-sans text-[15px] leading-6 tracking-normal whitespace-pre-wrap break-words";

interface Segment {
  text: string;
  span: number | null;
}

/** Splits text into plain runs and span runs (first occurrence, non-overlapping, in reading order). */
export function segmentSpans(value: string, spans: SpanMark[]): Segment[] {
  const hits: { start: number; end: number; i: number }[] = [];
  const lower = value.toLowerCase();
  spans.forEach((s, i) => {
    const needle = s.text.trim();
    if (!needle) return;
    let at = value.indexOf(needle);
    if (at === -1) at = lower.indexOf(needle.toLowerCase());
    if (at === -1) return;
    const end = at + needle.length;
    if (hits.some((h) => at < h.end && end > h.start)) return;
    hits.push({ start: at, end, i });
  });
  hits.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let pos = 0;
  for (const h of hits) {
    if (h.start > pos) out.push({ text: value.slice(pos, h.start), span: null });
    out.push({ text: value.slice(h.start, h.end), span: h.i });
    pos = h.end;
  }
  if (pos < value.length) out.push({ text: value.slice(pos), span: null });
  return out;
}

export const SpanEditor = forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    onChange: (value: string) => void;
    onBlur?: () => void;
    spans: SpanMark[];
    readOnly?: boolean;
    placeholder?: string;
    ariaLabel: string;
    className?: string;
    /** Render margin notes in a right gutter (the parent decides when there's room via container queries). */
    gutterClassName?: string;
  }
>(function SpanEditor({ value, onChange, onBlur, spans, readOnly, placeholder, ariaLabel, className, gutterClassName }, ref) {
  const mirrorRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [tops, setTops] = useState<Record<number, number>>({});
  const segments = useMemo(() => segmentSpans(value, spans), [value, spans]);
  const hasNotes = spans.some((s) => s.note);

  // Margin notes align to their span's line; when two would collide, the later one moves down.
  const measure = useCallback(() => {
    const mirror = mirrorRef.current;
    const gutter = gutterRef.current;
    if (!mirror || !gutter || gutter.offsetParent === null) return;
    const next: Record<number, number> = {};
    let floor = 0;
    for (const mark of mirror.querySelectorAll<HTMLElement>("mark[data-i]")) {
      const i = Number(mark.dataset.i);
      const top = Math.max(mark.offsetTop, floor);
      next[i] = top;
      const note = gutter.querySelector<HTMLElement>(`[data-note="${i}"]`);
      floor = top + (note?.offsetHeight ?? 36) + 10;
    }
    setTops((prev) => {
      const keys = Object.keys(next);
      if (keys.length === Object.keys(prev).length && keys.every((k) => prev[Number(k)] === next[Number(k)])) return prev;
      return next;
    });
  }, []);

  useEffect(() => {
    if (!hasNotes) return;
    const mirror = mirrorRef.current;
    if (!mirror) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(mirror);
    if (gutterRef.current) ro.observe(gutterRef.current);
    return () => ro.disconnect();
  }, [measure, hasNotes]);

  return (
    <div className={cn("relative", className)}>
      <div className="grid">
        <div ref={mirrorRef} aria-hidden className={cn(TEXT, "pointer-events-none col-start-1 row-start-1 text-transparent")}>
          {segments.map((seg, k) =>
            seg.span === null ? (
              <span key={k}>{seg.text}</span>
            ) : (
              <mark
                key={k}
                data-i={seg.span}
                className="bg-transparent text-transparent underline decoration-accent/55 decoration-[1.5px] underline-offset-[5px] [text-decoration-skip-ink:none]"
              >
                {seg.text}
              </mark>
            ),
          )}
          {"​"}
        </div>
        <textarea
          ref={ref}
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          aria-label={ariaLabel}
          spellCheck
          rows={1}
          onChange={(e) => {
            onChange(e.target.value);
            if (hasNotes) requestAnimationFrame(measure);
          }}
          onBlur={onBlur}
          className={cn(
            TEXT,
            "col-start-1 row-start-1 h-full resize-none overflow-hidden bg-transparent text-inherit caret-accent outline-none placeholder:text-fg-4",
            "[field-sizing:fixed] focus-visible:outline-none",
          )}
        />
      </div>
      {hasNotes && (
        <div ref={gutterRef} className={cn("pointer-events-none absolute top-0 left-[calc(100%+28px)] w-[188px]", gutterClassName)}>
          {spans.map((s, i) =>
            s.note && tops[i] !== undefined ? (
              <div key={i} data-note={i} className="pointer-events-auto absolute inset-x-0 animate-[fade-in_150ms_var(--ease-out)]" style={{ top: tops[i] }}>
                {s.note}
              </div>
            ) : s.note ? (
              // Rendered invisibly first so its height is known before placement.
              <div key={i} data-note={i} aria-hidden className="invisible absolute inset-x-0 top-0">
                {s.note}
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
});
