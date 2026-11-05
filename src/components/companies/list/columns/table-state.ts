import type { ColumnsData, ResearchColumn, SavedView, ViewFilters, ViewSort, ViewState } from "@/lib/columns/types";
import { shortQuestion } from "@/lib/columns/values";

/** Pure helpers for the Prospects table's view state: filters, sort and visible research columns. */

export const EMPTY_FILTERS: ViewFilters = { tiers: [], signals: [], statuses: [], sources: [], answers: {} };
export const DEFAULT_SORT: ViewSort = { key: "priority", dir: "desc" };

export const BUILTIN_SORTS = ["priority", "fit", "signal", "added"] as const;
export type BuiltinSort = (typeof BUILTIN_SORTS)[number];
export const BUILTIN_SORT_LABEL: Record<BuiltinSort, string> = { priority: "Priority", fit: "Fit", signal: "Newest signal", added: "Recently added" };

export function isBuiltinSort(key: string): key is BuiltinSort {
  return (BUILTIN_SORTS as readonly string[]).includes(key);
}

/** The default view's columns: every column in order, minus the ones hidden there. */
export function defaultColumns(data: Pick<ColumnsData, "columns" | "hidden"> | null): string[] {
  if (!data) return [];
  const hidden = new Set(data.hidden);
  return data.columns.filter((c) => !hidden.has(c.id)).map((c) => c.id);
}

export function defaultState(data: Pick<ColumnsData, "columns" | "hidden"> | null): ViewState {
  return { filters: EMPTY_FILTERS, sort: DEFAULT_SORT, columns: defaultColumns(data) };
}

export function viewState(view: SavedView): ViewState {
  return { filters: view.filters, sort: view.sort, columns: view.columns };
}

const sorted = (xs: string[]) => [...xs].sort();

/** Filters that select nothing are the same as no filter. */
export function normalizeFilters(f: ViewFilters): ViewFilters {
  return {
    tiers: sorted(f.tiers),
    signals: sorted(f.signals),
    statuses: sorted(f.statuses),
    sources: sorted(f.sources),
    answers: Object.fromEntries(
      Object.entries(f.answers)
        .filter(([, keys]) => keys.length > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, keys]) => [id, sorted(keys)]),
    ),
  };
}

export function sameFilters(a: ViewFilters, b: ViewFilters): boolean {
  return JSON.stringify(normalizeFilters(a)) === JSON.stringify(normalizeFilters(b));
}

/** Column order counts: moving a column in a saved view is a change to save. */
export function sameState(a: ViewState, b: ViewState): boolean {
  return sameFilters(a.filters, b.filters) && a.sort.key === b.sort.key && a.sort.dir === b.sort.dir && a.columns.join() === b.columns.join();
}

export function filterCount(f: ViewFilters): number {
  return f.tiers.length + f.signals.length + f.statuses.length + f.sources.length + Object.values(f.answers).reduce((n, k) => n + k.length, 0);
}

/** Drops filters and sorts on columns that no longer exist. */
export function cleanState(s: ViewState, columns: ResearchColumn[]): ViewState {
  const ids = new Set(columns.map((c) => c.id));
  const sortCol = s.sort.key.startsWith("col:") ? s.sort.key.slice(4) : null;
  return {
    filters: { ...s.filters, answers: Object.fromEntries(Object.entries(s.filters.answers).filter(([id]) => ids.has(id))) },
    sort: sortCol && !ids.has(sortCol) ? DEFAULT_SORT : s.sort,
    columns: s.columns.filter((id) => ids.has(id)),
  };
}

const ANSWER_LABEL: Record<string, string> = { yes: "Yes", no: "No", unknown: "Unknown", empty: "Not asked", failed: "Failed", answered: "Answered" };

/** A name to start from when saving a view: "Tier A · Bills on usage: Yes". The founder can change it. */
export function suggestName(s: ViewState, columns: ResearchColumn[], labels: { status?: (v: string) => string; signal?: (v: string) => string } = {}): string {
  const parts: string[] = [];
  if (s.filters.tiers.length) parts.push(`Tier ${sorted(s.filters.tiers).join(", ")}`);
  if (s.filters.statuses.length) parts.push(s.filters.statuses.map((v) => labels.status?.(v) ?? v).join(", "));
  if (s.filters.signals.length) parts.push(s.filters.signals.slice(0, 2).map((v) => labels.signal?.(v) ?? v).join(", "));
  for (const [id, keys] of Object.entries(s.filters.answers)) {
    const col = columns.find((c) => c.id === id);
    if (col && keys.length) parts.push(`${shortQuestion(col.question, 28)}: ${keys.map((k) => ANSWER_LABEL[k] ?? k).join(", ")}`);
  }
  if (s.filters.sources.length && parts.length < 2) parts.push(`${s.filters.sources.length === 1 ? "One source" : `${s.filters.sources.length} sources`}`);
  const name = parts.join(" · ") || "My view";
  return name.length > 60 ? `${name.slice(0, 59).replace(/\s+\S*$/, "")}…` : name;
}

/** Moves `id` one place left or right within `ids`. */
export function nudge(ids: string[], id: string, by: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + by;
  if (i === -1 || j < 0 || j >= ids.length) return ids;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
