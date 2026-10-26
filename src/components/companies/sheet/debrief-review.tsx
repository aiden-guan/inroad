"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Mail } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useRunFor, useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { AiBadge, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { CopyButton } from "@/components/ui/misc";
import { WorkLog } from "@/components/ui/work-log";
import { cn } from "@/lib/client/cn";
import { relativeTime, shortDate } from "@/lib/client/format";
import { RECAP_CLOSE, SCORED_FIELDS, computeQualification, emptyCard, hasDatedNextStep, scoresFrom, wordCount, type CardField } from "@/lib/deals/rules";
import type { Action } from "@/lib/domain/actions";
import { newId, nowISO } from "@/lib/domain/ids";
import { STAGE_LABELS, type Deal, type Debrief, type EntityRef, type ID, type Meeting, type Person, type Qualification, type QualificationCard, type Workspace } from "@/lib/domain/types";
import { lintDraft } from "@/lib/quality/lint";
import { ease } from "@/lib/motion";
import { ReferralLeads } from "@/components/people/referral-leads";
import { debriefReferrals } from "@/lib/deals/referrals";
import { Callout, DraftBlock, gmailHref, Section, useNow } from "./shared";

type ChangeKey = "card" | "nextStep" | "stage" | "people" | "price" | "map" | "pilot";
interface Change {
  key: ChangeKey;
  label: string;
  detail?: string;
}

function emailsFor(ws: Workspace, deal: Deal, meeting: Meeting): string {
  const ids = [...meeting.attendees.map((a) => a.personId), ...deal.contacts.map((c) => c.personId)].filter((x): x is string => !!x);
  return [...new Set(ids.map((id) => ws.people[id]?.email).filter(Boolean))].join(",");
}

const CARD_FIELDS: CardField[] = [...SCORED_FIELDS, "decisionProcess"];

/**
 * The card and score after applying this debrief to the deal as it is NOW: only the fields this call
 * covered replace what's on file, so hand edits and other calls' debriefs survive, in any order.
 */
function mergeDebrief(deal: Deal, d: Debrief, nextStep: { date?: string } | null | undefined, today: string): { card: QualificationCard; qualification: Qualification } {
  const card: QualificationCard = { ...(deal.card ?? emptyCard()) };
  const scores = scoresFrom(deal.qualification);
  const callScores = scoresFrom(d.qualification);
  // Debriefs saved before `covered` existed: every field the stored card has evidence for.
  const covered = d.covered ?? CARD_FIELDS.filter((f) => d.card[f].status !== "not_covered");
  for (const f of covered) {
    (card as Record<CardField, unknown>)[f] = d.card[f];
    if (f !== "decisionProcess") scores[f] = d.fieldScores?.[f] ?? callScores[f];
  }
  return { card, qualification: computeQualification(scores, hasDatedNextStep(nextStep, today)) };
}

/** People named on the call who aren't on the deal yet: existing account people (by name) or new ones. */
function committeeAdds(ws: Workspace, deal: Deal, account: Workspace["accounts"][string] | undefined, d: Debrief): { p: Debrief["committeeUpdates"][number]; personId?: ID }[] {
  const byName = new Map((account?.peopleIds ?? []).map((id) => [ws.people[id]?.name.toLowerCase(), id] as const));
  const taken = new Set(deal.contacts.map((c) => c.personId));
  const names = new Set<string>();
  const out: { p: Debrief["committeeUpdates"][number]; personId?: ID }[] = [];
  for (const p of d.committeeUpdates) {
    const name = p.name.toLowerCase();
    if (names.has(name)) continue;
    names.add(name);
    const personId = byName.get(name);
    if (personId && taken.has(personId)) continue;
    if (personId) taken.add(personId);
    out.push({ p, personId });
  }
  return out;
}

