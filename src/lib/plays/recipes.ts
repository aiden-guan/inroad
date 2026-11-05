import { daysBetween, weekOf } from "@/lib/domain/ids";
import { OPEN_STAGES, STAGE_LABELS, type Account, type Deal, type ISODate, type Move, type MoveKind, type Person, type PersonaRole, type Signal, type SignalType, type Stage, type Workspace } from "@/lib/domain/types";
import { openIntroFor } from "@/lib/intros/rules";
import { clip, daysSince, first, isOpen, isSuppressed, localDate, shortDay } from "@/lib/moves/util";
import { moveDomain, PLAY_BY_ID, PLAYS, playEnabled, playMatches, type PlayDef, type PlayMatch } from "./catalog";
import type { CustomPlay, Recipe, RecipeActionKind, RecipeAudience, RecipeDealFilter, RecipeGuardrails, RecipeMeasure, RecipeStatus, RecipeTrigger, RecipeVersion, UnsupportedPart } from "./recipe-types";

/**
 * Recipes in code: a play the founder wrote, run exactly like a built-in. Matching reads dated signals,
 * the company's facts and the founder's own history with it, so every match shows the fact that fired it
 * and every skip says which condition stopped it. Pure and isomorphic; costs no tokens.
 */

/* ─────────────────────────────── Vocabulary ─────────────────────────────── */

/** Signal types a business play can fire on, in the order the editor lists them. */
export const RECIPE_SIGNALS = [
  "jd_names_pain",
  "first_hire",
  "hiring",
  "new_leader",
  "champion_job_change",
  "funding",
  "filing",
  "launch",
  "stack_change",
  "compliance_deadline",
  "persona_post",
  "community_request",
  "public_pain",
] as const satisfies readonly SignalType[];
export type RecipeSignal = (typeof RECIPE_SIGNALS)[number];

/** What each signal is in plain words, where InRoad gets it, and its usual freshness window in days. */
export const SIGNAL_INFO: Record<RecipeSignal, { label: string; phrase: string; source: string; window: number }> = {
  jd_names_pain: { label: "Job post names the pain", phrase: "a job post that names the pain", source: "job boards (Greenhouse, Lever, Ashby, Workable) and HN Who's Hiring", window: 60 },
  first_hire: { label: "First hire for the role", phrase: "a first hire for the role", source: "job boards and HN Who's Hiring", window: 60 },
  hiring: { label: "Any job post", phrase: "any job post", source: "job boards and HN Who's Hiring", window: 45 },
  new_leader: { label: "New leader", phrase: "a new leader in the buying seat", source: "news, team pages and LinkedIn imports", window: 90 },
  champion_job_change: { label: "Champion moved", phrase: "someone who knows you starting there", source: "LinkedIn connection re-imports and people search", window: 120 },
  funding: { label: "Funding round", phrase: "a funding round", source: "news and Hacker News", window: 60 },
  filing: { label: "Form D filing", phrase: "a Form D filing", source: "SEC EDGAR", window: 60 },
  launch: { label: "Launch or pricing change", phrase: "a launch or pricing change", source: "their site, blog and Hacker News", window: 60 },
  stack_change: { label: "Stack change", phrase: "a change to their stack", source: "site scripts and DNS records", window: 60 },
  compliance_deadline: { label: "Audit or compliance deadline", phrase: "an audit or compliance deadline", source: "news and their site", window: 180 },
  persona_post: { label: "Buyer posted about it", phrase: "a buyer posting about the problem", source: "public posts you capture", window: 30 },
  community_request: { label: "Asked in a community", phrase: "a request for help in a community", source: "Hacker News questions", window: 14 },
  public_pain: { label: "Complained in public", phrase: "a public complaint about the problem", source: "public posts and reviews you capture", window: 30 },
};

export function signalLabel(type: SignalType): string {
  return (SIGNAL_INFO as Partial<Record<SignalType, { label: string }>>)[type]?.label ?? type.replace(/_/g, " ");
}

/** Business buying roles (the consumer ones don't apply to plays). */
export const PERSONA_ROLES = ["champion", "economic_buyer", "technical_approver", "user", "blocker"] as const satisfies readonly PersonaRole[];
const PERSONA_WORD: Partial<Record<PersonaRole, string>> = { champion: "champion", economic_buyer: "economic buyer", technical_approver: "technical approver", user: "user", blocker: "blocker" };

/** "champion (Controller)": the role, with the playbook's first title for it when there is one. */
export function personaLabel(ws: Pick<Workspace, "foundation"> | null | undefined, role: PersonaRole, { titled = true } = {}): string {
  const word = PERSONA_WORD[role] ?? role.replace(/_/g, " ");
  const title = titled ? ws?.foundation?.personas.find((p) => p.role === role)?.titles[0] : undefined;
  return title ? `${word} (${title})` : word;
}

export const ACTION_LABELS: Record<RecipeActionKind, string> = { write: "Write to them", research: "Research it", intro: "Ask for an intro", deal: "Review the deal" };
export const MEASURE_LABELS: Record<RecipeMeasure, string> = { reply: "replies", meeting: "meetings", won: "deals won" };
export const DEAL_LABELS: Record<RecipeDealFilter, string> = { none: "no open deal", open: "an open deal", any: "any deal status" };
export const STATUS_LABELS: Record<RecipeStatus, string> = { new: "new", tracked: "tracked", in_pipeline: "in pipeline" };
export const ACTION_KINDS = ["write", "research", "intro", "deal"] as const satisfies readonly RecipeActionKind[];
export const MEASURES = ["reply", "meeting", "won"] as const satisfies readonly RecipeMeasure[];
const DEALS = ["none", "open", "any"] as const satisfies readonly RecipeDealFilter[];
const STATUSES = ["new", "tracked", "in_pipeline"] as const satisfies readonly RecipeStatus[];
const TIERS = ["A", "B", "C"] as const satisfies readonly Account["tier"][];

/** Always on, whatever the recipe says. Shown as locked chips. */
export const ALWAYS_SKIPPED = "Customers, disqualified companies and anyone on your do-not-contact list";

/* ─────────────────────────────── Normalizing ─────────────────────────────── */

