import type { ColumnCell, ResearchColumn } from "@/lib/columns/types";
import { cellLabel } from "@/lib/columns/values";

/** CSV export for selected companies, with every visible research column's answer, confidence and first source. */

/**
 * One field. Text that a spreadsheet would run as a formula (=, +, -, @, tab or carriage return first) gets a
 * leading apostrophe: an exported company name or quote must never execute in Excel or Sheets.
 */
export function csvField(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvField).join(",")).join("\r\n");
}

export interface ExportRow {
  name: string;
  domain: string;
  tier: string;
  fit: number | null;
  status: string;
  whyNow: string;
  whyNowDate: string;
  whyNowUrl: string;
  warm: number;
  openRoles: number | null;
}

export function exportCsv(rows: ExportRow[], columns: ResearchColumn[], cells: Record<string, Record<string, ColumnCell>>): string {
  const head = ["Company", "Domain", "Tier", "Fit", "Status", "Why now", "Why now date", "Why now source", "Warm paths", "Open roles"];
  for (const c of columns) head.push(c.question, `${c.question} (confidence)`, `${c.question} (source)`);
  const body = rows.map((r) => {
    const line: (string | number | null)[] = [r.name, r.domain, r.tier, r.fit, r.status, r.whyNow, r.whyNowDate, r.whyNowUrl, r.warm, r.openRoles];
    for (const c of columns) {
      const cell = cells[c.id]?.[r.domain];
      line.push(cellLabel(cell), cell?.confidence ?? "", cell?.sources[0]?.url ?? "");
    }
    return line;
  });
  return toCsv([head, ...body]);
}

/** Starts the browser download of `csv` as `name`. */
export function downloadCsv(csv: string, name: string) {
  // A byte-order mark so Excel reads UTF-8 names and quotes correctly.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
