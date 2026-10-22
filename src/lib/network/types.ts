import type { Account, ID, ISODateTime, RunSummary } from "@/lib/domain/types";
import type { PresetId } from "./presets";

/** One import, kept in `.data/network.json` so it can be undone and shown in history. */
export interface ImportBatch {
  id: ID;
  kind: "csv" | "linkedin" | "github";
  preset?: PresetId;
  presetLabel?: string;
  fileName: string;
  importedAt: ISODateTime;
  rows: number;
  skipped: number;
  counts: { accountsCreated: number; accountsUpdated: number; peopleCreated: number; peopleUpdated: number };
  /** LinkedIn re-import diff. */
  linkedin?: { total: number; added: number; changed: number; removed: number; withEmail: number };
  /** GitHub stargazers: how many the repo has, how many profiles were read, how many named a company. */
  github?: { repo: string; total: number; read: number; matched: number; rateLimited: boolean; withToken: boolean };
  /** What this import created or filled in, so undo can take exactly that back out. */
  created: { accounts: string[]; people: ID[] };
  filled: { kind: "account" | "person"; id: string; field: string; value: unknown }[];
  statusChanged: { domain: string; from: Account["status"]; to: Account["status"] }[];
  undoneAt?: ISODateTime;
  undo?: { removedAccounts: number; removedPeople: number; kept: number };
}

/** What the browser gets back (no id lists). */
export type ImportBatchSummary = Omit<ImportBatch, "created" | "filled" | "statusChanged">;

export function summarizeBatch(b: ImportBatch): ImportBatchSummary {
  const { created: _c, filled: _f, statusChanged: _s, ...rest } = b;
  void _c;
  void _f;
  void _s;
  return rest;
}

/** POST /api/import (list) and POST /api/import/linkedin responses. */
export interface ImportResponse {
  batch: ImportBatchSummary;
  /** LinkedIn only: the screening run that started. */
  run?: RunSummary | null;
  runError?: string;
}

/** POST /api/import/undo response. */
export interface UndoResponse {
  batch: ImportBatchSummary;
  message: string;
}
