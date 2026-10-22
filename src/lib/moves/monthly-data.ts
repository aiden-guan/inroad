import { daysBetween, monthKey, todayISO } from "@/lib/domain/ids";
import type { Deal, ISODateTime, Stage, Workspace } from "@/lib/domain/types";
import { activeBet, betReadout, startedBets, type BetReadout, type StartedBet } from "@/lib/learning/bets";
import { clip, companyName, daysSince, localDate } from "./util";

/**
 * The monthly loop's numbers (SPEC W9 monthly, §5.2), computed in code: what changed since the bet was last
 * revised (the refresh inputs), the message-bet readout, the pricing log and, only near the thresholds, hiring
 * readiness. The model explains and proposes; code decides what may be shown and what's too early to say.
 */

/** A refresh is offered once this many calls were debriefed since the bet was last revised, or a deal was won. */
export const REFRESH_AFTER_CALLS = 5;
/** Hiring readiness appears only near the thresholds (SPEC MonthlyReview: ≥7 customers or ≥35 demos). */
export const HIRING_NEAR = { customers: 7, demos: 35 };
/** …and recommends hiring only past them (~10 founder-closed customers, ~50 demos at ≥20% win rate, a written playbook). */
export const HIRING_READY = { customers: 10, demos: 50, winRate: 0.2 };

/** When the bet was last revised: the newest refresh or monthly review, else when the playbook was written. */
export function lastRefreshAt(ws: Workspace): ISODateTime | null {
  const runs = Object.values(ws.briefs)
    .filter((b) => b.reviewKind === "refresh" || b.reviewKind === "monthly")
    .map((b) => b.generatedAt)
    .sort();
  return runs.at(-1) ?? ws.foundation?.revisedAt ?? ws.foundation?.generatedAt ?? null;
}

