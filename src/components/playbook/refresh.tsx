"use client";

import { useCallback } from "react";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { ProposalRow } from "@/components/today/review-panel";
import { RunInline } from "@/components/today/parts";
import { shortDate } from "@/lib/client/format";
import type { Brief, ReviewProposal, Workspace } from "@/lib/domain/types";
import { refreshOffer } from "@/lib/moves/monthly-data";
import { plural } from "@/lib/moves/util";
import { usePlaybook } from "./context";
import { Sub } from "./ui";

/** Playbook changes still waiting on the founder, from the latest refresh or monthly review. */
export function openRevisions(ws: Workspace): { brief: Brief; p: ReviewProposal }[] {
  return Object.values(ws.briefs)
    .filter((b) => b.reviewKind === "refresh" || b.reviewKind === "monthly")
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    .flatMap((brief) => (brief.proposals ?? []).filter((p) => p.kind === "revise_foundation" && p.status === "open").map((p) => ({ brief, p })));
}

/**
 * "Rebuild the bet from my calls" (W1c refresh): offered in the Playbook and on Today once five calls are debriefed or
 * a deal is won since the bet was last revised, and runnable any time. Its changes land here as Accept/Reject rows.
 */
export function RefreshBet({ ws, onResult, compact }: { ws: Workspace; onResult?: () => void; compact?: boolean }) {
  const offer = refreshOffer(ws);
  const open = openRevisions(ws);
  const since = offer.since ? shortDate(offer.since) : null;
  if (compact) {
    return open.length ? (
      <a href="#refresh" className="text-[13px] text-fg-2 underline underline-offset-2 hover:text-fg">
        {plural(open.length, "suggested change")} to the bet wait under Who
      </a>
    ) : (
      <RunInline workflow="review" args={{ kind: "refresh" }} runRef={{ kind: "playbook", id: "review:refresh" }} label="Rebuild the bet from my calls" variant="secondary" onResult={onResult} hint="About a minute · about $0.40" />
    );
  }
  return (
    <div className="space-y-3">
      <p className="max-w-[62ch] text-[13.5px] leading-[21px] text-fg-2">
        {open.length
          ? `${plural(open.length, "suggested change")} to the bet. Accept or reject each one; the version before is kept in the Journal.`
          : `I'll read ${offer.calls ? plural(offer.calls, "call") : "the calls"} debriefed${since ? ` since ${since}` : ""}${offer.won ? ` and ${plural(offer.won, "deal")} you won` : ""}, start from your best-fit customers, and suggest changes to who you sell to, how you position and how you talk to each persona. Nothing changes until you accept it.`}
      </p>
      {open.length > 0 && (
        <ul className="space-y-2">
          {open.map(({ brief, p }) => (
            <ProposalRow key={p.id} ws={ws} date={brief.date} p={p} />
          ))}
        </ul>
      )}
      <RunInline
        workflow="review"
        args={{ kind: "refresh" }}
        runRef={{ kind: "playbook", id: "review:refresh" }}
        label={open.length ? "Refresh again" : "Rebuild the bet from my calls"}
        variant={open.length ? "secondary" : "agent"}
        onResult={onResult}
        hint="About a minute · about $0.40"
      />
    </div>
  );
}

/**
 * Answering a founder question starts a light revise pass (W1: low effort, no web): it suggests changes only to the
 * sections the answer affects. Silent when it can't run (no key, the sample workspace).
 */
export function useReviseAfterAnswer(): (questionId: string) => void {
  const { ws } = useWorkspace();
  const { start } = useRuns();
  const sample = !!ws?.sample;
  return useCallback(
    (questionId: string) => {
      if (sample) return;
      void start("review", { kind: "refresh", questionId }, { notify: false, onError: () => {} });
    },
    [sample, start],
  );
}

/** The Who section's refresh block: shown once a refresh is worth it, or while its suggestions wait. */
export function RefreshSub() {
  const { ws } = usePlaybook();
  const offer = refreshOffer(ws);
  const open = openRevisions(ws);
  if (!offer.offered && !open.length) return null;
  return (
    <Sub
      id="refresh"
      title={open.length ? "Suggested changes to the bet" : "Rebuild the bet from your calls"}
      hint={open.length ? "From your calls and best-fit customers, each with what showed it." : `${plural(offer.calls, "call")} debriefed${offer.won ? ` and ${plural(offer.won, "deal")} won` : ""} since the bet was last revised. Conversations beat the website it was written from.`}
    >
      <RefreshBet ws={ws} />
    </Sub>
  );
}