function changesFor(ws: Workspace, deal: Deal, d: Debrief, account: Workspace["accounts"][string] | undefined, today: string): Change[] {
  const out: Change[] = [];
  const before = deal.qualification?.total ?? 0;
  const after = mergeDebrief(deal, d, d.nextStep?.date ? d.nextStep : deal.nextStep, today);
  const champ = after.card.champion;
  out.push({ key: "card", label: "Update the qualification card", detail: `${before} → ${after.qualification.total} of 12${champ.name ? ` · champion ${champ.name} (${champ.championStatus ?? "untested"})` : ""}` });
  if (d.nextStep?.date) out.push({ key: "nextStep", label: `Next step: ${d.nextStep.what}`, detail: `${shortDate(d.nextStep.date)}${d.nextStep.buyerAgreed ? " · they agreed" : " · not agreed by them yet"}` });
  if (d.stageSuggestion && !d.stageSuggestion.criteriaMissing.length && d.stageSuggestion.to !== deal.stage) {
    out.push({ key: "stage", label: `Move to ${STAGE_LABELS[d.stageSuggestion.to]}`, detail: d.stageSuggestion.criteriaMet.join(" · ") });
  }
  const adds = committeeAdds(ws, deal, account, d).map((x) => x.p);
  if (adds.length) out.push({ key: "people", label: `Add ${adds.length === 1 ? adds[0].name : `${adds.length} people`} to the deal`, detail: adds.map((p) => `${p.name}${p.title ? `, ${p.title}` : ""}`).join(" · ") });
  // Re-debriefing a call must not log the same quote twice.
  if (d.priceQuoted && !(deal.priceQuotes ?? []).some((q) => q.amountUsd === d.priceQuoted!.amountUsd)) out.push({ key: "price", label: `Log the price you quoted: $${d.priceQuoted.amountUsd.toLocaleString()}`, detail: d.priceQuoted.quote ? `“${d.priceQuoted.quote}”` : undefined });
  if (d.map) out.push({ key: "map", label: `Add a mutual action plan (${d.map.milestones.length} steps to ${shortDate(d.map.targetDate)})`, detail: "A draft to review with them, never sent as final" });
  if (d.pilotCriteria) out.push({ key: "pilot", label: "Save the pilot success criteria", detail: d.pilotCriteria });
  return out;
}

