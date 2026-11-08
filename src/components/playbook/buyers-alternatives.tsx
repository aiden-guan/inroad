"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAsk } from "@/components/providers/ask-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { QuoteRow } from "@/components/voice/parts";
import { cn } from "@/lib/client/cn";
import { money } from "@/lib/client/format";
import { navigateToHash } from "@/lib/client/location-hash";
import { STAGE_LABELS } from "@/lib/domain/types";
import { ease } from "@/lib/motion";
import { plural } from "@/lib/moves/util";
import { heardIn } from "@/lib/voice";
import { askAboutAlternative } from "@/lib/voice/use";
import type { AlternativeKind, VoiceAlternative } from "@/lib/voice/types";
import { BattlecardBlock } from "./buyers-battlecard";
import { RovingList, setParams, themeDomId, useArrival } from "./buyers-shared";
import { usePlaybook } from "./context";
import { FieldLabel, Sub } from "./ui";

/**
 * Competitors and alternatives, counted in code: every vendor the playbook names, tool names buyers used that it
 * doesn't, and the alternatives every deal has (spreadsheets, building it, hiring, doing nothing). Each shows the
 * conversations and deals where it came up, how those deals went, the answer on file, and a battlecard to draft.
 */

const KIND: Record<AlternativeKind, string> = { competitor: "Vendor", status_quo: "Status quo", in_house: "Build in-house", hire: "Hire", nothing: "No decision" };

export function BuyerAlternatives() {
  const { voice } = usePlaybook();
  const params = useSearchParams();
  const openKey = params.get("alt");
  useArrival(openKey);
  const heard = voice.alternatives.filter((a) => heardIn(a) > 0 || a.deals > 0);
  const quiet = voice.alternatives.filter((a) => heardIn(a) === 0 && a.deals === 0);
  if (!heard.length && !quiet.length) return null;
  return (
    <Sub
      id="buyer-alternatives"
      title="Competitors and alternatives"
      hint="What buyers compare you with, in their words. A lost deal counts against one when its loss reason on file names it, even without a quote."
    >
      {heard.length > 0 && (
        <RovingList>
          {heard.map((a) => (
            <AltRow key={a.key} a={a} open={openKey === a.key} onToggle={() => setParams(params, { alt: openKey === a.key ? null : a.key })} />
          ))}
        </RovingList>
      )}
      {quiet.length > 0 && (
        <p className="mt-3 text-[12.5px] leading-5 text-fg-3">
          In your playbook but not heard on a call yet: {quiet.map((a) => a.name).join(", ")}.
        </p>
      )}
    </Sub>
  );
}

function Record({ a }: { a: VoiceAlternative }) {
  const r = a.record;
  return (
    <span className="font-mono text-[12px] tnum text-fg-2">
      won {r.won} · lost {r.lost} · open {r.open}
    </span>
  );
}

function AnswerChip({ a }: { a: VoiceAlternative }) {
  if (!a.response) return <Badge tone={heardIn(a) >= 2 ? "warning" : "neutral"}>No answer yet</Badge>;
  return a.response.approved ? <Badge tone="success">Answer approved</Badge> : <Badge tone="outline">Draft answer</Badge>;
}

function AltRow({ a, open, onToggle }: { a: VoiceAlternative; open: boolean; onToggle: () => void }) {
  const n = heardIn(a);
  const preview = a.snippets.find((s) => s.verbatim) ?? a.snippets[0];
  return (
    <li id={themeDomId(a.key)} className={cn("scroll-mt-28 rounded-lg bg-surface ring-1 ring-border transition-shadow duration-150", open && "shadow-sm ring-border-strong")}>
      <button type="button" data-row aria-expanded={open} onClick={onToggle} className="flex w-full items-start gap-3 rounded-lg px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
        <ChevronRight aria-hidden className={cn("mt-1 size-3.5 shrink-0 text-fg-4 transition-transform duration-150", open && "rotate-90")} />
        {a.domain ? <Favicon domain={a.domain} name={a.name} size={18} className="mt-px" /> : <span aria-hidden className="mt-px inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] bg-bg-subtle font-mono text-[12px] text-fg-3 ring-1 ring-border">{a.name.charAt(0)}</span>}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[14.5px] font-medium leading-[21px] text-fg [overflow-wrap:anywhere]">{a.name}</span>
            {!a.inPlaybook && <Badge tone="agent">Not in your playbook</Badge>}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-fg-3">
            <span>{KIND[a.kind]}</span>
            <span className="font-mono tnum text-fg-2">
              {n ? plural(n, "conversation") : "no quotes"} · {plural(a.deals, "deal")}
            </span>
            {a.deals > 0 && <Record a={a} />}
          </span>
          {!open && preview && (
            <span className={cn("mt-1.5 line-clamp-1 text-[13.5px] leading-[20px] [overflow-wrap:anywhere]", preview.verbatim ? "font-serif italic text-fg-2" : "text-fg-3")}>
              {preview.verbatim ? `“${preview.text}”` : preview.text}
            </span>
          )}
        </span>
        <span className="hidden shrink-0 sm:block">
          <AnswerChip a={a} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.2, ease: ease.out }} className="overflow-hidden">
            <AltDetail a={a} />
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

