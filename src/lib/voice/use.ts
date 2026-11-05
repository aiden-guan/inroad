import type { FoundationRevision, Persona, StudioMaterial, Workspace } from "@/lib/domain/types";
import { clip, plural, shortDay } from "@/lib/moves/util";
import { buildRevision } from "@/lib/playbook/revision";
import { heardIn } from "./index";
import { winLine } from "./stats";
import { containsText, hashKey, sameText, terms, words } from "./text";
import type { BuyerVoice, VoiceAlternative, VoiceSnippet, VoiceTheme } from "./types";

/**
 * Putting a theme to work, in code: the playbook changes it suggests (tracked revisions, applied only when the
 * founder accepts one), the Studio material it becomes (their quotes, never named, plus the count behind them),
 * and the question it asks in Ask. Nothing here calls a model.
 */

export interface MessagingChange {
  id: string;
  label: string;
  why: string;
  revision: FoundationRevision;
}

const titleWords = (t: string) => new Set(words(t).filter((w) => w.length > 2 && !["head", "lead", "manager", "director", "senior"].includes(w)));

/** The persona whose titles the speakers' titles match most; the champion when titles don't say. */
export function personaFor(personas: Persona[], snips: VoiceSnippet[]): Persona | undefined {
  if (!personas.length) return undefined;
  const scores = personas.map((p) => {
    const titles = p.titles.map(titleWords);
    let n = 0;
    for (const s of snips) {
      if (!s.title) continue;
      const tw = titleWords(s.title);
      if (p.titles.some((t) => sameText(t, s.title!)) || titles.some((set) => [...set].some((w) => tw.has(w)))) n++;
    }
    return { p, n };
  });
  const best = scores.sort((a, b) => b.n - a.n)[0];
  return best.n > 0 ? best.p : (personas.find((p) => p.role === "champion") ?? personas[0]);
}

/**
 * "Add to messaging": up to two of their phrases as customer words, and, for a named pain, the pain in their words
 * on the persona who said it. Each is a tracked revision built and checked by the playbook's own revision code.
 */
export function messagingChanges(ws: Workspace, t: VoiceTheme): MessagingChange[] {
  const f = ws.foundation;
  if (!f || (t.kind !== "pain" && t.kind !== "outcome")) return [];
  const out: MessagingChange[] = [];
  const verbatim = t.snippets.filter((s) => s.verbatim);
  // Their words already in messaging ("true-up" covers "true-ups", "tie out usage" covers "usage tie-out") aren't offered
  // again, and a bare amount ("five days") is a number, not a phrase for the problem.
  const key = (p: string) => [...new Set(terms(p))].sort().join(" ");
  const have = new Set((f.messaging?.customerWords ?? []).map((w) => key(w.phrase)));
  const contentful = (p: string) => terms(p).some((x) => x !== "#n" && x !== "duration");
  const candidates = [...new Set([...t.words, ...t.phrases.filter((p) => p.split(" ").length >= 2)])].filter((p) => contentful(p) && !have.has(key(p)));
  for (const phrase of f.messaging?.customerWords ? candidates : []) {
    const revision = buildRevision(f, { target: "messaging.customerWords", op: "add", text: phrase });
    if (!revision) continue;
    const n = new Set(verbatim.filter((s) => containsText(s.text, phrase)).map((s) => s.conv)).size;
    out.push({ id: `cw:${phrase}`, label: "Customer words", why: n > 1 ? `Said in ${n} conversations` : "Said on a call", revision });
    if (out.length >= 2) break;
  }
  if (t.kind === "pain" && t.named) {
    const persona = personaFor(f.personas ?? [], t.snippets);
    const revision = persona ? buildRevision(f, { target: "persona.pain", op: "add", refId: persona.id, text: t.label }) : null;
    if (persona && revision) out.push({ id: `pain:${persona.id}`, label: `Pains · ${persona.titles[0] ?? "persona"}`, why: `${plural(heardIn(t), "conversation")} · named from their quotes`, revision });
  }
  return out;
}

