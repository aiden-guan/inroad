import "server-only";
import { todayISO } from "@/lib/domain/ids";
import type { Account, Evidence, Signal, SignalType, Workspace } from "@/lib/domain/types";
import { ensureAccount, isFreeMail, isSuppressed, normalizeDomain } from "@/lib/hub/records";
import { bestSignal, signalImplications, tierFor, whyNowScore, whyNowSentence } from "@/lib/workflows/enrich";
import { whereLabel } from "./feed";
import { clipQuote } from "./parse";
import { radarFindingId } from "./radar-model";
import { ACTIVITY_LABEL, KIND_LABEL, SOURCE_LABEL, type IntentItem, type IntentKind, type RadarCompany } from "./types";

/**
 * Intent findings become the workspace's own evidence and signals, so they show as "why now" on the account, feed
 * the "They said it in public" play and Today's "Answer the thread" move. Ids are derived from the item, so a
 * finding is attached once and can be taken off again when the founder marks it not relevant.
 */

const SIGNAL_OF: Record<IntentKind, SignalType> = { ask: "community_request", compare: "community_request", problem: "public_pain" };

export const signalIdFor = (id: string) => `sig_${id}`;
export const evidenceIdFor = (id: string) => `ev_${id}`;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

function fit(text: string, max: number): string {
  const w = text.replace(/\s+/g, " ").trim().split(" ");
  return w.length <= max ? w.join(" ") : `${w.slice(0, max).join(" ").replace(/[,;:.]$/, "")}…`;
}

const DEFAULT_IMPLICATION: Record<IntentKind, string> = {
  ask: "They asked in public. Answer in the thread first; email only after they engage.",
  compare: "They're weighing tools now. Answer the question in the thread before anything else.",
  problem: "They described the problem in public. A useful reply where they posted comes before any email.",
};

export function intentEvidence(item: IntentItem, at: string, runId?: string): Evidence {
  const verb = item.kind === "ask" ? "asked" : item.kind === "compare" ? "compared tools" : "described the problem";
  const who = item.author ? `${item.author}` : "Someone";
  const where = whereLabel(item);
  const placed = item.company ? `, who works at ${item.company.name} per ${item.company.basis === "said_in_post" ? "the post" : "their profile"}` : "";
  return {
    id: evidenceIdFor(item.id),
    claim: clipQuote(`${who}${placed} ${verb} on ${where}: “${item.title}”`, 200),
    quote: clipQuote(item.quote, 300),
    url: item.url,
    host: hostOf(item.url),
    sourceType: "community",
    ...(item.postedAt ? { publishedAt: item.postedAt.slice(0, 10) } : {}),
    retrievedAt: at,
    confidence: item.company?.basis === "profile_email" ? "high" : "medium",
    ...(runId ? { runId } : {}),
  };
}

/** Null for an undated post: no date, no signal (it can't say why now). */
export function intentSignal(ws: Workspace, item: IntentItem): Signal | null {
  if (!item.postedAt) return null;
  const type = SIGNAL_OF[item.kind];
  const verb = item.kind === "ask" ? "Asked" : item.kind === "compare" ? "Compared tools" : "Described the problem";
  const prefix = `${verb} on ${SOURCE_LABEL[item.source]}:`;
  return {
    id: signalIdFor(item.id),
    type,
    headline: `${prefix} “${fit(item.title.replace(/[“”"]/g, ""), Math.max(3, 14 - prefix.split(" ").length))}”`,
    date: item.postedAt.slice(0, 10),
    url: item.url,
    host: hostOf(item.url),
    evidenceId: evidenceIdFor(item.id),
    strength: item.relevance === 3 ? 3 : 2,
    usableInOutreach: true,
    implication: fit(signalImplications(ws)[type] ?? DEFAULT_IMPLICATION[item.kind], 25),
  };
}

/**
 * Recomputes the why-now score, sentence and tier after a signal came or went, the way enrichment does: a curated
 * sentence stays while a fresh signal backs it, and is rewritten when the new signal is the best one or when the
 * signal it was written from is gone.
 */
export function rescore(acc: Account, today = todayISO(), change: { added?: string; removed?: Signal } = {}) {
  acc.signals = [...acc.signals].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  acc.whyNowScore = whyNowScore(acc.signals, today, acc.warmPathCount);
  const best = bestSignal(acc.signals.filter((s) => s.usableInOutreach), today);
  const stale = !!change.removed && !!acc.whyNow?.startsWith(change.removed.headline.replace(/…”?$/, "").slice(0, 40));
  if (!best) acc.whyNow = null;
  else if (!acc.whyNow || best.id === change.added || stale) acc.whyNow = whyNowSentence(acc.signals, today);
  if (acc.criteria.length) acc.tier = tierFor(acc.fitScore, acc.whyNowScore) ?? "C";
}

/** Puts the evidence (always) and the signal (when dated) on the account. Idempotent. */
export function attach(ws: Workspace, domain: string, evidence: Evidence, signal: Signal | null): boolean {
  const acc = ws.accounts[domain];
  if (!acc) return false;
  ws.evidence[evidence.id] ??= evidence;
  if (signal && !acc.signals.some((s) => s.id === signal.id)) {
    acc.signals.push(signal);
    rescore(acc, todayISO(), { added: signal.id });
    return true;
  }
  return false;
}

