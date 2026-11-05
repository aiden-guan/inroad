import type { Deal, LossReason, ObjectionCard, Workspace } from "@/lib/domain/types";
import type { Corpus } from "./corpus";
import { ALTERNATIVE_SEEDS, NAMED_TOOL, NOT_A_TOOL } from "./lexicon";
import { dealRef } from "./stats";
import { sameText, words } from "./text";
import type { AlternativeKind, VoiceAlternative, VoiceSnippet } from "./types";

/**
 * Competitors and alternatives, from three places: the vendors the playbook names, the alternatives every B2B
 * deal has (spreadsheets, building it, hiring, doing nothing), and tool names buyers brought up that the playbook
 * doesn't know ("NetSuite already does this"). Each is counted in code against the calls, replies and deals
 * where it came up, with how those deals went, and the answer on file when there is one.
 */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const slug = (s: string) => words(s).join("-") || "x";

interface Candidate {
  key: string;
  name: string;
  kind: AlternativeKind;
  category: ObjectionCard["category"];
  inPlaybook: boolean;
  competitorIndex?: number;
  domain?: string;
  match: (s: VoiceSnippet) => boolean;
  /** Text an objection card must mention to be this one's answer. */
  cardMatch: (o: ObjectionCard) => boolean;
  /** Loss reasons that mean a lost deal went to this one even when no quote says so. */
  lossReasons?: LossReason[];
}

function nameMatcher(name: string, domain?: string): RegExp {
  const stem = domain?.split(".")[0];
  const alts = [escape(name), ...(stem && stem.length > 3 && !sameText(stem, name) ? [escape(stem)] : [])];
  return new RegExp(`\\b(${alts.join("|")})\\b`, "i");
}

/** Vendor names in the playbook: competitors, then competitor alternatives (positioning and the snapshot). */
function playbookVendors(ws: Workspace): { name: string; domain?: string; competitorIndex?: number }[] {
  const out: { name: string; domain?: string; competitorIndex?: number }[] = [];
  const add = (name: string, domain?: string, competitorIndex?: number) => {
    const n = name.trim();
    if (!n || out.some((o) => sameText(o.name, n))) return;
    out.push({ name: n, domain, competitorIndex });
  };
  (ws.foundation?.competitors ?? []).forEach((c, i) => add(c.name, c.domain, i));
  for (const a of ws.foundation?.positioning?.alternatives ?? []) if (a.kind === "competitor") add(a.name, a.domain);
  for (const a of ws.company?.alternatives ?? []) if (a.kind === "competitor") add(a.name);
  return out;
}

/** Tool names in the frames buyers use for an alternative, minus people, companies in the workspace and known names. */
function namedTools(ws: Workspace, snippets: VoiceSnippet[], known: string[]): Map<string, string> {
  const people = new Set(Object.values(ws.people).flatMap((p) => [p.name, words(p.name)[0] ?? ""]).map((n) => n.toLowerCase()));
  for (const n of [ws.founder.name, ws.sender?.name ?? ""]) for (const part of [n, words(n)[0] ?? ""]) if (part) people.add(part.toLowerCase());
  const companies = new Set([ws.company?.name ?? "", ...Object.values(ws.accounts).map((a) => a.name)].map((n) => n.toLowerCase()).filter(Boolean));
  const generic = ALTERNATIVE_SEEDS.map((s) => s.alias);
  const found = new Map<string, string>();
  // Only their own words: a debrief summary ("Thinks NetSuite covers it") isn't a buyer naming a tool.
  for (const s of snippets.filter((x) => x.verbatim)) {
    for (const re of NAMED_TOOL) {
      for (const m of s.text.matchAll(re)) {
        const name = m[1]?.trim();
        if (!name || NOT_A_TOOL.has(name.split(" ")[0])) continue;
        const lower = name.toLowerCase();
        if (people.has(lower) || people.has(lower.split(" ")[0]) || companies.has(lower)) continue;
        if (known.some((k) => sameText(k, name)) || generic.some((g) => g.test(name))) continue;
        const key = `named:${slug(name)}`;
        if (!found.has(key)) found.set(key, name);
      }
    }
  }
  // "Honestly NetSuite" is NetSuite: a two-word name whose last word was found alone is that one.
  for (const [key, name] of found) {
    const parts = name.split(" ");
    if (parts.length === 2 && [...found.values()].some((n) => n === parts[1])) found.delete(key);
  }
  return found;
}

