"use client";

import { Sparkles, X } from "lucide-react";
import { forwardRef, useState } from "react";
import { toast } from "sonner";
import { typicalCost } from "@/components/ask/proposals";
import { useActiveRuns, useRuns } from "@/components/providers/runs-provider";
import { AgentErrorNote } from "@/components/ui/agent-error";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { WorkLog } from "@/components/ui/work-log";
import { costOf, emptyUsage } from "@/lib/ai/models";
import { usd } from "@/lib/client/format";
import type { Workspace } from "@/lib/domain/types";
import { editingRecipe } from "@/lib/plays/recipes";
import { Micro } from "./parts";

/** Starting points that fill the box (no tokens until you press the button). */
const EXAMPLES: { label: string; sentence: string }[] = [
  { label: "RevOps or billing hire", sentence: "When a company in our ICP posts a RevOps or billing role and we have no open deal, draft a note to the hiring manager that references the role." },
  { label: "New finance leader", sentence: "When a new VP Finance or CFO starts at an A-tier account with no open deal, write to them in their first 60 days; at most 5 a week." },
  { label: "Funding during a proposal", sentence: "When a company with a deal at proposal raises a round, review the deal and ask who signs now." },
];

/** About what a compile costs on the cheap tier: this workspace's own receipts once there are two, else an estimate. */
function costHint(ws: Workspace): string {
  const seen = typicalCost(ws, "play_compile");
  return `${seen !== null ? "Usually" : "About"} ${usd(seen ?? costOf("fast", { ...emptyUsage(), inputTokens: 4_500, outputTokens: 700 }))} on your key`;
}

/**
 * "Describe a play": one sentence in, a recipe out that you edit, dry-run and turn on. The model (the cheap tier)
 * only chooses fields; finding companies, dating signals and counting results are code and cost nothing.
 */
export const DescribePlay = forwardRef<HTMLTextAreaElement, { ws: Workspace; text: string; setText: (t: string) => void; target?: string; clearTarget: () => void; onCompiled: (id: string) => void }>(function DescribePlay(
  { ws, text, setText, target, clearTarget, onCompiled },
  ref,
) {
  const { start, runs } = useRuns();
  const active = useActiveRuns().find((r) => r.workflow === "play_compile");
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const run = (runId ? runs[runId] : undefined) ?? active;
  const busy = starting || run?.status === "running" || run?.status === "queued";
  const ready = text.trim().length >= 12;
  const rewriting = target ? ws.customPlays?.[target] : undefined;

  const submit = async () => {
    if (!ready || busy) return;
    setStarting(true);
    const r = await start(
      "play_compile",
      { sentence: text.trim(), ...(rewriting ? { id: rewriting.id } : {}) },
      {
        notify: false,
        onResult: (res) => {
          const { id, fires, unsupported } = res as { id: string; fires: number; unsupported: number };
          onCompiled(id);
          setText("");
          clearTarget();
          toast(`Drafted. It would fire on ${fires} ${fires === 1 ? "company" : "companies"} today${unsupported ? `, and ${unsupported === 1 ? "one part" : `${unsupported} parts`} can't run (see the draft)` : ""}. Nothing runs until you turn it on.`);
        },
      },
    );
    setStarting(false);
    if (r) setRunId(r.id);
  };

  return (
    <section aria-labelledby="describe-play-label">
      <div className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-inset ring-border transition-shadow duration-150 focus-within:ring-border-strong">
        <div className="px-4 pt-3.5 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <label id="describe-play-label" htmlFor="describe-play">
              <Micro>{rewriting ? "Rewrite this play from a sentence" : "Describe a play"}</Micro>
            </label>
            <span className="hidden items-center gap-1.5 text-[12px] text-fg-3 md:pointer-fine:flex">
              <Kbd>N</Kbd> to type · <Kbd>↵</Kbd> to compile
            </span>
          </div>
          <textarea
            ref={ref}
            id="describe-play"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
              if (e.key === "Escape") e.currentTarget.blur();
            }}
            maxLength={500}
            disabled={busy}
            placeholder={EXAMPLES[0].sentence}
            className="mt-2 block min-h-[60px] w-full resize-none bg-transparent font-serif text-[17px] leading-[26px] text-fg outline-none placeholder:text-fg-3/80 disabled:opacity-60"
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-4 py-2.5 sm:px-5">
          {rewriting ? (
            <span className="inline-flex min-w-0 items-center gap-1 rounded-xs bg-bg-subtle px-1.5 py-0.5 text-[12px] text-fg-2 ring-1 ring-inset ring-border">
              <span className="truncate">Into {editingRecipe(rewriting)?.name ?? "this play"}</span>
              <button type="button" onClick={clearTarget} aria-label="Write a new play instead" className="inline-flex size-4 items-center justify-center rounded-xs text-fg-3 hover:text-fg">
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-fg-3">Try</span>
              {EXAMPLES.map((x) => (
                <button key={x.label} type="button" onClick={() => setText(x.sentence)} className="h-6 rounded-xs px-1.5 text-[12px] text-fg-2 ring-1 ring-inset ring-border transition-colors hover:bg-bg-subtle hover:text-fg">
                  {x.label}
                </button>
              ))}
            </span>
          )}
          <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[12px] text-fg-3">{costHint(ws)} · matching costs nothing</span>
            <Button variant="agent" size="sm" icon={<Sparkles className="size-3.5" />} loading={busy} disabled={!ready} onClick={() => void submit()}>
              {rewriting ? "Rewrite the recipe" : "Turn it into a play"}
            </Button>
          </span>
        </div>
      </div>
      {run && (run.status === "running" || run.status === "queued") && <WorkLog run={run} className="mt-2" />}
      {run?.status === "error" && run.error && (
        <p className="mt-2 px-1">
          <AgentErrorNote error={run.error} /> <span className="text-[12px] text-fg-3">Your sentence is still in the box.</span>
        </p>
      )}
    </section>
  );
});
