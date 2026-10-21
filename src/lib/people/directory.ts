import "server-only";
import { connectorFor, DEFAULT_MONTHLY_DATA_CREDITS, PEOPLE_DATA_PRICE, type ConnectorError, type FoundEmail, type PeopleAdapter, type PersonPreview } from "@/lib/connectors";
import { splitName } from "@/lib/connectors/http";
import { jurisdictionOf } from "@/lib/deals/rules";
import { monthKey, nowISO } from "@/lib/domain/ids";
import type { ContactPath, Person, Workspace } from "@/lib/domain/types";
import { ensurePerson } from "@/lib/hub/records";
import { mutateWorkspace, readWorkspace } from "@/lib/store/workspace";

/**
 * People data through Firecrawl, in code (zero Claude tokens). Searching is free; the founder clicks
 * for each paid lookup, sees its most-cost first, and a monthly credit limit stops runaway spend.
 * Only work emails are ever requested: never personal emails or phone numbers.
 */

export class PeopleDataError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly fixUrl?: string,
  ) {
    super(message);
  }
}

const STATUS: Record<ConnectorError["code"], number> = {
  auth: 401,
  forbidden: 403,
  plan: 402,
  not_found: 404,
  conflict: 409,
  validation: 400,
  rate_limited: 429,
  upstream: 502,
  network: 504,
};

export function monthlyCreditLimit(ws: Workspace): number {
  const v = Number(ws.integrations.firecrawl?.config.monthlyCredits);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_MONTHLY_DATA_CREDITS;
}

export function creditsThisMonth(ws: Workspace): number {
  return ws.usage[monthKey()]?.dataCredits ?? 0;
}

function adapter(ws: Workspace): PeopleAdapter {
  const people = connectorFor("firecrawl", ws)?.people;
  if (!people) throw new PeopleDataError("Connect Firecrawl in Integrations to look people up.", 412, "not_connected");
  return people;
}

function assertBudget(ws: Workspace, mostItCosts: number) {
  const limit = monthlyCreditLimit(ws);
  const used = creditsThisMonth(ws);
  if (used + mostItCosts > limit) {
    throw new PeopleDataError(
      `That lookup could pass your limit of ${limit.toLocaleString("en-US")} Firecrawl credits this month (${used.toLocaleString("en-US")} used). Raise it in Integrations → Firecrawl.`,
      402,
      "budget",
    );
  }
}

/** Saves what a call cost and how the connection is doing. Auth failures mark the integration so the hub shows it. */
async function record(credits: number, error?: ConnectorError) {
  await mutateWorkspace((w) => {
    const key = monthKey();
    if (credits > 0) {
      w.usage[key] ??= { costUsd: 0, runs: 0, byWorkflow: {}, freeSignals: 0 };
      w.usage[key].dataCredits = (w.usage[key].dataCredits ?? 0) + credits;
    }
    const st = w.integrations.firecrawl;
    if (!st) return;
    if (error?.code === "auth" || error?.code === "plan") st.lastError = { at: nowISO(), message: error.message };
    else if (!error) {
      delete st.lastError;
      st.lastSyncAt = nowISO();
      st.stats = { pushed: st.stats?.pushed ?? 0, pulled: (st.stats?.pulled ?? 0) + 1 };
    }
  });
}

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: ConnectorError }): T {
  if (r.ok) return r.value;
  throw new PeopleDataError(r.error.message, STATUS[r.error.code] ?? 502, r.error.code, r.error.fixUrl);
}

/** Titles worth searching for at this company: the ICP personas, then the dossier's open committee seats. */
export function titlesFor(ws: Workspace, domain: string): string[] {
  const account = ws.accounts[domain];
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (t: string | undefined) => {
    const v = t?.trim();
    if (v && !seen.has(v.toLowerCase()) && out.length < 10) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  };
  for (const p of ws.foundation?.personas ?? []) p.titles.slice(0, 4).forEach(add);
  for (const c of account?.dossier?.committee ?? []) if (!c.personIds.length) c.likelyTitles.forEach(add);
  add(account?.suggestedTitle);
  return out;
}

export interface Preview extends PersonPreview {
  /** Set when this person is already on file. */
  personId?: string;
}

