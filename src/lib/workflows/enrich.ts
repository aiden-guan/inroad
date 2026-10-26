import "server-only";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { daysBetween, newId, nowISO, todayISO } from "@/lib/domain/ids";
import type { Account, Enrichment, Evidence, Signal, SignalType, Workspace } from "@/lib/domain/types";
import { gatherSignals } from "@/lib/signals";
import { TTL, cached } from "@/lib/signals/cache";
import { shortUsd, type FormDFiling } from "@/lib/signals/edgar";
import type { HiringPost } from "@/lib/signals/hn-hiring";
import { fetchText, toDomain } from "@/lib/signals/http";
import { findOpenRoles, type JobPosting } from "@/lib/signals/jobs";
import { companyNews, hackerNews, type NewsItem } from "@/lib/signals/news";
import { normalizeCompanyName, shortBatch, ycByDomain, ycDirectory, ycJobs, ycUrl, type YcCompany } from "@/lib/signals/yc";
import { DATA_DIR } from "@/lib/store/settings";
import { defineWorkflow } from "./types";

/**
 * W3 enrichment: a free signal refresh. Job boards, news and Hacker News are read in code
 * (cached on disk), new dated signals are detected with rules, and each one gets an evidence
 * record. No model call — this workflow costs $0.
 *
 * The signal rules below are shared with discovery (they're the "why now" half of the score).
 */

/* ─────────────────────────── Signal rules ─────────────────────────── */

/** Freshness windows in days (SPEC W3 signal catalog). */
export const SIGNAL_WINDOW: Record<SignalType, number> = {
  champion_job_change: 90,
  first_hire: 60, // "while open"; postings are best in the first two weeks
  jd_names_pain: 60,
  community_request: 14,
  new_leader: 90,
  funding: 90,
  stack_change: 90,
  launch: 60,
  compliance_deadline: 270,
  persona_post: 30,
  public_pain: 90,
  filing: 90,
  hiring: 45,
  sensitive: 90,
  life_event: 60,
  seasonal: 45,
  trend: 30,
  competitor_gap: 60,
};

export function signalAge(s: Pick<Signal, "date">, today: string): number {
  return Math.max(0, daysBetween(s.date, today));
}

/** decay = 1 if age ≤ window/3; .6 if ≤ 2·window/3; .3 if ≤ window; else 0. */
export function signalDecay(s: Pick<Signal, "type" | "date">, today: string): number {
  if (s.type === "sensitive") return 0;
  const age = signalAge(s, today);
  const w = SIGNAL_WINDOW[s.type];
  if (age <= w / 3) return 1;
  if (age <= (2 * w) / 3) return 0.6;
  if (age <= w) return 0.3;
  return 0;
}

/**
 * whyNow = min(4, max(sᵢ·decayᵢ) + 0.5 × each other fresh signal type with s ≥ 2) + warm-path bonus.
 * Stacked signals beat any single one; repeats of the same type don't stack.
 */
