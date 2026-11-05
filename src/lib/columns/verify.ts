import { cleanDate, normUrl, quoteIn } from "@/lib/deals/ledger";
import { daysBetween } from "@/lib/domain/ids";
import type { Confidence } from "@/lib/domain/types";
import { LIMITS, type CellSource, type CellValue, type ResearchColumn, type SourceKind } from "./types";

/**
 * Code checks every answer the model gives before it reaches a cell: each quote must really be in the text
 * Inroad showed it for that URL (or, for Claude's own web search, the URL must be one the search returned),
 * the value must fit the column, and an answer with no source left standing becomes Unknown. Never a guess.
 */

export interface MaterialSource {
  url: string;
  /** Exactly the text the model was shown for this URL. */
  text: string;
  /** corpus(text), for quote checks. */
  haystack: string;
  kind: SourceKind;
  date?: string;
}

/** What the model submits for one company (see the submit tool in ./answer.ts). */
export interface Submitted {
  status: "answered" | "unknown";
  answer: string | number | null;
  confidence: Confidence;
  sources: { url: string; quote: string; publishedAt: string | null }[];
  note: string;
}

export interface Verified {
  value: CellValue;
  confidence: Confidence | null;
  sources: CellSource[];
  note: string;
  /** Sources the model cited that code couldn't stand behind. */
  dropped: number;
}

const LEVELS: Confidence[] = ["low", "medium", "high"];
const capAt = (c: Confidence, max: Confidence): Confidence => (LEVELS.indexOf(c) > LEVELS.indexOf(max) ? max : c);
const lower = (c: Confidence): Confidence => LEVELS[Math.max(0, LEVELS.indexOf(c) - 1)];

/** The most each kind of source can support. A search snippet is a stranger's summary; their own page is them. */
const MAX: Record<SourceKind, Confidence> = { site: "high", job_board: "high", dns: "high", evidence: "high", signal: "medium", page: "medium", search: "low" };

/** The answer as the column's type, or undefined when it doesn't fit (then the cell is Unknown). */
export function normalizeValue(column: Pick<ResearchColumn, "type" | "options">, answer: unknown): CellValue | undefined {
  if (answer === null || answer === undefined || answer === "") return undefined;
  switch (column.type) {
    case "yes_no": {
      if (typeof answer === "boolean") return answer;
      const a = String(answer).trim().toLowerCase();
      return a === "yes" || a === "true" ? true : a === "no" || a === "false" ? false : undefined;
    }
    case "number": {
      const n = typeof answer === "number" ? answer : Number(String(answer).replace(/[,\s]/g, ""));
      return Number.isFinite(n) ? n : undefined;
    }
    case "pick_one": {
      const a = String(answer).trim().toLowerCase();
      return (column.options ?? []).find((o) => o.toLowerCase() === a);
    }
    default: {
      const t = String(answer).replace(/\s+/g, " ").trim();
      return t ? t.slice(0, LIMITS.text) : undefined;
    }
  }
}

export function verifyAnswer(
  column: Pick<ResearchColumn, "type" | "options">,
  input: Submitted,
  ctx: {
    material: Map<string, MaterialSource>;
    /** URLs Claude's own web search returned this turn: citable, but their text never reached code. */
    searchUrls?: Set<string>;
    today: string;
  },
): Verified {
  const kept: CellSource[] = [];
  let dropped = 0;
  for (const s of input.sources.slice(0, LIMITS.sources + 2)) {
    const key = normUrl(s.url);
    const quote = s.quote.trim().replace(/^["“]|["”]$/g, "").slice(0, LIMITS.quote);
    const m = ctx.material.get(key);
    let date = cleanDate(s.publishedAt) ?? m?.date;
    if (date && date > ctx.today) date = m?.date && m.date <= ctx.today ? m.date : undefined;
    if (m && quote.length >= 3 && quoteIn(quote, m.haystack)) {
      kept.push({ url: m.url, quote, ...(date ? { date } : {}), kind: m.kind, checked: true });
    } else if (!m && ctx.searchUrls?.has(key) && quote.length >= 3) {
      kept.push({ url: s.url.trim(), quote, ...(date ? { date } : {}), kind: "search", checked: false });
    } else dropped++;
    if (kept.length >= LIMITS.sources) break;
  }

  const note = input.note.replace(/\s+/g, " ").trim().slice(0, LIMITS.note);
  const value = input.status === "answered" ? normalizeValue(column, input.answer) : undefined;
  if (value === undefined || !kept.length) {
    const why =
      input.status === "answered" && value !== undefined && !kept.length
        ? "No source I could check supports an answer, so I left it unknown."
        : input.status === "answered" && value === undefined
          ? "The answer didn't fit this column, so I left it unknown."
          : note || "Nothing I read answers this.";
    // Sources that were checked still show what was read, even when they don't settle it.
    return { value: null, confidence: null, sources: input.status === "unknown" ? kept : [], note: why, dropped };
  }

  // The best source caps the confidence; a year-old answer is worth a level less.
  const best = kept.reduce<Confidence>((top, s) => (LEVELS.indexOf(MAX[s.kind]) > LEVELS.indexOf(top) ? MAX[s.kind] : top), "low");
  let confidence = capAt(input.confidence, best);
  const newest = kept.map((s) => s.date).filter(Boolean).sort().at(-1);
  if (newest && daysBetween(newest, ctx.today) > 365) confidence = lower(confidence);
  return { value, confidence, sources: kept, note, dropped };
}