export async function findPeople(domain: string, titles?: string[]): Promise<{ people: Preview[]; titles: string[]; total?: number }> {
  const ws = readWorkspace();
  if (!ws.accounts[domain]) throw new PeopleDataError("That company isn't in your list.", 404, "not_found");
  const people = adapter(ws);
  const wanted = (titles ?? titlesFor(ws, domain)).map((t) => t.trim()).filter(Boolean).slice(0, 10);
  const r = await people.search({ domain, titles: wanted, perPage: 10 });
  await record(r.ok ? r.value.credits : 0, r.ok ? undefined : r.error);
  const { value } = unwrap(r);
  const byApollo = new Map(Object.values(ws.people).filter((p) => p.apolloId).map((p) => [p.apolloId!, p.id]));
  return {
    titles: wanted,
    total: value.total,
    people: value.people.map((p) => (byApollo.has(p.id) ? { ...p, personId: byApollo.get(p.id) } : p)),
  };
}

function emailPath(email: FoundEmail, via: string): ContactPath {
  // An address the provider didn't check is a guess: the founder confirms it before anything is sent.
  return email.verified
    ? { kind: "integration", value: email.address, via, verified: true, founderConfirmed: false }
    : { kind: "pattern_guess", value: email.address, via, verified: false, founderConfirmed: false };
}

function addEmail(person: Person, email: FoundEmail, via: string) {
  const existing = person.contactPaths.find((c) => c.value.toLowerCase() === email.address);
  if (existing) {
    if (email.verified && !existing.verified) Object.assign(existing, emailPath(email, via));
  } else {
    person.contactPaths.push(emailPath(email, via));
  }
  if (email.verified && !person.email) person.email = email.address;
}

const sameCompany = (a: string, b: string) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);

/** Reveals a search hit and files it on the company. Billed only on a match. */
export async function addPerson(domain: string, apolloId: string): Promise<{ personId: string; credits: number; email: FoundEmail | null; movedOn: boolean }> {
  const ws = readWorkspace();
  if (!ws.accounts[domain]) throw new PeopleDataError("That company isn't in your list.", 404, "not_found");
  const onFile = Object.values(ws.people).find((p) => p.apolloId === apolloId);
  if (onFile) return { personId: onFile.id, credits: 0, email: null, movedOn: onFile.mayHaveLeft };
  assertBudget(ws, PEOPLE_DATA_PRICE.add);
  const r = await adapter(ws).add(apolloId);
  await record(r.ok ? r.value.credits : 0, r.ok ? undefined : r.error);
  const { value: found, credits } = unwrap(r);
  if (!found) throw new PeopleDataError("Apollo couldn't match that person anymore, so nothing was charged. They may have changed jobs.", 404, "no_match");

  const movedOn = !!found.companyDomain && !sameCompany(found.companyDomain, domain);
  const { value: personId } = await mutateWorkspace((w) => {
    const { person } = ensurePerson(
      w,
      { domain, name: found.name, title: found.title, linkedinUrl: found.linkedinUrl ?? null, location: found.location },
      { via: "Apollo", source: "integration" },
    );
    person.apolloId = found.id;
    if (found.location && person.jurisdiction === "unknown") person.jurisdiction = jurisdictionOf(found.location);
    if (movedOn) person.mayHaveLeft = true;
    if (found.email) addEmail(person, found.email, "Apollo");
    return person.id;
  });
  return { personId, credits, email: found.email ?? null, movedOn };
}

/** A work email for someone already on file. Billed only when one is found. */
export async function findWorkEmail(personId: string): Promise<{ email: FoundEmail | null; credits: number }> {
  const ws = readWorkspace();
  const person = ws.people[personId];
  if (!person) throw new PeopleDataError("That person isn't on file anymore.", 404, "not_found");
  if (person.doNotContact) throw new PeopleDataError(`${person.name} asked not to be contacted, so I won't look up their email.`, 409, "do_not_contact");
  const { first, last } = splitName(person.name);
  if (!person.linkedinUrl && (!first || !last)) {
    throw new PeopleDataError(`I need ${person.name}'s full name or LinkedIn profile to look up a work email.`, 400, "validation");
  }
  assertBudget(ws, PEOPLE_DATA_PRICE.workEmail);
  const account = ws.accounts[person.accountDomain];
  const r = await adapter(ws).workEmail(
    person.linkedinUrl ? { linkedinUrl: person.linkedinUrl } : { firstName: first, lastName: last, domain: person.accountDomain, companyName: account?.name },
  );
  await record(r.ok ? r.value.credits : 0, r.ok ? undefined : r.error);
  const { value: email, credits } = unwrap(r);
  if (email) {
    await mutateWorkspace((w) => {
      const p = w.people[personId];
      if (p) addEmail(p, email, "FullEnrich");
    });
  }
  return { email, credits };
}

export function peopleDataErrorResponse(err: unknown): Response | null {
  if (!(err instanceof PeopleDataError)) return null;
  return Response.json({ error: err.message, code: err.code, ...(err.fixUrl ? { fixUrl: err.fixUrl } : {}) }, { status: err.status });
}