export function whyNowScore(signals: Signal[], today: string, warmPaths = 0): number {
  const live = signals
    .filter((s) => s.type !== "sensitive" && s.strength > 0)
    .map((s) => ({ s, v: s.strength * signalDecay(s, today) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v);
  let score = live[0]?.v ?? 0;
  if (live.length > 1) {
    const types = new Set([live[0].s.type]);
    for (const x of live.slice(1)) {
      if (x.s.strength >= 2 && !types.has(x.s.type)) {
        score += 0.5;
        types.add(x.s.type);
      }
    }
  }
  if (warmPaths > 0) score += 0.5;
  return Math.round(Math.min(4, score) * 10) / 10;
}

/** A: fit ≥70 & whyNow ≥2 · B: fit ≥70 (watch) · C: fit 50–69 & whyNow ≥3 · otherwise not worth a slot. */
export function tierFor(fit: number, whyNow: number): Account["tier"] | null {
  if (fit >= 70 && whyNow >= 2) return "A";
  if (fit >= 70) return "B";
  if (fit >= 50 && whyNow >= 3) return "C";
  return null;
}

export function bestSignal(signals: Signal[], today: string): Signal | undefined {
  return signals
    .filter((s) => s.type !== "sensitive" && s.strength > 0 && signalDecay(s, today) > 0)
    .sort((a, b) => b.strength * signalDecay(b, today) - a.strength * signalDecay(a, today) || b.date.localeCompare(a.date))[0];
}

function words(s: string, max: number): string {
  const w = s.replace(/\s+/g, " ").trim().split(" ");
  return w.length <= max ? w.join(" ") : `${w.slice(0, max).join(" ").replace(/[,;:.]$/, "")}…`;
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * "Posted “Founding Platform Engineer” (Oct 9). A first engineering hire usually means…" — ≤30 words, a hypothesis.
 * Only from a fresh signal that's usable in outreach: other agents draft from this sentence.
 */
export function whyNowSentence(signals: Signal[], today: string): string | null {
  const best = bestSignal(signals.filter((s) => s.usableInOutreach), today);
  if (!best) return null;
  return words(`${best.headline.replace(/…$/, "")} (${shortDate(best.date)}). ${best.implication}`, 30);
}

/* Buyer functions: which teams' hiring means something for this founder's product. */

const FUNCTIONS: { key: string; label: string; re: RegExp }[] = [
  { key: "revops", label: "revenue operations", re: /\b(revops|revenue operations|sales operations|sales ops|gtm operations|gtm engineer)\b/i },
  { key: "security", label: "security", re: /\b(security|secops|appsec|ciso|compliance|grc|privacy)\b/i },
  { key: "data", label: "data", re: /\b(data|analytics|machine learning|ml engineer|ai engineer|bi engineer)\b/i },
  { key: "finance", label: "finance", re: /\b(finance|financial|accounting|accountant|controller|cfo|fp&a|payroll|billing|treasury)\b/i },
  { key: "sales", label: "sales", re: /\b(sales|account executive|sdr|bdr|business development|cro)\b/i },
  { key: "marketing", label: "marketing", re: /\b(marketing|growth|demand gen|content|brand|seo|cmo)\b/i },
  { key: "support", label: "support", re: /\b(support|customer success|customer experience|cx)\b/i },
  { key: "people", label: "people", re: /\b(people|hr|human resources|recruit\w*|talent)\b/i },
  { key: "legal", label: "legal", re: /\b(legal|counsel|attorney|paralegal)\b/i },
  { key: "design", label: "design", re: /\b(designer|design lead|head of design|ux|ui)\b/i },
  { key: "product", label: "product", re: /\b(product manager|product management|head of product|cpo|product lead)\b/i },
  {
    key: "engineering",
    label: "engineering",
    re: /\b(engineer\w*|developer|devops|sre|platform|infrastructure|backend|back-end|frontend|front-end|full[- ]?stack|software|cto|architect)\b/i,
  },
  { key: "operations", label: "operations", re: /\b(operations|ops|coo|supply chain|logistics)\b/i },
];

export function functionOf(text: string): (typeof FUNCTIONS)[number] | undefined {
  return FUNCTIONS.find((f) => f.re.test(text));
}

/** The functions the founder sells into, read from personas, triggers and the ICP. */
export function buyerFunctions(ws: Workspace): string[] {
  const f = ws.foundation;
  const texts: string[] = [];
  for (const p of f?.personas ?? []) if (p.role !== "blocker") texts.push(...p.titles);
  if (f) texts.push(f.icp.hypothesis.role, ...f.icp.triggers.map((t) => t.implication));
  if (!texts.length && ws.company) texts.push(ws.company.whoItsFor);
  const counts = new Map<string, number>();
  for (const t of texts) {
    for (const fn of FUNCTIONS) if (fn.re.test(t)) counts.set(fn.key, (counts.get(fn.key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
}

/** Per-signal implications the playbook already wrote for this ICP (preferred over generic ones). */
export function signalImplications(ws: Workspace): Partial<Record<SignalType, string>> {
  const out: Partial<Record<SignalType, string>> = {};
  for (const s of ws.foundation?.messaging.bySignal ?? []) if (s.implication) out[s.signal] = words(s.implication, 25);
  for (const t of ws.foundation?.icp.triggers ?? []) if (t.implication) out[t.type] = words(t.implication, 25);
  return out;
}

/** The title to talk to first: the champion persona, else the economic buyer. */
export function suggestedTitle(ws: Workspace): string | undefined {
  const personas = ws.foundation?.personas ?? [];
  return (
    personas.find((p) => p.role === "champion")?.titles[0] ??
    personas.find((p) => p.role === "economic_buyer")?.titles[0] ??
    (ws.foundation?.icp.hypothesis.role || undefined)
  );
}

const FIRST_HIRE = /\b(founding|first|head of|#1)\b/i;
const SENSITIVE = /\b(layoffs?|lays off|laid off|lawsuit|sued|sues|breach|hacked|bankrupt\w*|shuts? down|investigation|fraud|indicted)\b/i;
// Needs an amount or a round: "raises concerns" and "raises the bar" aren't funding.
const FUNDING =
  /\b(?:(?:raises?|raised|secures?|secured|closes?|closed|lands?|landed)\s+(?:an?\s+|its\s+)?(?:[$€£]\s?[\d.]+|[\d.]+\s?(?:k|m|mn|million|b|bn|billion)\b|(?:new\s+)?(?:seed|pre-seed|series [a-e]|funding|round))|series [a-e] (?:round|funding)|(?:pre-)?seed round|funding round)/i;
const NEW_LEADER = /\b(appoints?|appointed|names|hires|joins as|promotes?|welcomes)\b.*\b(chief|cto|cfo|coo|cro|cmo|ciso|vp|vice president|head of|president|general manager)\b/i;
const LAUNCH = /\b(launch(es|ed)?|unveils?|introduces?|debuts?|rolls out|expands? (to|into)|opens|now available|general availability|ga)\b/i;

function defaultImplication(type: SignalType, fnLabel?: string): string {
  switch (type) {
    case "first_hire":
      return `A first ${fnLabel ?? "dedicated"} hire usually means the founders are handing that work off, and the new owner picks tools early.`;
    case "hiring":
      return `Hiring in ${fnLabel ?? "this team"} likely means that team is stretched right now.`;
    case "funding":
      return "New funding usually comes with a scaling plan. The stated use of funds is the angle, not the raise.";
    case "new_leader":
      return "New leaders usually review tools and processes in their first 30–60 days.";
    case "launch":
      return "A launch usually adds load on the team that has to support it.";
    case "sensitive":
      return "Context only. Never reference this in outreach.";
    default:
      return "Likely a reason to talk now; confirm on the first call.";
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export interface SignalSources {
  name: string;
  domain: string;
  jobs: JobPosting[];
  boardUrl?: string;
  jobsFrom?: "ats" | "yc";
  /** `via`: which news query found it. Name-only hits can be a different company with the same name. */
  news?: (NewsItem & { signal?: boolean; via?: "domain" | "name" })[];
  hn?: NewsItem[];
  yc?: YcCompany | null;
}

export interface FoundSignal {
  signal: Omit<Signal, "id" | "evidenceId">;
  evidence: Omit<Evidence, "id" | "retrievedAt" | "runId">;
}

/**
 * Rules that turn free data into dated, sourced signals. No date → no signal. Generic hiring
 * outside the buyer's function is skipped (strength 0 in the catalog).
 */
export function detectSignals(
  src: SignalSources,
  opts: { today: string; functions: string[]; implications: Partial<Record<SignalType, string>> },
): FoundSignal[] {
  const { today, functions, implications } = opts;
  const out: FoundSignal[] = [];
  const jobConfidence = src.jobsFrom === "yc" ? "medium" : "high";
  const imp = (type: SignalType, fnLabel?: string) => implications[type] ?? defaultImplication(type, fnLabel);

  const dated = src.jobs
    .filter((j) => j.postedAt && j.title?.trim())
    .map((j) => ({ ...j, title: j.title.trim(), date: j.postedAt!.slice(0, 10), age: Math.max(0, daysBetween(j.postedAt!.slice(0, 10), today)), fn: functionOf(`${j.title} ${j.team ?? ""}`) }))
    .filter((j) => j.age <= 120)
    .sort((a, b) => a.age - b.age);
  const inFn = (j: (typeof dated)[number]) => (functions.length ? !!j.fn && functions.includes(j.fn.key) : false);

  const jobEvidence = (j: (typeof dated)[number], quote = j.title): FoundSignal["evidence"] => {
    const url = j.url || src.boardUrl || `https://${src.domain}`;
    return {
      claim: words(`${src.name} posted “${j.title}”${j.team ? ` (${j.team})` : ""}`, 30).slice(0, 200),
      quote: quote.slice(0, 300),
      url,
      host: hostOf(url),
      sourceType: "job_post",
      publishedAt: j.date,
      confidence: jobConfidence,
    };
  };

  const first = dated.find((j) => FIRST_HIRE.test(j.title) && j.age <= SIGNAL_WINDOW.first_hire && (inFn(j) || !functions.length));
  if (first) {
    const ev = jobEvidence(first);
    out.push({
      signal: {
        type: "first_hire",
        headline: words(`Posted “${first.title}”`, 14),
        date: first.date,
        url: ev.url,
        host: ev.host,
        strength: functions.length ? 3 : 2,
        usableInOutreach: true,
        implication: imp("first_hire", first.fn?.label),
      },
      evidence: ev,
    });
  }

  const fnRecent = dated.filter((j) => j !== first && inFn(j) && j.age <= SIGNAL_WINDOW.hiring);
  const last30 = fnRecent.filter((j) => j.age <= 30);
  if (last30.length >= 3) {
    const label = last30[0].fn?.label ?? "these";
    const url = src.boardUrl || last30[0].url || `https://${src.domain}`;
    out.push({
      signal: {
        type: "hiring",
        headline: words(`Hiring ${last30.length} ${label} roles in 30 days`, 14),
        date: last30[0].date,
        url,
        host: hostOf(url),
        strength: 2,
        usableInOutreach: true,
        implication: imp("hiring", label),
      },
      evidence: {
        ...jobEvidence(last30[0], last30.slice(0, 4).map((j) => j.title).join("; ")),
        claim: `${src.name} posted ${last30.length} ${label} roles in the last 30 days`,
        url,
        host: hostOf(url),
      },
    });
  } else if (fnRecent.length) {
    const j = fnRecent[0];
    const ev = jobEvidence(j);
    out.push({
      signal: {
        type: "hiring",
        headline: words(`Posted “${j.title}”`, 14),
        date: j.date,
        url: ev.url,
        host: ev.host,
        strength: 1,
        usableInOutreach: true,
        implication: imp("hiring", j.fn?.label),
      },
      evidence: ev,
    });
  }

  // News: dated headlines only, classified by rules. Sensitive news is context, never outreach.
  // A headline matched only by name can be another company with the same name ("Atlas raises $20M"):
  // it must carry the exact name, and even then it's low-confidence context, not a reason to reach out.
  const domain = src.domain.toLowerCase();
  const exactName = new RegExp(`\\b${src.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  let newsTaken = 0;
  let unconfirmedTaken = 0;
  let sensitiveTaken = false;
  for (const n of src.news ?? []) {
    if (!n.publishedAt || !n.title) continue;
    const host = hostOf(n.url);
    const confirmed = n.via === "domain" || host === domain || host.endsWith(`.${domain}`) || n.title.toLowerCase().includes(domain);
    if (!confirmed && !exactName.test(n.title)) continue;
    const date = n.publishedAt.slice(0, 10);
    const age = Math.max(0, daysBetween(date, today));
    const type: SignalType | null = SENSITIVE.test(n.title)
      ? "sensitive"
      : FUNDING.test(n.title)
        ? "funding"
        : NEW_LEADER.test(n.title)
          ? "new_leader"
          : LAUNCH.test(n.title)
            ? "launch"
            : null;
    if (!type || age > SIGNAL_WINDOW[type]) continue;
    if (type === "sensitive" ? sensitiveTaken : confirmed ? newsTaken >= 2 : unconfirmedTaken >= 2) continue;
    if (type === "sensitive") sensitiveTaken = true;
    else if (confirmed) newsTaken++;
    else unconfirmedTaken++;
    out.push({
      signal: {
        type,
        headline: words(n.title, 14),
        date,
        url: n.url,
        host,
        strength: type === "sensitive" ? 0 : confirmed ? 2 : 1,
        usableInOutreach: type !== "sensitive" && confirmed,
        implication: imp(type),
      },
      evidence: {
        claim: n.title.slice(0, 200),
        quote: n.title.slice(0, 300),
        url: n.url,
        host,
        sourceType: "press",
        publishedAt: date,
        confidence: confirmed ? "medium" : "low",
      },
    });
  }

  // Launch HN / Show HN that links to their own domain.
  const hnLaunch = (src.hn ?? []).find(
    (h) => h.publishedAt && /^(launch hn|show hn)\b/i.test(h.title) && daysBetween(h.publishedAt.slice(0, 10), today) <= SIGNAL_WINDOW.launch,
  );
  if (hnLaunch?.publishedAt) {
    const date = hnLaunch.publishedAt.slice(0, 10);
    out.push({
      signal: {
        type: "launch",
        headline: words(hnLaunch.title, 14),
        date,
        url: hnLaunch.url,
        host: hostOf(hnLaunch.url),
        strength: /^launch hn/i.test(hnLaunch.title) ? 2 : 1,
        usableInOutreach: true,
        implication: imp("launch"),
      },
      evidence: {
        claim: `${src.name} posted on Hacker News: ${hnLaunch.title}`.slice(0, 200),
        quote: hnLaunch.title.slice(0, 300),
        url: hnLaunch.url,
        host: hostOf(hnLaunch.url),
        sourceType: "community",
        publishedAt: date,
        confidence: "high",
      },
    });
  }

  // A fresh YC launch is real but weak on its own (batchmates are low-signal unless they fit).
  const yc = src.yc;
  if (yc?.launchedAt && !out.some((s) => s.signal.type === "launch")) {
    const date = todayISO(new Date(yc.launchedAt * 1000));
    if (daysBetween(date, today) <= SIGNAL_WINDOW.launch) {
      out.push({
        signal: {
          type: "launch",
          headline: `Launched on YC (${shortBatch(yc.batch)})`,
          date,
          url: ycUrl(yc),
          host: "ycombinator.com",
          strength: 1,
          usableInOutreach: true,
          implication: imp("launch"),
        },
        evidence: {
          claim: `${yc.name} launched in the YC directory (${yc.batch}): ${yc.oneLiner}`.slice(0, 200),
          quote: yc.oneLiner.slice(0, 300),
          url: ycUrl(yc),
          host: "ycombinator.com",
          sourceType: "press",
          publishedAt: date,
          confidence: "medium",
        },
      });
    }
  }

  return out.sort((a, b) => b.signal.strength - a.signal.strength || b.signal.date.localeCompare(a.signal.date));
}

/**
 * A Form D notice as a dated funding signal: the filing date, what was sold, and a link to the record.
 * `matched` says how sure the domain is (the filing has no website): a name match on a directory or the
 * company's own site counts, a guess doesn't, and a guess is context, never an outreach line.
 */
export function filingSignal(
  f: Pick<FormDFiling, "company" | "filedAt" | "url" | "amountSoldUsd" | "totalOfferingUsd" | "firstSaleOn" | "industry" | "isAmendment">,
  opts: { today: string; implication?: string; matched: boolean },
): FoundSignal | null {
  const age = daysBetween(f.filedAt, opts.today);
  if (age < 0 || age > SIGNAL_WINDOW.funding || f.isAmendment) return null;
  const sold = shortUsd(f.amountSoldUsd);
  const offered = shortUsd(f.totalOfferingUsd);
  const quote = [
    f.totalOfferingUsd !== undefined ? `Total Offering Amount: $${f.totalOfferingUsd.toLocaleString("en-US")}` : null,
    f.amountSoldUsd !== undefined ? `Total Amount Sold: $${f.amountSoldUsd.toLocaleString("en-US")}` : null,
    f.firstSaleOn ? `Date of First Sale: ${f.firstSaleOn}` : null,
    f.industry ? `Industry Group: ${f.industry}` : null,
  ]
    .filter(Boolean)
    .join("; ");
  return {
    signal: {
      type: "funding",
      headline: words(sold ? `Filed a Form D: ${sold} raised` : "Filed a Form D for a new round", 14),
      date: f.filedAt,
      url: f.url,
      host: "sec.gov",
      strength: opts.matched ? 2 : 1,
      usableInOutreach: opts.matched,
      implication: opts.implication ?? defaultImplication("funding"),
    },
    evidence: {
      claim: `${f.company} filed a Form D on ${f.filedAt}${sold ? `: ${sold} sold${offered && offered !== sold ? ` of ${offered} offered` : ""}` : ""}`.slice(0, 200),
      quote: (quote || `Form D filed ${f.filedAt}`).slice(0, 300),
      url: f.url,
      host: "sec.gov",
      sourceType: "filing",
      publishedAt: f.filedAt,
      confidence: opts.matched ? "high" : "low",
    },
  };
}

/** The roles in a "Who is hiring?" post as dated postings, so the job rules read them like a board. */
export function hiringPostJobs(post: Pick<HiringPost, "roles" | "postedAt" | "url">): JobPosting[] {
  return post.roles.map((title) => ({ title, postedAt: post.postedAt, url: post.url, team: functionOf(title)?.label }));
}

export function signalKey(s: Pick<Signal, "type" | "url" | "date">): string {
  return `${s.type}|${s.url}|${s.date}`;
}

/* ─────────────────────────── Free lookups ─────────────────────────── */

const ATS_URL = {
  ashby: (t: string) => `https://jobs.ashbyhq.com/${t}`,
  greenhouse: (t: string) => `https://job-boards.greenhouse.io/${t}`,
  lever: (t: string) => `https://jobs.lever.co/${t}`,
  workable: (t: string) => `https://apply.workable.com/${t}`,
} as const;

type Board = NonNullable<Enrichment["jobBoard"]>;

export function boardUrl(board: Board | undefined): string | undefined {
  return board ? ATS_URL[board.provider](board.token) : undefined;
}

// Short generic stems ("get", "try") resolve to someone else's board; don't guess those.
const GENERIC_STEMS = new Set(["app", "get", "try", "use", "hello", "team", "home", "join", "the", "my", "go", "hey", "meet", "with"]);

/**
 * Open roles for a company: the known board first, else guessed ATS slugs (Ashby → Greenhouse →
 * Lever), else YC's own job board. Cached a day. Guess results use their own cache key so a later
 * site crawl that finds the real board isn't shadowed.
 */
export async function lightJobs(
  domain: string,
  opts: { board?: Board; tokens?: (string | undefined)[]; ycSlug?: string } = {},
): Promise<{ jobs: JobPosting[]; board?: Board; boardUrl?: string; from?: "ats" | "yc"; lookups: number }> {
  let lookups = 0;
  if (opts.board) {
    lookups++;
    const r = await cached(`jobs:${domain}`, TTL.day, () => findOpenRoles([opts.board!], domain));
    if (r.jobs.length) return { jobs: r.jobs, board: r.source, boardUrl: boardUrl(r.source), from: "ats", lookups };
  } else {
    const tokens = [
      ...new Set(
        [domain.split(".")[0], ...(opts.tokens ?? [])]
          .filter((t): t is string => !!t)
          .map((t) => t.toLowerCase().replace(/[^a-z0-9-]/g, ""))
          .filter((t) => t.length >= 4 && !GENERIC_STEMS.has(t)),
      ),
    ].slice(0, 2);
    if (tokens.length) {
      lookups++;
      const boards = tokens.flatMap((token) => (["ashby", "greenhouse", "lever"] as const).map((provider) => ({ provider, token })));
      const r = await cached(`jobs:guess2:${domain}`, TTL.day, () => findOpenRoles(boards, domain, { guessed: true, name: opts.tokens?.find(Boolean) }));
      if (r.jobs.length) return { jobs: r.jobs, board: r.source, boardUrl: boardUrl(r.source), from: "ats", lookups };
    }
  }
  if (opts.ycSlug) {
    lookups++;
    const jobs = await ycJobs(opts.ycSlug);
    if (jobs.length) return { jobs, boardUrl: `https://www.ycombinator.com/companies/${opts.ycSlug}/jobs`, from: "yc", lookups };
  }
  return { jobs: [], lookups };
}

export function rolesByTeam(jobs: JobPosting[]): Enrichment["rolesByTeam"] {
  const byTeam = new Map<string, string[]>();
  for (const j of jobs) byTeam.set(j.team || "Other", [...(byTeam.get(j.team || "Other") ?? []), j.title]);
  return [...byTeam.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([team, titles]) => ({ team, count: titles.length, titles: [...new Set(titles)].slice(0, 6) }));
}

export function newsForEnrichment(news: (NewsItem & { signal?: boolean })[]): Enrichment["news"] {
  return news.slice(0, 8).map((n) => ({ title: n.title, url: n.url, source: n.source, publishedAt: n.publishedAt, signal: Boolean(n.signal) }));
}

function metaContent(html: string, key: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  return tag?.match(/content=["']([^"']*)["']/i)?.[1]?.trim() || undefined;
}

function decode(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SiteBasics {
  domain: string;
  url: string;
  name: string;
  title: string;
  description: string;
}

/** Homepage name and description with one cached GET (a week). Null when the site can't be reached. */
export async function siteBasics(domain: string): Promise<SiteBasics | null> {
  try {
    return await cached(`basics:${domain}`, TTL.week, async () => {
      const res = (await fetchText(`https://${domain}`, { timeoutMs: 8000, maxBytes: 800_000 })) ?? (await fetchText(`https://www.${domain}`, { timeoutMs: 8000, maxBytes: 800_000 }));
      if (!res) throw new Error("unreachable");
      const html = res.body;
      const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
      const site = metaContent(html, "og:site_name");
      const description = decode(metaContent(html, "description") ?? metaContent(html, "og:description") ?? "");
      const name = decode(site || title.split(/\s[|\-–—:·]\s|[|–—·]/)[0] || "") || domain;
      return { domain, url: res.url, name: name.slice(0, 80), title: title.slice(0, 160), description: description.slice(0, 300) };
    });
  } catch {
    return null;
  }
}

/* ─────────────────────────── Warm paths ─────────────────────────── */

/** Connections per company from the founder's LinkedIn import (connections.json), read locally. */
export function warmPathIndex(): { byDomain: Map<string, number>; byName: Map<string, number> } {
  const byDomain = new Map<string, number>();
  const byName = new Map<string, number>();
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "connections.json"), "utf8"));
    const obj = raw as Record<string, unknown> | unknown[];
    const rows: unknown[] = Array.isArray(obj)
      ? obj
      : Array.isArray((obj as { connections?: unknown[] }).connections)
        ? (obj as { connections: unknown[] }).connections
        : Object.values(obj);
    for (const r of rows) {
      const row = r as { matchedDomain?: string; companyNorm?: string; company?: string };
      if (row.matchedDomain) byDomain.set(row.matchedDomain, (byDomain.get(row.matchedDomain) ?? 0) + 1);
      const n = normalizeCompanyName(row.companyNorm || row.company || "");
      if (n) byName.set(n, (byName.get(n) ?? 0) + 1);
    }
  } catch {
    // no import yet
  }
  return { byDomain, byName };
}

/* ─────────────────────────── Utilities ─────────────────────────── */

/** Runs `fn` over items with at most `n` in flight. */
export async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      if (signal?.aborted) return;
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

function isPlaceholderName(acc: Account): boolean {
  const stem = acc.domain.split(".")[0];
  return !acc.name || acc.name.toLowerCase() === acc.domain || acc.name.toLowerCase() === stem;
}

function firstLocation(locations: string): string | undefined {
  return locations.split(";")[0]?.split(",")[0]?.trim() || undefined;
}

/* ─────────────────────────── The workflow ─────────────────────────── */

interface Refreshed {
  domain: string;
  found: FoundSignal[];
  enrichment: Enrichment;
  lookups: number;
  siteName?: string;
  siteDescription?: string;
  yc?: YcCompany;
}

export default defineWorkflow({
  id: "enrich",
  args: z.object({ domains: z.array(z.string().min(3).max(200)).min(1).max(50) }),
  title: (a, ws) =>
    a.domains.length === 1 ? `Checking signals for ${ws.accounts[a.domains[0]]?.name ?? a.domains[0]}` : `Checking signals for ${a.domains.length} companies`,
  ref: (a) => (a.domains.length === 1 ? { kind: "account", id: a.domains[0] } : undefined),
  heavy: false,
  run: async (ctx) => {
    const ws = ctx.read();
    const today = todayISO();
    const functions = buyerFunctions(ws);
    const implications = signalImplications(ws);
    const domains = [...new Set(ctx.args.domains.map((d) => toDomain(d) ?? d.toLowerCase()))].filter((d) => ws.accounts[d]);
    if (!domains.length) {
      ctx.emit({ type: "status", text: "Nothing to check" });
      return { checked: 0, newSignals: 0, accounts: [] };
    }

    ctx.emit({ type: "status", text: domains.length === 1 ? `Checking job boards and news for ${ws.accounts[domains[0]].name}` : `Checking job boards and news for ${domains.length} companies` });
    const dir = await ycDirectory();

    const results = await pool(
      domains,
      4,
      async (domain): Promise<Refreshed | null> => {
        const acc = ctx.read().accounts[domain];
        if (!acc) return null;
        const yc = ycByDomain(dir, domain);
        const name = isPlaceholderName(acc) ? (yc?.name ?? acc.name) : acc.name;
        try {
          if (!acc.enrichment) {
            // First look at this company: read a couple of pages too (free), so the sheet has something to show.
            const sig = await gatherSignals(domain, { name: isPlaceholderName(acc) ? yc?.name : acc.name, maxPages: 2 });
            for (const p of sig.site?.pages ?? []) ctx.emit({ type: "read", url: p.url, host: hostOf(p.url) });
            let jobs = sig.jobs;
            let from: "ats" | "yc" | undefined = jobs.length ? "ats" : undefined;
            let url = boardUrl(sig.jobSource);
            let lookups = sig.lookups;
            if (!jobs.length && yc) {
              const yj = await ycJobs(yc.slug);
              lookups++;
              if (yj.length) {
                jobs = yj;
                from = "yc";
                url = `https://www.ycombinator.com/companies/${yc.slug}/jobs`;
              }
            }
            const enrichment: Enrichment = { ...sig.enrichment, openRoles: jobs.length, rolesByTeam: rolesByTeam(jobs) };
            const found = detectSignals({ name: sig.name || name, domain, jobs, boardUrl: url, jobsFrom: from, news: sig.news, hn: sig.hn, yc }, { today, functions, implications });
            return { domain, found, enrichment, lookups, siteName: sig.site?.name, siteDescription: sig.site?.pages[0]?.description, yc };
          }

          const prev = acc.enrichment;
          const [jobsRes, news, hn] = await Promise.all([
            lightJobs(domain, { board: prev.jobBoard, tokens: [yc?.slug], ycSlug: yc?.slug }),
            cached(`news:${domain}`, 12 * TTL.hour, () => companyNews(name, domain)).catch(() => []),
            cached(`hn:${domain}`, 12 * TTL.hour, () => hackerNews(domain)).catch(() => []),
          ]);
          const enrichment: Enrichment = {
            ...prev,
            crawledAt: nowISO(),
            jobBoard: jobsRes.board ?? prev.jobBoard,
            openRoles: jobsRes.jobs.length,
            rolesByTeam: rolesByTeam(jobsRes.jobs),
            news: news.length ? newsForEnrichment(news) : prev.news,
          };
          const found = detectSignals(
            { name, domain, jobs: jobsRes.jobs, boardUrl: jobsRes.boardUrl, jobsFrom: jobsRes.from, news, hn, yc },
            { today, functions, implications },
          );
          return { domain, found, enrichment, lookups: jobsRes.lookups + 2, yc };
        } catch (err) {
          console.warn(`[enrich] ${domain} failed:`, err);
          return null;
        }
      },
      ctx.signal,
    );

    const done = results.filter((r): r is Refreshed => !!r);
    ctx.noteFreeSignals(done.reduce((n, r) => n + r.lookups, 0));

    const summary = await ctx.mutate((draft) => {
      const out: { domain: string; name: string; added: string[] }[] = [];
      for (const r of done) {
        const acc = draft.accounts[r.domain];
        if (!acc) continue;
        const keys = new Set(acc.signals.map(signalKey));
        const added: Signal[] = [];
        for (const f of r.found) {
          const key = signalKey(f.signal);
          if (keys.has(key)) continue;
          keys.add(key);
          const evId = newId("ev");
          draft.evidence[evId] = { ...f.evidence, id: evId, retrievedAt: nowISO(), runId: ctx.runId };
          const sig: Signal = { ...f.signal, id: newId("sig"), evidenceId: evId };
          acc.signals.push(sig);
          added.push(sig);
        }
        acc.signals = acc.signals.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
        acc.enrichment = r.enrichment;
        if (isPlaceholderName(acc) && (r.yc?.name || r.siteName)) acc.name = (r.yc?.name || r.siteName)!.slice(0, 80);
        if (!acc.oneLiner) acc.oneLiner = (r.yc?.oneLiner || r.siteDescription || "").slice(0, 160) || undefined;
        if (r.yc) {
          acc.hqCity ??= firstLocation(r.yc.locations);
          acc.tags ??= r.yc.tags.slice(0, 4);
        }
        acc.whyNowScore = whyNowScore(acc.signals, today, acc.warmPathCount);
        // Keep a curated sentence while a fresh signal backs it; clear it once nothing fresh is left.
        const best = bestSignal(acc.signals.filter((s) => s.usableInOutreach), today);
        if (!best) acc.whyNow = null;
        else if (!acc.whyNow || added.includes(best)) acc.whyNow = whyNowSentence(acc.signals, today);
        // Only re-tier accounts that were scored against the ICP; never drop a tier below C here.
        if (acc.criteria.length) acc.tier = tierFor(acc.fitScore, acc.whyNowScore) ?? "C";
        out.push({ domain: acc.domain, name: acc.name, added: added.map((s) => s.headline) });
      }
      return out;
    });

    const newSignals = summary.reduce((n, a) => n + a.added.length, 0);
    for (const a of summary) if (a.added.length) ctx.emit({ type: "action", text: `${a.name}: ${a.added[0]}${a.added.length > 1 ? ` (+${a.added.length - 1} more)` : ""}` });
    const urls = done.flatMap((r) => r.found.map((f) => f.signal.url));
    if (urls.length) ctx.emit({ type: "sources", sources: [...new Set(urls)].slice(0, 40).map((url) => ({ url, host: hostOf(url), title: hostOf(url) })) });
    ctx.emit({ type: "status", text: newSignals ? `Found ${newSignals} new signal${newSignals === 1 ? "" : "s"}` : "No new signals since last check" });
    return { checked: done.length, newSignals, accounts: summary };
  },
});
