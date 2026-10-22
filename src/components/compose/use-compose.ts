"use client";

import { useCallback, useState } from "react";
import { useRuns } from "@/components/providers/runs-provider";
import type { OutreachPackage } from "@/lib/domain/types";
import type { ComposeResult } from "@/lib/workflows/compose";

export interface ComposeArgs {
  domain: string;
  personId?: string;
  angleId?: string;
  mode?: OutreachPackage["mode"];
  replyText?: string;
  receivedAt?: string;
  connectorId?: string;
  packageId?: string;
  alternate?: boolean;
  /** Cold mode: the person whose referral reply is the premise. */
  referredBy?: string;
  /** Cold mode, with referredBy: their words when the referral came on a call (from the debrief). */
  referralQuote?: string;
}

/** Starts the compose workflow and tracks this one run (its live log, then its result). */
export function useCompose() {
  const { runs, start } = useRuns();
  const [runId, setRunId] = useState<string | null>(null);
  const [result, setResult] = useState<ComposeResult | null>(null);
  const run = runId ? runs[runId] : undefined;

  const begin = useCallback(
    async (args: ComposeArgs, onResult?: (r: ComposeResult) => void) => {
      setResult(null);
      const state = await start("compose", args, {
        notify: false,
        onResult: (data) => {
          const r = data as ComposeResult;
          setResult(r);
          onResult?.(r);
        },
      });
      setRunId(state?.id ?? null);
      return state;
    },
    [start],
  );

  const reset = useCallback(() => {
    setRunId(null);
    setResult(null);
  }, []);

  const busy = run?.status === "running" || run?.status === "queued";
  return { run, result, begin, reset, busy };
}
