import "server-only";
import { todayISO } from "@/lib/domain/ids";
import type { ICPCriterion, Signal, SignalType, Workspace } from "@/lib/domain/types";
import { normalizeDomain } from "@/lib/hub/records";
import { normalizeCompany } from "@/lib/network/csv";
import { readConnections } from "@/lib/network/store";
import { tierFor, whyNowScore } from "@/lib/workflows/enrich";

/**
 * Rule-based account scoring for outside agents (score_accounts): no model call, so an AI SDR can
 * filter a list before spending its own enrichment credits. Same formula as discovery:
 *   fit = round(100 × Σ(w·m)/Σw), must-have w=3, nice-to-have w=1; true=1, unknown=.5, false=0.
 *   whyNow from supplied signals with the signal catalog's strengths and freshness decay.
 *   A: fit ≥70 & whyNow ≥2 · B: fit ≥70 · C: fit 50–69 & whyNow ≥3 · otherwise none.
 * A word missing from a short description is never evidence against fit: it stays unknown.
 */

export interface ScoreInput {
  domain?: string;
  name?: string;
  description?: string;
  industry?: string;
  employees?: number;
  location?: string;
  tags?: string[];
  signals?: { type: SignalType; date: string; url?: string }[];
}

export interface ScoreOutput {
  domain: string | null;
  name: string | null;
  tier: "A" | "B" | "C" | "none";
  fit_score: number;
  why_now: number;
  reasons: string[];
  disqualified: string | null;
  warm_paths: number;
  /** Set when Inroad already tracks this company; its own scores win. */
  known: { status: string; tier: string; fit_score: number; why_now: number; tracked: boolean; has_deal: boolean } | null;
}

/** Strengths from the signal catalog (SPEC W3). */
const STRENGTH: Record<SignalType, 0 | 1 | 2 | 3> = {
  champion_job_change: 3,
  first_hire: 3,
  jd_names_pain: 3,
  community_request: 3,
  new_leader: 2,
  funding: 2,
  stack_change: 2,
  launch: 2,
  compliance_deadline: 2,
  persona_post: 2,
  public_pain: 1,
  filing: 1,
  hiring: 1,
  sensitive: 0,
};

/** Which supplied signal types count as evidence for a situational criterion, by its detection method. */
const DETECTS: Partial<Record<ICPCriterion["detection"], SignalType[]>> = {
  job_posts: ["first_hire", "hiring", "jd_names_pain"],
  press: ["funding", "new_leader", "launch"],
  form_d: ["funding", "filing"],
  github: ["launch", "stack_change"],
  hn: ["community_request", "persona_post", "launch"],
  dns: ["stack_change"],
  site: ["launch", "stack_change"],
};

const STOP = new Set(
  "with that this from have their they them than then into onto over under about after before more most less least very much many such some each every other only also just like using uses used use based where when which while whose what who whom will would could should must need needs needed team teams company companies business businesses people person someone something those these there here early stage stages scale scaling growing growth fast first second third least plus within across between around among without".split(
    " ",
  ),
);

const stem = (w: string) => w.replace(/(ies)$/, "y").replace(/(ing|ers|er|es|s)$/, "");

function keywords(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.toLowerCase().matchAll(/[a-z][a-z0-9+-]{3,}/g)) {
    const w = m[0].replace(/-+$/, "");
    if (!STOP.has(w)) out.add(stem(w));
  }
  return [...out].slice(0, 8);
}

function parseBand(text: string): [number, number] | undefined {
  const t = text.toLowerCase().replace(/,/g, "");
  const unit = "(?:employees|people|staff|ftes?|engineers|headcount|person)";
  let m = t.match(new RegExp(`(\\d+)\\s*(?:-|–|—|to)\\s*(\\d+)\\s*\\+?\\s*${unit}`));
  if (m) return [Number(m[1]), Number(m[2])];
  m = t.match(new RegExp(`(?:under|fewer than|less than|below|<)\\s*(\\d+)\\s*${unit}`));
  if (m) return [1, Number(m[1])];
  m = t.match(new RegExp(`(?:over|more than|at least|above|>)\\s*(\\d+)\\s*${unit}`)) ?? t.match(new RegExp(`(\\d+)\\+\\s*${unit}`));
  if (m) return [Number(m[1]), 10_000_000];
  return undefined;
}

const BAND: Record<NonNullable<NonNullable<Workspace["foundation"]>["icp"]["employeeBand"]>, [number, number] | undefined> = {
  lt50: [1, 49],
  "50_300": [50, 300],
  gt300: [301, 10_000_000],
  mixed: undefined,
};