/** The one review screen after a debrief: apply to deal (toggles), the recap, tasks, and what I learned. */
export function DebriefReview({ deal, meeting, debrief, today }: { deal: Deal; meeting: Meeting; debrief: Debrief; today: string }) {
  const { ws, dispatch } = useWorkspace();
  const { start } = useRuns();
  const now = useNow();
  const account = ws?.accounts[deal.accountDomain];
  const changes = useMemo(() => (ws ? changesFor(ws, deal, debrief, account, today) : []), [ws, deal, debrief, account, today]);
  const [off, setOff] = useState<Set<ChangeKey>>(new Set());
  const [tasksOff, setTasksOff] = useState<Set<number>>(new Set());
  const [showQuotes, setShowQuotes] = useState(false);
  // The proposal run is tracked on the deal, so a click here and the Proposal section share one run.
  const proposalRef = useMemo<EntityRef>(() => ({ kind: "deal", id: deal.id }), [deal.id]);
  const proposalRun = useRunFor(proposalRef, "asset");
  const proposalActive = !!proposalRun && (proposalRun.status === "running" || proposalRun.status === "queued");
  const [proposalPending, setProposalPending] = useState(false);
  const applied = !!debrief.appliedAt;
  if (!ws) return null;

  // Tasks already added from this meeting (an earlier apply of a re-debriefed call) aren't offered again.
  const norm = (t: string) => t.trim().toLowerCase();
  const have = new Set((deal.tasks ?? []).filter((x) => x.meetingId === meeting.id).map((x) => norm(x.what)));
  const newTasks = debrief.tasks.filter((t) => !have.has(norm(t.what)));

  const toggle = (k: ChangeKey) =>
    setOff((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const apply = async () => {
    const at = nowISO();
    const on = (k: ChangeKey) => changes.some((c) => c.key === k) && !off.has(k);
    const actions: Action[] = [];
    const patch: Partial<Deal> = {};
    const nextStep = on("nextStep") && debrief.nextStep?.date ? { what: debrief.nextStep.what, date: debrief.nextStep.date, buyerAgreed: debrief.nextStep.buyerAgreed } : deal.nextStep;
    if (on("card")) {
      const merged = mergeDebrief(deal, debrief, nextStep, today);
      patch.card = merged.card;
      patch.qualification = merged.qualification;
      // Champion status lives on the person too.
      const champ = merged.card.champion;
      const person = champ.name ? account?.peopleIds.map((id) => ws.people[id]).find((p) => p?.name.toLowerCase() === champ.name!.toLowerCase()) : undefined;
      if (person && champ.championStatus && champ.championStatus !== "none" && person.champion !== champ.championStatus) actions.push({ type: "person.upsert", person: { ...person, champion: champ.championStatus } });
    } else if (on("nextStep") && deal.qualification) {
      patch.qualification = computeQualification(scoresFrom(deal.qualification), hasDatedNextStep(nextStep, today));
    }
    if (on("people")) {
      const contacts = [...deal.contacts];
      for (const { p, personId } of committeeAdds(ws, deal, account, debrief)) {
        // Already on the account (usually from the dossier): put them on the deal.
        if (personId) {
          contacts.push({ personId, role: p.role ?? ws.people[personId]?.role });
          continue;
        }
        const person: Person = {
          id: newId("per"),
          accountDomain: deal.accountDomain,
          name: p.name,
          title: p.title ?? "",
          role: p.role,
          evidenceIds: [],
          confidence: "medium",
          mayHaveLeft: false,
          contactPaths: [],
          jurisdiction: account?.dossier?.snapshot.jurisdiction ?? "unknown",
          doNotContact: false,
          source: "manual",
          notes: `Named on the ${shortDate(meeting.startsAt)} call`,
        };
        actions.push({ type: "person.upsert", person });
        contacts.push({ personId: person.id, role: p.role });
      }
      patch.contacts = contacts;
    }
    if (on("price") && debrief.priceQuoted) patch.priceQuotes = [...(deal.priceQuotes ?? []), { at: today, amountUsd: debrief.priceQuoted.amountUsd }];
    if (on("map") && debrief.map) patch.map = debrief.map;
    if (on("pilot") && debrief.pilotCriteria) patch.pilot = { paid: true, ...deal.pilot, criteria: debrief.pilotCriteria };
    const tasks = newTasks.filter((_, i) => !tasksOff.has(i));
    if (tasks.length) patch.tasks = [...(deal.tasks ?? []), ...tasks.map((t) => ({ id: newId("task"), what: t.what, due: t.due, owner: t.owner, done: false, meetingId: meeting.id }))];
    if (Object.keys(patch).length) actions.push({ type: "deal.update", id: deal.id, patch, at });
    if (on("nextStep") && nextStep) actions.push({ type: "deal.setNextStep", id: deal.id, nextStep, at });
    if (on("stage") && debrief.stageSuggestion) actions.push({ type: "deal.setStage", id: deal.id, stage: debrief.stageSuggestion.to, at });
    actions.push({ type: "meeting.patchDebrief", id: meeting.id, generatedAt: debrief.generatedAt, patch: { appliedAt: at } });
    const ok = await dispatch(actions);
    if (ok) toast(`Applied to ${deal.name}${on("stage") && debrief.stageSuggestion ? ` · now ${STAGE_LABELS[debrief.stageSuggestion.to]}` : ""}`);
  };

  const count = changes.filter((c) => !off.has(c.key)).length + newTasks.filter((_, i) => !tasksOff.has(i)).length;
  const blocked = debrief.stageSuggestion && debrief.stageSuggestion.criteriaMissing.length > 0 && debrief.stageSuggestion.to !== deal.stage ? debrief.stageSuggestion : null;
  const to = emailsFor(ws, deal, meeting);

  return (
    <div className="space-y-6">
      <p className="flex flex-wrap items-center gap-2 font-mono text-[11.5px] text-fg-3">
        <AiBadge /> Debriefed {relativeTime(debrief.generatedAt, now)} · from {debrief.source === "transcript" ? "the transcript" : "your notes"}
      </p>

      {debrief.noNextStepWarning && (
        <Callout tone="danger">
          <p className="font-medium">This call has no dated next step. Treat it as a soft no until one is booked.</p>
          {debrief.schedulingEmail && (
            <div className="mt-2.5 text-fg">
              <DraftBlock>
                <p className="text-[13px] font-medium text-fg">{debrief.schedulingEmail.subject}</p>
                <p className="mt-1 whitespace-pre-wrap text-[15px] leading-6 text-fg-2">{debrief.schedulingEmail.body}</p>
              </DraftBlock>
              <HandoffButtons to={to} subject={debrief.schedulingEmail.subject} body={debrief.schedulingEmail.body} authUser={ws.founder.gmailAuthUser} />
            </div>
          )}
        </Callout>
      )}
      {debrief.singleThreadWarning && <Callout tone="warning">{debrief.singleThreadWarning}</Callout>}

      {/* 1. Apply to deal */}
      <AnimatePresence initial={false} mode="popLayout">
        {applied ? (
          <motion.p key="applied" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} className="flex items-center gap-1.5 text-[13px] text-fg-2">
            <Check className="size-3.5 text-success" aria-hidden /> Applied to the deal {relativeTime(debrief.appliedAt, now)}.
          </motion.p>
        ) : (
          <motion.div key="apply" exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15, ease: ease.out }} className="rounded-lg bg-surface ring-1 ring-border">
            <p className="border-b border-border px-4 py-2.5 text-[13px] font-semibold text-fg">Apply to the deal</p>
            <ul className="divide-y divide-border">
              {changes.map((c) => (
                <li key={c.key}>
                  <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-bg-subtle">
                    <input type="checkbox" checked={!off.has(c.key)} onChange={() => toggle(c.key)} className="mt-[3px] accent-[var(--fg)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-fg">{c.label}</span>
                      {c.detail && <span className="mt-0.5 block text-[12px] leading-[18px] text-fg-3">{c.detail}</span>}
                    </span>
                  </label>
                </li>
              ))}
              {newTasks.map((t, i) => (
                <li key={`t${i}`}>
                  <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-bg-subtle">
                    <input
                      type="checkbox"
                      checked={!tasksOff.has(i)}
                      onChange={() =>
                        setTasksOff((s) => {
                          const n = new Set(s);
                          if (n.has(i)) n.delete(i);
                          else n.add(i);
                          return n;
                        })
                      }
                      className="mt-[3px] accent-[var(--fg)]"
                    />
                    <span className="min-w-0 flex-1 text-[13px] text-fg">
                      Task: {t.what}
                      <span className="ml-1.5 text-[12px] text-fg-3">
                        {t.owner === "buyer" ? "them" : "you"}
                        {t.due ? ` · ${shortDate(t.due)}` : ""}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {blocked && (
              <p className="border-t border-border px-4 py-2.5 text-[12.5px] text-fg-2">
                Not {STAGE_LABELS[blocked.to]} yet. Missing: {blocked.criteriaMissing.join(" · ")}.
              </p>
            )}
            <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5">
              <span className="text-[12px] text-fg-3">Nothing changes until you apply. I never move a deal myself.</span>
              <Button variant="primary" onClick={() => void apply()} disabled={count === 0}>
                Apply {count} change{count === 1 ? "" : "s"}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. Recap */}
      <RecapEditor key={`${meeting.id}-${debrief.generatedAt}`} meeting={meeting} debrief={debrief} to={to} authUser={ws.founder.gmailAuthUser} />

      {debrief.offerProposal && !deal.proposal && (
        <Callout
          action={
            <Button
              size="sm"
              variant="agent"
              loading={proposalActive || proposalPending}
              onClick={async () => {
                if (proposalActive || proposalPending) return;
                setProposalPending(true);
                await start("asset", { kind: "pilot_proposal", dealId: deal.id, title: `${deal.name} pilot proposal` });
                setProposalPending(false);
              }}
            >
              Draft the pilot proposal
            </Button>
          }
        >
          A pilot came up. I can draft the one-page proposal with success criteria and an order-form block.
          {proposalActive && proposalRun && <WorkLog run={proposalRun} className="mt-2.5" />}
        </Callout>
      )}

      {/* 3. What I learned */}
      {debrief.toConfirm.length > 0 && (
        <Section label="Confirm next time">
          <ul className="space-y-1 font-serif text-[16px] leading-[24px] text-fg">
            {debrief.toConfirm.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </Section>
      )}
      {debrief.coaching.length > 0 && (
        <Section label="Coaching">
          <ul className="space-y-1.5 font-serif text-[16px] leading-[24px] text-fg">
            {debrief.coaching.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </Section>
      )}
      {debriefReferrals(debrief).length > 0 && (
        <Section label="Who else to talk to">
          <p className="mb-2.5 text-[13px] text-fg-2">They named people worth meeting. A referral is the warmest first touch you&apos;ll get, so write while the call is fresh.</p>
          <ReferralLeads meeting={meeting} />
        </Section>
      )}
      <Learned debrief={debrief} />

      {debrief.quotes.length > 0 && (
        <section>
          <button onClick={() => setShowQuotes((s) => !s)} aria-expanded={showQuotes} className="flex items-center gap-1.5 text-[12px] font-medium text-fg-3 hover:text-fg-2">
            {debrief.source === "transcript" ? "What they said" : "From your notes"} · {debrief.quotes.length}
            <ChevronDown className={cn("size-3.5 transition-transform duration-200", showQuotes && "rotate-180")} />
          </button>
          {showQuotes && (
            <ul className="mt-2 space-y-2">
              {debrief.quotes.map((q) => (
                <li key={q.id} className="border-l-2 border-border-strong pl-3">
                  {q.speaker && <span className="block text-[11.5px] text-fg-3">{q.speaker}</span>}
                  <span className={cn("font-serif text-[15px] leading-[22px] text-fg-2", q.kind === "note" && "italic")}>{q.kind === "note" ? q.text : `“${q.text}”`}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function RecapEditor({ meeting, debrief, to, authUser }: { meeting: Meeting; debrief: Debrief; to: string; authUser?: string }) {
  const { dispatch } = useWorkspace();
  const [subject, setSubject] = useState(debrief.recap.subject);
  const [body, setBody] = useState(debrief.recap.body);
  const words = wordCount(body);
  const lint = useMemo(() => lintDraft({ subject, body, frame: "recap", step: 2, kind: "recap" }), [subject, body]);
  // A recap answers what was promised on the call, so "offers a resource" isn't a problem here.
  const issues = lint.violations.filter((v) => v.code !== "ASSET_MISSING");
  const worst = issues.find((v) => v.severity === "error") ?? issues.find((v) => v.severity === "warn");
  const persist = () => {
    if (subject === debrief.recap.subject && body === debrief.recap.body) return;
    void dispatch({ type: "meeting.patchDebrief", id: meeting.id, generatedAt: debrief.generatedAt, patch: { recap: { subject, body } } });
  };
  return (
    <Section
      label="Recap · send it today"
      right={
        <span className={cn("font-mono text-[11.5px] tnum", words > 180 ? "text-warning" : "text-fg-3")}>
          {words}/180 words
        </span>
      }
    >
      <div className="draft-rule rounded-r-md bg-surface py-2.5 pl-3.5 pr-3">
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} onBlur={persist} aria-label="Recap subject" className="mb-2 h-8 font-medium ring-border" />
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} onBlur={persist} aria-label="Recap body" className="min-h-40 text-[15px] leading-6 ring-border" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={cn("mr-auto text-[12px]", worst ? (worst.severity === "error" ? "text-danger" : "text-warning") : "text-fg-3")}>
          {worst ? worst.detail : body.trim().endsWith(RECAP_CLOSE) ? "Ready" : `End with “${RECAP_CLOSE}”`}
        </span>
        <HandoffButtons to={to} subject={subject} body={body} authUser={authUser} inline />
      </div>
    </Section>
  );
}

function HandoffButtons({ to, subject, body, authUser, inline }: { to: string; subject: string; body: string; authUser?: string; inline?: boolean }) {
  const href = gmailHref({ to, subject, body, authUser });
  return (
    <div className={cn("flex items-center gap-2", !inline && "mt-2")}>
      <CopyButton text={`${subject}\n\n${body}`} />
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-sm bg-primary px-2.5 text-[12px] font-medium text-primary-fg shadow-btn transition-transform duration-150 hover:bg-primary-hover active:scale-[0.97]">
          <Mail className="size-3.5" aria-hidden /> Open in Gmail
        </a>
      ) : (
        <span className="text-[12px] text-fg-3">Too long for a Gmail link. Copy it instead.</span>
      )}
    </div>
  );
}

function Learned({ debrief }: { debrief: Debrief }) {
  const { dispatch } = useWorkspace();
  const [added, setAdded] = useState<Set<number>>(new Set());
  const hasAny = debrief.newObjections.length || debrief.customerWords.length || debrief.povCandidates?.length;
  if (!hasAny) return null;
  return (
    <Section label="For your Playbook">
      <div className="space-y-3 text-[13px]">
        {debrief.newObjections.length > 0 && (
          <p className="text-fg-2">
            <span className="text-fg">Objections added as drafts:</span> {debrief.newObjections.map((o) => `“${o}”`).join(" · ")}
          </p>
        )}
        {debrief.customerWords.length > 0 && (
          <p className="text-fg-2">
            <span className="text-fg">Their words, saved to messaging:</span> {debrief.customerWords.map((w) => `“${w}”`).join(" · ")}
          </p>
        )}
        {debrief.povCandidates?.map((p, i) => (
          <div key={i} className="flex items-start gap-3 rounded-md bg-bg-subtle px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="font-serif text-[15.5px] leading-[23px] text-fg">“{p.text}”</p>
              <p className="mt-0.5 text-[12px] text-fg-3">{p.basis}</p>
            </div>
            {added.has(i) ? (
              <Badge tone="neutral">Added</Badge>
            ) : (
              <Button
                size="xs"
                onClick={() =>
                  void dispatch({ type: "pov.upsert", pov: { id: newId("pov"), text: p.text, evidence: p.basis, createdAt: nowISO(), uses: 0 } }).then((ok) => {
                    if (ok) setAdded((s) => new Set(s).add(i));
                  })
                }
              >
                Add to POV bank
              </Button>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}
