import type { Workspace } from "@/lib/domain/types";
import { companyDomainOf, findPerson, isFreeMail, normalizeDomain, normalizeEmail } from "@/lib/hub/records";
import { linkedinKey } from "./csv";
import type { Mapping } from "./presets";

/**
 * The dedupe plan for a list import, computed the same way in the browser (preview) and on the
 * server (apply): companies key on domain, people on email, LinkedIn URL, or name at the company.
 * Imported data only fills gaps; it never overwrites what's already there.
 */

export interface ListRow {
  /** 1-based data row (header excluded), for "row 14 was skipped". */
  line: number;
  domain?: string;
  company?: string;
  email?: string;
  name?: string;
  title?: string;
  linkedin?: string;
  location?: string;
  description?: string;
  notes?: string;
  person: boolean;
}

export type SkipReason = "no_domain" | "personal_email" | "suppressed" | "own_company" | "duplicate";

export const SKIP_LABELS: Record<SkipReason, string> = {
  no_domain: "No website or work email",
  personal_email: "Personal email and no website",
  suppressed: "On your do-not-contact list",
  own_company: "Your own company",
  duplicate: "Repeated in the file",
};

const clip = (s: string | undefined, n: number) => {
  const t = s?.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, n) : undefined;
};

export function readListRows(rows: string[][], mapping: Mapping): ListRow[] {
  const get = (r: string[], k: keyof Mapping) => {
    const i = mapping[k];
    return i === null || i === undefined ? undefined : r[i]?.trim() || undefined;
  };
  return rows.map((r, idx) => {
    const email = normalizeEmail(get(r, "email")) ?? undefined;
    const rawLinkedin = get(r, "linkedin");
    const linkedin = rawLinkedin && /linkedin\.com\//i.test(rawLinkedin) ? clip(rawLinkedin, 300) : undefined;
    let domain = normalizeDomain(get(r, "domain")) ?? undefined;
    if (domain && /(^|\.)linkedin\.com$/.test(domain)) domain = undefined;
    domain ??= companyDomainOf(email) ?? undefined;
    const name = clip([get(r, "first"), get(r, "last")].filter(Boolean).join(" ") || get(r, "name"), 120);
    const title = clip(get(r, "title"), 120);
    return {
      line: idx + 1,
      domain,
      company: clip(get(r, "company"), 120),
      email,
      name,
      title,
      linkedin,
      location: clip(get(r, "location"), 80),
      description: clip(get(r, "description"), 200),
      notes: clip(get(r, "notes"), 300),
      person: Boolean(email || name || linkedin || title),
    };
  });
}

export interface ImportPlan {
  total: number;
  /** Domains, in file order. */
  newAccounts: string[];
  existingAccounts: string[];
  newPeople: number;
  existingPeople: number;
  skipped: { line: number; reason: SkipReason }[];
  /** Rows to apply (skips removed). */
  rows: ListRow[];
}

type PlanWorkspace = Pick<Workspace, "accounts" | "people" | "suppression" | "company">;

export function planImport(ws: PlanWorkspace, rows: ListRow[]): ImportPlan {
  const own = ws.company?.domain?.toLowerCase();
  const suppressedDomains = new Set(ws.suppression.map((s) => s.domain?.toLowerCase()).filter(Boolean) as string[]);
  const suppressedEmails = new Set(ws.suppression.map((s) => s.email?.toLowerCase()).filter(Boolean) as string[]);
  const newAccounts: string[] = [];
  const existingAccounts: string[] = [];
  const seenDomains = new Set<string>();
  const companyRows = new Set<string>();
  const personKeys = new Set<string>();
  const skipped: ImportPlan["skipped"] = [];
  const apply: ListRow[] = [];
  let newPeople = 0;
  let existingPeople = 0;

  for (const row of rows) {
    if (!row.domain) {
      skipped.push({ line: row.line, reason: row.email && isFreeMail(row.email.split("@")[1] ?? "") ? "personal_email" : "no_domain" });
      continue;
    }
    if (own && (row.domain === own || row.domain.endsWith(`.${own}`))) {
      skipped.push({ line: row.line, reason: "own_company" });
      continue;
    }
    if (suppressedDomains.has(row.domain) || (row.email && suppressedEmails.has(row.email))) {
      skipped.push({ line: row.line, reason: "suppressed" });
      continue;
    }
    const keys = row.person
      ? [row.email && `e:${row.email}`, row.linkedin && `l:${linkedinKey(row.linkedin)}`, row.name && `n:${row.domain}:${row.name.toLowerCase()}`].filter(Boolean) as string[]
      : [];
    if (row.person ? keys.some((k) => personKeys.has(k)) : companyRows.has(row.domain)) {
      skipped.push({ line: row.line, reason: "duplicate" });
      continue;
    }
    if (row.person) {
      for (const k of keys) personKeys.add(k);
      if (keys.length) {
        if (findPerson(ws as Workspace, { email: row.email, linkedinUrl: row.linkedin, name: row.name, domain: row.domain })) existingPeople++;
        else newPeople++;
      }
    } else {
      companyRows.add(row.domain);
    }
    if (!seenDomains.has(row.domain)) {
      seenDomains.add(row.domain);
      (ws.accounts[row.domain] ? existingAccounts : newAccounts).push(row.domain);
    }
    apply.push(row);
  }
  return { total: rows.length, newAccounts, existingAccounts, newPeople, existingPeople, skipped, rows: apply };
}

/** "9 skipped: 5 personal emails, 3 repeated, 1 do-not-contact". */
export function skipSummary(skipped: ImportPlan["skipped"]): { reason: SkipReason; label: string; count: number; lines: number[] }[] {
  const by = new Map<SkipReason, number[]>();
  for (const s of skipped) by.set(s.reason, [...(by.get(s.reason) ?? []), s.line]);
  return [...by.entries()].map(([reason, lines]) => ({ reason, label: SKIP_LABELS[reason], count: lines.length, lines })).sort((a, b) => b.count - a.count);
}
