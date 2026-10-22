"use client";

import { Check } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { AiBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton, Markdown } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { nowISO, todayISO } from "@/lib/domain/ids";
import { DIMENSION_LABELS, TARGETING_DIMENSIONS, betEndsOn, inferDimension } from "@/lib/learning/bets";
import { shortDay } from "@/lib/moves/util";
import { revisionStale } from "@/lib/playbook/revision";
import type { Brief, EntityRef, ReviewProposal, Workspace } from "@/lib/domain/types";
import { applyLabel, proposalActions } from "./proposals";
import { RunInline } from "./parts";

const ABOUT = {
  monday:
    "I'll score every open deal for risk, pick the ones that need you this week, propose what to kill or nurture after 14 days without a dated next step, and find the earliest broken stage in your funnel. About a minute.",
  friday:
    "I'll read every reply from this week, tally inputs against targets with sample sizes, quote the objections, and propose up to 3 playbook edits and one message bet for next month. About a minute.",
  monthly:
    "I'll read the message bet, rebuild the bet from the calls since it was last revised (each change a suggestion you accept or reject), log your quotes against how they landed, and check hiring readiness once you're near it. About two minutes.",
} as const;

export type ReviewKind = keyof typeof ABOUT;

const LABELS: Record<ReviewKind | "refresh", string> = { monday: "pipeline review", friday: "learning review", monthly: "monthly review", refresh: "bet refresh" };
const RUN_LABELS: Record<ReviewKind, string> = { monday: "Run the pipeline review", friday: "Run the learning review", monthly: "Run the monthly review" };

/** The review workflow's run ref: one per kind, so each card shows only its own work log. */
const reviewRef = (kind: ReviewKind): EntityRef => ({ kind: "playbook", id: `review:${kind}` });

