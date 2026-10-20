"use client";

import * as RP from "@radix-ui/react-popover";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/client/cn";
import { age, hostOf } from "@/lib/client/format";
import type { Evidence } from "@/lib/domain/types";
import { Badge } from "./badge";
import { Favicon } from "./favicon";

/**
 * Provenance is the product's signature: every claim the agent makes carries a note with the
 * host, the age and the verbatim quote. Inline it's a chip; in wide layouts it's a margin note.
 */
export function SourceChip({
  url,
  publishedAt,
  quote,
  claim,
  confidence,
  className,
  onFlagWrong,
}: {
  url: string;
  publishedAt?: string;
  quote?: string;
  claim?: string;
  confidence?: Evidence["confidence"];
  className?: string;
  onFlagWrong?: () => void;
}) {
  const host = hostOf(url);
  const when = age(publishedAt);
  return (
    <RP.Root>
      <RP.Trigger asChild>
        <button
          className={cn(
            "inline-flex h-5 max-w-[min(14rem,100%)] items-center gap-1 rounded-xs bg-surface px-1 align-[1px] text-[11px] text-fg-2 ring-1 ring-border",
            "transition-[background-color,box-shadow] duration-150 ease-out-quad hover:bg-accent-subtle hover:ring-accent/30",
            className,
          )}
        >
          <Favicon domain={host} size={12} className="ring-0" />
          <span className="truncate font-mono">{host}</span>
          {when && <span className="shrink-0 whitespace-nowrap font-mono text-fg-3">· {when}</span>}
        </button>
      </RP.Trigger>
      <RP.Portal>
        <RP.Content
          side="top"
          sideOffset={6}
          className="z-[75] w-80 origin-[var(--radix-popover-content-transform-origin)] rounded-lg bg-surface-raised p-3 shadow-lg ring-1 ring-border data-[state=open]:animate-[pop-in_160ms_var(--ease-out)]"
        >
          {claim && <p className="mb-2 text-[13px] font-medium text-fg">{claim}</p>}
          {quote && (
            <blockquote className="border-l-2 border-accent/50 pl-2.5 font-serif text-[14px] leading-[21px] text-fg-2">“{quote}”</blockquote>
          )}
          <div className="mt-3 flex items-center justify-between gap-2">
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 text-[12px] text-accent-text hover:underline">
              <span className="truncate">{host}</span>
              <ExternalLink className="size-3 shrink-0" />
            </a>
            <div className="flex items-center gap-1.5">
              {confidence && <Badge tone={confidence === "high" ? "success" : confidence === "medium" ? "neutral" : "warning"}>{confidence}</Badge>}
              {onFlagWrong && (
                <button onClick={onFlagWrong} className="text-[12px] text-fg-3 hover:text-danger">
                  Wrong?
                </button>
              )}
            </div>
          </div>
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  );
}

/** Margin note: sits in a right gutter beside the sentence it supports (≥1280px layouts). */
export function MarginNote({ url, publishedAt, quote, className }: { url: string; publishedAt?: string; quote?: string; className?: string }) {
  const host = hostOf(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn("group block border-l border-accent/40 pl-2.5 text-[11.5px] leading-[16px] text-fg-3 transition-colors hover:border-accent hover:text-fg-2", className)}
    >
      <span className="font-mono text-fg-2">
        {host}
        {publishedAt && <span className="text-fg-3"> · {age(publishedAt)}</span>}
      </span>
      {quote && <span className="mt-0.5 line-clamp-2 font-serif text-[12.5px] italic">“{quote}”</span>}
    </a>
  );
}

/** Wrap a sentence the agent wrote; the evidence appears as a chip right after it. */
export function Cited({ children, evidence }: { children: ReactNode; evidence?: Evidence | null }) {
  return (
    <span>
      {children}
      {evidence && (
        <>
          {" "}
          <SourceChip url={evidence.url} publishedAt={evidence.publishedAt} quote={evidence.quote} claim={evidence.claim} confidence={evidence.confidence} />
        </>
      )}
    </span>
  );
}
