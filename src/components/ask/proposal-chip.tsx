"use client";

import {
  ArrowRight,
  Ban,
  BookmarkPlus,
  CalendarClock,
  Check,
  Handshake,
  Lightbulb,
  ListPlus,
  MessageSquareWarning,
  MoveRight,
  Play,
  ShieldCheck,
  UserPlus,
  X,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button, IconButton } from "@/components/ui/button";
import { Orb } from "@/components/ui/orb";
import { cn } from "@/lib/client/cn";
import { usd } from "@/lib/client/format";
import type { AskProposal, AskProposalKind } from "@/lib/domain/types";
import { ease } from "@/lib/motion";
import { hrefAfter, proposalActions, typicalCost, workflowOf } from "./proposals";

const ICONS: Record<AskProposalKind, LucideIcon> = {
  track_account: BookmarkPlus,
  create_deal: Handshake,
  set_next_step: CalendarClock,
  change_stage: MoveRight,
  add_task: ListPlus,
  add_person: UserPlus,
  add_pov: Lightbulb,
  add_claim: ShieldCheck,
  add_objection: MessageSquareWarning,
  suppress: Ban,
  start_workflow: Play,
};

const APPLY_LABEL: Partial<Record<AskProposalKind, string>> = {
  start_workflow: "Start",
  add_claim: "Save draft",
};

/**
 * One proposed change: what applying does, why, and the founder's two choices. The blue-pencil rule marks it as
 * the agent's suggestion; once applied it turns to ink with a check. Nothing applies without a click.
 */
export function ProposalChip({
  proposal,
  onDecide,
  onNavigate,
  hereHref,
}: {
  proposal: AskProposal;
  onDecide: (status: "applied" | "dismissed", runId?: string) => Promise<void>;
  /** Called before following a link out of the conversation (the window closes). */
  onNavigate?: () => void;
  /** The page the conversation sits on; links to it are hidden. */
  hereHref?: string;
}) {
  const { ws, dispatch } = useWorkspace();
  const { start, runs } = useRuns();
  const [busy, setBusy] = useState(false);
  const Icon = ICONS[proposal.kind] ?? ArrowRight;
  const applied = proposal.status === "applied";
  const flow = workflowOf(proposal);
  const cost = ws && flow ? typicalCost(ws, flow.workflow) : null;
  const run = proposal.runId ? runs[proposal.runId] : undefined;
  const running = run?.status === "running" || run?.status === "queued";
  const href = ws ? hrefAfter(proposal, ws) : undefined;

  async function apply() {
    if (!ws || busy) return;
    setBusy(true);
    try {
      if (flow) {
        const started = await start(flow.workflow, flow.args, { notify: true });
        if (started) await onDecide("applied", started.id);
        return;
      }
      const actions = proposalActions(proposal, ws);
      if (!actions) {
        toast.error("This no longer applies: the record changed since I suggested it.");
        await onDecide("dismissed");
        return;
      }
      if (await dispatch(actions)) await onDecide("applied");
    } finally {
      setBusy(false);
    }
  }

  if (proposal.status === "dismissed") return null;

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.2, ease: ease.out }}
      className={cn(
        "group flex items-start gap-2.5 rounded-r-md py-2 pl-3 pr-2 font-sans ring-1 ring-border transition-colors duration-200",
        applied ? "bg-bg-subtle" : "draft-rule bg-surface",
      )}
    >
      <span className={cn("mt-[3px] flex size-4 shrink-0 items-center justify-center", applied ? "text-success" : "text-fg-3")}>
        {applied ? <Check className="size-4" /> : <Icon className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-[13.5px] leading-[20px]", applied ? "text-fg-2" : "text-fg")}>{proposal.summary}</p>
        {!applied && <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[18px] text-fg-3">{proposal.reason}</p>}
        {applied && flow && run && (
          <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-fg-3">
            <Orb size={10} state={running ? "working" : run.status === "error" ? "error" : "idle"} />
            {running ? run.title : run.status === "error" ? (run.error?.message ?? "That run failed.") : `Done · ${run.title}`}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 self-center">
        <AnimatePresence mode="popLayout" initial={false}>
          {applied ? (
            <motion.span key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-1">
              <span className="px-1 text-[12px] text-fg-3">{flow ? "Started" : "Applied"}</span>
              {href && href !== hereHref && (
                <Link href={href} onClick={onNavigate} className="inline-flex h-6 items-center gap-1 rounded-xs px-1.5 text-[12px] font-medium text-fg-2 hover:bg-bg-subtle hover:text-fg">
                  Open <ArrowRight className="size-3" />
                </Link>
              )}
            </motion.span>
          ) : (
            <motion.span key="ask" exit={{ opacity: 0, transition: { duration: 0.1 } }} className="flex items-center gap-1">
              {cost !== null && <span className="hidden font-mono text-[11px] text-fg-3 sm:inline">≈{usd(cost)}</span>}
              <Button size="xs" variant="secondary" onClick={() => void apply()} loading={busy} disabled={!ws}>
                {APPLY_LABEL[proposal.kind] ?? "Apply"}
              </Button>
              <IconButton label="Dismiss" className="size-6" onClick={() => void onDecide("dismissed")} disabled={busy}>
                <X className="size-3.5" />
              </IconButton>
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
