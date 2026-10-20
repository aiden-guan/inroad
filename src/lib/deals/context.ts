import "server-only";
import type { Account, Deal, Meeting, Workspace } from "@/lib/domain/types";
import { localDate } from "@/lib/moves/util";
import { FIELD_META, SCORED_FIELDS, scoreOf } from "./rules";

/**
 * Compact, prompt-ready views of a deal and its account. Built in code so Claude reads a few
 * hundred tokens of state instead of the raw workspace.
 */

function clip(s: string | undefined | null, n: number): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function cardSummary(deal: Deal): string {
  const card = deal.card;
  if (!card) return "Qualification card: empty (no call debriefed yet).";
  const lines = SCORED_FIELDS.map((f) => {
    const field = card[f];
    const extra =
      f === "champion" && card.champion.name
        ? ` [${card.champion.name}, ${card.champion.championStatus ?? "untested"}]`
        : f === "economicBuyer" && card.economicBuyer.name
          ? ` [${card.economicBuyer.name}${card.economicBuyer.engaged ? ", engaged" : ""}]`
          : f === "criticalEvent" && card.criticalEvent.date
            ? ` [${card.criticalEvent.date}${card.criticalEvent.consequence ? `, if missed: ${clip(card.criticalEvent.consequence, 80)}` : ""}]`
            : f === "pain" && card.pain.impact
              ? ` [impact: ${clip(card.pain.impact, 80)}]`
              : "";
    return `- ${FIELD_META[f].label} ${scoreOf(deal.qualification, f)}/2 (${field.status}): ${clip(field.value, 160) || "—"}${extra}`;
  });
  lines.push(`- ${FIELD_META.decisionProcess.label} (${card.decisionProcess.status}): ${clip(card.decisionProcess.value, 200) || "—"}`);
  return `Qualification card, ${deal.qualification?.total ?? 0}/12:\n${lines.join("\n")}`;
}

export function dealContext(ws: Workspace, deal: Deal, account: Account | undefined, opts: { excludeMeetingId?: string } = {}): string {
  const people = deal.contacts.map((c) => ws.people[c.personId]).filter(Boolean);
  const prior = deal.meetingIds
    .map((id) => ws.meetings[id])
    .filter((m): m is Meeting => !!m && m.id !== opts.excludeMeetingId && !!m.debrief)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const lines = [
    `Deal: ${deal.name} · stage ${deal.stage} since ${deal.stageHistory.at(-1)?.at.slice(0, 10) ?? deal.createdAt.slice(0, 10)}`,
    deal.nextStep ? `Next step on file: ${deal.nextStep.what} by ${deal.nextStep.date}${deal.nextStep.buyerAgreed ? " (buyer agreed)" : ""}` : "Next step on file: none",
    people.length ? `Contacts: ${people.map((p) => `${p.name}, ${p.title}${p.role ? ` (${p.role})` : ""}${p.champion ? ` [champion: ${p.champion}]` : ""}`).join("; ")}` : "Contacts: none recorded",
    cardSummary(deal),
    deal.pilot ? `Pilot: ${deal.pilot.paid ? `paid${deal.pilot.feeUsd ? ` $${deal.pilot.feeUsd}` : ""}` : "UNPAID"}${deal.pilot.startedOn ? `, started ${deal.pilot.startedOn}` : ""}. Criteria: ${clip(deal.pilot.criteria, 300) || "not written"}` : null,
    deal.priceQuotes?.length ? `Price quotes: ${deal.priceQuotes.map((q) => `$${q.amountUsd} on ${q.at}${q.outcome ? ` (${q.outcome})` : ""}`).join("; ")}` : "No price quoted yet.",
    deal.map ? `Mutual action plan: ${deal.map.milestones.length} milestones to ${deal.map.targetDate}; ${deal.map.milestones.filter((m) => m.status === "done").length} done.` : null,
    deal.tasks?.filter((t) => !t.done).length ? `Open tasks: ${deal.tasks.filter((t) => !t.done).map((t) => `${t.what} (${t.owner}${t.due ? `, due ${t.due}` : ""})`).join("; ")}` : null,
    ...prior.slice(-3).map((m) => {
      const d = m.debrief!;
      return `Earlier call ${localDate(m.startsAt)} "${clip(m.title, 60)}": next step ${d.nextStep ? `"${clip(d.nextStep.what, 80)}"${d.nextStep.date ? ` by ${d.nextStep.date}` : ""}` : "none"}; to confirm: ${d.toConfirm.slice(0, 3).map((t) => clip(t, 80)).join("; ") || "nothing"}; objections: ${d.newObjections.slice(0, 3).map((t) => clip(t, 80)).join("; ") || "none"}.`;
    }),
    account?.dossier ? `Account: ${account.dossier.snapshot.plainDescription} Stage ${account.dossier.snapshot.stage}${account.dossier.snapshot.headcount ? `, ~${account.dossier.snapshot.headcount.value} people` : ""}${account.dossier.snapshot.hq ? `, HQ ${account.dossier.snapshot.hq}` : ""}.` : account ? `Account: ${account.name} (${account.domain})${account.oneLiner ? `: ${account.oneLiner}` : ""}.` : null,
  ];
  return lines.filter(Boolean).join("\n");
}
