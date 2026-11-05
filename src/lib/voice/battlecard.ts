import type { Action } from "@/lib/domain/actions";
import type { Claim, Competitor, ObjectionCard, Workspace } from "@/lib/domain/types";
import { STAGE_LABELS } from "@/lib/domain/types";
import { unsourcedNumbers } from "@/components/playbook/model";
import { clip, plural } from "@/lib/moves/util";
import { heardIn } from "./index";
import { hashKey } from "./text";
import type { BuyerVoice, VoiceAlternative, VoiceBattlecard, VoiceSnippet, VoiceTheme } from "./types";

/**
 * "Draft a battlecard": for one alternative (a vendor, spreadsheets, building it…) or a recurring objection, the
 * answer the founder will use on calls, written by the model only from the quotes and the approved claims. Code
 * picks the quotes, counts the record, checks every id and number the draft uses, and turns an approved draft
 * into the existing objection card and competitor entry through ordinary actions.
 */

export const BATTLECARD_QUOTES = 10;

export const BATTLECARD_RULES = `BATTLECARD RULES
You write the answer a founder uses on sales calls when this comes up. Sources: the QUOTES (what buyers said) and
the APPROVED CLAIMS (the only facts about us). Nothing else is a fact.
- objection: at most 20 words, how buyers put it, close to their words in the quotes.
- underlyingConcern: at most 25 words: what they are worried about underneath.
- clarifyingQ: at most 25 words: the one question to ask before answering.
- response: at most 70 words. Acknowledge, then answer. A fact about us must come from an approved claim; a fact about
  them from a quote. If the quotes and claims can't support an answer, keep it short and lean on the question.
- walkAwayIf: at most 25 words: when this is a real no and the founder should let the deal go.
- landmines: up to 3 questions (at most 22 words each) that surface where the alternative falls short, without
  knocking it. Only for a named vendor or alternative; otherwise empty.
- whenWeWin / whenWeLose: at most 30 words each, from the record and the quotes; null when they don't show it.
- quoteIds: the quotes the draft rests on (at least one). claimIds: the approved claims it uses.
- Never invent a number, customer, feature or date. Never disparage a competitor. Plain sentences, no exclamation marks.`;

export interface BattlecardTarget {
  key: string;
  subject: string;
  kind: "alternative" | "objection";
  snippets: VoiceSnippet[];
  category: ObjectionCard["category"];
  response?: { objectionId: string; approved: boolean; text: string };
  alternative?: VoiceAlternative;
  theme?: VoiceTheme;
  /** The playbook's competitor entry, when it's a named vendor there. */
  competitor?: { index: number; entry: Competitor };
}

export function battlecardTarget(ws: Workspace, voice: BuyerVoice, key: string): BattlecardTarget | null {
  const alt = voice.alternatives.find((a) => a.key === key);
  if (alt) {
    const entry = alt.competitorIndex !== undefined ? ws.foundation?.competitors?.[alt.competitorIndex] : undefined;
    return {
      key,
      subject: alt.name,
      kind: "alternative",
      snippets: alt.snippets,
      category: alt.category,
      response: alt.response,
      alternative: alt,
      competitor: entry && alt.competitorIndex !== undefined ? { index: alt.competitorIndex, entry } : undefined,
    };
  }
  const theme = voice.themes.find((t) => t.key === key && t.kind === "objection");
  if (theme) return { key, subject: theme.label, kind: "objection", snippets: theme.snippets, category: theme.category ?? "priority", response: theme.response, theme };
  return null;
}

/** Quotes for the prompt: verbatim first, one per conversation before a second from the same one, newest first. */
export function pickQuotes(snips: VoiceSnippet[], max = BATTLECARD_QUOTES): VoiceSnippet[] {
  const sorted = [...snips].sort((a, b) => Number(b.verbatim) - Number(a.verbatim) || b.at.localeCompare(a.at));
  const seen = new Set<string>();
  const first = sorted.filter((s) => (seen.has(s.conv) ? false : (seen.add(s.conv), true)));
  return [...first, ...sorted.filter((s) => !first.includes(s))].slice(0, max);
}

export interface BattlecardInput {
  target: BattlecardTarget;
  message: string;
  /** Prompt quote id → snippet id. */
  quotes: Map<string, string>;
  claims: Claim[];
  /** Everything the draft may take a number from. */
  sourced: string;
}

function record(t: BattlecardTarget): string[] {
  const rows = t.alternative?.dealRows ?? [];
  if (!rows.length) return [`Deals where it came up: ${plural(t.theme?.deals ?? 0, "deal")}.`];
  const lines = rows.map((r) => `${r.name}: ${r.outcome === "open" ? `open, at ${STAGE_LABELS[r.stage]}` : r.outcome}${r.lostTo ? " (the loss reason on file is this)" : ""}`);
  return [`Deals where it came up: ${rows.length} (won ${t.alternative!.record.won}, lost ${t.alternative!.record.lost}, open ${t.alternative!.record.open}).`, ...lines];
}