/** Takes a finding's signal and evidence off its account again ("Not relevant", or undo of a track). */
export function detach(ws: Workspace, domain: string | undefined, id: string) {
  const acc = domain ? ws.accounts[domain] : undefined;
  const removed = acc?.signals.find((s) => s.id === signalIdFor(id));
  if (acc && removed) {
    acc.signals = acc.signals.filter((s) => s.id !== removed.id);
    rescore(acc, todayISO(), { removed });
  }
  delete ws.evidence[evidenceIdFor(id)];
}

export type TrackRefusal = "own" | "suppressed" | "no_domain" | "disqualified";

export function refusal(ws: Workspace, domain: string | undefined): TrackRefusal | null {
  const d = domain ? normalizeDomain(domain) : null;
  if (!d || isFreeMail(d)) return "no_domain";
  const own = ws.company?.domain?.toLowerCase();
  if (own && (d === own || d.endsWith(`.${own}`))) return "own";
  if (isSuppressed(ws, undefined, d)) return "suppressed";
  if (ws.accounts[d]?.status === "disqualified") return "disqualified";
  return null;
}

export const REFUSAL_TEXT: Record<TrackRefusal, string> = {
  own: "That's your own company.",
  suppressed: "That company is on your do-not-contact list.",
  no_domain: "I don't know this company's website, so it can't be tracked yet.",
  disqualified: "You disqualified that company. Restore it in Companies first.",
};

/** "Track company" on a post: the account (created if new, and watched), with the post as its evidence and signal. */
export function trackItem(ws: Workspace, item: IntentItem, at: string): { domain: string; created: boolean } {
  const domain = normalizeDomain(item.company?.domain)!;
  const { account, created } = ensureAccount(
    ws,
    { domain, name: item.company?.name },
    { source: "community", sourceDetail: `${SOURCE_LABEL[item.source]} · ${KIND_LABEL[item.kind].toLowerCase()}`, at, tag: "intent" },
  );
  if (created) account.sourceUrl = item.url;
  account.watch = true;
  if (account.status === "new") account.status = "tracked";
  attach(ws, domain, intentEvidence(item, at), intentSignal(ws, item));
  return { domain, created };
}

/** "Track company" on a radar row: GitHub activity as evidence. An issue that names the pain is a public signal. */
export function trackRadar(ws: Workspace, c: RadarCompany, at: string): { domain: string; created: boolean } {
  const domain = normalizeDomain(c.domain)!;
  const { account, created } = ensureAccount(ws, { domain, name: c.name }, { source: "community", sourceDetail: "GitHub · developer radar", at, tag: "developer-radar" });
  account.watch = true;
  if (account.status === "new") account.status = "tracked";
  const id = radarFindingId(domain);
  const url = c.quote?.url ?? `https://github.com/${c.repos[0]}`;
  if (created) account.sourceUrl = url;
  const evidence: Evidence = {
    id: evidenceIdFor(id),
    claim: clipQuote(c.line, 200),
    quote: clipQuote(c.quote?.text ?? `GitHub accounts: ${c.logins.slice(0, 6).join(", ")}`, 300),
    url,
    host: hostOf(url),
    sourceType: "community",
    publishedAt: (c.quote?.at ?? c.lastAt).slice(0, 10),
    retrievedAt: at,
    confidence: "medium",
  };
  const written = c.quote && c.quote.pain && (c.quote.kind === "issue" || c.quote.kind === "discussion");
  const repos = c.repos.length === 1 ? c.repos[0] : `${c.repos.length} repositories`;
  const kinds = (Object.keys(c.counts) as (keyof typeof c.counts)[]).map((k) => ACTIVITY_LABEL[k].many).join(" and ");
  const signal: Signal = written
    ? {
        id: signalIdFor(id),
        type: "public_pain",
        headline: fit(`Opened a public ${ACTIVITY_LABEL[c.quote!.kind].one} on ${c.quote!.repo} about ${c.quote!.pain!.toLowerCase()}`, 14),
        date: c.quote!.at.slice(0, 10),
        url: c.quote!.url,
        host: hostOf(c.quote!.url),
        evidenceId: evidence.id,
        strength: 2,
        usableInOutreach: true,
        implication: "They described the problem in a public issue. Reply there first, and cite the issue if you write later.",
      }
    : {
        id: signalIdFor(id),
        type: "stack_change",
        headline: fit(`${c.logins.length} ${c.logins.length === 1 ? "engineer" : "engineers"} active on ${repos} (${kinds})`, 14),
        date: c.lastAt.slice(0, 10),
        url,
        host: hostOf(url),
        evidenceId: evidence.id,
        strength: 1,
        // Watching what engineers fork is context, never a line in an email.
        usableInOutreach: false,
        implication: "Engineers here are working with tools in your space; a tooling decision may be open. Context only.",
      };
  attach(ws, domain, evidence, signal);
  return { domain, created };
}

