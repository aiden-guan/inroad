"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { GrowthLogForm, PmfSurveyForm, VerdictList } from "@/components/consumer/growth-ui";
import { PartnerCard } from "@/components/partners/partner-card";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { CopyButton } from "@/components/ui/misc";
import { readGrowth } from "@/lib/consumer/growth";
import { INTERVIEW_QUESTIONS, interviewInvite, referralAsk } from "@/lib/consumer/partners";
import { newId, nowISO } from "@/lib/domain/ids";
import type { Move, Workspace } from "@/lib/domain/types";
import { RunInline } from "./parts";
import { ReviewBody } from "./review-panel";

/** The rules this file renders; move-body.tsx hands them over. */
export const CONSUMER_RULES = new Set([
  "growth_log",
  "paid_hold",
  "growth_focus",
  "review_growth",
  "user_talks",
  "experiment_readout",
  "referral_ask",
  "pmf_survey",
  "partner_find",
  "partner_draft",
  "partner_send",
  "partner_follow_up",
  "partner_reply",
  "partner_brief",
  "partner_disclosure",
  "partner_results",
  "partner_let_go",
]);

interface Props {
  rule: string;
  move: Move;
  ws: Workspace;
  today: string;
  weekStart: string;
  onComplete: () => void;
  onChanged: () => void;
}

function Lead({ children }: { children: ReactNode }) {
  return <p className="max-w-[62ch] text-[13.5px] leading-[21px] text-fg-2">{children}</p>;
}

function Open({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex h-8 items-center gap-2 rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-fg shadow-btn hover:bg-primary-hover active:scale-[0.97]">
      {children} <ArrowUpRight className="size-3.5 opacity-70" />
    </Link>
  );
}

export function ConsumerMoveBody({ rule, move, ws, today, weekStart, onComplete, onChanged }: Props) {
  const { dispatch } = useWorkspace();
  const g = readGrowth(ws, today);

  if (rule.startsWith("partner_") && rule !== "partner_find") {
    const p = move.subjectIds?.[0] ? ws.partners?.[move.subjectIds[0]] : undefined;
    if (!p) return <Lead>They were removed from your list.</Lead>;
    if (rule === "partner_let_go") {
      return (
        <div className="space-y-3">
          <Lead>Two weeks since the follow-up and no answer. Let {p.name} go; a third note costs more goodwill than it earns.</Lead>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={async () => {
                if (await dispatch({ type: "partner.setStage", id: p.id, stage: "passed", at: nowISO() })) onComplete();
              }}
            >
              Let them go
            </Button>
            <Button variant="ghost" onClick={onComplete}>
              Keep waiting
            </Button>
          </div>
        </div>
      );
    }
    return <PartnerCard p={p} today={today} focused />;
  }

  switch (rule) {
    case "growth_log":
      return (
        <div className="space-y-3">
          <Lead>Two minutes. I read them in code: what&apos;s leaking, whether paid can wait, and what to test next.</Lead>
          <GrowthLogForm
            ws={ws}
            today={today}
            compact
            onSaved={() => {
              onChanged();
              onComplete();
            }}
          />
        </div>
      );
    case "paid_hold":
    case "growth_focus": {
      const shown = rule === "paid_hold" ? g.verdicts.filter((v) => v.id === "paid_before_retention") : g.verdicts.filter((v) => v.stage === g.focus && v.severity !== "info");
      return (
        <div className="space-y-3">
          <VerdictList verdicts={shown} />
          <div className="flex flex-wrap gap-2">
            <Open href="/playbook#numbers">See the numbers</Open>
            <Button variant="ghost" onClick={onComplete}>
              Got it
            </Button>
          </div>
        </div>
      );
    }
    case "review_growth":
      return <ReviewBody ws={ws} kind="growth" weekStart={weekStart} />;
    case "user_talks":
      return <UserTalks ws={ws} onChanged={onChanged} />;
    case "experiment_readout": {
      const e = move.subjectIds?.[0] ? ws.experiments?.[move.subjectIds[0]] : undefined;
      if (!e) return <Lead>This experiment was removed.</Lead>;
      return <Readout id={e.id} hypothesis={e.hypothesis} metric={e.metric} onDone={onComplete} />;
    }
    case "referral_ask": {
      const text = referralAsk({ founderName: ws.founder.name, product: ws.company?.name ?? "the product" });
      return (
        <div className="space-y-3">
          <Lead>Users stay, so the ask is earned. Send this to people who reached the first win, one at a time. Never reward a review or a rating.</Lead>
          <pre className="whitespace-pre-wrap rounded-md bg-surface px-3 py-2.5 font-sans text-[13.5px] leading-[21px] text-fg ring-1 ring-border">{text}</pre>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={text} label="Copy" />
            <Open href={`/playbook?new=referral_program#assets`}>Write the referral program</Open>
            <Button variant="ghost" onClick={onComplete}>
              Done
            </Button>
          </div>
        </div>
      );
    }
    case "pmf_survey":
      return (
        <div className="space-y-3">
          <Lead>
            Ask it in the product or by email, only to people who used it at least twice in the last two weeks. Then look at who said &ldquo;very disappointed&rdquo;: what do they have in common?
          </Lead>
          <PmfSurveyForm
            onSaved={() => {
              onChanged();
              onComplete();
            }}
          />
        </div>
      );
    case "partner_find":
      return (
        <div className="space-y-3">
          <Lead>I&apos;ll look where your segments gather: creators they watch, communities where they ask for help, newsletters and podcasts. Only links I can show you.</Lead>
          <RunInline workflow="partners" args={{ mode: "find", count: 8, source: "weekly" }} runRef={{ kind: "playbook", id: "partners" }} label="Find creators and communities" onResult={onChanged} hint="Up to 5 web searches · about $0.10" />
        </div>
      );
  }
  return null;
}

