"use client";

import { ArrowUpRight, Check, Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { BILLING_URL } from "@/lib/ai/errors";
import { cn } from "@/lib/client/cn";

export interface RunError {
  message: string;
  code?: string;
  requestId?: string;
  detail?: string;
}

/**
 * A run's failure, said once in plain words, with the one fix that applies (add credits, update the key)
 * and, when the API answered, "Copy details" for a support request. The raw API response never shows.
 */
export function AgentErrorNote({ error, className, withFix = true }: { error: RunError; className?: string; /** False when the fix is already the main button nearby. */ withFix?: boolean }) {
  const [copied, setCopied] = useState(false);
  const details = [error.code && `code ${error.code}`, error.requestId && `request ${error.requestId}`, error.detail].filter(Boolean).join(" · ");
  const fix = !withFix ? null : error.code === "no_credit" ? (
    <a href={BILLING_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-fg-2 underline-offset-2 hover:text-fg hover:underline">
      Add credits <ArrowUpRight className="size-3" aria-hidden />
    </a>
  ) : error.code === "auth" || error.code === "no_key" ? (
    <Link href="/settings#api-key" className="font-medium text-fg-2 underline-offset-2 hover:text-fg hover:underline">
      Open Settings
    </Link>
  ) : null;
  return (
    <span className={cn("text-[12px] leading-[18px] text-danger", className)}>
      {error.message}
      {fix && <span className="ml-2 whitespace-nowrap">{fix}</span>}
      {(error.requestId || error.detail) && (
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(details);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="ml-2 inline-flex items-center gap-1 whitespace-nowrap text-fg-3 transition-colors duration-150 hover:text-fg-2"
        >
          {copied ? <Check className="size-3 text-success" aria-hidden /> : <Copy className="size-3" aria-hidden />}
          {copied ? "Copied" : "Copy details"}
        </button>
      )}
    </span>
  );
}