function candidates(ws: Workspace, snippets: VoiceSnippet[]): Candidate[] {
  const vendors = playbookVendors(ws);
  const out: Candidate[] = vendors.map((v) => {
    const re = nameMatcher(v.name, v.domain);
    return {
      key: `vendor:${slug(v.name)}`,
      name: v.name,
      kind: "competitor",
      category: "competitor",
      inPlaybook: true,
      competitorIndex: v.competitorIndex,
      domain: v.domain,
      match: (s) => re.test(s.text),
      cardMatch: (o) => re.test(o.objection) || re.test(o.response),
    };
  });
  for (const [key, name] of namedTools(ws, snippets, vendors.map((v) => v.name))) {
    const re = nameMatcher(name);
    out.push({ key, name, kind: "competitor", category: "competitor", inPlaybook: false, match: (s) => re.test(s.text), cardMatch: (o) => re.test(o.objection) });
  }
  const playbookAlts = [...(ws.foundation?.positioning?.alternatives ?? []), ...(ws.company?.alternatives ?? [])];
  for (const seed of ALTERNATIVE_SEEDS) {
    // A status-quo alternative must also be named like this one ("Spreadsheet exports" is spreadsheets; "Do nothing" isn't).
    const kinds: Record<AlternativeKind, string[]> = { status_quo: ["status_quo"], in_house: ["in_house"], hire: ["hire"], nothing: ["status_quo"], competitor: [] };
    const inPlaybook = playbookAlts.some((a) => kinds[seed.kind].includes(a.kind) && (seed.kind === "in_house" || seed.kind === "hire" || seed.alias.test(a.name)));
    out.push({
      key: seed.key,
      name: seed.name,
      kind: seed.kind,
      category: seed.kind === "hire" ? "status_quo" : seed.kind === "nothing" ? "priority" : seed.category,
      inPlaybook,
      match: (s) => seed.patterns.some((p) => p.test(s.text)),
      cardMatch: (o) =>
        seed.kind === "in_house"
          ? o.category === "build"
          : seed.kind === "nothing"
            ? o.category === "timing" || o.category === "priority"
            : seed.kind === "hire"
              ? /\bhir(e|ing)\b|\bheadcount\b/i.test(o.objection)
              : seed.alias.test(o.objection),
      lossReasons: seed.kind === "in_house" ? ["build"] : seed.kind === "nothing" ? ["timing", "no_budget", "went_dark", "no_pain"] : undefined,
    });
  }
  return out;
}

/** The answer on file: an approved card first, then the most heard. */
export function bestCard(cards: ObjectionCard[]): ObjectionCard | undefined {
  return [...cards].sort((a, b) => Number(b.approved) - Number(a.approved) || b.timesHeard - a.timesHeard)[0];
}

export interface Alternatives {
  alternatives: VoiceAlternative[];
  /** Snippets that name a vendor (from the playbook or not): they count toward "another tool should cover it". */
  vendorSnippets: Set<string>;
}

export function buildAlternatives(ws: Workspace, corpus: Corpus): Alternatives {
  const vendorSnippets = new Set<string>();
  const alternatives: VoiceAlternative[] = [];
  const all = candidates(ws, corpus.snippets);
  const competitorLosses = (d: Deal) => d.stage === "lost" && d.lossReason === "competitor";

  for (const c of all) {
    const matched = corpus.snippets.filter(c.match);
    // A call quoted on it doesn't also need the debrief's one-line summary of the same thing.
    const quoted = new Set(matched.filter((s) => s.verbatim).map((s) => s.conv));
    const snippets = matched.filter((s) => !(s.source === "summary" && quoted.has(s.conv)));
    if (c.kind === "competitor") for (const s of snippets) vendorSnippets.add(s.id);
    const dealIds = new Set(snippets.map((s) => s.dealId).filter((id): id is string => !!id));
    // A lost deal whose reason on file is this alternative counts as lost to it, quote or not.
    const lostTo = new Set<string>();
    for (const d of Object.values(ws.deals)) {
      if (d.stage !== "lost" || !d.lossReason) continue;
      if (c.lossReasons?.includes(d.lossReason)) lostTo.add(d.id);
    }
    // "Lost to a competitor" names one only when exactly one vendor came up on that deal.
    if (c.kind === "competitor") {
      for (const d of Object.values(ws.deals)) {
        if (!competitorLosses(d) || !dealIds.has(d.id)) continue;
        const named = all.filter((o) => o.kind === "competitor" && corpus.snippets.some((s) => s.dealId === d.id && o.match(s)));
        if (named.length === 1 && named[0].key === c.key) lostTo.add(d.id);
      }
    }
    for (const id of lostTo) dealIds.add(id);
    if (!snippets.length && !lostTo.size) {
      // Playbook vendors stay listed with nothing heard: knowing nobody mentions them is worth something too.
      if (!c.inPlaybook || c.kind !== "competitor") continue;
    }
    const deals = [...dealIds].map((id) => ws.deals[id]).filter((d): d is Deal => !!d);
    const dealRows = deals
      .map((d) => ({ ...dealRef(d), outcome: d.stage === "won" ? ("won" as const) : d.stage === "lost" ? ("lost" as const) : d.stage === "nurture" ? ("nurture" as const) : ("open" as const), lostTo: lostTo.has(d.id) }))
      .sort((a, b) => ["lost", "won", "open", "nurture"].indexOf(a.outcome) - ["lost", "won", "open", "nurture"].indexOf(b.outcome) || a.name.localeCompare(b.name));
    const cards = ws.objections.filter(c.cardMatch);
    const card = bestCard(cards);
    const dates = snippets.map((s) => s.date).sort();
    alternatives.push({
      key: c.key,
      name: c.name,
      kind: c.kind,
      inPlaybook: c.inPlaybook,
      competitorIndex: c.competitorIndex,
      domain: c.domain,
      snippets,
      calls: new Set(snippets.filter((s) => s.convKind === "call").map((s) => s.conv)).size,
      replies: new Set(snippets.filter((s) => s.convKind === "reply").map((s) => s.conv)).size,
      deals: deals.length,
      dealRows,
      record: { won: dealRows.filter((r) => r.outcome === "won").length, lost: dealRows.filter((r) => r.outcome === "lost").length, open: dealRows.filter((r) => r.outcome === "open").length },
      firstHeard: dates[0],
      lastHeard: dates.at(-1),
      response: card ? { objectionId: card.id, approved: card.approved, text: card.response } : undefined,
      category: c.category,
    });
  }

  alternatives.sort((a, b) => b.calls + b.replies - (a.calls + a.replies) || b.deals - a.deals || Number(b.kind === "competitor") - Number(a.kind === "competitor") || a.name.localeCompare(b.name));
  return { alternatives, vendorSnippets };
}