/** This period's review of a kind, newest first (it may have been run on any day since `weekStart`). */
export function findReview(ws: Workspace, kind: ReviewKind, weekStart: string): Brief | undefined {
  return Object.values(ws.briefs)
    .filter((b) => b.reviewKind === kind && b.review && b.date >= weekStart)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

/** `weekStart`: the start of the period the review covers (the month's first day for the monthly review). */
export function ReviewBody({ ws, kind, weekStart }: { ws: Workspace; kind: ReviewKind; weekStart: string }) {
  const review = findReview(ws, kind, weekStart);
  if (!review) {
    return (
      <div className="space-y-3">
        <p className="font-serif text-[16px] leading-[25px] text-fg-2">{ABOUT[kind]}</p>
        <RunInline
          workflow="review"
          args={{ kind }}
          runRef={reviewRef(kind)}
          label={RUN_LABELS[kind]}
          hint={kind === "monthly" ? "Costs about $0.50" : "Costs about $0.05"}
        />
      </div>
    );
  }
  return <ReviewDoc ws={ws} review={review} kind={kind} />;
}

export function ReviewDoc({ ws, review, kind }: { ws: Workspace; review: Brief; kind: ReviewKind }) {
  const proposals = review.proposals ?? [];
  const open = proposals.filter((p) => p.status === "open");
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-[12px] text-fg-3">
        <AiBadge />
        <span>
          Your Head of GTM · {LABELS[kind]} · {new Date(`${review.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
        </span>
      </div>
      <Markdown className="[&>p:first-child]:text-[19px] [&>p:first-child]:leading-[28px]">{review.review ?? ""}</Markdown>
      {proposals.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[12px] font-medium text-fg-3">{open.length ? `${open.length} to decide` : "All decided"}</h3>
          <ul className="space-y-2">
            {proposals.map((p) => (
              <ProposalRow key={p.id} ws={ws} date={review.date} p={p} />
            ))}
          </ul>
          <p className="text-[12px] text-fg-3">Nothing changes until you apply it. Stages only move when you say so.</p>
        </div>
      )}
      <RunInline workflow="review" args={{ kind }} runRef={reviewRef(kind)} label="Run it again" variant="secondary" />
    </div>
  );
}

/** What starting a bet does, in one line. Writing bets alternate drafts; who-and-why bets sort the sends. */
function betStartedToast(p: ReviewProposal): string {
  const until = shortDay(betEndsOn(todayISO()));
  const d = p.bet?.dimension ?? inferDimension(p.bet?.variable ?? "");
  if (d && TARGETING_DIMENSIONS.includes(d)) return `Started. Until ${until}, every first touch to either group is tagged with its arm.`;
  if (d) return `Started. Until ${until}, first-touch drafts alternate between control and variant, and each send is tagged.`;
  return `Saved. I'll restate it in each Friday review until ${until}.`;
}

/** One proposal with Apply (or Accept) and Dismiss (or Reject). Playbook changes show their before and after. */
export function ProposalRow({ ws, date, p }: { ws: Workspace; date: string; p: ReviewProposal }) {
  const { dispatch } = useWorkspace();
  const decided = p.status !== "open";
  const revision = p.kind === "revise_foundation" ? p.revision : undefined;
  const stale = !!revision && !decided && revisionStale(ws.foundation, revision);
  const apply = async () => {
    const actions = proposalActions(p, ws, date);
    if (!actions) {
      toast.error("That can't be applied anymore. The deal or playbook section changed.");
      return;
    }
    const ok = await dispatch(actions);
    if (ok) toast(p.kind === "message_bet" ? betStartedToast(p) : revision ? "Accepted. The version before it is kept in the Journal if you change your mind." : "Applied.");
  };
  const dismiss = () => void dispatch({ type: "brief.setProposal", date, proposalId: p.id, status: "dismissed", at: nowISO() });

  return (
    <li className={cn("rounded-md bg-surface p-3 ring-1 ring-border", decided && "bg-bg-subtle/60")}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className={cn("text-[13.5px] font-semibold leading-5", decided ? "text-fg-2" : "text-fg")}>{p.title}</p>
          <p className="mt-0.5 text-[13px] leading-5 text-fg-2">{p.detail}</p>
          {p.bet && (
            <p className="mt-1.5 text-[13px] leading-5 text-fg-2">
              {p.bet.dimension && <span className="text-fg-3">{DIMENSION_LABELS[p.bet.dimension]} · </span>}
              <span className="text-fg-3">Control:</span> {p.bet.control} <span className="text-fg-3">· Variant:</span> {p.bet.variant}
            </p>
          )}
          {p.justification?.map((j) => (
            <p key={j} className="mt-1.5 border-l border-border-strong pl-2.5 font-serif text-[14px] italic leading-[21px] text-fg-3">
              {j}
            </p>
          ))}
          {p.kind === "note" && p.text && <pre className="mt-2 whitespace-pre-wrap rounded-sm bg-sunken p-3 font-sans text-[14px] leading-[22px] text-fg">{p.text}</pre>}
          {revision && (
            <div className="mt-2 space-y-1 rounded-sm bg-sunken p-3 text-[14px] leading-[22px]">
              {revision.before && (
                <p className="text-fg-3 line-through decoration-fg-4">
                  <span className="sr-only">Now: </span>
                  {revision.before}
                </p>
              )}
              {revision.after && (
                <p className="text-fg">
                  <span className="sr-only">Proposed: </span>
                  {revision.after}
                </p>
              )}
            </div>
          )}
          {stale && <p className="mt-1.5 text-[12.5px] text-fg-3">You changed this part of the playbook since. Refresh again to get a new suggestion.</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {decided ? (
            <span className="inline-flex items-center gap-1 text-[12.5px] text-fg-3">
              {p.status === "applied" && <Check className="size-3.5" />}
              {p.status === "applied" ? (revision ? "Accepted" : "Applied") : revision ? "Rejected" : "Dismissed"}
            </span>
          ) : (
            <>
              {p.kind === "note" && p.text ? (
                <CopyButton text={p.text} label="Copy post" onCopied={() => void apply()} />
              ) : (
                !stale && (
                  <Button size="sm" variant="primary" onClick={() => void apply()}>
                    {applyLabel(p)}
                  </Button>
                )
              )}
              <Button size="sm" variant="ghost" onClick={dismiss}>
                {revision ? "Reject" : "Dismiss"}
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}