const OUTCOME_TONE = { won: "text-success", lost: "text-danger", open: "text-fg-2", nurture: "text-fg-3" } as const;

function AltDetail({ a }: { a: VoiceAlternative }) {
  const { openAsk } = useAsk();
  const competitor = a.competitorIndex !== undefined;
  return (
    <div className="border-t border-border px-4 pb-4 pt-3 sm:pl-10">
      <div className="mb-2 sm:hidden">
        <AnswerChip a={a} />
      </div>
      {a.dealRows.length > 0 && (
        <div>
          <FieldLabel>Deals where it came up</FieldLabel>
          <ul className="divide-y divide-border rounded-md ring-1 ring-border">
            {a.dealRows.map((d) => (
              <li key={d.dealId}>
                <Link href={`/companies?c=${encodeURIComponent(d.domain)}`} className="flex min-w-0 items-center gap-2.5 px-3 py-2 text-[13px] transition-colors hover:bg-bg-subtle/60">
                  <Favicon domain={d.domain} name={d.name} size={16} />
                  <span className="min-w-0 flex-1 truncate text-fg">{d.name}</span>
                  {d.amountUsd !== undefined && <span className="shrink-0 font-mono text-[12px] tnum text-fg-3">{money(d.amountUsd)}</span>}
                  <span className={cn("shrink-0 text-[12px] font-medium", OUTCOME_TONE[d.outcome])}>
                    {d.outcome === "open" ? STAGE_LABELS[d.stage] : d.outcome === "won" ? "Won" : d.outcome === "lost" ? "Lost" : "Nurture"}
                    {d.lostTo && <span className="font-normal text-fg-3"> · reason on file</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {a.record.won + a.record.lost > 0 && a.record.won + a.record.lost < 10 && (
            <p className="mt-1 text-[12px] text-fg-3">
              {plural(a.record.won + a.record.lost, "decided deal")}: too few to call a win rate against it.
            </p>
          )}
        </div>
      )}
      {a.snippets.length > 0 && (
        <div className="mt-3">
          <FieldLabel>What buyers said</FieldLabel>
          <ul className="divide-y divide-border">
            {a.snippets.slice(0, 6).map((s) => (
              <QuoteRow key={s.id} s={s} />
            ))}
          </ul>
          {a.snippets.length > 6 && <p className="mt-1 text-[12px] text-fg-3">{plural(a.snippets.length - 6, "more quote")} under Every quote.</p>}
        </div>
      )}
      {a.response && (
        <p className="mt-3 text-[13px] leading-5 text-fg-2">
          <span className="text-fg-3">{a.response.approved ? "Your approved answer: " : "Draft answer on file: "}</span>
          {a.response.text || "No response written yet."}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" icon={<MessageCircle className="size-3.5" />} onClick={() => openAsk({ context: { kind: "playbook", id: "competitors" }, prefill: askAboutAlternative(a) })}>
          Ask about this
        </Button>
        {competitor && (
          <button type="button" onClick={() => navigateToHash("competitors")} className="rounded-xs text-[12.5px] text-fg-3 underline-offset-2 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
            Its entry under Why us → Competitors
          </button>
        )}
      </div>
      {a.snippets.length > 0 && <BattlecardBlock subjectKey={a.key} label="Draft a battlecard" hasAnswer={!!a.response?.approved} />}
    </div>
  );
}
