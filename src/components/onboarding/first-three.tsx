"use client";

import { ChevronDown, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRuns, type RunState } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { Input, Label } from "@/components/ui/field";
import { SourceChip } from "@/components/ui/source";
import { duration, usd } from "@/lib/client/format";
import type { Action } from "@/lib/domain/actions";
import { nowISO } from "@/lib/domain/ids";
import type { Account, RunSummary, Signal, Workspace } from "@/lib/domain/types";
import { ease, spring } from "@/lib/motion";
import { BetDocument } from "./bet-document";
import { PendingRow } from "./reading-ledger";
import { rankAccounts, runSummary } from "./shared";
import { KnownUsers } from "./known-users";

const AGREEMENT = [
  "I draft. You decide, and you send.",
  "Every fact links to its source. If I’m guessing, I’ll say so.",
  "About 25 excellent first touches a week, not 2,000. Warm intros first.",
  "I’m an AI, and I’ll never pretend to be you.",
];

/** The freshest strong signal is the reason to talk now. */
function topSignal(a: Account): Signal | undefined {
  return [...a.signals].filter((s) => s.usableInOutreach !== false).sort((x, y) => y.strength - x.strength || y.date.localeCompare(x.date))[0];
}

function AccountRow({ a, i, talkTo, showWarm }: { a: Account; i: number; talkTo?: string; showWarm: boolean }) {
  const sig = topSignal(a);
  const why = a.whyNow ?? sig?.headline ?? a.oneLiner;
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: ease.out }}
      className="flex gap-3 py-3.5"
    >
      <span className="w-3 shrink-0 pt-0.5 font-mono text-[12px] text-fg-3">{i + 1}</span>
      <Favicon domain={a.domain} name={a.name} size={20} className="mt-px" />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[14px] font-medium text-fg">{a.name}</span>
          <span className="truncate font-mono text-[11.5px] text-fg-3">{a.domain}</span>
        </p>
        {why && (
          <p className="mt-0.5 text-pretty text-[13.5px] leading-5 text-fg-2">
            {why}
            {sig?.url && (
              <>
                {" "}
                <SourceChip url={sig.url} publishedAt={sig.date} claim={sig.headline} />
              </>
            )}
          </p>
        )}
        {(talkTo || (showWarm && a.warmPathCount > 0)) && (
          <p className="mt-1 text-[12.5px] text-fg-3">
            {talkTo && <>Talk to: {talkTo}</>}
            {talkTo && showWarm && a.warmPathCount > 0 && " · "}
            {showWarm && a.warmPathCount > 0 && `${a.warmPathCount} ${a.warmPathCount === 1 ? "person" : "people"} you know`}
          </p>
        )}
      </div>
    </motion.li>
  );
}

function receiptLine(run: RunState | undefined, summary: RunSummary | undefined): string | null {
  const r = summary?.receipt;
  if (r) return [`Worked for ${duration(r.durationMs)}`, r.sources ? `${r.sources} sources` : null, usd(r.costUsd)].filter(Boolean).join(" · ");
  if (run?.endedAt) return [`Worked for ${duration(run.endedAt - run.startedAt)}`, run.costUsd !== undefined ? usd(run.costUsd) : null].filter(Boolean).join(" · ");
  return null;
}

/**
 * "Here's who I'd talk to first": the bet in one sentence, the first companies as discovery lands them, the working
 * agreement, and one action. Research starts dossiers for these accounts and opens Today.
 */
