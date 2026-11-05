import type { Confidence } from "@/lib/domain/types";

/**
 * Research columns: one question asked of every company in the table ("Do they bill on usage?"),
 * answered per company from what Inroad already knows, the company's own site and, if needed, one web
 * search. Every answer carries its sources; "Unknown" is a real value, never a guess.
 *
 * Stored apart from the workspace in `columns.json` (src/lib/columns/store.ts): cells hold quotes and URLs
 * for every company, and the workspace is sent to the browser on every change. Client-safe: no server code.
 */

export const COLUMN_TYPES = ["yes_no", "pick_one", "number", "text"] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export const COLUMN_TYPE_LABEL: Record<ColumnType, string> = {
  yes_no: "Yes / no",
  pick_one: "Pick one",
  number: "Number",
  text: "Short text",
};

export const LIMITS = {
  columns: 30,
  views: 20,
  question: 200,
  instructions: 500,
  options: 8,
  option: 40,
  viewName: 60,
  /** Companies one run may ask. */
  domains: 500,
  sources: 3,
  quote: 300,
  note: 200,
  text: 120,
} as const;

export interface ResearchColumn {
  id: string;
  question: string;
  type: ColumnType;
  /** pick_one only: the answers allowed (2–8). */
  options?: string[];
  /** How to decide, in the founder's words ("Count it only if the pricing page shows a metered unit"). */
  instructions?: string;
  createdAt: string;
  /** Set when the question, type, options or instructions change; answers to the old question are cleared. */
  updatedAt?: string;
}

/**
 * Where an answer comes from. site: their own pages; job_board: their public job board, read in code;
 * dns: their DNS records; evidence/signal: facts already on file; page: another page it read; search: a
 * search result's snippet.
 */
export type SourceKind = "site" | "job_board" | "dns" | "evidence" | "signal" | "page" | "search";

export interface CellSource {
  url: string;
  /** A verbatim span from the source, or (job_board, dns) the line code read from it. */
  quote: string;
  /** YYYY-MM-DD: the source's own date, else the day it was read. */
  date?: string;
  kind: SourceKind;
  /** Code found the quote in the text it fetched. False only for a web search result the model saw and code didn't. */
  checked: boolean;
}

export type CellValue = boolean | number | string | null;

export interface ColumnCell {
  columnId: string;
  domain: string;
  /** null = Unknown: nothing found supports an answer. */
  value: CellValue;
  /** null when unknown or failed. */
  confidence: Confidence | null;
  sources: CellSource[];
  /** One line: what the answer rests on, or why it's unknown. */
  note?: string;
  at: string;
  /** workspace: answered in code from what was already known (zero tokens). reused: copied from the same question asked earlier. */
  method: "workspace" | "reused" | "model";
  runId?: string;
  /** What this answer cost on the founder's key. 0 when answered in code. */
  costUsd?: number;
  /** The model has no price on file, so costUsd counts nothing (it isn't free). */
  unpriced?: boolean;
  searches?: number;
  pagesRead?: number;
  /** The attempt failed (budget, search limit, the provider): not an answer. Asking again retries it. */
  error?: string;
}

/* ─────────────────────────── Saved views ─────────────────────────── */

export interface ViewFilters {
  tiers: string[];
  signals: string[];
  statuses: string[];
  sources: string[];
  /** Research column id → answer keys kept (see answerKey). */
  answers: Record<string, string[]>;
}

/** key: "priority" | "fit" | "signal" | "added" | "col:<columnId>". */
export interface ViewSort {
  key: string;
  dir: "asc" | "desc";
}

export interface ViewState {
  filters: ViewFilters;
  sort: ViewSort;
  /** Research columns shown, in order. */
  columns: string[];
}

export interface SavedView extends ViewState {
  id: string;
  name: string;
  createdAt: string;
  updatedAt?: string;
}

/* ─────────────────────────── The file ─────────────────────────── */

export interface ColumnsData {
  /** Display order on the default view. */
  columns: ResearchColumn[];
  /** Hidden on the default view. */
  hidden: string[];
  /** columnId → domain → cell. */
  cells: Record<string, Record<string, ColumnCell>>;
  views: SavedView[];
}

/** A run filling a column right now (kept in memory on the server; see src/lib/columns/jobs.ts). */
export interface ColumnJob {
  runId: string;
  columnId: string;
  domains: string[];
  /** Being researched this moment. */
  active: string[];
  done: number;
  preview: boolean;
}

/** Where answers can come from today, for the composer's "where I look" line and the cost estimate. */
export interface SearchInfo {
  /** The configured search provider's name, or "Claude web search", or null when there's none. */
  provider: string | null;
  limit: number;
  used: number;
}

export interface ColumnsResponse extends ColumnsData {
  jobs: ColumnJob[];
  search: SearchInfo;
}

export type ColumnsOp =
  | { type: "column.add"; column: ResearchColumn; index?: number }
  | { type: "column.update"; id: string; patch: Partial<Pick<ResearchColumn, "question" | "type" | "options" | "instructions">>; at: string }
  | { type: "column.delete"; id: string }
  /** Undo for a delete: the column back where it was, with its answers, visibility and places in views. */
  | { type: "column.restore"; column: ResearchColumn; index: number; cells: Record<string, ColumnCell>; hidden: boolean; views: { id: string; index: number }[] }
  | { type: "column.move"; id: string; to: number }
  | { type: "column.hide"; id: string; hidden: boolean }
  | { type: "cells.clear"; columnId: string; domains?: string[] }
  | { type: "view.save"; view: SavedView }
  | { type: "view.delete"; id: string }
  | { type: "view.restore"; view: SavedView; index: number };

export function emptyColumns(): ColumnsData {
  return { columns: [], hidden: [], cells: {}, views: [] };
}
