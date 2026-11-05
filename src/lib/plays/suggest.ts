import type { ISODate, PersonaRole, Signal, SignalType, Workspace } from "@/lib/domain/types";
import { clip, daysSince } from "@/lib/moves/util";
import { playEnabled, playForSignal } from "./catalog";
import type { CustomPlay, Recipe } from "./recipe-types";
import { customPlays, dryRun, fold, liveRecipe, mentions, normalizeRecipe, orList, PERSONA_ROLES, personaLabel, RECIPE_SIGNALS, SIGNAL_INFO, type RecipeSignal } from "./recipes";

/**
 * "Plays you might want": recipes built in code from this workspace, never by a model. Three sources, each
 * with the evidence that it would fire: signal types that fired at fit companies with no running play on
 * them, the playbook's own persona triggers where recent signals use their words, and companies with two
 * different fresh signals at once. Ranked by how many companies each would fire on today.
 */

export interface PlaySuggestion {
  key: string;
  name: string;
  /** Why, from facts computed here: "2 fit companies posted one in the last 45 days; no running play covers it." */
  why: string;
  /** How the play reads as a sentence; kept on the draft it becomes. */
  sentence: string;
  recipe: Recipe;
  fires: number;
  handled: number;
  /** Who it would fire on today, best first. */
  companies: string[];
}

const FIT = 60;
const STOP = new Set(
  "a an the and or of to for in on at by with from into their our your its new first moving hiring hire hires role roles days day tied work readiness firm customers team teams people company companies".split(" "),
);

/** Signal types a persona trigger like "Hiring a revenue accountant for usage" describes. */
export function typesFor(phrase: string): RecipeSignal[] {
  const t = fold(phrase);
  const out = new Set<RecipeSignal>();
  if (/\b(?:hir(?:e|es|ing)|posting|job|recruit\w*|opening)\b/.test(t)) ["jd_names_pain", "first_hire", "hiring"].forEach((s) => out.add(s as RecipeSignal));
  if (/\b(?:raise[sd]?|raising|round|funding|funded|series [a-e])\b/.test(t)) ["funding", "filing"].forEach((s) => out.add(s as RecipeSignal));
  if (/\b(?:audit\w*|soc 2|soc2|compliance|ipo)\b/.test(t)) out.add("compliance_deadline");
  if (/\b(?:launch\w*|pricing|contracts?|plans?|moving \w+ to)\b/.test(t)) out.add("launch");
  if (/\b(?:migrat\w*|stack|switch\w*)\b/.test(t)) out.add("stack_change");
  if (/\b(?:new|joins?|joined|appointed|first \d+ days)\b.*\b(?:leader|vp|head|cfo|cro|chief|role)\b/.test(t)) out.add("new_leader");
  return RECIPE_SIGNALS.filter((s) => out.has(s));
}

/** Words worth matching on, from a phrase: no filler, at least 4 letters. */
function words(phrase: string): string[] {
  return [...new Set(fold(phrase).split(/[^\p{L}\p{N}]+/u))].filter((w) => w.length >= 4 && !STOP.has(w));
}

const prospect = (a: Workspace["accounts"][string]) => a.status !== "customer" && a.status !== "disqualified";
const fresh = (s: Signal, today: ISODate, days: number) => s.usableInOutreach && s.type !== "sensitive" && !!s.date && daysSince(s.date, today) <= days;

function covered(ws: Workspace, type: SignalType): boolean {
  const builtin = playForSignal(type);
  if (builtin && playEnabled(ws, builtin)) return true;
  return customPlays(ws).some((cp) => playEnabled(ws, cp.id) && !!liveRecipe(cp)?.trigger.signals.includes(type));
}

/** Two recipes that would mostly fire on the same thing: half their signal types shared and a word in common (or neither has words). */
function overlaps(a: Recipe, b: Recipe): boolean {
  const sa = new Set(a.trigger.signals);
  const shared = b.trigger.signals.filter((s) => sa.has(s)).length;
  const union = new Set([...a.trigger.signals, ...b.trigger.signals]).size;
  if (shared / union < 0.5 || a.trigger.stack !== b.trigger.stack) return false;
  const ka = a.trigger.keywords;
  const kb = b.trigger.keywords;
  return (!ka.length && !kb.length) || ka.some((k) => kb.includes(k));
}

function personaRoles(ws: Workspace): PersonaRole[] {
  const roles = (ws.foundation?.personas ?? []).map((p) => p.role).filter((r): r is PersonaRole => (PERSONA_ROLES as readonly string[]).includes(r));
  const pick = (["champion", "economic_buyer"] as PersonaRole[]).filter((r) => roles.includes(r));
  return pick.length ? pick : roles.slice(0, 2);
}

function implication(ws: Workspace, type: SignalType): string | undefined {
  return ws.foundation?.icp.triggers.find((t) => t.type === type)?.implication ?? ws.foundation?.messaging.bySignal.find((s) => s.signal === type)?.implication;
}

function windowFor(ws: Workspace, types: RecipeSignal[]): number {
  return Math.max(...types.map((t) => ws.foundation?.icp.triggers.find((x) => x.type === t)?.windowDays ?? SIGNAL_INFO[t].window));
}

type Candidate = Omit<PlaySuggestion, "fires" | "handled" | "companies"> & { rank: number };