export function FirstThree({ ws, onLeave }: { ws: Workspace; onLeave: () => void }) {
  const { runs, start } = useRuns();
  const { dispatch } = useWorkspace();
  const router = useRouter();
  const o = ws.onboarding;
  const f = ws.foundation;
  const [name, setName] = useState(ws.founder.name ?? "");
  const [title, setTitle] = useState(ws.founder.title ?? "");
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [showBet, setShowBet] = useState(false);
  const [finding, setFinding] = useState(false);

  const dId = o.discoveryRunId;
  const dLive = dId ? runs[dId] : undefined;
  const dSummary = runSummary(ws, dId);
  const dStatus = dLive?.status ?? dSummary?.status;
  const dStarted = dLive?.startedAt ?? (dSummary ? Date.parse(dSummary.startedAt) : undefined);
  const searching = dStatus === "running" || dStatus === "queued";
  const dError = dStatus === "error" ? (dLive?.error?.message ?? dSummary?.error?.message ?? "Something went wrong.") : null;
  const found =
    dStarted === undefined
      ? []
      : rankAccounts(
          Object.values(ws.accounts).filter(
            // A list dropped in while reading adds companies too; only the ones discovery gave a reason to talk count here. Never pad.
            (a) => Date.parse(a.addedAt) >= dStarted - 2000 && a.status !== "disqualified" && a.domain !== ws.company?.domain && !(a.source === "csv_import" && !a.whyNow && !a.signals.length),
          ),
        ).slice(0, 3);
  const lastStep = dLive?.steps[dLive.steps.length - 1];
  const champion = f?.personas.find((p) => p.role === "champion") ?? f?.personas[0];
  const talkTo = champion?.titles[0];
  const showWarm = !!ws.network;
  const fRun = o.runId ? runs[o.runId] : undefined;
  const receipt = receiptLine(fRun, runSummary(ws, o.runId));
  const provenance = f?.provenance?.icp?.label ?? "From your site · 0 conversations confirm this";

  // A list dropped in while reading couldn't be screened before the bet existed. Now it does: screen it once,
  // so the card can say how many of the founder's connections sit at companies that fit.
  const net = ws.network;
  const netRun = Object.values(runs).find((r) => r.workflow === "network" && (r.status === "running" || r.status === "queued"));
  const screenStarted = useRef(false);
  useEffect(() => {
    if (screenStarted.current || !net || net.screenedAt || !f?.icp.criteria.length || netRun) return;
    screenStarted.current = true;
    void start("network", { reason: "import" }, { notify: false });
  }, [net, f, netRun, start]);

  const findCompanies = async (widen = false) => {
    if (finding) return;
    setFinding(true);
    // Discovery screens against the saved ICP criteria; a brief becomes one more must-have, so send
    // one only before the ICP exists. Widening uses the full lane (more sources, more searches).
    const brief = f?.icp?.criteria.length ? undefined : ws.company?.whoItsFor?.slice(0, 300);
    const seeds = (o.answers?.last3 ?? "").match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi) ?? [];
    const run = await start("discovery", { count: 3, source: widen ? "manual" : "onboarding", brief, seedDomains: seeds.length ? seeds.slice(0, 10) : undefined }, { notify: false });
    if (run) await dispatch({ type: "onboarding.update", patch: { discoveryRunId: run.id } });
    setFinding(false);
  };

  const hire = async (to: string, research: Account[]) => {
    if (busy) return;
    setBusy(true);
    onLeave();
    // The founder can open the workspace immediately; the first search continues in the background.
    if (to === "/today" && !dId) await findCompanies();
    const ids: string[] = [];
    for (const a of research) {
      const r = await start("dossier", { domain: a.domain }, { notify: false });
      if (r) ids.push(r.id);
    }
    // "10 more prospects" in the background (SPEC §3.1): queued behind the dossiers, it lands in Later on Today.
    if (research.length) await start("discovery", { count: 10, source: "weekly" }, { notify: false });
    const actions: Action[] = [];
    if (name.trim() !== (ws.founder.name ?? "") || title.trim() !== (ws.founder.title ?? "")) {
      actions.push({ type: "founder.update", patch: { name: name.trim(), title: title.trim() || undefined } });
    }
    for (const a of research) if (!a.watch) actions.push({ type: "account.track", domain: a.domain, watch: true });
    // Today keeps a card for each of these until the first note goes, whatever their signals say.
    actions.push({ type: "onboarding.update", patch: { status: "hired", hiredAt: nowISO(), dossierRunIds: ids, firstThree: research.map((a) => a.domain) } });
    if (!(await dispatch(actions))) {
      setBusy(false);
      return;
    }
    // On a phone the offer card is long and its button at the bottom: the orb at the top is off screen, so
    // its flight into the header wouldn't play (a shared transition needs both ends in view), and Today
    // would open scrolled down. Back to the top first.
    await scrollToTop();
    setLeaving(true);
    setTimeout(() => router.push(to), 180);
  };

  const n = found.length;
  const empty = n === 0 && !searching;
  const idle = empty && (!dId || dStatus === "stopped");
  const cta = n > 0 ? "Start my workflow" : "Go to Today";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void hire("/today", found);
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.99 }}
        animate={leaving ? { opacity: 0, scale: 0.96, y: 0 } : { opacity: 1, y: 0, scale: 1 }}
        transition={leaving ? { duration: 0.18, ease: ease.inQuad } : spring.smooth}
        className="rounded-xl bg-surface p-5 shadow-md ring-1 ring-border sm:p-8"
      >
        <h1 className="text-balance font-serif text-[28px] leading-[34px] tracking-[-0.01em] text-fg sm:text-[30px] sm:leading-[36px]">
          {!empty
            ? "Here’s who I’d talk to first"
            : dError
              ? "I couldn’t finish the search"
              : idle
                ? "Next: your first three companies"
                : "Your GTM plan is ready"}
        </h1>

        {f?.icp.hypothesis.sentence && (
          <div className="mt-4">
            <p className="prose-agent text-pretty">
              <span className="text-fg-3">Your starting plan: </span>
              {f.icp.hypothesis.sentence}
            </p>
            <p className="mt-2 font-mono text-[11px] leading-4 text-fg-3">
              {provenance}
            </p>
          </div>
        )}

        <KnownUsers ws={ws} />

        <ol className="mt-6 divide-y divide-border border-y border-border" aria-label="Companies to talk to first" aria-live="polite">
          <AnimatePresence initial={false}>
            {found.map((a, i) => (
              <AccountRow key={a.domain} a={a} i={i} talkTo={talkTo} showWarm={showWarm} />
            ))}
          </AnimatePresence>
          {searching && (
            <li className="py-3">
              <ul>
                <PendingRow
                  verb={n === 0 ? "Finding companies with a dated reason to talk" : `${3 - n} more landing`}
                  detail={lastStep && lastStep.kind !== "status" ? lastStep.text.slice(0, 60) : undefined}
                />
              </ul>
            </li>
          )}
          {!searching && n === 0 && (
            <li className="py-4">
              {dError ? (
                <>
                  <p className="text-pretty text-[13.5px] leading-5 text-fg-2">{dError}</p>
                  <Button className="mt-3" variant="secondary" size="sm" onClick={() => void findCompanies()}>
                    Try again
                  </Button>
                </>
              ) : idle ? (
                <p className="text-pretty text-[13.5px] leading-5 text-fg-2">
                  Open Today to find your first prospects and review your next actions.
                </p>
              ) : (
                <>
                  <p className="text-pretty text-[13.5px] leading-5 text-fg-2">
                    {(dLive?.result as { note?: string } | undefined)?.note ??
                      "No matches in the sources checked. Try a broader search or import people you already know."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => void findCompanies(true)}>
                      Look in more places
                    </Button>
                    {/* A list dropped while reading is already in: start from it on Today rather than ask for it again. */}
                    <Button variant="ghost" size="sm" className="h-auto min-h-7 whitespace-normal py-1 text-left" onClick={() => void hire(net ? "/today" : "/integrations?import=linkedin", [])}>
                      {net ? "Use my network" : "Import LinkedIn connections"}
                    </Button>
                  </div>
                </>
              )}
            </li>
          )}
        </ol>

        {net && (
          <div className="mt-3" aria-live="polite">
            {netRun ? (
              <ul>
                <PendingRow verb={`Matching your ${net.total.toLocaleString("en-US")} connections against the bet`} />
              </ul>
            ) : (
              <p className="flex gap-2 text-pretty text-[13px] leading-5 text-fg-2">
                <Users className="mt-0.5 size-3.5 shrink-0 text-fg-3" aria-hidden />
                {net.screenedAt && net.line ? net.line : `${net.total.toLocaleString("en-US")} connections in. I'll match them against the bet on Today.`}
              </p>
            )}
          </div>
        )}

        <details className="mt-5 text-[13px] text-fg-3">
          <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">How Inroad works</summary>
          <ul className="mt-3 space-y-1.5">
            {AGREEMENT.map((line) => (
              <li key={line} className="flex gap-2.5 text-pretty text-[13.5px] leading-5 text-fg-2">
                <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-fg-4" />
                {line}
              </li>
            ))}
          </ul>
        </details>

        <form onSubmit={submit} className="mt-7">
          <Label htmlFor="founder-name" hint="optional">Your name</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="founder-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
              maxLength={80}
              className="h-9 text-[16px] sm:flex-1 sm:text-[13.5px]"
            />
            <Input
              aria-label="Your title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (optional)"
              autoComplete="organization-title"
              maxLength={80}
              className="h-9 text-[16px] sm:w-48 sm:text-[13.5px]"
            />
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Button
              type="submit"
              variant="agent"
              size="lg"
              loading={busy}
            >
              {cta}
            </Button>
            <button
              type="button"
              onClick={() => void hire("/playbook", [])}
              disabled={busy}
              className="rounded-xs text-[13px] text-fg-2 underline-offset-4 transition-colors duration-150 hover:text-fg hover:underline disabled:opacity-50"
            >
              Edit plan
            </button>
          </div>
          <p className="mt-3 text-pretty text-[12px] leading-[18px] text-fg-3">
            {n > 0 ? "Research runs in the background. Review your outreach drafts on Today." : searching ? "The search will keep running. Your next actions appear on Today." : "Start with your daily actions. You can add prospects or import a list any time."}
          </p>
        </form>
      </motion.div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 px-1">
        {receipt ? <span className="font-mono text-[11.5px] text-fg-3">{receipt}</span> : <span />}
        {f && (
          <button
            type="button"
            onClick={() => setShowBet((v) => !v)}
            aria-expanded={showBet}
            className="inline-flex items-center gap-1 rounded-xs text-[12.5px] text-fg-3 transition-colors hover:text-fg-2"
          >
            {showBet ? "Hide GTM plan" : "View full GTM plan"}
            <ChevronDown className={`size-3.5 transition-transform duration-200 ${showBet ? "rotate-180" : ""}`} aria-hidden />
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {showBet && (
          <motion.div key="bet" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} className="mt-4">
            <BetDocument ws={ws} live={false} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** Narrow screens only: scrolls to the top (smoothly, unless reduced motion) and resolves once it's there. */
async function scrollToTop() {
  if (window.scrollY === 0 || window.matchMedia("(min-width: 768px)").matches) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduce ? "instant" : "smooth" });
  const until = Date.now() + 800;
  while (window.scrollY > 0 && Date.now() < until) await new Promise((r) => requestAnimationFrame(r));
  if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: "instant" });
}