export function battlecardInput(ws: Workspace, voice: BuyerVoice, key: string, header = ""): BattlecardInput | null {
  const target = battlecardTarget(ws, voice, key);
  if (!target || !target.snippets.length) return null;
  const quotes = new Map<string, string>();
  const quoteLines = pickQuotes(target.snippets).map((s, i) => {
    const id = `q${i + 1}`;
    quotes.set(id, s.id);
    const who = [s.title ?? (s.speaker ? "buyer" : undefined), s.company].filter(Boolean).join(" at ");
    const kind = s.verbatim ? (s.source === "email" ? "their email" : "transcript") : s.source === "summary" ? "debrief summary, not their words" : "founder's notes, not their words";
    return `<quote id="${id}" source="${kind}" who="${who || "buyer"}" date="${s.date}"${s.stage ? ` stage="${STAGE_LABELS[s.stage]}"` : ""}>${clip(s.text, 400)}</quote>`;
  });
  const claims = ws.claims.filter((c) => c.approved);
  const recordLines = record(target);
  const existing = target.response ? ws.objections.find((o) => o.id === target.response!.objectionId) : undefined;
  const c = target.competitor?.entry;
  const message = [
    header,
    `Draft the battlecard for: ${target.subject} (${target.kind === "alternative" ? `an alternative buyers named, ${target.alternative!.kind.replace("_", " ")}` : "a recurring objection"}).`,
    `It came up in ${plural(heardIn(target), "conversation")}.`,
    ws.company?.plainOneLiner ? `What we sell: ${ws.company.plainOneLiner}` : null,
    "",
    "RECORD (counted in code):",
    ...recordLines,
    "",
    "QUOTES:",
    ...quoteLines,
    "",
    "APPROVED CLAIMS:",
    ...(claims.length ? claims.map((cl) => `<claim id="${cl.id}" kind="${cl.kind}">${clip(cl.text, 300)}</claim>`) : ["(none approved yet: make no claims about us)"]),
    existing ? `\nTHE ANSWER ON FILE NOW (${existing.approved ? "approved" : "draft"}): "${clip(existing.objection, 200)}" → ${clip(existing.response || "(no response yet)", 500)}` : null,
    c ? `\nPLAYBOOK ENTRY FOR ${c.name}: we win when ${c.whenWeWin || "(blank)"}; we lose when ${c.whenWeLose || "(blank)"}; questions: ${c.landmineQuestions.join(" / ") || "(none)"}` : null,
    "",
    "Call submit_battlecard once.",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
  const sourced = [...target.snippets.map((s) => s.text), ...claims.map((cl) => cl.text), ...recordLines].join("\n");
  return { target, message, quotes, claims, sourced };
}

export interface BattlecardOut {
  objection: string;
  category: ObjectionCard["category"];
  underlyingConcern: string;
  clarifyingQ: string;
  response: string;
  walkAwayIf: string;
  landmines: string[];
  whenWeWin: string | null;
  whenWeLose: string | null;
  quoteIds: string[];
  claimIds: string[];
}

const words = (s: string | null | undefined) => (s ?? "").trim().split(/\s+/).filter(Boolean).length;

export function battlecardProblems(out: BattlecardOut, input: BattlecardInput): string[] {
  const problems: string[] = [];
  const badQuotes = out.quoteIds.filter((q) => !input.quotes.has(q));
  if (!out.quoteIds.length) problems.push("quoteIds: cite at least one quote");
  if (badQuotes.length) problems.push(`Unknown quote ids: ${badQuotes.join(", ")}`);
  const approved = new Set(input.claims.map((c) => c.id));
  const badClaims = out.claimIds.filter((c) => !approved.has(c));
  if (badClaims.length) problems.push(`Not approved claims: ${badClaims.join(", ")}. Use only APPROVED CLAIMS`);
  for (const [field, text, max] of [
    ["objection", out.objection, 22],
    ["response", out.response, 80],
    ["clarifyingQ", out.clarifyingQ, 30],
    ["walkAwayIf", out.walkAwayIf, 30],
  ] as const) {
    if (words(text) > max) problems.push(`${field} is ${words(text)} words; keep it shorter`);
    if (/!/.test(text)) problems.push(`${field}: no exclamation marks`);
  }
  for (const [field, text] of [
    ["response", out.response],
    ["whenWeWin", out.whenWeWin ?? ""],
    ["whenWeLose", out.whenWeLose ?? ""],
    ["walkAwayIf", out.walkAwayIf],
  ] as const) {
    const unsourced = unsourcedNumbers(text, input.sourced);
    if (unsourced.length) problems.push(`${field}: "${unsourced[0]}" isn't in a quote or an approved claim; remove it`);
  }
  return problems;
}

const tidy = (s: string | null | undefined, max: number) => clip((s ?? "").replace(/\s+/g, " ").trim(), max);

export function toBattlecard(out: BattlecardOut, input: BattlecardInput, meta: { at: string; runId?: string; costUsd?: number }): VoiceBattlecard {
  const approved = new Set(input.claims.map((c) => c.id));
  return {
    key: input.target.key,
    subject: input.target.subject,
    objection: tidy(out.objection, 200).replace(/^["“]|["”]$/g, ""),
    category: out.category,
    underlyingConcern: tidy(out.underlyingConcern, 300),
    clarifyingQ: tidy(out.clarifyingQ, 300),
    response: tidy(out.response, 700),
    walkAwayIf: tidy(out.walkAwayIf, 300),
    landmines: out.landmines.map((l) => tidy(l, 240)).filter(Boolean).slice(0, 3),
    ...(out.whenWeWin?.trim() ? { whenWeWin: tidy(out.whenWeWin, 300) } : {}),
    ...(out.whenWeLose?.trim() ? { whenWeLose: tidy(out.whenWeLose, 300) } : {}),
    quoteIds: [...new Set(out.quoteIds.map((q) => input.quotes.get(q)).filter((x): x is string => !!x))],
    claimIds: [...new Set(out.claimIds.filter((c) => approved.has(c)))],
    at: meta.at,
    ...(meta.runId ? { runId: meta.runId } : {}),
    ...(meta.costUsd !== undefined ? { costUsd: meta.costUsd } : {}),
  };
}

const sameQ = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Saving a draft, as ordinary actions: the objection card (the one on file keeps its id, wording and counts),
 * and for a vendor its competitor entry (new questions added, blank fields filled, never the founder's text
 * replaced). Returns the undo too.
 */
export function saveBattlecard(ws: Workspace, voice: BuyerVoice, card: VoiceBattlecard, approve: boolean, at: string): { actions: Action[]; undo: Action[]; objectionId: string } | null {
  const target = battlecardTarget(ws, voice, card.key);
  const existing = target?.response ? ws.objections.find((o) => o.id === target.response!.objectionId) : undefined;
  const heard = target ? heardIn(target) : 1;
  const last = target?.snippets.map((s) => s.date).sort().at(-1);
  const objection: ObjectionCard = existing
    ? { ...existing, underlyingConcern: card.underlyingConcern, clarifyingQ: card.clarifyingQ, response: card.response, walkAwayIf: card.walkAwayIf, approved: approve }
    : {
        id: `obj_bv_${hashKey(card.key)}`,
        objection: card.objection,
        category: card.category,
        underlyingConcern: card.underlyingConcern,
        clarifyingQ: card.clarifyingQ,
        response: card.response,
        walkAwayIf: card.walkAwayIf,
        approved: approve,
        timesHeard: heard,
        ...(last ? { lastHeard: last } : {}),
      };
  const actions: Action[] = [{ type: "objection.upsert", objection }];
  const undo: Action[] = [existing ? { type: "objection.upsert", objection: existing } : { type: "objection.remove", id: objection.id }];

  const f = ws.foundation;
  const alt = target?.alternative;
  if (f && alt?.kind === "competitor") {
    const list = f.competitors ?? [];
    const i = alt.competitorIndex;
    if (i !== undefined && list[i]) {
      const c = list[i];
      const questions = [...c.landmineQuestions, ...card.landmines.filter((q) => !c.landmineQuestions.some((x) => sameQ(x, q)))].slice(0, 8);
      const next: Competitor = { ...c, landmineQuestions: questions, whenWeWin: c.whenWeWin.trim() ? c.whenWeWin : (card.whenWeWin ?? ""), whenWeLose: c.whenWeLose.trim() ? c.whenWeLose : (card.whenWeLose ?? "") };
      if (JSON.stringify(next) !== JSON.stringify(c)) {
        actions.push({ type: "foundation.set", path: ["competitors", i], value: next });
        undo.push({ type: "foundation.set", path: ["competitors", i], value: c });
      }
    } else if (!list.some((c) => c.name.toLowerCase() === alt.name.toLowerCase())) {
      const entry: Competitor = { name: alt.name, ...(alt.domain ? { domain: alt.domain } : {}), whenWeWin: card.whenWeWin ?? "", whenWeLose: card.whenWeLose ?? "", landmineQuestions: card.landmines };
      actions.push({ type: "foundation.set", path: ["competitors"], value: [...list, entry] });
      undo.push({ type: "foundation.set", path: ["competitors"], value: list });
    }
  }
  actions.push({ type: "buyerVoice.markSaved", key: card.key, saved: { at, objectionId: objection.id, approved: approve } });
  undo.push({ type: "buyerVoice.markSaved", key: card.key, saved: null });
  return { actions, undo, objectionId: objection.id };
}
