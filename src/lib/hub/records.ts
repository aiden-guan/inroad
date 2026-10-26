/**
 * Deterministic record matching and creation for data that arrives from other tools.
 * Pure functions over a mutable workspace draft (call inside `mutateWorkspace`). Zero tokens.
 * Rule: imported data fills gaps; it never overwrites what the founder or the agent already wrote.
 */
import { newId } from "@/lib/domain/ids";
import type { Account, DiscoverySource, ISODateTime, Person, Workspace } from "@/lib/domain/types";

const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.de",
  "yandex.com",
  "mail.com",
  "hey.com",
  "fastmail.com",
  "zoho.com",
  "qq.com",
  "163.com",
]);

/** "https://www.Acme.com/about" → "acme.com". Returns null for anything that isn't a plausible domain. */
export function normalizeDomain(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let d = input.trim().toLowerCase();
  if (!d) return null;
  if (d.includes("@")) d = d.split("@").pop() ?? "";
  d = d.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#:\s]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) && d.length <= 253 ? d : null;
}

export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const e = input.trim().toLowerCase().replace(/^mailto:/, "");
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null;
}

/** The company domain behind an email, unless it's a personal mailbox. */
export function companyDomainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const d = normalizeDomain(email.split("@")[1]);
  return d && !FREE_MAIL.has(d) ? d : null;
}

export function isFreeMail(domain: string): boolean {
  return FREE_MAIL.has(domain);
}

function titleCaseFromDomain(domain: string): string {
  const root = domain.split(".")[0] ?? domain;
  return root.charAt(0).toUpperCase() + root.slice(1);
}

/** Finds or creates the account. Existing accounts only get empty fields filled. */
export function ensureAccount(
  ws: Workspace,
  input: { domain: string; name?: string; city?: string; linkedinUrl?: string },
  meta: { source: DiscoverySource; sourceDetail: string; at: ISODateTime; tag?: string },
): { account: Account; created: boolean } {
  const existing = ws.accounts[input.domain];
  if (existing) {
    if (!existing.name && input.name) existing.name = input.name;
    if (!existing.hqCity && input.city) existing.hqCity = input.city;
    return { account: existing, created: false };
  }
  const account: Account = {
    domain: input.domain,
    name: input.name?.trim() || titleCaseFromDomain(input.domain),
    status: "new",
    source: meta.source,
    sourceDetail: meta.sourceDetail,
    addedAt: meta.at,
    // Unscored until discovery or a dossier scores it against the ICP; B keeps it visible without claiming fit.
    fitScore: 50,
    tier: "B",
    criteria: [],
    signals: [],
    whyNow: null,
    whyNowScore: 0,
    peopleIds: [],
    warmPathCount: 0,
    watch: false,
    ...(input.city ? { hqCity: input.city } : {}),
    ...(meta.tag ? { tags: [meta.tag] } : {}),
  };
  ws.accounts[input.domain] = account;
  return { account, created: true };
}

export function findPerson(ws: Workspace, q: { email?: string | null; linkedinUrl?: string | null; name?: string; domain?: string | null }): Person | undefined {
  const people = Object.values(ws.people);
  if (q.email) {
    const hit = people.find((p) => p.email?.toLowerCase() === q.email);
    if (hit) return hit;
  }
  if (q.linkedinUrl) {
    const norm = (u: string) => u.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
    const target = norm(q.linkedinUrl);
    const hit = people.find((p) => p.linkedinUrl && norm(p.linkedinUrl) === target);
    if (hit) return hit;
  }
  if (q.name && q.domain) {
    const n = q.name.trim().toLowerCase();
    return people.find((p) => p.accountDomain === q.domain && p.name.trim().toLowerCase() === n);
  }
  return undefined;
}

/** Finds or creates a person on an existing account. Existing people only get empty fields filled. */
export function ensurePerson(
  ws: Workspace,
  input: { domain: string; email?: string | null; name?: string; title?: string; linkedinUrl?: string | null; location?: string },
  meta: { via: string; source: DiscoverySource },
): { person: Person; created: boolean } {
  const existing = findPerson(ws, { email: input.email, linkedinUrl: input.linkedinUrl, name: input.name, domain: input.domain });
  if (existing) {
    if (!existing.email && input.email) existing.email = input.email;
    if (!existing.title && input.title) existing.title = input.title;
    if (!existing.linkedinUrl && input.linkedinUrl) existing.linkedinUrl = input.linkedinUrl;
    if (!existing.location && input.location) existing.location = input.location;
    if (input.email && !existing.contactPaths.some((c) => c.value.toLowerCase() === input.email)) {
      existing.contactPaths.push({ kind: "integration", value: input.email, via: meta.via, verified: false, founderConfirmed: false });
    }
    return { person: existing, created: false };
  }
  const fallbackName = input.email ? input.email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Unknown";
  const person: Person = {
    id: newId("per"),
    accountDomain: input.domain,
    name: input.name?.trim() || fallbackName,
    title: input.title?.trim() ?? "",
    ...(input.email ? { email: input.email } : {}),
    ...(input.linkedinUrl ? { linkedinUrl: input.linkedinUrl } : {}),
    ...(input.location ? { location: input.location } : {}),
    evidenceIds: [],
    confidence: "medium",
    mayHaveLeft: false,
    contactPaths: [
      ...(input.email ? [{ kind: "integration" as const, value: input.email, via: meta.via, verified: false, founderConfirmed: false }] : []),
      ...(input.linkedinUrl ? [{ kind: "linkedin" as const, value: input.linkedinUrl, via: meta.via, verified: false, founderConfirmed: false }] : []),
    ],
    jurisdiction: "unknown",
    doNotContact: false,
    source: meta.source,
  };
  ws.people[person.id] = person;
  const acc = ws.accounts[input.domain];
  if (acc && !acc.peopleIds.includes(person.id)) acc.peopleIds.push(person.id);
  return { person, created: true };
}

/** They asked for their details to be deleted: a sync doesn't bring them back (only the address is kept, to stay away). */
export function askedToBeDeleted(ws: Workspace, email: string | null | undefined): boolean {
  const e = email?.trim().toLowerCase();
  return !!e && ws.suppression.some((s) => s.reason === "requested_delete" && s.email?.toLowerCase() === e);
}

export function isSuppressed(ws: Workspace, email: string | undefined, domain: string | undefined): boolean {
  const e = email?.toLowerCase();
  return ws.suppression.some((s) => (e && s.email?.toLowerCase() === e) || (domain && s.domain?.toLowerCase() === domain.toLowerCase()));
}
