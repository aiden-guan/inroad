"use client";

import { motion } from "motion/react";
import { X } from "lucide-react";
import type { RunState } from "@/components/providers/runs-provider";
import { AiBadge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Orb } from "@/components/ui/orb";
import { Receipt, WorkLog } from "@/components/ui/work-log";
import { ease } from "@/lib/motion";

/** What the discovery workflow returns (src/lib/workflows/discovery.ts). */
export interface DiscoveryResult {
  added: number;
  tiers?: { A: number; B: number; C: number };
  rescored?: number;
  considered: number;
  note: string;
  accounts: { domain: string; name: string; tier: "A" | "B" | "C"; whyNow: string | null }[];
}

/** The live log while I look; afterwards one line of outcome, my note and the receipt. */
export function DiscoveryStatus({ run, onDismiss, onRetry }: { run: RunState; onDismiss: () => void; onRetry: () => void }) {
  const active = run.status === "running" || run.status === "queued";
  if (active) return <WorkLog run={run} defaultOpen className="mb-5" />;

  const result = run.result as DiscoveryResult | undefined;
  const failed = run.status === "error";
  // A stopped run gets no result event, so in this session it ends as "done" without a result.
  const stopped = run.status === "stopped" || (run.status === "done" && run.result === undefined);
  const headline = failed
    ? "Finding companies stopped"
    : stopped
      ? "Stopped before I saved anything. Run it again when you're ready."
      : result && result.added > 0
        ? `I added ${result.added} ${result.added === 1 ? "company" : "companies"}${result.tiers?.A ? ` · ${result.tiers.A} ready to work` : ""}`
        : "Nothing cleared the bar this time";

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: ease.out }}
      className="mb-5 flex items-start gap-3 rounded-lg bg-surface p-3.5 ring-1 ring-border"
    >
      <Orb state={failed ? "error" : "idle"} size={18} className="mt-px" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[13px] font-medium text-fg">
          {headline}
          <AiBadge />
        </p>
        {failed ? (
          <p className="mt-1 text-[12.5px] text-fg-2">{run.error?.message ?? "Something went wrong."} Try again, or narrow it with a one-line brief.</p>
        ) : (
          result?.note && <p className="mt-1 max-w-[68ch] font-serif text-[15px] leading-[23px] text-fg-2 text-pretty">{result.note}</p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <Receipt run={run} />
          {failed && (
            <Button size="xs" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      </div>
      <IconButton label="Dismiss" onClick={onDismiss}>
        <X className="size-4" />
      </IconButton>
    </motion.div>
  );
}
