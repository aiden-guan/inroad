/**
 * CSV in and out, written for what tools actually export: BOMs, CRLF, quoted newlines, `;` from
 * European Excel, and LinkedIn's preamble lines above the header. Pure and dependency-free, so the
 * browser previews exactly what the server will import.
 */

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  /** Lines above the header (LinkedIn's "Notes:" preamble) plus blank rows dropped. */
  skippedLines: number;
}

/** Hard ceilings. Imports are for warm paths and lists you'll work, not volume. */
export const CSV_LIMITS = { bytes: 8_000_000, listRows: 2_000, connections: 40_000 } as const;

function sniffDelimiter(text: string): "," | ";" | "\t" {
  const sample = text.slice(0, 4000).split(/\r?\n/).filter((l) => l.trim()).slice(0, 8).join("\n");
  const count = (ch: string) => sample.split(ch).length - 1;
  const comma = count(",");
  const semi = count(";");
  const tab = count("\t");
  if (tab > comma && tab > semi) return "\t";
  if (semi > comma) return ";";
  return ",";
}

/** Splits text into records, honoring quotes (RFC 4180) and any newline style. */
function records(text: string, delimiter: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    cell += ch;
    i++;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out;
}

const nonEmpty = (r: string[]) => r.filter((c) => c.trim() !== "").length;

/**
 * Parses CSV text. The header is the first record that `isHeader` accepts, or else the first with
 * at least two non-empty cells (which skips LinkedIn's one-cell "Notes:" preamble).
 */
export function parseCsv(input: string, opts: { isHeader?: (cells: string[]) => boolean } = {}): ParsedCsv {
  const text = input.replace(/^﻿/, "");
  const all = records(text, sniffDelimiter(text));
  let h = opts.isHeader ? all.findIndex((r) => opts.isHeader!(r.map((c) => c.trim()))) : -1;
  if (h === -1) h = all.findIndex((r) => nonEmpty(r) >= 2);
  if (h === -1) return { headers: [], rows: [], skippedLines: all.length };
  const headers = all[h].map((c, i) => c.trim() || `Column ${i + 1}`);
  const rows: string[][] = [];
  let skipped = h;
  for (const r of all.slice(h + 1)) {
    if (!nonEmpty(r)) {
      skipped++;
      continue;
    }
    const cells = r.slice(0, headers.length).map((c) => c.trim());
    while (cells.length < headers.length) cells.push("");
    rows.push(cells);
  }
  return { headers, rows, skippedLines: skipped };
}

/** "Person Linkedin Url" → "personlinkedinurl". */
export const headerKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/* ───────────── LinkedIn Connections.csv ───────────── */

export const LINKEDIN_HEADER = ["First Name", "Last Name", "URL", "Email Address", "Company", "Position", "Connected On"] as const;

export function isLinkedInHeader(cells: string[]): boolean {
  const keys = new Set(cells.map(headerKey));
  return keys.has("firstname") && keys.has("lastname") && (keys.has("url") || keys.has("profileurl")) && keys.has("company") && keys.has("position");
}

/** "linkedin.com/in/jane-doe" — the stable identity of a connection across imports. */
export function linkedinKey(url: string | undefined): string {
  if (!url) return "";
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^([a-z]{2,3}\.)?(www\.)?/, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** LinkedIn writes "12 Oct 2024"; older exports used "10/12/24". Returns `YYYY-MM-DD` or undefined. */
export function parseLinkedInDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  let m = t.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

/* ───────────── Company names ───────────── */

/** Same rules as the YC directory join, so "Acme, Inc." and "ACME" meet. */
export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(inc|llc|ltd|corp|corporation|co|gmbh|plc|sa|bv|hq|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Not a company you can sell to, or not a company at all. */
const NOT_A_COMPANY = /^(self ?employed|freelance\w*|independent( consultant)?|consultant|stealth( mode)?( startup)?|stealth startup|retired|unemployed|open to work|confidential|private|various|n ?a|none|student|looking for.*|career break|sabbatical|seeking.*|-+)$/;

export function isRealCompany(norm: string): boolean {
  return norm.length >= 2 && !NOT_A_COMPANY.test(norm);
}

/* ───────────── Writing CSV ───────────── */

/**
 * One cell. Values from other tools are untrusted, so a leading = + - @ (a spreadsheet formula) is
 * defused with a quote unless the cell is plainly a number or a phone number.
 */
function cell(v: unknown): string {
  if (v === undefined || v === null) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d[\d\s().,-]*$/.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n") + "\r\n";
}