function UserTalks({ ws, onChanged }: { ws: Workspace; onChanged: () => void }) {
  const { dispatch } = useWorkspace();
  const invite = interviewInvite({ founderName: ws.founder.name, product: ws.company?.name ?? "the product" });
  const [who, setWho] = useState("");
  const [notes, setNotes] = useState("");
  const log = async () => {
    if (!who.trim()) return;
    const ok = await dispatch({
      type: "activity.log",
      activity: { id: newId("act"), at: nowISO(), kind: "user_conversation", summary: `Talked to ${who.trim()}`, body: notes.trim() || undefined, channel: "phone", source: "founder" },
    });
    if (ok) {
      setWho("");
      setNotes("");
      onChanged();
    }
  };
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Lead>Invite recent signups, your most active users and people who stopped. Fifteen minutes about what they did, not what they&apos;d do.</Lead>
        <pre className="whitespace-pre-wrap rounded-md bg-surface px-3 py-2.5 font-sans text-[13.5px] leading-[21px] text-fg ring-1 ring-border">
          {invite.subject}
          {"\n\n"}
          {invite.body}
        </pre>
        <CopyButton text={`${invite.subject}\n\n${invite.body}`} label="Copy the invite" />
      </div>
      <div>
        <p className="mb-1 text-[12px] font-medium text-fg-2">Ask about the past</p>
        <ul className="space-y-0.5">
          {INTERVIEW_QUESTIONS.slice(0, 4).map((q) => (
            <li key={q} className="text-[13px] leading-5 text-fg-2">
              {q}
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-[12px] font-medium text-fg-2">Log a conversation</p>
        <Input aria-label="Who you talked to" value={who} onChange={(e) => setWho(e.target.value)} placeholder="Maya, a new user from TikTok" maxLength={80} className="text-[16px] sm:text-[13px]" />
        <Textarea aria-label="What you learned" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Their words for the problem, what they used before, where they got stuck" maxLength={2000} className="min-h-20 text-[16px] sm:text-[13.5px]" />
        <Button size="sm" variant="primary" disabled={!who.trim()} onClick={() => void log()}>
          Log it
        </Button>
      </div>
    </div>
  );
}

function Readout({ id, hypothesis, metric, onDone }: { id: string; hypothesis: string; metric: string; onDone: () => void }) {
  const { dispatch } = useWorkspace();
  const [result, setResult] = useState("");
  const decide = async (status: "won" | "lost" | "inconclusive") => {
    if (await dispatch({ type: "experiment.update", id, patch: { status, result: result.trim() || undefined }, at: nowISO() })) onDone();
  };
  return (
    <div className="space-y-3">
      <p className="font-serif text-[17px] leading-[26px] text-fg">{hypothesis}</p>
      {metric && <Lead>Measure: {metric}. Compare the same weeks before and after; a small sample is a hint, not a winner.</Lead>}
      <Input aria-label="What happened" value={result} onChange={(e) => setResult(e.target.value)} placeholder="What happened, in one line" maxLength={200} className="text-[16px] sm:text-[13px]" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void decide("won")}>
          It worked
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void decide("lost")}>
          It didn&apos;t
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void decide("inconclusive")}>
          Can&apos;t tell
        </Button>
      </div>
    </div>
  );
}
