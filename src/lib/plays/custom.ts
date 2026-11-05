import type { ID, ISODateTime, Move, PersonaRole, SkipReason, Workspace } from "@/lib/domain/types";
import { clip } from "@/lib/moves/util";
import { firstWorked, moveDomain, tallyResults, type PlayResults } from "./catalog";
import type { CustomPlay, CustomPlayAction, Recipe, RecipeMeasure, RecipeVersion } from "./recipe-types";
import { currentVersion, describeChanges, MEASURE_LABELS, normalizeRecipe, orList, personaLabel, roleOf, sameRecipe, versionAt } from "./recipes";

/**
 * The founder's plays over time: the reducer behind the customPlay.* actions, the record of what each play
 * worked (kept for good, per version), its results by version, and the lessons its skipped cards teach.
 * Pure: the browser and the server apply the same actions and get the same workspace.
 */

/* ─────────────────────────────── Reducer ─────────────────────────────── */

const SOURCES: RecipeVersion["source"][] = ["compiled", "suggested", "edit", "learned"];
const str = (v: unknown, max: number) => clip(typeof v === "string" ? v : "", max);

/** A play as it may be stored: every field checked, recipes normalized, history pointing at real versions. */
export function normalizePlay(raw: CustomPlay): CustomPlay {
  const seen = new Set<number>();
  const versions = (Array.isArray(raw.versions) ? raw.versions : [])
    .filter((v) => v && Number.isInteger(v.version) && v.version > 0 && !seen.has(v.version) && !!seen.add(v.version))
    .map((v) => ({ version: v.version, recipe: normalizeRecipe(v.recipe), at: String(v.at), note: str(v.note, 160), source: SOURCES.includes(v.source) ? v.source : "edit" }))
    .sort((a, b) => a.version - b.version);
  const history = (Array.isArray(raw.history) ? raw.history : [])
    .filter((h) => h && seen.has(h.version) && typeof h.at === "string")
    .map((h) => ({ version: h.version, at: h.at }))
    .sort((a, b) => a.at.localeCompare(b.at));
  const last = versions.at(-1);
  if (last && !history.length) history.push({ version: last.version, at: last.at });
  return {
    id: String(raw.id),
    createdAt: String(raw.createdAt),
    sentence: str(raw.sentence, 500),
    origin: raw.origin === "suggestion" ? "suggestion" : "sentence",
    ...(raw.suggestion ? { suggestion: String(raw.suggestion).slice(0, 80) } : {}),
    versions,
    history,
    ...(raw.draft ? { draft: normalizeRecipe(raw.draft) } : {}),
    unsupported: (Array.isArray(raw.unsupported) ? raw.unsupported : [])
      .map((u) => ({ phrase: str(u?.phrase, 120), why: str(u?.why, 200), nearest: str(u?.nearest, 200) }))
      .filter((u) => u.phrase)
      .slice(0, 6),
    assumptions: (Array.isArray(raw.assumptions) ? raw.assumptions : []).map((a) => str(a, 200)).filter(Boolean).slice(0, 6),
    dismissed: (Array.isArray(raw.dismissed) ? raw.dismissed : [])
      .filter((d) => d && typeof d.key === "string")
      .map((d) => ({ key: d.key.slice(0, 60), at: String(d.at), skips: Number(d.skips) || 0 }))
      .slice(-20),
    ...(raw.archivedAt ? { archivedAt: String(raw.archivedAt) } : {}),
    ...(raw.runId ? { runId: String(raw.runId) } : {}),
  };
}

/** Applies one customPlay.* action. The caller (applyAction) has already checked the play exists. Never throws. */
export function applyCustomPlayAction(ws: Workspace, action: CustomPlayAction): void {
  const all = (ws.customPlays ??= {});
  if (action.type === "customPlay.upsert") {
    const play = normalizePlay(action.play);
    all[play.id] = play;
    return;
  }
  const cp = all[action.id];
  if (!cp) return;
  switch (action.type) {
    case "customPlay.edit": {
      const recipe = normalizeRecipe(action.recipe);
      const current = currentVersion(cp)?.recipe;
      // Editing back to what runs is no change at all.
      if (current && sameRecipe(current, recipe)) delete cp.draft;
      else cp.draft = recipe;
      return;
    }
    case "customPlay.commit": {
      const recipe = action.recipe ? normalizeRecipe(action.recipe) : cp.draft;
      if (!recipe) return;
      if (!action.recipe) delete cp.draft;
      const current = currentVersion(cp);
      if (current && sameRecipe(current.recipe, recipe)) return;
      const version = (cp.versions.at(-1)?.version ?? 0) + 1;
      const auto = current ? describeChanges(current.recipe, recipe, ws).slice(0, 3).join("; ") : "First version";
      cp.versions.push({ version, recipe, at: action.at, note: clip(action.note?.trim() || auto || "Saved", 160), source: action.source });
      cp.history.push({ version, at: action.at });
      return;
    }
    case "customPlay.rollback": {
      if (!cp.versions.some((v) => v.version === action.version) || currentVersion(cp)?.version === action.version) return;
      cp.history.push({ version: action.version, at: action.at });
      return;
    }
    case "customPlay.discardDraft":
      delete cp.draft;
      return;
    case "customPlay.dismissLesson":
      cp.dismissed = [...cp.dismissed.filter((d) => d.key !== action.key), { key: action.key, at: action.at, skips: action.skips }].slice(-20);
      return;
    case "customPlay.archive":
      if (action.archived) {
        cp.archivedAt = action.at;
        ws.plays ??= {};
        ws.plays[cp.id] = { ...ws.plays[cp.id], enabled: false, updatedAt: action.at };
      } else delete cp.archivedAt;
      return;
    case "customPlay.remove":
      // A play that has run keeps its record (results stay attributed); only a draft can go.
      if (cp.versions.length) return;
      delete all[cp.id];
      if (ws.plays?.[cp.id]) delete ws.plays[cp.id];
      return;
  }
}

