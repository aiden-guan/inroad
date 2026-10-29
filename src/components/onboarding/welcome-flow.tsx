"use client";

import { Square } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useRuns, type RunState } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { AiBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { LoadingSignal } from "@/components/ui/loading";
import { Orb, type OrbState } from "@/components/ui/orb";
import { OrbMorph, useWide } from "@/components/ui/orb-morph";
import { useBillingUrl } from "@/lib/client/ai-provider";
import type { RunSummary, Workspace } from "@/lib/domain/types";
import { ease } from "@/lib/motion";
import { BetDocument } from "./bet-document";
import { isConsumer } from "@/lib/consumer/market";
import { FirstThree } from "./first-three";
import { FirstUsers } from "./first-users";
import { InlineQuestions, WhoBuysPrompt } from "./inline-questions";
import { KeyBlock, useKeyForm } from "./key-block";
import { LearnedChips } from "./learned-chips";
import { PendingRow, ReadingLedger, type ExtraRow } from "./reading-ledger";
import { StartStep, type StartArgs } from "./start-step";
import { Canvas, clock, inOverlay, isTyping, runSummary, useLiveRefresh, useNow } from "./shared";

type Phase = "start" | "reading" | "drafting" | "offer";

/**
 * Onboarding's own words for failures where it has something to add. Everything else shows the run's
 * message, which names the provider and says what to do (out of credits, rate limited, model unavailable).
 */
const ERROR_COPY: Record<string, string> = {
  no_key: "Add an AI provider key to put me to work.",
  auth: "Your API key was rejected. Paste a new one below.",
  refusal: "I couldn’t do that one. Try again, or tell me in two sentences what you sell.",
  no_submit: "I lost the thread on that one. Your answers and corrections are saved, so trying again picks up from there.",
};

const isLive = (s: RunSummary["status"] | undefined) => s === "running" || s === "queued";

/** When the run stopped or failed, say what happened and offer the one obvious next step. */
function FailurePanel({ code, message, stopped, onRetry, onStartOver }: { code?: string; message?: string; stopped: boolean; onRetry: () => void; onStartOver: () => void }) {
  const keyForm = useKeyForm();
  const needsKey = code === "no_key" || code === "auth";
  const billingUrl = useBillingUrl();
  const copy = stopped
    ? "Stopped. What I learned so far is saved."
    : ((code && ERROR_COPY[code]) ?? (code && message ? `${message}${code === "no_credit" ? " Your answers and corrections are saved." : ""}` : "I lost the thread on that one. Your answers and corrections are saved."));
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: ease.out }}
      className="mt-6 rounded-lg bg-surface p-4 shadow-xs ring-1 ring-border sm:p-5"
    >
      <p className="text-pretty text-[14px] leading-[21px] text-fg">
        {copy}
        {code === "no_credit" && (
          <a href={billingUrl} target="_blank" rel="noreferrer" className="ml-1.5 whitespace-nowrap font-medium text-accent-text underline-offset-2 hover:underline">
            Add credits ↗
          </a>
        )}
      </p>
      {!stopped && !needsKey && !code && message && <p className="mt-1 text-pretty text-[12.5px] text-fg-3">{message}</p>}
      {needsKey ? (
        <div className="mt-4">
          <KeyBlock
            form={keyForm}
            title={code === "auth" ? "Paste a working API key." : "I run on your AI provider's key."}
            autoFocus
            onSave={async () => {
              if (await keyForm.submit()) onRetry();
            }}
          />
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="agent" onClick={onRetry}>
            {stopped ? "Pick up where I left off" : "Try again"}
          </Button>
          <Button variant="ghost" onClick={onStartOver}>
            Start over
          </Button>
        </div>
      )}
    </motion.div>
  );
}

