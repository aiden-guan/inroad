"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CopyButton } from "@/components/ui/misc";
import { SourceChip } from "@/components/ui/source";
import { cn } from "@/lib/client/cn";
import type { Evidence } from "@/lib/domain/types";

/**
 * The agent's answer in the reading face. While it streams, words surface one at a time (opacity + 2px blur,
 * 180ms) at a steady pace, whatever size the network chunks are. This reveal exists only in Ask.
 *
 * A small markdown subset the Ask rules allow: paragraphs, bullets, numbered lists, **bold**, [links](…),
 * evidence markers [ev_…] (rendered as source chips) and ```draft fences (rendered in Inter: it's what the
 * recipient will read).
 */

const WORD_CSS = `@keyframes ask-word-in{from{opacity:0;filter:blur(2px)}to{opacity:1;filter:blur(0)}}
.ask-word{display:inline-block;max-width:100%;overflow-wrap:anywhere;animation:ask-word-in 180ms cubic-bezier(0.23,1,0.32,1) both}
@media (prefers-reduced-motion:reduce){.ask-word{animation:none}}`;

/** Only whole words are shown while streaming; a half-arrived word or marker waits for the next chunk. */
export function settledText(text: string, streaming: boolean): string {
  if (!streaming || /\s$/.test(text)) return text;
  const cut = Math.max(text.lastIndexOf(" "), text.lastIndexOf("\n"));
  return cut === -1 ? "" : text.slice(0, cut + 1);
}

export function countWords(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

function firstWords(text: string, n: number): string {
  if (n <= 0) return "";
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) if (++i === n) return text.slice(0, m.index + m[0].length);
  return text;
}

/** Reveals `total` words at a steady pace, faster when far behind. Returns how many to show. */
export function useWordReveal(total: number, animate: boolean): number {
  const [shown, setShown] = useState(animate ? 0 : total);
  const caughtUp = shown >= total;
  useEffect(() => {
    if (!animate || caughtUp) return;
    const id = setInterval(() => setShown((s) => (s >= total ? s : Math.min(total, s + Math.max(1, Math.ceil((total - s) / 12))))), 32);
    return () => clearInterval(id);
  }, [animate, caughtUp, total]);
  return animate ? Math.min(shown, total) : total;
}

type Block = { kind: "p" | "h"; text: string } | { kind: "ul" | "ol"; items: string[] } | { kind: "draft"; text: string; open: boolean };

function parse(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([a-z]*)/i);
    if (fence) {
      flush();
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !/^\s*```/.test(lines[j])) body.push(lines[j++]);
      blocks.push({ kind: "draft", text: body.join("\n").trim(), open: j >= lines.length });
      i = j;
      continue;
    }
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flush();
      const kind = bullet ? "ul" : "ol";
      const last = blocks[blocks.length - 1];
      const item = (bullet ?? numbered)![1];
      if (last && last.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
      continue;
    }
    const heading = line.match(/^\s*#{1,4}\s+(.*)$/);
    if (heading) {
      flush();
      blocks.push({ kind: "h", text: heading[1] });
      continue;
    }
    if (!line.trim()) flush();
    else para.push(line.trim());
  }
  flush();
  return blocks;
}

const INLINE = /(\*\*[^*\n]+\*\*|\[ev_[a-z0-9_]+\]|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|`[^`\n]+`)/gi;

interface InlineCtx {
  animate: boolean;
  evidence: Record<string, Evidence>;
  key: string;
}

function words(text: string, ctx: InlineCtx, k: string, className?: string): ReactNode[] {
  return text.split(/(\s+)/).map((w, i) =>
    !w ? null : /^\s+$/.test(w) ? (
      w
    ) : (
      <span key={`${k}${i}`} className={cn(ctx.animate && "ask-word", className)}>
        {w}
      </span>
    ),
  );
}

function inline(raw: string, ctx: InlineCtx): ReactNode[] {
  // A marker for evidence that isn't in the workspace (deleted, or never real) disappears with its space.
  const text = raw.replace(/\s*\[(ev_[a-z0-9_]+)\]/gi, (m, id: string) => (ctx.evidence[id] ? m : ""));
  // A bold marker whose closing half hasn't arrived yet shouldn't flash as "**".
  const pairs = (text.match(/\*\*/g) ?? []).length;
  const safe = pairs % 2 ? text.slice(0, text.lastIndexOf("**")) + text.slice(text.lastIndexOf("**") + 2) : text;
  return safe.split(INLINE).map((part, i) => {
    const k = `${ctx.key}.${i}.`;
    if (!part) return null;
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={k} className="font-semibold">{words(part.slice(2, -2), ctx, k)}</strong>;
    const ev = part.match(/^\[(ev_[a-z0-9_]+)\]$/i);
    if (ev) {
      const e = ctx.evidence[ev[1]];
      return e ? (
        <span key={k} className={cn(ctx.animate && "ask-word")}>
          <SourceChip url={e.url} publishedAt={e.publishedAt} quote={e.quote} claim={e.claim} confidence={e.confidence} className="mx-0.5" />
        </span>
      ) : null;
    }
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) {
      return (
        <a key={k} href={link[2]} target="_blank" rel="noreferrer" className="text-accent-text underline-offset-2 hover:underline">
          {words(link[1], ctx, k)}
        </a>
      );
    }
    if (/^`[^`]+`$/.test(part)) return <code key={k} className="rounded-xs bg-bg-subtle px-1 font-mono text-[0.82em]">{part.slice(1, -1)}</code>;
    return words(part, ctx, k);
  });
}

export function AnswerText({
  text,
  limit,
  animate,
  evidence,
  className,
}: {
  /** Settled text (whole words only). */
  text: string;
  /** How many words to show (from `useWordReveal`). */
  limit: number;
  animate: boolean;
  evidence: Record<string, Evidence>;
  className?: string;
}) {
  const shown = animate ? firstWords(text, limit) : text;
  const blocks = parse(shown);
  return (
    <div className={cn("prose-agent space-y-3 text-pretty break-words", className)}>
      {animate && (
        <style href="ask-word-in" precedence="default">
          {WORD_CSS}
        </style>
      )}
      {blocks.map((b, i) => {
        const ctx: InlineCtx = { animate, evidence, key: `b${i}` };
        switch (b.kind) {
          case "p":
            return <p key={i}>{inline(b.text, ctx)}</p>;
          case "h":
            return (
              <p key={i} className="font-semibold">
                {inline(b.text, ctx)}
              </p>
            );
          case "ul":
          case "ol": {
            const List = b.kind === "ul" ? "ul" : "ol";
            return (
              <List key={i} className={cn("space-y-1.5 pl-5", b.kind === "ul" ? "list-disc marker:text-fg-4" : "list-decimal marker:text-fg-3")}>
                {b.items.map((item, j) => (
                  <li key={j} className="pl-1">
                    {inline(item, { ...ctx, key: `b${i}.${j}` })}
                  </li>
                ))}
              </List>
            );
          }
          case "draft":
            return (
              <div key={i} className="draft-rule rounded-r-md bg-surface py-2.5 pl-3.5 pr-2.5 font-sans ring-1 ring-border">
                <div className="mb-1.5 flex h-6 items-center justify-between gap-2">
                  <span className="text-[11.5px] font-medium text-fg-3">Draft</span>
                  {!b.open && b.text && <CopyButton text={b.text} />}
                </div>
                <p className="whitespace-pre-wrap text-[14px] leading-[21px] text-fg-2">{words(b.text, ctx, `d${i}.`)}</p>
              </div>
            );
        }
      })}
    </div>
  );
}