/* ─────────────────────────────── What each play worked, for good ─────────────────────────────── */

/**
 * The first time a play worked these companies. Earlier dates win and nothing is trimmed, so a play's results
 * never shrink as its run log (last 30) and its old Today cards (30 days) roll off. For the founder's plays the
 * version current then is kept with it.
 */
export function noteWorked(ws: Workspace, playId: string, domains: string[], at: ISODateTime, moveId?: ID): void {
  if (!domains.length) return;
  ws.plays ??= {};
  const custom = ws.customPlays?.[playId];
  // A built-in play with no entry runs by default; the founder's runs only once it's turned on.
  const state = (ws.plays[playId] ??= { enabled: !custom, updatedAt: at });
  const worked = (state.worked ??= {});
  const version = custom ? versionAt(custom, at) : undefined;
  for (const domain of domains) {
    const prev = worked[domain];
    if (prev && prev.at <= at) continue;
    worked[domain] = { at, ...(version !== undefined ? { version } : {}), ...(moveId ? { moveId } : {}) };
  }
}

/** A play's Today card marked done counts from when the card appeared, like the results always have. */
export function noteCardDone(ws: Workspace, move: Move): void {
  if (!move.playId || move.autoDone) return;
  const domain = moveDomain(ws, move);
  if (domain) noteWorked(ws, move.playId, [domain], move.createdAt, move.id);
}

/** Undoing a done card takes back what it recorded (and only that). */
export function forgetCard(ws: Workspace, move: Move): void {
  const worked = move.playId ? ws.plays?.[move.playId]?.worked : undefined;
  if (!worked) return;
  for (const [domain, w] of Object.entries(worked)) if (w.moveId === move.id) delete worked[domain];
}

/* ─────────────────────────────── Results by version ─────────────────────────────── */

/** The play's results, and the same numbers split by the version that was current when each company was first worked. */
export function resultsByVersion(ws: Workspace, cp: CustomPlay): { total: PlayResults; byVersion: Map<number, PlayResults> } {
  const worked = firstWorked(ws, cp.id);
  const recorded = ws.plays?.[cp.id]?.worked ?? {};
  const groups = new Map<number, Map<string, ISODateTime>>();
  for (const [domain, at] of worked) {
    const v = (recorded[domain]?.at === at ? recorded[domain].version : undefined) ?? versionAt(cp, at) ?? 1;
    if (!groups.has(v)) groups.set(v, new Map());
    groups.get(v)!.set(domain, at);
  }
  return { total: tallyResults(ws, worked), byVersion: new Map([...groups].map(([v, m]) => [v, tallyResults(ws, m)])) };
}

/** The measure the founder picked, honest about small numbers: "1 meeting from 3 worked · too few to call". */
export function measureLine(r: PlayResults, measure: RecipeMeasure): string {
  if (!r.worked) return `No ${MEASURE_LABELS[measure]} yet: nothing worked from it`;
  const n = measure === "reply" ? r.replied : measure === "meeting" ? r.meetings : r.won;
  const word = measure === "reply" ? (n === 1 ? "reply" : "replies") : measure === "meeting" ? (n === 1 ? "meeting" : "meetings") : n === 1 ? "deal won" : "deals won";
  return `${n} ${word} from ${r.worked} worked${r.worked >= 20 ? ` · ${Math.round((100 * n) / r.worked)} per 100` : " · too few to call"}`;
}

/* ─────────────────────────────── Skips teach plays ─────────────────────────────── */

/** A change the play's skipped cards argue for. Code proposes it; the founder accepts or dismisses; undo puts it back. */
export interface PlayLesson {
  key: string;
  reason: SkipReason;
  skips: number;
  /** The question on the chip: "Stop writing to the technical approver?" */
  title: string;
  /** The evidence: "3 of its cards were skipped as “wrong person”, all written to a Head of Data." */
  detail: string;
  /** The version note if accepted. */
  note: string;
  recipe: Recipe;
}

const COOLDOWNS = [14, 30, 45, 60, 90, 120, 180, 270, 365];
/** Skips with one reason before a lesson is offered (and again after a dismissal). */
export const LESSON_AFTER = 3;