interface Crit {
  id: string;
  text: string;
  mustHave: boolean;
  kind: ICPCriterion["kind"];
  detection: ICPCriterion["detection"];
  words: string[];
  band?: [number, number];
}

export interface ScoringContext {
  ready: boolean;
  crits: Crit[];
  anti: { text: string; words: string[] }[];
  band?: [number, number];
  own?: string;
  competitors: { names: Set<string>; domains: Set<string> };
  suppressed: Set<string>;
  warm: { byDomain: Map<string, number>; byName: Map<string, number> };
  ws: Workspace;
  today: string;
}

export function scoringContext(ws: Workspace): ScoringContext {
  const f = ws.foundation;
  const crits: Crit[] = (f?.icp.criteria ?? []).map((c) => ({ id: c.id, text: c.text, mustHave: c.mustHave, kind: c.kind, detection: c.detection, words: keywords(c.text), band: parseBand(c.text) }));
  const competitors = { names: new Set<string>(), domains: new Set<string>() };
  for (const c of f?.competitors ?? []) {
    competitors.names.add(normalizeCompany(c.name));
    const d = c.domain ? normalizeDomain(c.domain) : null;
    if (d) competitors.domains.add(d);
  }
  for (const a of f?.positioning.alternatives ?? []) if (a.kind === "competitor") competitors.names.add(normalizeCompany(a.name));
  const warm = { byDomain: new Map<string, number>(), byName: new Map<string, number>() };
  for (const r of readConnections()) {
    if (r.matchedDomain) warm.byDomain.set(r.matchedDomain, (warm.byDomain.get(r.matchedDomain) ?? 0) + 1);
    const n = r.companyNorm || normalizeCompany(r.company);
    if (n) warm.byName.set(n, (warm.byName.get(n) ?? 0) + 1);
  }
  return {
    ready: Boolean(f && crits.length),
    crits,
    anti: (f?.icp.antiIcp ?? []).map((a) => ({ text: a.text, words: keywords(a.text) })),
    band: (f?.icp.employeeBand ? BAND[f.icp.employeeBand] : undefined) ?? crits.find((c) => c.band)?.band,
    own: ws.company?.domain?.toLowerCase(),
    competitors,
    suppressed: new Set(ws.suppression.map((s) => s.domain?.toLowerCase()).filter(Boolean) as string[]),
    warm,
    ws,
    today: todayISO(),
  };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function scoreAccount(ctx: ScoringContext, input: ScoreInput): ScoreOutput {
  const domain = input.domain ? normalizeDomain(input.domain) : null;
  const name = input.name?.trim() || null;
  const norm = name ? normalizeCompany(name) : "";
  const text = [input.name, input.industry, input.description, ...(input.tags ?? [])].filter(Boolean).join(" ").toLowerCase();
  const textWords = new Set([...text.matchAll(/[a-z][a-z0-9+-]{3,}/g)].map((m) => stem(m[0].replace(/-+$/, ""))));
  const warm = (domain ? ctx.warm.byDomain.get(domain) : undefined) ?? (norm ? ctx.warm.byName.get(norm) : undefined) ?? 0;
  const reasons: string[] = [];
  const out = (o: Partial<ScoreOutput>): ScoreOutput => ({ domain, name, tier: "none", fit_score: 0, why_now: 0, reasons, disqualified: null, warm_paths: warm, known: null, ...o });

  const acc = domain ? ctx.ws.accounts[domain] : undefined;
  const known = acc
    ? { status: acc.status, tier: acc.tier, fit_score: acc.fitScore, why_now: acc.whyNowScore, tracked: acc.watch, has_deal: Boolean(acc.dealId) }
    : null;

  if (domain && ctx.own && (domain === ctx.own || domain.endsWith(`.${ctx.own}`))) return out({ disqualified: "This is the founder's own company.", known });
  if ((domain && ctx.competitors.domains.has(domain)) || (norm && ctx.competitors.names.has(norm))) return out({ disqualified: "A competitor.", known });
  if (domain && ctx.suppressed.has(domain)) return out({ disqualified: "On the do-not-contact list.", known });
  if (acc?.status === "disqualified") return out({ disqualified: `The founder disqualified it${acc.disqualified?.reason ? ` (${acc.disqualified.reason.replace(/_/g, " ")})` : ""}.`, known });
  if (acc?.status === "customer") return out({ disqualified: "Already a customer.", known, fit_score: acc.fitScore });

  for (const a of ctx.anti) {
    const hits = a.words.filter((w) => textWords.has(w)).length;
    if (a.words.length && hits >= Math.min(2, a.words.length)) return out({ disqualified: `Matches the anti-ICP: "${clip(a.text, 80)}".`, known });
  }

  // Already researched: Inroad's own scores (from real evidence) beat a guess from a few fields.
  const described = Boolean(input.description || input.industry || input.employees !== undefined || input.tags?.length || input.signals?.length);
  if (acc && known && !described) {
    reasons.push(`Already in Inroad: tier ${acc.tier}, fit ${acc.fitScore}${acc.whyNow ? `. Why now: ${clip(acc.whyNow, 90)}` : ""}`);
    if (acc.dealId) reasons.push("In the founder's pipeline. Don't prospect it.");
    return out({ tier: tierFor(acc.fitScore, acc.whyNowScore) ?? "none", fit_score: acc.fitScore, why_now: acc.whyNowScore, known });
  }

  if (!ctx.ready) {
    reasons.push("The founder's ICP isn't written yet, so fit can't be scored. Every company scores 50.");
    const whyNow = signalsScore(ctx, input, warm);
    return out({ tier: tierFor(50, whyNow) ?? "none", fit_score: 50, why_now: whyNow, known });
  }

  let num = 0;
  let den = 0;
  let unknown = 0;
  for (const c of ctx.crits) {
    const w = c.mustHave ? 3 : 1;
    den += w;
    let met: "true" | "false" | "unknown" = "unknown";
    const band = c.band ?? (c.kind === "firmographic" && /\b(employees|people|headcount|size|team of)\b/i.test(c.text) ? ctx.band : undefined);
    if (band && input.employees !== undefined) {
      // 20% tolerance at the edges: headcounts in databases lag.
      met = input.employees >= band[0] * 0.8 && input.employees <= band[1] * 1.2 ? "true" : "false";
      const range = band[1] >= 10_000_000 ? `${band[0]}+` : `${band[0]}–${band[1]}`;
      const inside = input.employees >= band[0] && input.employees <= band[1];
      reasons.push(`${input.employees} people is ${inside ? "inside" : met === "true" ? "close to" : "outside"} the ${range} band`);
    } else if (c.kind === "situational") {
      const types = DETECTS[c.detection] ?? [];
      const hit = input.signals?.find((s) => types.includes(s.type));
      if (hit) {
        met = "true";
        reasons.push(`Signal ${hit.type.replace(/_/g, " ")} (${hit.date.slice(0, 10)}) meets "${clip(c.text, 60)}"`);
      }
    } else if (c.words.length) {
      const hits = c.words.filter((w) => textWords.has(w)).length;
      if (hits >= Math.min(2, c.words.length)) {
        met = "true";
        reasons.push(`Meets "${clip(c.text, 70)}"`);
      }
    }
    if (met === "unknown") unknown++;
    num += w * (met === "true" ? 1 : met === "unknown" ? 0.5 : 0);
  }
  const fit = den ? Math.round((100 * num) / den) : 50;
  if (unknown === ctx.crits.length) reasons.push("Not enough data to judge fit. Send industry, description and employees.");
  else if (unknown) reasons.push(`${unknown} of ${ctx.crits.length} criteria unknown from the data sent`);
  const whyNow = signalsScore(ctx, input, warm);
  if (whyNow) reasons.push(`Why-now ${whyNow}/4 from ${input.signals?.length ?? 0} signal${input.signals?.length === 1 ? "" : "s"}${warm ? " and a warm path" : ""}`);
  else if (warm) reasons.push(`${warm} of the founder's connections work here`);
  return out({ tier: tierFor(fit, whyNow) ?? "none", fit_score: fit, why_now: whyNow, reasons: reasons.slice(0, 5), known });
}

function signalsScore(ctx: ScoringContext, input: ScoreInput, warm: number): number {
  const signals: Signal[] = (input.signals ?? [])
    .filter((s) => /^\d{4}-\d{2}-\d{2}/.test(s.date) && s.date.slice(0, 10) <= ctx.today)
    .map((s, i) => ({
      id: `in_${i}`,
      type: s.type,
      headline: s.type,
      date: s.date.slice(0, 10),
      url: s.url ?? "",
      host: "",
      strength: STRENGTH[s.type],
      usableInOutreach: false,
      implication: "",
    }));
  return whyNowScore(signals, ctx.today, warm);
}
