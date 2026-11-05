import type { ColumnCell, ColumnType, ResearchColumn } from "./types";

/** Pure helpers for showing, filtering, sorting and pricing research-column answers. Client-safe. */

/* ─────────────────────────── Showing an answer ─────────────────────────── */

export type CellState = "answered" | "unknown" | "failed" | "empty";

export function cellState(cell: ColumnCell | undefined): CellState {
  if (!cell) return "empty";
  if (cell.error) return "failed";
  return cell.value === null ? "unknown" : "answered";
}

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** "Yes", "No", "Stripe", "1,200", "Unknown", or "" when not asked. */
export function cellLabel(cell: ColumnCell | undefined): string {
  const state = cellState(cell);
  if (state === "empty") return "";
  if (state === "failed") return "Failed";
  if (state === "unknown") return "Unknown";
  const v = cell!.value;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return numberFormat.format(v);
  return String(v);
}

/** The header label: the question without its question mark, kept short enough for a narrow column. */
export function shortQuestion(question: string, max = 48): string {
  const q = question.trim().replace(/\s+/g, " ").replace(/\?+$/, "");
  return q.length > max ? `${q.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : q;
}

/** The same question asked twice (another column, or one deleted and made again) can reuse its answers. */
export function questionKey(c: Pick<ResearchColumn, "question" | "type" | "options" | "instructions">): string {
  const norm = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return [norm(c.question), c.type, (c.options ?? []).map(norm).join("|"), norm(c.instructions)].join("¦");
}

/* ─────────────────────────── Proposing a type ─────────────────────────── */

/**
 * Inroad's first guess at the answer type, from how the question starts. The founder can change it.
 * "Which billing system do they use?" → short text (pick one only when options are given).
 */
export function suggestType(question: string): ColumnType {
  const q = question.trim().toLowerCase();
  if (/^(how many|how much|what (is the )?(number|count|percent|percentage|share|price|amount)|number of|count of)\b/.test(q)) return "number";
  if (/^(do|does|did|is|are|was|were|has|have|had|can|could|will|would|should)\b/.test(q)) return "yes_no";
  return "text";
}

/* ─────────────────────────── Filtering ─────────────────────────── */

/** The filter bucket an answer falls in: "yes"/"no" for yes-no, the option for pick-one, else "answered"; plus unknown/failed/empty. */
export function answerKey(column: Pick<ResearchColumn, "type">, cell: ColumnCell | undefined): string {
  const state = cellState(cell);
  if (state !== "answered") return state;
  if (column.type === "yes_no") return cell!.value ? "yes" : "no";
  if (column.type === "pick_one") return String(cell!.value);
  return "answered";
}

export interface AnswerOption {
  value: string;
  label: string;
  count: number;
}

/** Filter choices for a column over these domains, with counts. Failed shows only when something failed. */
export function answerOptions(column: ResearchColumn, cells: Record<string, ColumnCell> | undefined, domains: string[]): AnswerOption[] {
  const counts = new Map<string, number>();
  for (const d of domains) {
    const k = answerKey(column, cells?.[d]);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const base: { value: string; label: string }[] =
    column.type === "yes_no"
      ? [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]
      : column.type === "pick_one"
        ? (column.options ?? []).map((o) => ({ value: o, label: o }))
        : [{ value: "answered", label: "Answered" }];
  const tail = [
    { value: "unknown", label: "Unknown" },
    { value: "empty", label: "Not asked yet" },
    ...(counts.get("failed") ? [{ value: "failed", label: "Failed" }] : []),
  ];
  return [...base, ...tail].map((o) => ({ ...o, count: counts.get(o.value) ?? 0 }));
}

/* ─────────────────────────── Sorting ─────────────────────────── */

/**
 * Compares two answers for a column sort. Answers come first in the chosen direction; Unknown, failed and
 * not-asked always sort last, whatever the direction, so "high to low" never starts with blanks.
 * Returns 0 for ties so the caller can break them (by priority).
 */
export function compareCells(column: ResearchColumn, a: ColumnCell | undefined, b: ColumnCell | undefined, dir: "asc" | "desc"): number {
  const rank = (c: ColumnCell | undefined) => {
    const s = cellState(c);
    return s === "answered" ? 0 : s === "unknown" ? 1 : s === "failed" ? 2 : 3;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb || ra !== 0) return ra - rb;
  const sign = dir === "asc" ? 1 : -1;
  const va = a!.value;
  const vb = b!.value;
  switch (column.type) {
    case "yes_no":
      return sign * (Number(va) - Number(vb));
    case "number":
      return sign * ((va as number) - (vb as number));
    case "pick_one": {
      // "asc" is the order the options were listed in.
      const opts = column.options ?? [];
      return sign * (opts.indexOf(String(va)) - opts.indexOf(String(vb)));
    }
    default:
      return sign * String(va).localeCompare(String(vb), undefined, { sensitivity: "base", numeric: true });
  }
}

/** Sort choices a column offers, in menu order. The first is what clicking the header picks. */
export function sortChoices(type: ColumnType): { dir: "asc" | "desc"; label: string }[] {
  switch (type) {
    case "yes_no":
      return [
        { dir: "desc", label: "Yes first" },
        { dir: "asc", label: "No first" },
      ];
    case "number":
      return [
        { dir: "desc", label: "High to low" },
        { dir: "asc", label: "Low to high" },
      ];
    case "pick_one":
      return [
        { dir: "asc", label: "In option order" },
        { dir: "desc", label: "Reverse option order" },
      ];
    default:
      return [
        { dir: "asc", label: "A to Z" },
        { dir: "desc", label: "Z to A" },
      ];
  }
}

/* ─────────────────────────── Cost of the rest, from the preview ─────────────────────────── */

export interface Estimate {
  /** Rows the preview measured. */
  rows: number;
  /** Of those, answered by the model (the rest cost nothing: from what was known, or reused). */
  modelRows: number;
  /** Measured cost of the preview rows. */
  previewUsd: number;
  /** previewUsd per row × remaining. */
  restUsd: number;
  /** Searches the preview used per row × remaining, rounded up. */
  restSearches: number;
  /** Some preview answer ran on a model with no price on file: the dollar figures count nothing. */
  unpriced: boolean;
  /** Wall-clock time the preview took per row × remaining (same concurrency), in ms. */
  restMs: number | null;
}

/**
 * What the rest will cost, from what the preview actually cost: the measured average per row times the rows
 * left. Not a model of what the rest will need; the composer says it's based on these rows.
 */
export function estimateRest(previewCells: ColumnCell[], remaining: number, previewMs?: number): Estimate {
  const rows = previewCells.filter((c) => !c.error);
  const n = rows.length;
  const previewUsd = rows.reduce((s, c) => s + (c.costUsd ?? 0), 0);
  const searches = rows.reduce((s, c) => s + (c.searches ?? 0), 0);
  const per = n ? previewUsd / n : 0;
  return {
    rows: n,
    modelRows: rows.filter((c) => c.method === "model").length,
    previewUsd,
    restUsd: per * Math.max(0, remaining),
    restSearches: n ? Math.ceil((searches / n) * Math.max(0, remaining)) : 0,
    unpriced: rows.some((c) => c.unpriced),
    restMs: previewMs && n ? Math.round((previewMs / n) * Math.max(0, remaining)) : null,
  };
}

/** "$0.00", "$0.004", "$0.38", "$12.40": small amounts keep a third decimal so a cheap preview isn't shown as free. */
export function costLabel(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** "about 40s", "about 3 min". */
export function durationLabel(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `about ${Math.max(5, Math.round(s / 5) * 5)}s`;
  const m = Math.round(s / 60);
  return `about ${m} min`;
}