/** Lessons from cards skipped since the current version started. Deterministic: same skips, same lessons. */
export function playLessons(ws: Workspace, cp: CustomPlay): PlayLesson[] {
  const current = currentVersion(cp);
  if (!current) return [];
  const recipe = current.recipe;
  const since = cp.history.at(-1)?.at ?? current.at;
  const skipped = Object.values(ws.moves).filter((m) => m.playId === cp.id && m.status === "skipped" && !!m.skipReason && m.createdAt >= since);
  const count = (reason: SkipReason) => skipped.filter((m) => m.skipReason === reason);
  const out: PlayLesson[] = [];
  const offer = (lesson: PlayLesson) => {
    if (!sameRecipe(lesson.recipe, recipe)) out.push(lesson);
  };

  // "Wrong person", over and over, to one persona: stop writing to it.
  const roles = new Map<PersonaRole, { n: number; titles: string[] }>();
  for (const m of count("wrong_person")) {
    const person = m.ref?.kind === "person" ? ws.people[m.ref.id] : undefined;
    const role = person ? roleOf(ws, person) : undefined;
    if (!person || !role) continue;
    const r = roles.get(role) ?? { n: 0, titles: [] };
    r.n++;
    if (person.title && !r.titles.includes(person.title)) r.titles.push(person.title);
    roles.set(role, r);
  }
  const top = [...roles].sort((a, b) => b[1].n - a[1].n)[0];
  if (top && top[1].n >= LESSON_AFTER && !recipe.audience.excludePersonas.includes(top[0])) {
    const [role, { n, titles }] = top;
    const label = personaLabel(ws, role, { titled: false });
    offer({
      key: `exclude:${role}`,
      reason: "wrong_person",
      skips: n,
      title: `Stop writing to the ${label}?`,
      detail: `${n} of its cards were skipped as “wrong person”, all written to ${titles.length ? orList(titles.slice(0, 2).map((t) => `a ${t}`)) : `the ${label}`}.`,
      note: `Got it: no more ${label} after ${n} “wrong person” skips`,
      recipe: normalizeRecipe({ ...recipe, audience: { ...recipe.audience, personas: recipe.audience.personas.filter((p) => p !== role), excludePersonas: [...recipe.audience.excludePersonas, role] } }),
    });
  }

  // "Not relevant now" or "already handled": come back to a company less often.
  const notNow = count("not_relevant_now").length;
  const handled = count("already_handled").length;
  if (notNow >= LESSON_AFTER || handled >= LESSON_AFTER) {
    const days = recipe.guardrails.cooldownDays;
    const next = COOLDOWNS.find((d) => d > days) ?? days;
    const n = (notNow >= LESSON_AFTER ? notNow : 0) + (handled >= LESSON_AFTER ? handled : 0);
    const why =
      notNow >= LESSON_AFTER && handled >= LESSON_AFTER
        ? `${notNow} of its cards were skipped as “not relevant now” and ${handled} as “already handled”`
        : notNow >= LESSON_AFTER
          ? `${notNow} of its cards were skipped as “not relevant now”`
          : `${handled} of its cards were skipped as “already handled”`;
    offer({
      key: `cooldown:${next}`,
      reason: notNow >= LESSON_AFTER ? "not_relevant_now" : "already_handled",
      skips: n,
      title: `Wait ${next} days before coming back to a company?`,
      detail: `${why}. It waits ${days} ${days === 1 ? "day" : "days"} now.`,
      note: `Got it: cooldown ${days} → ${next} days after ${n} skips`,
      recipe: normalizeRecipe({ ...recipe, guardrails: { ...recipe.guardrails, cooldownDays: next } }),
    });
  }

  // "Weak angle": only stronger signals, or failing that, fresher ones.
  const weak = count("weak_angle").length;
  if (weak >= LESSON_AFTER) {
    const s = recipe.trigger.minStrength;
    if (s < 3) {
      const next = (s + 1) as 2 | 3;
      offer({
        key: `strength:${next}`,
        reason: "weak_angle",
        skips: weak,
        title: "Only fire on stronger signals?",
        detail: `${weak} of its cards were skipped as “weak angle”. Signals of strength ${s}+ count now; this asks for ${next}+.`,
        note: `Got it: strength ${s}+ → ${next}+ after ${weak} “weak angle” skips`,
        recipe: normalizeRecipe({ ...recipe, trigger: { ...recipe.trigger, minStrength: next } }),
      });
    } else {
      const next = Math.max(7, Math.round(recipe.trigger.withinDays / 2));
      offer({
        key: `window:${next}`,
        reason: "weak_angle",
        skips: weak,
        title: `Only use signals from the last ${next} days?`,
        detail: `${weak} of its cards were skipped as “weak angle”, and it already takes only strong signals.`,
        note: `Got it: window ${recipe.trigger.withinDays} → ${next} days after ${weak} “weak angle” skips`,
        recipe: normalizeRecipe({ ...recipe, trigger: { ...recipe.trigger, withinDays: next } }),
      });
    }
  }

  // A dismissed lesson comes back only after LESSON_AFTER more skips.
  return out.filter((l) => !cp.dismissed.some((d) => d.key === l.key && l.skips < d.skips + LESSON_AFTER));
}