function debriefedSince(ws: Workspace, since: string | null) {
  return Object.values(ws.meetings)
    .filter((m) => m.debrief && (!since || m.debrief.generatedAt > since))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

function wonAt(d: Deal): string | undefined {
  return d.stage === "won" ? [...d.stageHistory].reverse().find((h) => h.stage === "won")?.at : undefined;
}

/** Calls debriefed and deals won since the last revision: what makes a refresh worth its cost. */
export function refreshOffer(ws: Workspace): { calls: number; won: number; since: string | null; offered: boolean } {
  const since = lastRefreshAt(ws);
  const calls = debriefedSince(ws, since).length;
  const won = Object.values(ws.deals).filter((d) => {
    const at = wonAt(d);
    return at && (!since || at > since);
  }).length;
  return { calls, won, since, offered: !!ws.foundation && (calls >= REFRESH_AFTER_CALLS || won > 0) };
}

export interface RefreshInputs {
  since: string | null;
  /** The text block the model reads; every line it may cite carries an id. */
  block: string;
  /** Id → the quote or fact behind it, for the proposal's justification. */
  quotes: Map<string, string>;
  calls: number;
  /** Everything buyers said verbatim (transcript quotes and their words), lowercased: customer words must come from here. */
  verbatim: string;
  /** Won deals and paid pilots: the best-fit customers a rebuild starts from. */
  customers: number;
  replies: number;
}

/**
 * What a refresh reads: calls debriefed since the last revision (verbatim only from transcripts), the best-fit
 * customers (won or paid, how fast they bought), losses and replies since, and the founder's answers.
 */
export function refreshInputs(ws: Workspace, now: Date, opts: { questionId?: string } = {}): RefreshInputs {
  const since = lastRefreshAt(ws);
  const today = todayISO(now);
  const quotes = new Map<string, string>();
  const out: string[] = [];
  const verbatim: string[] = [];

  const calls = debriefedSince(ws, since).slice(-12);
  out.push(`<calls since="${since ? localDate(since) : "the first bet"}" count="${calls.length}">`);
  calls.forEach((m, i) => {
    const d = m.debrief!;
    const deal = ws.deals[m.dealId];
    const company = companyName(ws, deal?.accountDomain);
    const alias = `m${i + 1}`;
    out.push(`${alias} · ${company} · ${deal ? deal.stage : "no deal"} · ${localDate(m.startsAt)} · ${d.source === "transcript" ? "transcript (verbatim)" : "founder notes (paraphrase)"}`);
    if (d.source === "transcript") verbatim.push(...d.quotes.map((q) => q.text), ...d.customerWords);
    d.quotes.slice(0, 5).forEach((q, j) => {
      const id = `${alias}.q${j + 1}`;
      const line = d.source === "transcript" ? `${q.speaker ?? "Buyer"}: "${clip(q.text, 240)}"` : `Founder's note: ${clip(q.text, 240)}`;
      out.push(`  ${id} ${line}`);
      quotes.set(id, `${line} (${company} call)`);
    });
    const facts = [
      d.card.pain.value && `pain: ${clip(d.card.pain.value, 160)}`,
      d.card.fit.value && `fit: ${clip(d.card.fit.value, 120)}`,
      d.customerWords.length ? `their words: ${d.customerWords.slice(0, 4).map((w) => `"${clip(w, 50)}"`).join(", ")}` : "",
      d.newObjections.length ? `objections: ${d.newObjections.slice(0, 3).map((o) => clip(o, 80)).join(" | ")}` : "",
    ].filter(Boolean);
    if (facts.length) {
      out.push(`  ${alias} ${facts.join(" · ")}`);
      quotes.set(alias, `${company} call: ${facts.join(" · ")}`);
    }
  });
  out.push("</calls>");

  const best = Object.values(ws.deals)
    .filter((d) => d.stage === "won" || (d.stage === "pilot" && d.pilot?.paid))
    .sort((a, b) => (wonAt(a) ?? a.updatedAt).localeCompare(wonAt(b) ?? b.updatedAt));
  out.push(`<best_fit_customers count="${best.length}">`);
  best.forEach((d, i) => {
    const alias = `w${i + 1}`;
    const won = wonAt(d);
    const company = companyName(ws, d.accountDomain);
    const card = d.card;
    const line = [
      `${alias} · ${company} · ${d.stage === "won" ? `won${won ? ` in ${daysBetween(localDate(d.createdAt), localDate(won))} days` : ""}` : "paid pilot"}`,
      `${d.meetingIds.length} calls`,
      card?.pain.value ? `pain: ${clip(card.pain.value, 140)}` : "",
      card?.champion.name ? `champion: ${card.champion.name}` : "",
      ws.accounts[d.accountDomain]?.oneLiner ? `what they do: ${clip(ws.accounts[d.accountDomain].oneLiner!, 100)}` : "",
    ].filter(Boolean);
    out.push(line.join(" · "));
    quotes.set(alias, line.join(" · ").slice(alias.length + 3));
  });
  out.push("</best_fit_customers>");

  const losses = Object.values(ws.deals).filter((d) => d.stage === "lost" && d.stageHistory.some((h) => h.stage === "lost" && (!since || h.at > since)));
  out.push(`<losses count="${losses.length}">`);
  losses.forEach((d, i) => {
    const line = `l${i + 1} · ${companyName(ws, d.accountDomain)} lost: ${(d.lossReason ?? "unknown").replace(/_/g, " ")}`;
    out.push(line);
    quotes.set(`l${i + 1}`, line.slice(line.indexOf("·") + 2));
  });
  out.push("</losses>");

  const replies = ws.activities.filter((a) => a.kind === "reply_received" && a.body && (!since || a.at > since)).slice(-10);
  out.push(`<replies count="${replies.length}">`);
  replies.forEach((a, i) => {
    const p = a.personId ? ws.people[a.personId] : undefined;
    const company = companyName(ws, p?.accountDomain ?? a.accountDomain);
    out.push(`r${i + 1} · ${p?.title ?? "contact"} at ${company} · ${a.sentiment ?? "unclassified"}\n   <reply>${clip(a.body ?? "", 300).replace(/[<>]/g, "")}</reply>`);
    quotes.set(`r${i + 1}`, `“${clip(a.body ?? "", 160)}” (${company})`);
  });
  out.push("</replies>");

  const answers = (ws.foundation?.founderQuestions ?? []).filter((q) => q.answer && (!opts.questionId || q.id === opts.questionId));
  out.push("<founder_answers>");
  answers.forEach((q, i) => {
    out.push(`f${i + 1} · ${clip(q.question, 140)} → ${clip(q.answer!, 300)}`);
    quotes.set(`f${i + 1}`, `Your answer: ${clip(q.answer!, 160)}`);
  });
  out.push("</founder_answers>");

  const f = ws.foundation;
  if (f) {
    out.push("<playbook_now>");
    out.push(`Best fit: ${f.positioning.bestFit.map((b) => `"${b}"`).join("; ") || "(none)"}`);
    out.push(`ICP criteria: ${f.icp.criteria.map((c) => `[${c.id}] ${c.text} (${c.status}${c.mustHave ? ", must have" : ""})`).join("; ") || "(none)"}`);
    out.push(`Personas: ${f.personas.map((p) => `[${p.id}] ${p.role}: pains ${p.pains.slice(0, 3).map((x) => `"${clip(x, 60)}"`).join(", ") || "none"}`).join("; ")}`);
    if (f.icp.betHistory?.length) {
      const open = f.icp.betHistory.find((b) => !b.endedAt);
      if (open) out.push(`Segment bet since ${localDate(open.startedAt)} (${daysSince(open.startedAt, today)} days): ${open.segment}`);
    }
    out.push("</playbook_now>");
  }
  return { since, block: out.join("\n"), quotes, calls: calls.length, verbatim: verbatim.join("\n").toLowerCase(), customers: best.length, replies: replies.length };
}

/* ───────────────────────────── Pricing and hiring ───────────────────────────── */

export interface PricingLog {
  quotes: number;
  accepted: number;
  pushback: number;
  lost: number;
  open: number;
  median: number | null;
  low: number | null;
  high: number | null;
  note: string;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Every quote against its outcome. Five quotes replace the starting price band (W1c commercial rule). */
export function pricingLog(ws: Workspace): PricingLog {
  const quotes = Object.values(ws.deals).flatMap((d) => d.priceQuotes ?? []);
  const amounts = quotes.map((q) => q.amountUsd).sort((a, b) => a - b);
  const count = (o: "accepted" | "pushback" | "lost") => quotes.filter((q) => q.outcome === o).length;
  const accepted = count("accepted");
  const pushback = count("pushback");
  const lost = count("lost");
  const decided = accepted + pushback + lost;
  const median = amounts.length ? (amounts.length % 2 ? amounts[(amounts.length - 1) / 2] : (amounts[amounts.length / 2 - 1] + amounts[amounts.length / 2]) / 2) : null;
  let note: string;
  if (!quotes.length) note = "No price quoted yet. Quote on value, about 10–20% of the annual value you find in discovery, and log every quote with how it landed.";
  else if (quotes.length < 5) note = `${quotes.length} of 5 quotes logged. The starting band holds until there are 5.`;
  else {
    note = `Your quotes now set the anchor instead of the starting band: median ${usd(median!)} (${usd(amounts[0])}–${usd(amounts.at(-1)!)}).`;
    if (decided >= 5 && accepted / decided > 0.7) note += " Nearly every decided quote was accepted: try a higher anchor on the next one.";
    else if (decided >= 5 && pushback + lost > accepted) note += " Most decided quotes met pushback: anchor on the value they quantified, and discount only for something in return.";
  }
  return { quotes: quotes.length, accepted, pushback, lost, open: quotes.length - decided, median, low: amounts[0] ?? null, high: amounts.at(-1) ?? null, note };
}

export interface HiringReadiness {
  customers: number;
  demos: number;
  winRate: number | null;
  closed: number;
  playbookDocumented: boolean;
  missing: string[];
  ready: boolean;
  verdict: string;
}

/** Null until the founder is near the thresholds; the answer before that is always "keep selling yourself". */
export function hiringReadiness(ws: Workspace, now: Date): HiringReadiness | null {
  const deals = Object.values(ws.deals);
  const customers = deals.filter((d) => d.stage === "won").length;
  const nowMs = now.getTime();
  const demos = Object.values(ws.meetings).filter((m) => new Date(m.startsAt).getTime() <= nowMs).length;
  if (customers < HIRING_NEAR.customers && demos < HIRING_NEAR.demos) return null;
  const closed = customers + deals.filter((d) => d.stage === "lost").length;
  const winRate = closed >= 10 ? customers / closed : null;
  const f = ws.foundation;
  const missing = [
    !f?.icp.hypothesis.sentence && "a written ICP",
    !f?.messaging.oneLiner && "a one-line pitch",
    ws.objections.filter((o) => o.approved).length < 3 && "an objection bank (3+ approved)",
    !f?.personas.length && "personas",
  ].filter((x): x is string => !!x);
  const ready = customers >= HIRING_READY.customers && demos >= HIRING_READY.demos && winRate !== null && winRate >= HIRING_READY.winRate && !missing.length;
  const verdict = ready
    ? "Ready to hire: two founding AEs, pathfinders who are your buyer's persona with 18+ months selling at your price point, so you can compare them. Not a VP or a head of sales first."
    : `Keep selling yourself for now: ${customers} of about ${HIRING_READY.customers} customers, ${demos} of about ${HIRING_READY.demos} demos${winRate === null ? ", win rate unknown until 10 closed deals" : `, ${Math.round(winRate * 100)}% win rate (n=${closed})`}${missing.length ? `; still to write down: ${missing.join(", ")}` : ""}. Then hire two founding AEs, not a VP.`;
  return { customers, demos, winRate, closed, playbookDocumented: !missing.length, missing, ready, verdict };
}

/* ───────────────────────────── The month ───────────────────────────── */

export interface MonthlyData {
  month: string;
  /** The bet to read: one that ended and has no readout yet. */
  ended: { bet: StartedBet; readout: BetReadout } | null;
  /** The bet still running, with its counts so far. */
  running: { bet: StartedBet; readout: BetReadout } | null;
  pricing: PricingLog;
  hiring: HiringReadiness | null;
  network: { daysSince: number; jobChanges: number } | null;
  refresh: RefreshInputs;
  stages: Partial<Record<Stage, number>>;
}

export function monthlyData(ws: Workspace, now: Date): MonthlyData {
  const today = todayISO(now);
  const ended = startedBets(ws)
    .filter((b) => b.endsOn < today && !b.readout)
    .at(-1);
  const running = activeBet(ws, today);
  const stages: Partial<Record<Stage, number>> = {};
  for (const d of Object.values(ws.deals)) stages[d.stage] = (stages[d.stage] ?? 0) + 1;
  return {
    month: monthKey(now),
    ended: ended ? { bet: ended, readout: betReadout(ws, ended.id) } : null,
    running: running ? { bet: running, readout: betReadout(ws, running.id) } : null,
    pricing: pricingLog(ws),
    hiring: hiringReadiness(ws, now),
    network: ws.network ? { daysSince: daysSince(ws.network.importedAt, today), jobChanges: ws.network.jobChanges } : null,
    refresh: refreshInputs(ws, now),
    stages,
  };
}