export function suggestPlays(ws: Workspace, today: ISODate, limit = 3): PlaySuggestion[] {
  const accounts = Object.values(ws.accounts).filter((a) => prospect(a) && a.fitScore >= FIT);
  const personas = personaRoles(ws);
  const who = personas.length ? `the ${orList(personas.map((p) => personaLabel(ws, p, { titled: false })))}` : "the best person on file";
  const candidates: Candidate[] = [];

  // 1. Signal types that fired at fit companies and that no running play watches.
  for (const type of RECIPE_SIGNALS) {
    if (covered(ws, type)) continue;
    const days = Math.min(45, SIGNAL_INFO[type].window);
    const hits = accounts.filter((a) => a.signals.some((s) => s.type === type && fresh(s, today, days)));
    if (!hits.length) continue;
    const info = SIGNAL_INFO[type];
    candidates.push({
      key: `uncovered:${type}`,
      rank: 0,
      name: clip(`${info.label} at a fit company`, 60),
      why: `${hits.length} fit ${hits.length === 1 ? "company" : "companies"} showed ${info.phrase} in the last ${days} days, and no running play covers it.`,
      sentence: `When a fit company shows ${info.phrase} and there's no open deal, write to ${who}.`,
      recipe: normalizeRecipe({
        name: `${info.label} at a fit company`,
        trigger: { signals: [type], withinDays: SIGNAL_INFO[type].window },
        audience: { tiers: ["A", "B"], minFit: FIT, deal: "none", personas },
        action: { kind: "write", angle: implication(ws, type) ?? "Write about what the signal changes for them, citing it." },
        measure: "reply",
      }),
    });
  }

  // 2. The playbook's persona triggers, where recent signals use their words.
  const recent = Object.values(ws.accounts)
    .filter(prospect)
    .flatMap((a) => a.signals.filter((s) => fresh(s, today, 120)));
  for (const persona of ws.foundation?.personas ?? []) {
    if (!(PERSONA_ROLES as readonly string[]).includes(persona.role)) continue;
    for (const phrase of persona.triggers) {
      const types = typesFor(phrase);
      if (!types.length) continue;
      const texts = recent.filter((s) => (types as SignalType[]).includes(s.type)).map((s) => `${s.headline} ${s.implication}`);
      const kw = words(phrase).filter((w) => texts.some((t) => !!mentions(t, [w])));
      if (!kw.length) continue;
      const label = personaLabel(ws, persona.role, { titled: false });
      const name = clip(phrase.charAt(0).toUpperCase() + phrase.slice(1), 60);
      candidates.push({
        key: `persona:${persona.id}:${fold(phrase).slice(0, 40)}`,
        rank: 1,
        name,
        why: `Your playbook says ${quote(phrase)} is a trigger for the ${label}; recent signals use ${orList(kw.slice(0, 3).map(quote))}.`,
        sentence: `When a company shows ${quote(fold(phrase))} (a signal that mentions ${orList(kw.slice(0, 3))}) and there's no open deal, write to the ${label}.`,
        recipe: normalizeRecipe({
          name,
          trigger: { signals: types, withinDays: windowFor(ws, types), keywords: kw.slice(0, 3) },
          audience: { tiers: ["A", "B"], deal: "none", personas: [persona.role] },
          action: { kind: "write", angle: clip(`${phrase}: ${persona.line}`, 240) },
          measure: "reply",
        }),
      });
    }
  }

  // 3. Two different signals at once: the strongest reason to write, and no built-in play asks for it.
  const stacked = accounts.filter((a) => new Set(a.signals.filter((s) => fresh(s, today, 60) && (RECIPE_SIGNALS as readonly string[]).includes(s.type)).map((s) => s.type)).size >= 2);
  if (stacked.length) {
    const types = RECIPE_SIGNALS.filter((t) => stacked.some((a) => a.signals.some((s) => s.type === t && fresh(s, today, 60))));
    candidates.push({
      key: `stack:${types.join("+")}`,
      rank: 2,
      name: "Two signals at once",
      why: `${stacked.length} fit ${stacked.length === 1 ? "company has" : "companies have"} two different fresh signals at the same time.`,
      sentence: `When a fit company has two different fresh signals at once and there's no open deal, write to ${who} about the newest one.`,
      recipe: normalizeRecipe({
        name: "Two signals at once",
        trigger: { signals: types, withinDays: 60, stack: 2 },
        audience: { tiers: ["A", "B"], minFit: FIT, deal: "none", personas },
        action: { kind: "write", angle: "Lead with the newest signal; bring in the other only if it sharpens the point." },
        measure: "meeting",
      }),
    });
  }

  const own = Object.values(ws.customPlays ?? {});
  const taken = new Set(own.map((cp) => cp.suggestion).filter(Boolean));
  const recipes = own.map((cp: CustomPlay) => liveRecipe(cp)).filter((r): r is Recipe => !!r);
  const out: (PlaySuggestion & { rank: number })[] = [];
  for (const c of candidates) {
    if (taken.has(c.key) || recipes.some((r) => overlaps(r, c.recipe)) || out.some((o) => overlaps(o.recipe, c.recipe))) continue;
    const dry = dryRun(ws, c.recipe, `suggest_${c.key}`, today);
    const live = [...dry.fire, ...dry.waiting];
    if (!live.length && !dry.handled.length) continue;
    out.push({ ...c, fires: live.length, handled: dry.handled.length, companies: live.slice(0, 3).map((m) => m.company) });
  }
  return out
    .sort((a, b) => b.fires - a.fires || a.rank - b.rank || b.handled - a.handled)
    .slice(0, limit)
    .map(({ key, name, why, sentence, recipe, fires, handled, companies }) => ({ key, name, why, sentence, recipe, fires, handled, companies }));
}

const quote = (s: string) => `“${s}”`;