const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const int = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(max, Math.max(min, n));
};
const someOf = <T extends string>(v: unknown, list: readonly T[]): T[] => (Array.isArray(v) ? uniq(v.filter((x): x is T => typeof x === "string" && (list as readonly string[]).includes(x))) : []);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback);

/** Lowercase, hyphens and slashes as spaces, single spaces: how keywords and the text they search are compared. */
export function fold(text: string): string {
  return text.toLowerCase().replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim();
}

function keywordList(v: unknown, max = 8): string[] {
  if (!Array.isArray(v)) return [];
  return uniq(v.filter((x): x is string => typeof x === "string").map((x) => fold(x).replace(/^["“']+|["”']+$/g, "")).filter((x) => x.length >= 2 && x.length <= 40)).slice(0, max);
}

/** Every recipe that reaches the workspace goes through here: from the model, the editor or an old file. */
export function normalizeRecipe(raw: unknown): Recipe {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Recipe>;
  const t = (r.trigger ?? {}) as Partial<RecipeTrigger>;
  const a = (r.audience ?? {}) as Partial<RecipeAudience>;
  const g = (r.guardrails ?? {}) as Partial<RecipeGuardrails>;
  const act = (r.action ?? {}) as Partial<Recipe["action"]>;
  const signals = someOf(t.signals, RECIPE_SIGNALS);
  const personas = someOf(a.personas, PERSONA_ROLES);
  const deal = oneOf(a.deal, DEALS, "none");
  const name = typeof r.name === "string" ? r.name.replace(/\s+/g, " ").trim() : "";
  return {
    name: clip(name || "My play", 60),
    trigger: {
      signals: signals.length ? signals : ["jd_names_pain"],
      withinDays: int(t.withinDays, 1, 365, 45),
      keywords: keywordList(t.keywords),
      minStrength: int(t.minStrength, 1, 3, 1) as 1 | 2 | 3,
      stack: Math.min(int(t.stack, 1, 3, 1), Math.max(1, signals.length)) as 1 | 2 | 3,
    },
    audience: {
      tiers: someOf(a.tiers, TIERS),
      minFit: int(a.minFit, 0, 100, 0),
      statuses: someOf(a.statuses, STATUSES),
      deal,
      stages: deal === "open" ? someOf(a.stages, OPEN_STAGES) : [],
      personas,
      excludePersonas: someOf(a.excludePersonas, PERSONA_ROLES).filter((p) => !personas.includes(p)),
      criteria: Array.isArray(a.criteria) ? uniq(a.criteria.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim())).slice(0, 6) : [],
      keywords: keywordList(a.keywords),
    },
    guardrails: { cooldownDays: int(g.cooldownDays, 0, 365, 30), maxPerWeek: int(g.maxPerWeek, 1, 50, 5) },
    action: { kind: oneOf(act.kind, ACTION_KINDS, "write"), angle: clip(typeof act.angle === "string" ? act.angle : "", 240) },
    measure: oneOf(r.measure, MEASURES, "reply"),
  };
}

/** Same rules, ignoring order inside lists. */
export function sameRecipe(a: Recipe, b: Recipe): boolean {
  const key = (r: Recipe) => {
    const n = normalizeRecipe(r);
    const sort = (xs: string[]) => [...xs].sort();
    return JSON.stringify({
      ...n,
      trigger: { ...n.trigger, signals: sort(n.trigger.signals), keywords: sort(n.trigger.keywords) },
      audience: { ...n.audience, tiers: sort(n.audience.tiers), statuses: sort(n.audience.statuses), stages: sort(n.audience.stages), excludePersonas: sort(n.audience.excludePersonas), criteria: sort(n.audience.criteria), keywords: sort(n.audience.keywords) },
    });
  };
  return key(a) === key(b);
}

/* ─────────────────────────────── Reading a company ─────────────────────────────── */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first keyword the text mentions, from the start of a word: "reconcil" finds "reconciliation"; "ar" doesn't find "quarter". */
export function mentions(text: string, keywords: string[]): string | undefined {
  if (!keywords.length) return undefined;
  const t = fold(text);
  return keywords.find((k) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(fold(k))}`, "u").test(t));
}

/** What the company's facts on file say: name, description, stack, the dossier and the evidence behind its signals. */
export function accountText(ws: Pick<Workspace, "evidence">, acc: Account): string {
  const ids = new Set<string>([...acc.signals.map((s) => s.evidenceId ?? ""), ...(acc.dossier?.facts.flatMap((f) => f.evidenceIds) ?? []), ...(acc.dossier?.snapshot.descriptionEvidenceIds ?? [])]);
  const ev = [...ids].flatMap((id) => (ws.evidence[id] ? [ws.evidence[id].claim, ws.evidence[id].quote] : []));
  return [
    acc.name,
    acc.domain,
    acc.oneLiner,
    acc.whyNow,
    acc.hqCity,
    ...(acc.tags ?? []),
    acc.enrichment?.title,
    acc.enrichment?.description,
    ...(acc.enrichment?.tech ?? []),
    acc.dossier?.snapshot.plainDescription,
    acc.dossier?.snapshot.stage,
    ...(acc.dossier?.facts.map((f) => f.text) ?? []),
    ...acc.criteria.map((c) => c.note),
    ...ev,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A person's buying role: set on the person, else the playbook persona whose titles their title contains. */
export function roleOf(ws: Pick<Workspace, "foundation">, p: Person): PersonaRole | undefined {
  if (p.role) return p.role;
  const title = fold(p.title ?? "");
  if (!title) return undefined;
  return ws.foundation?.personas.find((x) => x.titles.some((t) => t.trim() && title.includes(fold(t))))?.role;
}

/** Who the play writes to: the first preferred persona on file, never an excluded one, never anyone suppressed. */
export function pickPerson(ws: Workspace, acc: Account, audience: Pick<RecipeAudience, "personas" | "excludePersonas">): Person | undefined {
  const people = acc.peopleIds
    .map((id) => ws.people[id])
    .filter((p): p is Person => !!p && !p.mayHaveLeft && !isSuppressed(ws, p, acc.domain))
    .filter((p) => {
      const role = roleOf(ws, p);
      return !role || !audience.excludePersonas.includes(role);
    });
  if (audience.personas.length) {
    for (const role of audience.personas) {
      const p = people.find((x) => roleOf(ws, x) === role);
      if (p) return p;
    }
    return undefined;
  }
  const pick = acc.dossier?.recommendation.personId;
  return people.find((p) => p.id === pick) ?? people.find((p) => roleOf(ws, p) === "champion") ?? people.find((p) => roleOf(ws, p) === "economic_buyer") ?? people[0];
}

const TOUCHES = new Set(["touch_sent", "linkedin_dm", "intro_requested"]);

/** This play's Today card for a match. Ids are stable per play and subject, across versions. */
export function cardId(m: Pick<PlayMatch, "key">): string {
  return `mv_play_${m.key.replace(/[^a-z0-9_.-]/gi, "_")}`;
}

function domainSuppressed(ws: Workspace, domain: string): boolean {
  const d = domain.toLowerCase();
  return ws.suppression.some((s) => !s.email && s.domain?.toLowerCase() === d);
}

/** The latest day anyone reached the company (a touch, a LinkedIn message, an intro ask), or this play worked it or had its card skipped. */
function lastReached(ws: Workspace, playId: string, domain: string): { day: ISODate; skipped: boolean } | undefined {
  let last: { day: ISODate; skipped: boolean } | undefined;
  const see = (day: ISODate, skipped = false) => {
    if (!last || day > last.day) last = { day, skipped };
  };
  for (const a of ws.activities) if (a.accountDomain === domain && TOUCHES.has(a.kind) && a.outcome !== "not_sent") see(localDate(a.at));
  for (const run of ws.plays?.[playId]?.runs ?? []) if (run.domains.includes(domain)) see(localDate(run.at));
  for (const m of Object.values(ws.moves)) if (m.playId === playId && (m.status === "done" || m.status === "skipped") && !m.autoDone && moveDomain(ws, m) === domain) see(localDate(m.createdAt), m.status === "skipped");
  return last;
}

const daysAgo = (n: number) => (n === 0 ? "today" : `${n} ${n === 1 ? "day" : "days"} ago`);

/** Why a match needs nothing new: already reached since the signal, a draft or intro in flight, or its card was decided. */
function inMotion(ws: Workspace, playId: string, acc: Account, sig: Signal, key: string): string | undefined {
  const own = ws.moves[cardId({ key })];
  if (own?.status === "skipped") return `Skipped on Today${own.skipReason ? `: ${own.skipReason.replace(/_/g, " ")}` : ""}`;
  if (own?.status === "done" && !own.autoDone) return `Worked from this play ${shortDay(localDate(own.createdAt))}`;
  const touch = ws.activities
    .filter((a) => a.accountDomain === acc.domain && TOUCHES.has(a.kind) && a.outcome !== "not_sent" && localDate(a.at) >= sig.date)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  if (touch) return `${touch.kind === "intro_requested" ? "Intro asked" : "Reached"} ${shortDay(localDate(touch.at))}`;
  const run = (ws.plays?.[playId]?.runs ?? []).filter((r) => r.domains.includes(acc.domain) && localDate(r.at) >= sig.date).at(-1);
  if (run) return `Worked from this play ${shortDay(localDate(run.at))}`;
  const pkg = Object.values(ws.outreach)
    .filter((p) => p.accountDomain === acc.domain && localDate(p.createdAt) >= sig.date)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (pkg) return pkg.steps.some((s) => s.status === "draft") ? `Draft waiting since ${shortDay(localDate(pkg.createdAt))}` : `Drafted ${shortDay(localDate(pkg.createdAt))}`;
  if (openIntroFor(ws, acc.domain)) return "Intro in progress";
  return undefined;
}

/* ─────────────────────────────── Matching ─────────────────────────────── */

export interface RecipeMatch extends PlayMatch {
  signalType: SignalType;
  signalId: string;
  /** The keyword the signal mentioned, when the trigger has keywords. */
  matched?: string;
  /** Set when nothing new is needed (worked): what's already happening. */
  inMotion?: string;
  /** No one in the play's personas is on file yet: find them first. */
  needsPerson?: boolean;
  /** Different signal types fresh at once. */
  stacked: number;
}

export interface RecipeSkip {
  domain: string;
  company: string;
  /** The first condition that stopped it, ≤ 80 chars. */
  reason: string;
  date?: ISODate;
  stage: "always" | "trigger" | "audience" | "guardrail";
}

const TIER_WEIGHT: Record<Account["tier"], number> = { A: 30, B: 18, C: 6 };

/** "a, b or c" */
export function orList(items: string[], last = "or"): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${last} ${items.at(-1)}`;
}
const quote = (s: string) => `“${s}”`;

/** An open deal, or one parked in nurture: either way the company is worked from the deal. */
function openOrParked(ws: Workspace, acc: Account): Deal | undefined {
  const active = (d: Deal | undefined): d is Deal => !!d && (OPEN_STAGES.includes(d.stage) || d.stage === "nurture");
  const deal = acc.dealId ? ws.deals[acc.dealId] : undefined;
  return active(deal) ? deal : Object.values(ws.deals).find((d) => d.accountDomain === acc.domain && active(d));
}

/**
 * The whole audit in one pass: every company with the trigger's signal on file either matches (with the
 * dated fact that fired it) or is skipped with the first condition that stopped it. Customers, disqualified
 * companies and do-not-contact are always out.
 */
export function evaluateRecipe(ws: Workspace, recipe: Recipe, playId: string, today: ISODate): { matches: RecipeMatch[]; skips: RecipeSkip[] } {
  const { trigger: t, audience: a, guardrails: g } = recipe;
  const types = new Set<SignalType>(t.signals);
  const criteria = ws.foundation?.icp.criteria ?? [];
  const matches: RecipeMatch[] = [];
  const skips: RecipeSkip[] = [];
  for (const acc of Object.values(ws.accounts)) {
    const ofType = acc.signals.filter((s) => types.has(s.type) && s.type !== "sensitive" && !!s.date);
    if (!ofType.length) continue;
    // Old history isn't worth listing: only companies whose signal is within twice the window (at least 120 days).
    const listable = ofType.some((s) => daysSince(s.date, today) <= Math.max(120, t.withinDays * 2));
    const skip = (stage: RecipeSkip["stage"], reason: string, date?: ISODate) => {
      if (listable) skips.push({ domain: acc.domain, company: acc.name, reason: clip(reason, 80), date, stage });
    };

    if (acc.status === "customer") {
      skip("always", "Already a customer");
      continue;
    }
    if (acc.status === "disqualified") {
      skip("always", `Disqualified${acc.disqualified ? `: ${acc.disqualified.reason.replace(/_/g, " ")}` : ""}`);
      continue;
    }
    if (domainSuppressed(ws, acc.domain)) {
      skip("always", "On your do-not-contact list");
      continue;
    }

    const fresh = ofType.filter((s) => daysSince(s.date, today) <= t.withinDays);
    if (!fresh.length) {
      const newest = [...ofType].sort((x, y) => y.date.localeCompare(x.date))[0];
      skip("trigger", `Newest signal is ${daysSince(newest.date, today)} days old; the window is ${t.withinDays}`, newest.date);
      continue;
    }
    const usable = fresh.filter((s) => s.usableInOutreach);
    if (!usable.length) {
      skip("trigger", "Its signal is marked not usable in outreach", fresh[0].date);
      continue;
    }
    const strong = usable.filter((s) => s.strength >= t.minStrength);
    if (!strong.length) {
      skip("trigger", `Signal strength ${Math.max(...usable.map((s) => s.strength))}; this play needs ${t.minStrength}+`, usable[0].date);
      continue;
    }
    const said = t.keywords.length ? strong.filter((s) => !!mentions(`${s.headline} ${s.implication}`, t.keywords)) : strong;
    if (!said.length) {
      skip("trigger", `No fresh signal mentions ${orList(t.keywords.map(quote))}`, strong[0].date);
      continue;
    }
    const stacked = new Set(strong.map((s) => s.type)).size;
    if (stacked < t.stack) {
      skip("trigger", `${stacked} of the ${t.stack} signal types it needs at once`, said[0].date);
      continue;
    }
    const sig = [...said].sort((x, y) => y.strength - x.strength || y.date.localeCompare(x.date))[0];

    if (a.tiers.length && !a.tiers.includes(acc.tier)) {
      skip("audience", `Tier ${acc.tier}: this play runs on ${orList(a.tiers)}`, sig.date);
      continue;
    }
    if (acc.fitScore < a.minFit) {
      skip("audience", `Fit ${acc.fitScore}; this play needs ${a.minFit}+`, sig.date);
      continue;
    }
    if (a.statuses.length && !(a.statuses as string[]).includes(acc.status)) {
      skip("audience", `Status is ${STATUS_LABELS[acc.status as RecipeStatus] ?? acc.status}; this play runs on ${orList(a.statuses.map((s) => STATUS_LABELS[s]))}`, sig.date);
      continue;
    }
    const deal = openOrParked(ws, acc);
    if (a.deal === "none" && deal) {
      skip("audience", deal.stage === "nurture" ? `Parked in nurture${deal.nurtureUntil ? ` until ${shortDay(deal.nurtureUntil)}` : ""}` : `Open deal at ${STAGE_LABELS[deal.stage]}: worked from the deal`, sig.date);
      continue;
    }
    const open = deal && isOpen(deal) ? deal : undefined;
    if (a.deal === "open" && !open) {
      skip("audience", "No open deal", sig.date);
      continue;
    }
    if (a.deal === "open" && open && a.stages.length && !a.stages.includes(open.stage)) {
      skip("audience", `Deal at ${STAGE_LABELS[open.stage]}; this play runs on ${orList(a.stages.map((s) => STAGE_LABELS[s]))}`, sig.date);
      continue;
    }
    const unmet = a.criteria.find((id) => acc.criteria.find((c) => c.criterionId === id)?.met !== "true");
    if (unmet) {
      const text = criteria.find((c) => c.id === unmet)?.text ?? "an ICP criterion";
      const state = acc.criteria.find((c) => c.criterionId === unmet)?.met;
      skip("audience", `${state === "false" ? "Doesn't meet" : "Not known to meet"} ${quote(clip(text, 44))}`, sig.date);
      continue;
    }
    if (a.keywords.length && !mentions(accountText(ws, acc), a.keywords)) {
      skip("audience", `Nothing on file mentions ${orList(a.keywords.map(quote))}`, sig.date);
      continue;
    }

    const key = `${playId}:${acc.domain}:${sig.id}`;
    const busy = inMotion(ws, playId, acc, sig, key);
    if (!busy && g.cooldownDays > 0) {
      const reached = lastReached(ws, playId, acc.domain);
      const ago = reached ? daysSince(reached.day, today) : Infinity;
      if (reached && ago < g.cooldownDays) {
        skip("guardrail", `${reached.skipped ? "Its card was skipped" : "Reached"} ${daysAgo(ago)}; the cooldown is ${g.cooldownDays} days`, reached.day);
        continue;
      }
    }

    const person = pickPerson(ws, acc, a);
    const age = daysSince(sig.date, today);
    matches.push({
      key,
      domain: acc.domain,
      company: acc.name,
      personId: person?.id,
      personName: person?.name,
      dealId: a.deal !== "none" ? open?.id : undefined,
      headline: clip(sig.headline, 90),
      date: sig.date,
      url: sig.url,
      score: TIER_WEIGHT[acc.tier] + sig.strength * 8 + Math.max(0, (t.withinDays - age) / t.withinDays) * 20 + (acc.warmPathCount > 0 ? 6 : 0) + acc.fitScore / 10 + (stacked - 1) * 6,
      worked: !!busy,
      signalType: sig.type,
      signalId: sig.id,
      matched: t.keywords.length ? mentions(`${sig.headline} ${sig.implication}`, t.keywords) : undefined,
      inMotion: busy,
      needsPerson: !person && (a.personas.length > 0 || recipe.action.kind === "write"),
      stacked,
    });
  }
  matches.sort((x, y) => Number(x.worked) - Number(y.worked) || y.score - x.score || x.company.localeCompare(y.company));
  skips.sort((x, y) => x.company.localeCompare(y.company));
  return { matches, skips };
}

/* ─────────────────────────────── As a play ─────────────────────────────── */

/** "A job post that names the pain or a first hire for the role in the last 45 days, mentioning “billing”." */
export function triggerSentence(r: Recipe): string {
  const t = r.trigger;
  const kinds = orList(t.signals.map((s) => SIGNAL_INFO[s as RecipeSignal]?.phrase ?? s.replace(/_/g, " ")));
  const text = `${kinds}${t.stack > 1 ? ` (${t.stack} different ones at once)` : ""} in the last ${t.withinDays} days${t.keywords.length ? `, mentioning ${orList(t.keywords.map(quote))}` : ""}${t.minStrength > 1 ? `, strength ${t.minStrength} or more` : ""}`;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** "A or B companies with fit 60+ that meet “Prices on a usage metric”, with no open deal." */
export function audienceSentence(r: Recipe, ws?: Pick<Workspace, "foundation"> | null): string {
  const a = r.audience;
  const criteria = a.criteria.map((id) => ws?.foundation?.icp.criteria.find((c) => c.id === id)?.text).filter((x): x is string => !!x);
  const parts = [
    `${a.tiers.length ? `${orList(a.tiers)}-tier` : "Any"} companies${a.minFit ? ` with fit ${a.minFit}+` : ""}`,
    criteria.length ? ` that meet ${orList(criteria.map((c) => quote(clip(c, 50))), "and")}` : "",
    a.keywords.length ? `${criteria.length ? " and" : ""} whose facts mention ${orList(a.keywords.map(quote))}` : "",
    a.statuses.length ? `, ${orList(a.statuses.map((s) => STATUS_LABELS[s]))} only` : "",
    a.deal === "none" ? ", with no open deal" : a.deal === "open" ? (a.stages.length ? `, with a deal at ${orList(a.stages.map((s) => STAGE_LABELS[s]))}` : ", with an open deal") : "",
  ];
  return `${parts.join("")}.`;
}

export function whoSentence(r: Recipe, ws?: Pick<Workspace, "foundation"> | null): string {
  const a = r.audience;
  const who = a.personas.length ? `The ${orList(a.personas.map((p) => personaLabel(ws, p)))}` : "The best person on file";
  return `${who}${a.excludePersonas.length ? `; never the ${orList(a.excludePersonas.map((p) => personaLabel(ws, p, { titled: false })))}` : ""}.`;
}

const COACH: Record<RecipeActionKind, string> = {
  write: "One observation from the signal, one question. No meeting ask in the first note.",
  research: "Confirm the trigger on their site and job posts first, then decide whether to write.",
  intro: "Ask for the intro with a forwardable note: who you are, why them, why now, in three lines.",
  deal: "Bring the signal to the deal: what it changes for them, and the next step it calls for.",
};

function promptFor(r: Recipe, m: PlayMatch, ws: Workspace): string {
  const who = m.personName ?? (r.audience.personas[0] ? `the ${personaLabel(ws, r.audience.personas[0])}` : "the right person");
  const why = `${m.headline}${m.date ? ` (${shortDay(m.date)})` : ""}`;
  const angle = r.action.angle ? ` Angle: ${r.action.angle}` : "";
  switch (r.action.kind) {
    case "intro":
      return `Draft a forwardable intro ask for ${who} at ${m.company}. Why now: ${why}.${angle} Three lines the connector can pass on unchanged.`;
    case "deal":
      return `Review the ${m.company} deal against this: ${why}.${angle} What does it change, what's the next step, and draft the note to ${who}.`;
    case "research":
      return `Research ${m.company}: is this real and does it matter for us? ${why}.${angle}`;
    default:
      return `Draft a short first note to ${who} at ${m.company}. Why now: ${why}.${angle} Cite the signal, one question, no meeting ask, under 90 words, my voice.`;
  }
}

/** A recipe as a play that runs beside the built-ins: same matching contract, same results, same Today path. */
export function compileRecipe(id: string, recipe: Recipe, opts: { version: number | null; sentence?: string; ws?: Pick<Workspace, "foundation"> | null }): PlayDef {
  const r = normalizeRecipe(recipe);
  const said = (s: Signal) => s.strength >= r.trigger.minStrength && (!r.trigger.keywords.length || !!mentions(`${s.headline} ${s.implication}`, r.trigger.keywords));
  return {
    id,
    name: r.name,
    family: "signal",
    trigger: triggerSentence(r),
    why: opts.sentence ? `Your play${opts.version ? `, v${opts.version}` : ""}: ${quote(clip(opts.sentence, 180))}` : `Your play${opts.version ? `, v${opts.version}` : ""}.`,
    audience: `${audienceSentence(r, opts.ws)} ${whoSentence(r, opts.ws)}`,
    action: { kind: r.action.kind, label: ACTION_LABELS[r.action.kind] },
    windowDays: r.trigger.withinDays,
    data: "free",
    signals: [...r.trigger.signals],
    coach: `${r.action.angle ? `${r.action.angle.replace(/\.?$/, ".")} ` : ""}${COACH[r.action.kind]}`,
    prompt: r.action.kind === "research" ? undefined : (m, ws) => promptFor(r, m, ws),
    tiers: r.audience.tiers.length ? [...r.audience.tiers] : undefined,
    custom: { version: opts.version },
    signalTest: said,
    accountTest: undefined,
    stack: r.trigger.stack,
    match: (ws, today) => evaluateRecipe(ws, r, id, today).matches,
  };
}

/** The account traits a backtest can hold a company to regardless of when (ICP criteria and fact keywords). */
export function recipeAccountTest(ws: Workspace, r: Recipe): (acc: Account) => boolean {
  return (acc) =>
    r.audience.criteria.every((id) => acc.criteria.find((c) => c.criterionId === id)?.met === "true") && (!r.audience.keywords.length || !!mentions(accountText(ws, acc), r.audience.keywords));
}

/* ─────────────────────────────── Custom plays in the workspace ─────────────────────────────── */

export function currentVersion(cp: CustomPlay): RecipeVersion | undefined {
  const v = cp.history.at(-1)?.version;
  return cp.versions.find((x) => x.version === v) ?? cp.versions.at(-1);
}

/** What runs now (the current version), else the draft of a play that hasn't run. */
export function liveRecipe(cp: CustomPlay): Recipe | undefined {
  return currentVersion(cp)?.recipe ?? cp.draft;
}

/** The recipe the editor shows: unsaved changes first. */
export function editingRecipe(cp: CustomPlay): Recipe | undefined {
  return cp.draft ?? currentVersion(cp)?.recipe;
}

/** The version that was current at a moment (results are attributed to it). */
export function versionAt(cp: CustomPlay, at: string): number | undefined {
  let v: number | undefined;
  for (const h of cp.history) {
    if (h.at <= at) v = h.version;
    else break;
  }
  return v ?? cp.history[0]?.version;
}

/** A founder's play as a PlayDef: the current version, or its draft (`which: "draft"`, or before its first run). */
export function compileCustom(ws: Pick<Workspace, "foundation">, cp: CustomPlay, which: "live" | "draft" = "live"): PlayDef | undefined {
  const recipe = which === "draft" ? editingRecipe(cp) : liveRecipe(cp);
  if (!recipe) return undefined;
  const version = which === "draft" && cp.draft ? null : (currentVersion(cp)?.version ?? null);
  const def = compileRecipe(cp.id, recipe, { version, sentence: cp.sentence, ws });
  return { ...def, accountTest: (acc) => recipeAccountTest(ws as Workspace, normalizeRecipe(recipe))(acc) };
}

/** The founder's plays that aren't archived, newest first. */
export function customPlays(ws: Workspace): CustomPlay[] {
  return Object.values(ws.customPlays ?? {})
    .filter((cp) => !cp.archivedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Every play, the founder's first. Drafts are left out (they don't run); the editor compiles them itself. */
export function playsFor(ws: Workspace): PlayDef[] {
  const own = customPlays(ws)
    .filter((cp) => cp.versions.length > 0)
    .map((cp) => compileCustom(ws, cp))
    .filter((p): p is PlayDef => !!p);
  return [...own, ...PLAYS];
}

/** A play by id, built-in or the founder's. */
export function findPlay(ws: Workspace, id: string | undefined): PlayDef | undefined {
  if (!id) return undefined;
  if (PLAY_BY_ID[id]) return PLAY_BY_ID[id];
  const cp = ws.customPlays?.[id];
  return cp ? compileCustom(ws, cp) : undefined;
}

/* ─────────────────────────────── Weekly cap and dry run ─────────────────────────────── */

/** Companies this play put on Today or worked in bulk since Monday. */
export function enrolledThisWeek(ws: Workspace, playId: string, today: ISODate): number {
  const monday = weekOf(today);
  const domains = new Set<string>();
  for (const m of Object.values(ws.moves)) {
    if (m.playId !== playId || localDate(m.createdAt) < monday) continue;
    const d = moveDomain(ws, m);
    if (d) domains.add(d);
  }
  for (const run of ws.plays?.[playId]?.runs ?? []) if (localDate(run.at) >= monday) for (const d of run.domains) domains.add(d);
  return domains.size;
}

export interface DryRun {
  /** New work, best first, inside this week's cap. */
  fire: RecipeMatch[];
  /** New work past this week's cap: it waits for Monday. */
  waiting: RecipeMatch[];
  /** Matches that need nothing new: reached, drafted, in an intro, or decided on Today. */
  handled: RecipeMatch[];
  skips: RecipeSkip[];
  capLeft: number;
}

/** What the play would do today, without doing it. */
export function dryRun(ws: Workspace, recipe: Recipe, playId: string, today: ISODate): DryRun {
  const r = normalizeRecipe(recipe);
  const { matches, skips } = evaluateRecipe(ws, r, playId, today);
  const live = matches.filter((m) => !m.worked);
  const capLeft = Math.max(0, r.guardrails.maxPerWeek - enrolledThisWeek(ws, playId, today));
  return { fire: live.slice(0, capLeft), waiting: live.slice(capLeft), handled: matches.filter((m) => m.worked), skips, capLeft };
}

/* ─────────────────────────────── Today ─────────────────────────────── */

const CARD: Record<RecipeActionKind, { kind: MoveKind; base: number; minutes: number }> = {
  write: { kind: "first_touch", base: 50, minutes: 4 },
  research: { kind: "research", base: 44, minutes: 1 },
  intro: { kind: "intro_ask", base: 52, minutes: 4 },
  deal: { kind: "next_step_missing", base: 54, minutes: 5 },
};
/** New cards across the founder's plays in one pass, and open ones at once: they add to Today, never flood it. */
const NEW_AT_ONCE = 3;
const OPEN_MAX = 4;

export type PlayCard = Omit<Move, "createdAt" | "status" | "rule" | "evidenceIds" | "dueOn"> & { rule: "play" };

function cardTitle(r: Recipe, m: PlayMatch, ws: Workspace): string {
  switch (r.action.kind) {
    case "research":
      return `Research ${m.company}`;
    case "intro":
      return `Ask for an intro to ${m.company}`;
    case "deal":
      return `Review the ${m.company} deal`;
    default: {
      const who = first(m.personName) || (r.audience.personas[0] ? `the ${ws.foundation?.personas.find((p) => p.role === r.audience.personas[0])?.titles[0] ?? personaLabel(ws, r.audience.personas[0], { titled: false })}` : "the right person");
      return `Write to ${who} at ${m.company}`;
    }
  }
}

const isOpenCard = (m: Move | undefined, today: ISODate) => !!m && (m.status === "open" || (m.status === "snoozed" && !!m.snoozedUntil && m.snoozedUntil <= today));

/**
 * The Today hook (src/lib/moves/rules.ts calls it from its plays rule): each running play the founder wrote puts
 * its best new matches on Today, one company per card, inside its weekly cap and at most ⌈cap ÷ 5⌉ open at once.
 * Cards already on the desk keep coming back while their match lasts, so snoozes and decisions stick.
 */
export function customPlayCards(ws: Workspace, today: ISODate, busy: Set<string | undefined>): PlayCard[] {
  const out: PlayCard[] = [];
  let fresh = NEW_AT_ONCE;
  let openTotal = 0;
  const running = customPlays(ws)
    .filter((cp) => playEnabled(ws, cp.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const plan: { play: PlayDef; recipe: Recipe; live: PlayMatch[] }[] = [];
  for (const cp of running) {
    const play = compileCustom(ws, cp);
    const recipe = liveRecipe(cp);
    if (!play || !recipe) continue;
    plan.push({ play, recipe, live: playMatches(ws, play, today).filter((m) => !m.worked) });
  }
  const card = (play: PlayDef, r: Recipe, m: PlayMatch): PlayCard => ({
    id: cardId(m),
    kind: CARD[r.action.kind].kind,
    rule: "play",
    playId: play.id,
    title: cardTitle(r, m, ws),
    why: `${play.name} · ${clip(m.headline, 60)}`,
    minutes: CARD[r.action.kind].minutes,
    priority: CARD[r.action.kind].base,
    ref: m.dealId ? { kind: "deal", id: m.dealId } : m.personId ? { kind: "person", id: m.personId } : { kind: "account", id: m.domain },
    source: m.url ? { url: m.url, date: m.date } : undefined,
    href: `/companies?c=${encodeURIComponent(m.domain)}`,
  });
  const open = new Map<string, number>();
  // Cards already on the desk first: they hold their place whatever else is busy.
  for (const { play, recipe, live } of plan) {
    for (const m of live) {
      const prev = ws.moves[cardId(m)];
      if (!prev) continue;
      out.push(card(play, recipe, m));
      busy.add(m.domain);
      if (isOpenCard(prev, today)) {
        open.set(play.id, (open.get(play.id) ?? 0) + 1);
        openTotal++;
      }
    }
  }
  for (const { play, recipe, live } of plan) {
    const slots = Math.min(3, Math.max(1, Math.ceil(recipe.guardrails.maxPerWeek / 5)));
    let capLeft = recipe.guardrails.maxPerWeek - enrolledThisWeek(ws, play.id, today);
    for (const m of live) {
      if (fresh <= 0 || openTotal >= OPEN_MAX || capLeft <= 0 || (open.get(play.id) ?? 0) >= slots) break;
      if (ws.moves[cardId(m)] || busy.has(m.domain)) continue;
      out.push(card(play, recipe, m));
      busy.add(m.domain);
      open.set(play.id, (open.get(play.id) ?? 0) + 1);
      openTotal++;
      capLeft--;
      fresh--;
    }
  }
  return out;
}

/* ─────────────────────────────── Changes and limits ─────────────────────────────── */

const list = (xs: string[]) => (xs.length ? xs.join(", ") : "any");

/** What changed between two recipes, in short lines: "Cooldown 30 → 60 days". Version notes and the editor use it. */
export function describeChanges(a: Recipe, b: Recipe, ws?: Pick<Workspace, "foundation"> | null): string[] {
  const out: string[] = [];
  const added = <T,>(x: T[], y: T[]) => y.filter((v) => !x.includes(v));
  const removed = <T,>(x: T[], y: T[]) => x.filter((v) => !y.includes(v));
  if (a.name !== b.name) out.push(`Renamed to ${quote(b.name)}`);
  for (const s of added(a.trigger.signals, b.trigger.signals)) out.push(`Fires on ${signalLabel(s).toLowerCase()}`);
  for (const s of removed(a.trigger.signals, b.trigger.signals)) out.push(`No longer fires on ${signalLabel(s).toLowerCase()}`);
  if (a.trigger.withinDays !== b.trigger.withinDays) out.push(`Window ${a.trigger.withinDays} → ${b.trigger.withinDays} days`);
  for (const k of added(a.trigger.keywords, b.trigger.keywords)) out.push(`Signal may mention ${quote(k)}`);
  for (const k of removed(a.trigger.keywords, b.trigger.keywords)) out.push(`Dropped ${quote(k)} from the signal words`);
  if (a.trigger.minStrength !== b.trigger.minStrength) out.push(`Strength ${a.trigger.minStrength}+ → ${b.trigger.minStrength}+`);
  if (a.trigger.stack !== b.trigger.stack) out.push(b.trigger.stack > 1 ? `Needs ${b.trigger.stack} signal types at once` : "Any one signal is enough");
  if (list(a.audience.tiers) !== list(b.audience.tiers)) out.push(`Tiers ${list(a.audience.tiers)} → ${list(b.audience.tiers)}`);
  if (a.audience.minFit !== b.audience.minFit) out.push(`Fit ${a.audience.minFit}+ → ${b.audience.minFit}+`);
  if (list(a.audience.statuses) !== list(b.audience.statuses)) out.push(`Status ${list(a.audience.statuses.map((s) => STATUS_LABELS[s]))} → ${list(b.audience.statuses.map((s) => STATUS_LABELS[s]))}`);
  if (a.audience.deal !== b.audience.deal || list(a.audience.stages) !== list(b.audience.stages)) out.push(`Deal: ${DEAL_LABELS[a.audience.deal]} → ${b.audience.deal === "open" && b.audience.stages.length ? `a deal at ${orList(b.audience.stages.map((s) => STAGE_LABELS[s]))}` : DEAL_LABELS[b.audience.deal]}`);
  for (const p of added(a.audience.personas, b.audience.personas)) out.push(`Writes to the ${personaLabel(ws, p, { titled: false })}`);
  for (const p of removed(a.audience.personas, b.audience.personas)) if (!b.audience.excludePersonas.includes(p)) out.push(`Stops preferring the ${personaLabel(ws, p, { titled: false })}`);
  for (const p of added(a.audience.excludePersonas, b.audience.excludePersonas)) out.push(`Never writes to the ${personaLabel(ws, p, { titled: false })}`);
  for (const p of removed(a.audience.excludePersonas, b.audience.excludePersonas)) out.push(`May write to the ${personaLabel(ws, p, { titled: false })} again`);
  const crit = (id: string) => quote(clip(ws?.foundation?.icp.criteria.find((c) => c.id === id)?.text ?? id, 40));
  for (const c of added(a.audience.criteria, b.audience.criteria)) out.push(`Must meet ${crit(c)}`);
  for (const c of removed(a.audience.criteria, b.audience.criteria)) out.push(`No longer needs ${crit(c)}`);
  for (const k of added(a.audience.keywords, b.audience.keywords)) out.push(`Company facts may mention ${quote(k)}`);
  for (const k of removed(a.audience.keywords, b.audience.keywords)) out.push(`Dropped ${quote(k)} from the company words`);
  if (a.guardrails.cooldownDays !== b.guardrails.cooldownDays) out.push(`Cooldown ${a.guardrails.cooldownDays} → ${b.guardrails.cooldownDays} days`);
  if (a.guardrails.maxPerWeek !== b.guardrails.maxPerWeek) out.push(`At most ${a.guardrails.maxPerWeek} → ${b.guardrails.maxPerWeek} a week`);
  if (a.action.kind !== b.action.kind) out.push(`Action: ${ACTION_LABELS[a.action.kind].toLowerCase()} → ${ACTION_LABELS[b.action.kind].toLowerCase()}`);
  if (a.action.angle !== b.action.angle) out.push("New angle");
  if (a.measure !== b.measure) out.push(`Measured on ${MEASURE_LABELS[b.measure]}`);
  return out;
}

/**
 * Things a sentence can ask for that InRoad can't detect. The compiler should name them; this list is the
 * zero-token backstop so a condition is never dropped without a word, even when the model missed it.
 */
const CANNOT: { test: RegExp; why: string; nearest: string }[] = [
  {
    test: /\b(?:visit(?:s|ed|ing)?|view(?:s|ed)?|look(?:s|ed)? at|went to|came to) (?:our|the|my) (?:site|website|pricing(?: page)?|demo page|docs?)\b|\bwebsite visit(?:or)?s?\b|\bpricing[- ]page (?:visit|view)s?\b|\bvisitor (?:id|data)\b/i,
    why: "Website visits need visitor identification, which InRoad doesn't buy.",
    nearest: "A launch or pricing change on their site, or a page monitor in Research.",
  },
  {
    test: /\bintent (?:data|signals?)\b|\bbombora\b|\bg2\b|\b(?:researching|comparing) (?:competitors|alternatives|vendors|tools)\b/i,
    why: "Third-party intent data is paid; InRoad runs on free public signals.",
    nearest: "A buyer posting about the problem, or a request for help in a community.",
  },
  {
    test: /\blinkedin (?:posts? engagement|engagement|likes?|comments?|activity|reactions?)\b|\b(?:liked|commented on|engaged with|reacted to|shared) (?:our|my|a|the) (?:linkedin )?post\b/i,
    why: "InRoad doesn't read LinkedIn engagement (no scraping).",
    nearest: "A buyer posting about the problem, from posts you capture.",
  },
  {
    test: /\b(?:open(?:s|ed)?|click(?:s|ed)?) (?:on )?(?:our|my|the|an?) (?:email|link|newsletter|message)\b|\bemail opens?\b/i,
    why: "Opens and clicks aren't tracked; they stopped being reliable after mail privacy changes.",
    nearest: "Replies, marked in Check replies on Today.",
  },
  {
    test: /\b(?:signs? up|signed up|sign-?ups?|free trial|trial users?|product usage|active users?|usage (?:spikes?|drops?)|hits? (?:their|the|a) (?:plan |usage )?limit|in-app)\b/i,
    why: "Product usage isn't an account signal yet: connected analytics feed metrics, not plays.",
    nearest: "A first hire or a launch at the account.",
  },
  {
    test: /\b(?:deals?|opportunit(?:y|ies)|proposals?)\b[^.]{0,40}\b(?:quiet|silent|stall(?:s|ed)?|dark|no (?:reply|response|answer))\b|\bgone (?:quiet|silent|dark)\b/i,
    why: "Deal silence isn't a signal a custom play can fire on.",
    nearest: "The built-in play Rescue a stalled deal (21 days quiet).",
  },
  {
    test: /\bclosed[- ]lost\b|\blost (?:deals?|to (?:a )?competitor)\b|\bdeals? we lost\b/i,
    why: "Lost deals come back on their own clock in a built-in play.",
    nearest: "The built-in play Revisit closed-lost.",
  },
  {
    test: /\bheadcount\b|\b(?:grew|grows|growing) (?:by )?\d+ ?%|\b(?:more|fewer|over|under) than \d+ (?:employees|people)\b|\b\d+\+? employees\b/i,
    why: "Headcount isn't tracked over time.",
    nearest: "An ICP criterion about company size, or hiring signals.",
  },
  {
    test: /\braised? (?:more|less|over|under) than\b|\b(?:over|more than|at least|above) \$\s?\d|\$\d+ ?(?:m|mm|million|k|b)\+/i,
    why: "Round sizes aren't read from funding news.",
    nearest: "Any funding round, with a word like “Series B”.",
  },
  {
    test: /\b(?:auto-?send|automatically (?:send|email|message|post|connect)|send (?:it|them|the (?:note|email|message)) (?:automatically|for me|without)|without (?:asking|approval|my approval|me))\b/i,
    why: "InRoad never sends, posts or contacts anyone by itself. It drafts; you approve.",
    nearest: "A draft on Today for you to approve.",
  },
];

/** Adds what the sentence asked for that can't run and the compiler didn't already name. */
export function withUnsupported(sentence: string, named: UnsupportedPart[]): UnsupportedPart[] {
  const out = [...named];
  for (const rule of CANNOT) {
    const hit = rule.test.exec(sentence)?.[0];
    if (!hit) continue;
    const h = fold(hit);
    if (out.some((u) => fold(u.phrase).includes(h) || h.includes(fold(u.phrase)) || u.why === rule.why)) continue;
    out.push({ phrase: hit, why: rule.why, nearest: rule.nearest });
  }
  return out.slice(0, 6);
}

/** Days between a version and today, for "v2 · 9 days". */
export function ageDays(at: string, today: ISODate): number {
  return Math.max(0, daysBetween(localDate(at), today));
}

/** The editor's default for a brand-new recipe. */
export function blankRecipe(): Recipe {
  return normalizeRecipe({ name: "New play", trigger: { signals: ["jd_names_pain"], withinDays: 45 }, audience: { tiers: ["A", "B"], deal: "none" }, action: { kind: "write", angle: "" } });
}

export const STAGE_CHOICES: Stage[] = [...OPEN_STAGES];