const whoSaid = (s: VoiceSnippet) => `${s.title ?? "Buyer"}, ${s.source === "email" ? "email" : "sales call"}, ${shortDay(s.date)}${s.source === "transcript" ? " (transcript)" : ""}`;

/**
 * "Write a post about this": the theme's verbatim quotes as Studio material (marked don't-name: buyers said these on
 * sales calls, not for publication) and one count, computed here, so a post can say how often it comes up.
 * Material already in Studio is left alone, so writing twice doesn't reset what it was used for.
 */
export function studioMaterial(ws: Workspace, voice: BuyerVoice, t: VoiceTheme, at: string): StudioMaterial[] {
  const have = new Set(ws.studio.material.map((m) => m.id));
  const total = voice.conversations.length;
  const n = heardIn(t);
  const since = t.firstHeard ? shortDay(t.firstHeard) : undefined;
  const out: StudioMaterial[] = [
    {
      id: `mat_bv_${hashKey(t.key)}`,
      kind: "fact",
      text: `Buyers raised "${t.label}" in ${n} of ${plural(total, "conversation")}${since ? ` since ${since}` : ""}.`,
      source: `Counted by Inroad from your debriefed calls and replies, ${shortDay(voice.today)}`,
      createdAt: at,
      uses: 0,
    },
  ];
  const seen = new Set<string>();
  for (const s of t.snippets) {
    if (!s.verbatim || seen.has(s.conv)) continue;
    seen.add(s.conv);
    out.push({ id: `mat_bv_${hashKey(s.id)}`, kind: "quote", text: clip(s.text, 400), source: whoSaid(s), permission: "anonymized_only", createdAt: at, uses: 0 });
    if (out.length >= 5) break;
  }
  return out.filter((m) => !have.has(m.id));
}

const quoteBit = (s: VoiceSnippet) => `"${clip(s.text, 160)}" (${s.title ?? "a buyer"}${s.company ? ` at ${s.company}` : ""}, ${shortDay(s.date)}${s.verbatim ? "" : ", from notes"})`;

const examples = (snips: VoiceSnippet[]) =>
  [...snips]
    .sort((a, b) => Number(b.verbatim) - Number(a.verbatim) || b.at.localeCompare(a.at))
    .slice(0, 3)
    .map(quoteBit)
    .join("; ");

/** The question "Ask about this" sends: the theme, its counts and a few quotes, so Ask needn't look them up. */
export function askAboutTheme(voice: BuyerVoice, t: VoiceTheme): string {
  const n = heardIn(t);
  const what = t.kind === "objection" ? "handle it on calls" : t.kind === "process" ? "run deals around it" : "use it in discovery and messaging";
  return clip(
    `Buyers keep raising "${t.label}": ${n} of ${plural(voice.conversations.length, "conversation")}, ${plural(t.deals, "deal")}${t.companies.length ? ` (${t.companies.slice(0, 4).join(", ")})` : ""}. ${winLine(t.win)}. In their words: ${examples(t.snippets)}. What should I change to ${what}?`,
    1400,
  );
}

export function askAboutAlternative(a: VoiceAlternative): string {
  const n = heardIn(a);
  const rec = `won ${a.record.won}, lost ${a.record.lost}, open ${a.record.open}`;
  const answer = a.response ? `My current answer${a.response.approved ? "" : " (a draft)"}: "${clip(a.response.text || "none written", 240)}".` : "I have no answer on file yet.";
  return clip(
    `How should I handle ${a.name} when it comes up? Buyers raised it in ${plural(n, "conversation")} across ${plural(a.deals, "deal")} (${rec}). ${answer} In their words: ${examples(a.snippets)}. Give me the questions to ask and what to say, using only my approved claims.`,
    1400,
  );
}
