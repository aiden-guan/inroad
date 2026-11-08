"use client";

import { Check, Swords } from "lucide-react";
import { RunInline } from "@/components/today/parts";
import { AiBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QuoteRow } from "@/components/voice/parts";
import { shortDate, usd } from "@/lib/client/format";
import { navigateToHash } from "@/lib/client/location-hash";
import { nowISO } from "@/lib/domain/ids";
import { plural } from "@/lib/moves/util";
import { saveBattlecard } from "@/lib/voice/battlecard";
import type { VoiceBattlecard, VoiceSnippet } from "@/lib/voice/types";
import { usePlaybook } from "./context";
import { DraftLabel, FieldLabel, undoable } from "./ui";

/**
 * A battlecard for one alternative or recurring objection: drafted by the model from the quotes and approved claims
 * only, shown here with what it rests on, and saved by the founder into Objections (and the competitor's entry)
 * through ordinary actions. Nothing is saved until they say so; every save and dismissal can be undone.
 */

const runRef = (key: string) => ({ kind: "playbook" as const, id: `buyers:${key}` });

export function BattlecardBlock({ subjectKey, label, hasAnswer }: { subjectKey: string; label: string; hasAnswer: boolean }) {
  const { ws } = usePlaybook();
  const card = ws.buyerVoice?.battlecards?.[subjectKey];
  const live = card && !card.dismissedAt ? card : undefined;
  return (
    <div className="mt-4">
      {live && <BattlecardDraft card={live} />}
      <div className={live ? "mt-3" : undefined}>
        <RunInline
          workflow="buyer_voice"
          args={{ mode: "battlecard", key: subjectKey }}
          runRef={runRef(subjectKey)}
          label={live ? "Draft it again" : hasAnswer ? `Redraft the answer from these quotes` : label}
          variant={live || hasAnswer ? "secondary" : "agent"}
          icon={<Swords className="size-3.5" />}
          hint="About 20 seconds · about $0.03 · only from these quotes and your approved claims"
        />
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-4">
      <dt className="pt-0.5 text-[12px] font-medium text-fg-3">{label}</dt>
      <dd className="text-[14px] leading-[21px] text-fg [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function BattlecardDraft({ card }: { card: VoiceBattlecard }) {
  const { ws, dispatch, voice } = usePlaybook();
  const quotes = card.quoteIds.map((id) => voice.snippets.find((s) => s.id === id)).filter((s): s is VoiceSnippet => !!s);
  const claims = card.claimIds.map((id) => ws.claims.find((c) => c.id === id && c.approved)).filter((c): c is NonNullable<typeof c> => !!c);
  const saved = card.saved;

  const save = async (approve: boolean) => {
    const at = nowISO();
    const plan = saveBattlecard(ws, voice, card, approve, at);
    if (!plan) return;
    if (!(await dispatch(plan.actions))) return;
    undoable(approve ? "Saved and approved under How we sell → Objections. Call prep uses it from now on." : "Saved as a draft under How we sell → Objections.", () => void dispatch(plan.undo));
  };
  const dismiss = () => {
    void dispatch({ type: "buyerVoice.dismiss", key: card.key, at: nowISO() });
    undoable("Draft set aside.", () => void dispatch({ type: "buyerVoice.dismiss", key: card.key, at: null }));
  };

  return (
    <div className="rounded-lg bg-surface ring-1 ring-border">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-4 py-2.5">
        <AiBadge />
        <span className="text-[13px] font-medium text-fg">Battlecard: {card.subject}</span>
        {!saved && <DraftLabel />}
        <span className="ml-auto font-mono text-[12px] tnum text-fg-3">
          {plural(quotes.length, "quote")} · {plural(claims.length, "claim")} · {shortDate(card.at)}
          {card.costUsd !== undefined && ` · ${usd(card.costUsd)}`}
        </span>
      </div>
      <dl className="space-y-2.5 px-4 py-3">
        <Row label="When they say">“{card.objection}”</Row>
        {card.underlyingConcern && <Row label="What's underneath">{card.underlyingConcern}</Row>}
        {card.clarifyingQ && <Row label="Ask first">{card.clarifyingQ}</Row>}
        <Row label="Then say">{card.response}</Row>
        {card.walkAwayIf && <Row label="Walk away if">{card.walkAwayIf}</Row>}
        {card.landmines.length > 0 && (
          <Row label="Questions that surface the gap">
            <ul className="space-y-1">
              {card.landmines.map((q) => (
                <li key={q} className="flex gap-2">
                  <span aria-hidden className="mt-[9px] size-1 shrink-0 rounded-full bg-fg-4" />
                  <span>{q}</span>
                </li>
              ))}
            </ul>
          </Row>
        )}
        {card.whenWeWin && <Row label="We win when">{card.whenWeWin}</Row>}
        {card.whenWeLose && <Row label="We lose when">{card.whenWeLose}</Row>}
      </dl>
      {(quotes.length > 0 || claims.length > 0) && (
        <details className="group border-t border-border px-4 py-2.5">
          <summary className="cursor-pointer list-none text-[12.5px] text-fg-2 marker:hidden hover:text-fg [&::-webkit-details-marker]:hidden">
            <span className="underline-offset-2 group-open:underline">What it rests on</span>
          </summary>
          {quotes.length > 0 && <ul className="mt-1 divide-y divide-border">{quotes.map((s) => <QuoteRow key={s.id} s={s} compact />)}</ul>}
          {claims.length > 0 && (
            <div className="mt-2">
              <FieldLabel>Approved claims</FieldLabel>
              <ul className="space-y-1 text-[13px] leading-5 text-fg-2">
                {claims.map((c) => (
                  <li key={c.id}>{c.text}</li>
                ))}
              </ul>
            </div>
          )}
        </details>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
        {saved ? (
          <>
            <span className="inline-flex items-center gap-1 text-[12.5px] text-fg-2">
              <Check className="size-3.5" /> Saved {saved.approved ? "and approved" : "as a draft"} {shortDate(saved.at)}
            </span>
            <Button size="xs" variant="ghost" onClick={() => navigateToHash("objections")}>
              Open in Objections
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="primary" onClick={() => void save(true)}>
              Approve and save
            </Button>
            <Button size="sm" onClick={() => void save(false)}>
              Save as draft
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Set aside
            </Button>
            <span className="text-[12px] text-fg-3">Saves into How we sell → Objections{card.landmines.length ? " and the competitor's questions" : ""}.</span>
          </>
        )}
      </div>
    </div>
  );
}
