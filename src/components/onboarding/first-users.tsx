"use client";

import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/field";
import { SourceChip } from "@/components/ui/source";
import { PARTNER_KIND_LABELS, PLATFORM_LABELS } from "@/lib/consumer/partners";
import { growthDefaults } from "@/lib/consumer/plan";
import type { Action } from "@/lib/domain/actions";
import { nowISO } from "@/lib/domain/ids";
import type { Partner, Workspace } from "@/lib/domain/types";
import { ease, spring } from "@/lib/motion";
import { BetDocument } from "./bet-document";
import { PendingRow } from "./reading-ledger";
import { runSummary } from "./shared";

const AGREEMENT = [
  "I draft. You decide, and you post or send.",
  "Every fact links to its source. If I’m guessing, I’ll say so.",
  "Retention before reach: I’ll hold you off paid ads until users come back.",
  "Paid or gifted posts say #ad. Reviews are never bought or steered.",
  "I’m an AI, and I’ll never pretend to be you.",
];

function PartnerRow({ p, i }: { p: Partner; i: number }) {
  return (
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: ease.out }} className="flex gap-3 py-3.5">
      <span className="w-3 shrink-0 pt-0.5 font-mono text-[12px] text-fg-3">{i + 1}</span>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="truncate text-[14px] font-medium text-fg">{p.name}</span>
          <span className="truncate font-mono text-[11.5px] text-fg-3">
            {[PARTNER_KIND_LABELS[p.kind], p.platform ? PLATFORM_LABELS[p.platform] : null, p.handle].filter(Boolean).join(" · ")}
          </span>
        </p>
        <p className="mt-0.5 text-pretty text-[13.5px] leading-5 text-fg-2">
          {p.fit}
          {p.sourceUrl && (
            <>
              {" "}
              <SourceChip url={p.sourceUrl} claim={p.fit} />
            </>
          )}
        </p>
      </div>
    </motion.li>
  );
}

/**
 * The consumer offer step: the audience bet, the creators and communities found where the segments gather, where the
 * first 100 users come from, and one action. Mirrors FirstThree; nothing is contacted until the founder sends it.
 */
export function FirstUsers({ ws, onLeave }: { ws: Workspace; onLeave: () => void }) {
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
  const searching = dStatus === "running" || dStatus === "queued";
  const dError = dStatus === "error" ? (dLive?.error?.message ?? dSummary?.error?.message ?? "Something went wrong.") : null;
  const found = Object.values(ws.partners ?? {})
    .filter((p) => p.stage === "shortlist")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, 6);
  const lastStep = dLive?.steps[dLive.steps.length - 1];
  const firstHundred = growthDefaults(ws).firstHundred;
  const provenance = f?.provenance?.icp?.label ?? "From your site · 0 users confirm this";

  const find = async () => {
    if (finding) return;
    setFinding(true);
    const run = await start("partners", { mode: "find", count: 6, source: "onboarding" }, { notify: false });
    if (run) await dispatch({ type: "onboarding.update", patch: { discoveryRunId: run.id } });
    setFinding(false);
  };

  const hire = async (to: string) => {
    if (busy) return;
    setBusy(true);
    onLeave();
    if (to === "/today" && !dId) await find();
    const actions: Action[] = [];
    if (name.trim() !== (ws.founder.name ?? "") || title.trim() !== (ws.founder.title ?? "")) {
      actions.push({ type: "founder.update", patch: { name: name.trim(), title: title.trim() || undefined } });
    }
    actions.push({ type: "onboarding.update", patch: { status: "hired", hiredAt: nowISO() } });
    if (!(await dispatch(actions))) {
      setBusy(false);
      return;
    }
    setLeaving(true);
    setTimeout(() => router.push(to), 180);
  };

  const n = found.length;
  const idle = n === 0 && !searching && (!dId || dStatus === "stopped");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void hire("/today");
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
          {n > 0 || searching ? "Here’s where your first users are" : dError ? "I couldn’t finish the search" : idle ? "Next: where your first users gather" : "I didn’t find anyone I could verify"}
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

        <ol className="mt-6 divide-y divide-border border-y border-border" aria-label="Creators and communities to start with" aria-live="polite">
          <AnimatePresence initial={false}>
            {found.map((p, i) => (
              <PartnerRow key={p.id} p={p} i={i} />
            ))}
          </AnimatePresence>
          {searching && (
            <li className="py-3">
              <ul>
                <PendingRow verb={n === 0 ? "Looking where your users already gather" : "More landing"} detail={lastStep && lastStep.kind !== "status" ? lastStep.text.slice(0, 60) : undefined} />
              </ul>
            </li>
          )}
          {!searching && n === 0 && (
            <li className="py-4">
              <p className="text-pretty text-[13.5px] leading-5 text-fg-2">
                {dError ?? (idle ? "I haven’t looked yet. I’ll find creators and communities whose audience is your segment." : "Nothing I found had a link I could check. Try again, or add the places you already know.")}
              </p>
              <Button className="mt-3" variant="secondary" size="sm" onClick={() => void find()} loading={finding}>
                {idle ? "Find them" : "Try again"}
              </Button>
            </li>
          )}
        </ol>

        {firstHundred.length > 0 && (
          <div className="mt-6">
            <SectionLabel>Where the first 100 come from</SectionLabel>
            <ul className="space-y-1.5">
              {firstHundred.map((line) => (
                <li key={line} className="flex gap-2.5 text-pretty text-[13.5px] leading-5 text-fg-2">
                  <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-fg-4" />
                  {line}
                </li>
              ))}
            </ul>
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
            <Input id="founder-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" maxLength={80} className="h-9 text-[16px] sm:flex-1 sm:text-[13.5px]" />
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
            <Button type="submit" variant="agent" size="lg" loading={busy}>
              {n > 0 ? "Start my workflow" : "Go to Today"}
            </Button>
            <button
              type="button"
              onClick={() => void hire("/playbook")}
              disabled={busy}
              className="rounded-xs text-[13px] text-fg-2 underline-offset-4 transition-colors duration-150 hover:text-fg hover:underline disabled:opacity-50"
            >
              Edit plan
            </button>
          </div>
          <p className="mt-3 text-pretty text-[12px] leading-[18px] text-fg-3">
            {searching ? "The search will keep running. Your next actions appear on Today." : "Review your growth actions and outreach drafts on Today."}
          </p>
        </form>
      </motion.div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 px-1">
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