function WorkingColumn({
  ws,
  phase,
  stale,
  args,
  run,
  summary,
  discovery,
  onRetry,
  onStartOver,
}: {
  ws: Workspace;
  phase: "reading" | "drafting";
  stale: boolean;
  args: StartArgs | null;
  run: RunState | undefined;
  summary: RunSummary | undefined;
  discovery: RunState | undefined;
  onRetry: () => void;
  onStartOver: () => void;
}) {
  const { stop } = useRuns();
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const o = ws.onboarding;
  const runId = run?.id ?? summary?.id;
  const status = run?.status ?? summary?.status;
  const live = isLive(status);
  const stopped = status === "stopped";
  // A run that ended without a result while its summary still says running was lost (e.g. the server restarted).
  const lost = (run?.status === "done" && run.result === undefined && summary?.status === "running") || (!stale && summary?.status === "done" && !run);
  const failed = stopped || status === "error" || lost;
  const error = run?.error ?? summary?.error;

  const domain = stale ? args?.url : o.domain;
  const ledger = stale ? [] : (o.ledger ?? []);
  const site = stale ? (args?.url ? "reading" : "none") : o.site;
  const startedAt = run?.startedAt ?? (summary ? Date.parse(summary.startedAt) : 0);
  const endedAt = run?.endedAt ?? (summary?.endedAt ? Date.parse(summary.endedAt) : undefined);
  const now = useNow(live, startedAt);
  const elapsed = startedAt ? (endedAt ?? (live ? now : startedAt)) - startedAt : 0;

  useEffect(() => {
    if (!live || !runId) return;
    const onKey = (e: KeyboardEvent) => {
      // An Escape a popover already handled (it calls preventDefault) or that comes from inside an overlay closes that, not the run.
      if (e.key !== "Escape" || e.defaultPrevented || isTyping(e.target) || inOverlay(e.target)) return;
      e.preventDefault();
      void stop(runId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live, runId, stop]);

  let pending: { verb: string; detail?: string } | null = null;
  if (live && phase === "reading") {
    if (site === "reading") pending = { verb: "Reading", detail: domain ?? undefined };
    else if (site !== "none" && !ledger.some((r) => r.kind === "check")) pending = { verb: "Checking DNS, job boards and news" };
    else if (!o.sections?.snapshot) pending = { verb: "Writing down what I learned" };
  }
  const steps = run?.steps ?? [];
  const searches: ExtraRow[] = steps
    .filter((s) => s.kind === "search")
    .map((s) => ({ id: `search-${s.id}`, verb: live && !s.doneAt ? "Searching" : "Searched", detail: `“${s.text}”`, active: live && !s.doneAt }));
  const dLast = discovery?.steps[discovery.steps.length - 1];
  const dLive = isLive(discovery?.status);
  const title = phase === "drafting" ? "Drafting your first bet" : domain ? `Reading ${domain}` : "Reading your description";
  const showQuestions = !stale && (ledger.length > 0 || phase === "drafting" || site === "none");

  return (
    <motion.div key="working" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-balance font-serif text-[26px] leading-[32px] tracking-[-0.01em] text-fg [overflow-wrap:anywhere] sm:text-[30px] sm:leading-[36px]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={title} className="inline-block" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ duration: 0.24, ease: ease.out }}>
                {title}
              </motion.span>
            </AnimatePresence>
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-fg-3">
            Your Head of GTM <AiBadge />
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 pt-2">
          <span className="font-mono text-[12px] tnum text-fg-3" aria-label="Elapsed">
            {clock(elapsed)}
          </span>
          {live && (
            <button
              onClick={() => runId && void stop(runId)}
              className="inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-[12px] text-fg-3 transition-colors duration-150 hover:bg-bg-subtle hover:text-fg active:scale-[0.97]"
            >
              <Square className="size-2.5 fill-current" aria-hidden />
              Stop
              <Kbd className="hidden sm:pointer-fine:inline-flex">Esc</Kbd>
            </button>
          )}
        </div>
      </header>

      {failed && <FailurePanel code={error?.code} message={error?.message} stopped={stopped} onRetry={onRetry} onStartOver={onStartOver} />}

      <div className="mt-6">
        <ReadingLedger
          rows={ledger}
          pending={pending}
          extra={phase === "drafting" ? searches : []}
          collapsed={phase === "drafting" && !ledgerOpen}
          onToggle={phase === "drafting" ? () => setLedgerOpen((v) => !v) : undefined}
        />
        {phase === "drafting" && live && (
          <div className="mt-1 min-h-6">
            <AnimatePresence mode="wait" initial={false}>
              {run?.thinking && (
                <motion.p
                  key={run.thinking}
                  initial={{ opacity: 0, filter: "blur(2px)" }}
                  animate={{ opacity: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, filter: "blur(2px)" }}
                  transition={{ duration: 0.15 }}
                  className="truncate pl-6 font-serif text-[14px] italic leading-6 text-fg-3"
                >
                  {run.thinking}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        )}
        {dLive && (
          <ul className="mt-1">
            <PendingRow verb="Finding companies" detail={dLast && dLast.kind !== "status" ? dLast.text.slice(0, 60) : undefined} />
          </ul>
        )}
      </div>

      {(site === "thin" || site === "spa") && !stale && (
        <div className="mt-6">
          <WhoBuysPrompt ws={ws} />
        </div>
      )}
      {showQuestions && (
        <div className="mt-6">
          <InlineQuestions ws={ws} />
        </div>
      )}

      <div className="mt-8">
        <LearnedChips ws={ws} waiting={!stale && live && phase === "reading" && !o.sections?.snapshot && ledger.length > 0} />
      </div>

      {phase === "drafting" && (
        <div className="mt-8">
          <BetDocument ws={ws} live={live} />
        </div>
      )}
    </motion.div>
  );
}

/**
 * /welcome: the first run. Step 0 (website), then reading → drafting (live, resumable after a reload: the run keeps
 * going server-side and we reattach through ws.onboarding.runId), then "Here's who I'd talk to first".
 */
export function WelcomeFlow() {
  const { ws, error, dispatch } = useWorkspace();
  const { runs, start } = useRuns();
  const router = useRouter();
  const [pending, setPending] = useState<{ runId: string; args: StartArgs } | null>(null);
  const [starting, setStarting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const wide = useWide();

  const status = ws?.onboarding.status;
  useEffect(() => {
    if (status === "hired" && !leaving) router.replace("/today");
  }, [status, leaving, router]);

  const o = ws?.onboarding;
  const caughtUp = !pending || o?.runId === pending.runId;
  const runId = caughtUp ? o?.runId : pending?.runId;
  const run = runId ? runs[runId] : undefined;
  const summary = ws ? runSummary(ws, runId) : undefined;
  const discovery = o?.discoveryRunId ? runs[o.discoveryRunId] : undefined;
  const phase: Phase = !caughtUp
    ? "reading"
    : o?.status === "reading" || o?.status === "drafting"
      ? o.status
      : o?.status === "offer" || (o?.status === "hired" && leaving)
        ? "offer"
        : "start";

  useLiveRefresh(
    phase === "reading" || phase === "drafting" || (phase === "offer" && isLive(discovery?.status)),
    `${run?.steps.length ?? 0}|${run?.status}|${discovery?.steps.length ?? 0}|${discovery?.status}|${o?.status}`,
  );

  const begin = async (args: StartArgs) => {
    setStarting(true);
    const r = await start("foundation", args, { notify: false });
    setStarting(false);
    if (r) setPending({ runId: r.id, args });
    return !!r;
  };
  const retry = () => void begin({ url: o?.url ?? pending?.args.url, note: o?.note ?? pending?.args.note, market: o?.market ?? pending?.args.market });
  const startOver = () => {
    setPending(null);
    void dispatch({ type: "onboarding.update", patch: { status: "new", error: undefined } });
  };

  if (!ws || (status === "hired" && !leaving)) {
    return (
      <Canvas>
        <div className="flex justify-center pt-[30vh]">{error ? <p className="px-6 text-center text-[13px] text-danger">{error}</p> : <LoadingSignal />}</div>
      </Canvas>
    );
  }

  const live = isLive(run?.status ?? summary?.status);
  const failed = !live && phase !== "offer" && (run?.status === "error" || run?.status === "stopped" || summary?.status === "error" || summary?.status === "stopped");
  const orb: OrbState = phase === "offer" ? "needs" : failed ? "error" : live || !caughtUp ? "working" : "idle";
  const tick = (o?.ledger?.length ?? 0) + (ws.company?.chips.length ?? 0) + Object.keys(o?.sections ?? {}).length;

  return (
    <Canvas>
      <AnimatePresence mode="wait" initial={false}>
        {phase === "start" ? (
          <StartStep key="start" ws={ws} onStart={begin} starting={starting} />
        ) : (
          <motion.main
            key="work"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="mx-auto grid w-full max-w-[960px] grid-cols-1 gap-5 px-4 pb-24 pt-4 sm:px-6 md:grid-cols-[112px_minmax(0,1fr)] md:gap-10 md:px-10 md:pt-12"
          >
            <aside className="md:sticky md:top-12 md:self-start">
              {/* When the founder says go, this orb flies into the sidebar (or the phone header). */}
              <OrbMorph on={wide} layout="desktop">
                <Orb state={orb} size={96} tick={tick} className="hidden md:inline-flex" />
              </OrbMorph>
              <OrbMorph on={!wide} layout="phone">
                <Orb state={orb} size={36} tick={tick} className="md:hidden" />
              </OrbMorph>
            </aside>
            <div className="min-w-0 max-w-[640px]">
              <AnimatePresence mode="wait" initial={false}>
                {phase === "offer" ? (
                  <motion.div key="offer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
                    {isConsumer(ws) ? <FirstUsers ws={ws} onLeave={() => setLeaving(true)} /> : <FirstThree ws={ws} onLeave={() => setLeaving(true)} />}
                  </motion.div>
                ) : (
                  <WorkingColumn
                    key="working"
                    ws={ws}
                    phase={phase}
                    stale={!caughtUp}
                    args={pending?.args ?? null}
                    run={run}
                    summary={summary}
                    discovery={discovery}
                    onRetry={retry}
                    onStartOver={startOver}
                  />
                )}
              </AnimatePresence>
            </div>
          </motion.main>
        )}
      </AnimatePresence>
    </Canvas>
  );
}
