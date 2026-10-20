"use client";

import type { EntityRef } from "@/lib/domain/types";
import { Conversation } from "./conversation";

/**
 * The Ask conversation embedded inline (no overlay), scoped to an entity. The company sheet renders it as its
 * "Ask" tab, so asking never stacks a window on top of a sheet. It picks up this record's recent thread.
 *
 * A prefill is asked once: `onPrefillSent` tells the owner to clear it, so a remount (tab switch, another
 * company) resumes the thread instead of paying for the same question again. The owner keys this panel per
 * new prefill; the conversation inside is keyed by record only, so clearing the prefill doesn't restart it.
 */
export function AskPanel({ context, prefill, onPrefillSent }: { context?: EntityRef; prefill?: string; onPrefillSent?: () => void }) {
  const key = context ? `${context.kind}:${context.id}` : "none";
  const hereHref = context?.kind === "account" ? `/companies?c=${encodeURIComponent(context.id)}` : undefined;
  return (
    <Conversation
      key={key}
      variant="inline"
      context={context}
      resume={!prefill}
      prefill={prefill}
      onPrefillSent={onPrefillSent}
      hereHref={hereHref}
      className="h-[max(420px,calc(100dvh-260px))]"
    />
  );
}
