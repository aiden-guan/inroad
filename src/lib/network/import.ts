import "server-only";
import { ActionError } from "@/lib/domain/actions";
import { newId, nowISO, todayISO } from "@/lib/domain/ids";
import type { Account, Connection, ContactPath, Person, RelationshipTag, Workspace } from "@/lib/domain/types";
import { ensureAccount, ensurePerson, findPerson, isFreeMail, isSuppressed, normalizeDomain } from "@/lib/hub/records";
import { wasForgotten } from "@/lib/people/forget";
import { mutateWorkspace, readWorkspace } from "@/lib/store/workspace";
import { CSV_LIMITS, headerKey, isLinkedInHeader, linkedinKey, normalizeCompany, parseCsv, parseLinkedInDate } from "./csv";
import { planImport, readListRows } from "./plan";
import { FIELDS, looksLikeConnections, presetById, type Mapping, type PresetId } from "./presets";
import { mutateNetwork, readNetwork, updateConnections } from "./store";
import { knowsByTag } from "./tags";
import { BUYER_ROLES, normalizeTitle, seniority } from "./titles";
import type { ImportBatch } from "./types";

/**
 * Imports, undo, and "track these companies". Deterministic code, zero tokens.
 * Everything in a file is untrusted data: it's clipped, deduplicated and stored; it never sends,
 * never overwrites what's already known, and never triggers anything outbound.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/* ───────────── Lists (accounts and people) ───────────── */

export interface ListImportInput {
  fileName: string;
  text: string;
  preset: PresetId;
  mapping: Mapping;
}

export async function applyListImport(input: ListImportInput): Promise<ImportBatch> {
  if (input.text.length > CSV_LIMITS.bytes) throw new ActionError("That file is over 8 MB. Split it or filter it to your ICP first.");
  const parsed = parseCsv(input.text);
  if (!parsed.headers.length) throw new ActionError("I couldn't find a header row. Export the list as CSV with column names in the first row.");
  if (looksLikeConnections(parsed.headers)) throw new ActionError("This is LinkedIn's Connections.csv. Import it under LinkedIn connections so I can screen it as your network.");
  if (parsed.rows.length > CSV_LIMITS.listRows) {
    throw new ActionError(`This file has ${plural(parsed.rows.length, "row")}. Imports stop at ${CSV_LIMITS.listRows.toLocaleString("en-US")} so every company gets real attention. Filter it to your ICP first.`);
  }
  for (const f of FIELDS) {
    const i = input.mapping[f.key];
    if (i !== null && (i < 0 || i >= parsed.headers.length)) throw new ActionError(`The column for ${f.label.toLowerCase()} doesn't exist in this file.`);
  }
  if (input.mapping.domain === null && input.mapping.email === null) throw new ActionError("Choose the column with the company website or a work email. I match companies by domain.");

  const preset = presetById(input.preset);
  const rows = readListRows(parsed.rows, input.mapping);
  const at = nowISO();
  const matched: { email?: string; linkedin?: string; tag: RelationshipTag }[] = [];
  const fileName = input.fileName.slice(0, 120) || "import.csv";
  const via = preset.id === "generic" ? fileName : preset.label;

  const batch = (
    await mutateWorkspace((ws) => {
      const plan = planImport(ws, rows);
      const b: ImportBatch = {
        id: newId("imp"),
        kind: "csv",
        preset: preset.id,
        presetLabel: preset.label,
        fileName,
        importedAt: at,
        rows: rows.length,
        skipped: plan.skipped.length,
        counts: { accountsCreated: 0, accountsUpdated: 0, peopleCreated: 0, peopleUpdated: 0 },
        created: { accounts: [], people: [] },
        filled: [],
        statusChanged: [],
      };
      const touchedAccounts = new Set<string>();
      const touchedPeople = new Set<string>();
      // People on a signup or user list know the product: their tag makes a later job change a champion signal.
      const knows = preset.kind === "signups" ? ("signup" as const) : preset.kind === "customers" ? ("customer" as const) : null;

      for (const row of plan.rows) {
        const domain = row.domain!;
        const prevAccount = ws.accounts[domain] ? { ...ws.accounts[domain] } : null;
        const { account, created } = ensureAccount(
          ws,
          { domain, name: row.company, city: row.person ? undefined : row.location },
          { source: "csv_import", sourceDetail: `${preset.label} · ${fileName}`.slice(0, 120), at, tag: preset.tag },
        );
        if (created) {
          if (!b.created.accounts.includes(domain)) b.created.accounts.push(domain);
        } else if (prevAccount) {
          if (!prevAccount.hqCity && account.hqCity) {
            b.filled.push({ kind: "account", id: domain, field: "hqCity", value: account.hqCity });
            touchedAccounts.add(domain);
          }
          if (preset.tag && !(account.tags ?? []).includes(preset.tag)) {
            account.tags = [...(account.tags ?? []), preset.tag];
            b.filled.push({ kind: "account", id: domain, field: "tag", value: preset.tag });
            touchedAccounts.add(domain);
          }
        }
        if (!account.oneLiner && row.description) {
          account.oneLiner = row.description.slice(0, 160);
          if (!created) {
            b.filled.push({ kind: "account", id: domain, field: "oneLiner", value: account.oneLiner });
            touchedAccounts.add(domain);
          }
        }
        // A paying customer is never a prospect again.
        if (preset.kind === "customers" && (account.status === "new" || account.status === "tracked")) {
          b.statusChanged.push({ domain, from: account.status, to: "customer" });
          account.status = "customer";
          account.customerAt = at;
          if (!created) touchedAccounts.add(domain);
        }

        if (!row.person) continue;
        // Asked to have their details deleted: a list doesn't bring them back.
        if (wasForgotten(ws, { email: row.email, linkedinUrl: row.linkedin, name: row.name, domain })) {
          b.skipped++;
          continue;
        }
        const before = findPerson(ws, { email: row.email, linkedinUrl: row.linkedin, name: row.name, domain });
        const snapshot = before ? { email: before.email, title: before.title, linkedinUrl: before.linkedinUrl, location: before.location, paths: before.contactPaths.length } : null;
        const { person, created: madePerson } = ensurePerson(
          ws,
          { domain, email: row.email, name: row.name, title: row.title, linkedinUrl: row.linkedin, location: row.location },
          { via, source: "csv_import" },
        );
        if (knows && !(person.tags ?? []).includes(knows)) {
          person.tags = [...(person.tags ?? []), knows];
          if (!madePerson) {
            b.filled.push({ kind: "person", id: person.id, field: "tag", value: knows });
            touchedPeople.add(person.id);
          }
        }
        if (knows && (person.email || person.linkedinUrl)) matched.push({ email: person.email?.toLowerCase(), linkedin: person.linkedinUrl, tag: knows });
        if (madePerson) {
          b.created.people.push(person.id);
          if (row.notes) person.notes = `${preset.label}: ${row.notes}`.slice(0, 400);
          if (preset.kind === "signups") person.notes = [person.notes, `Signed up for your product (${fileName}).`].filter(Boolean).join("\n").slice(0, 400);
          continue;
        }
        if (!snapshot) continue;
        for (const field of ["email", "title", "linkedinUrl", "location"] as const) {
          if (!snapshot[field] && person[field]) {
            b.filled.push({ kind: "person", id: person.id, field, value: person[field] });
            touchedPeople.add(person.id);
          }
        }
        if (person.contactPaths.length > snapshot.paths) {
          for (const p of person.contactPaths.slice(snapshot.paths)) b.filled.push({ kind: "person", id: person.id, field: "contactPath", value: p.value });
          touchedPeople.add(person.id);
        }
        if (!person.notes && row.notes) {
          person.notes = `${preset.label}: ${row.notes}`.slice(0, 400);
          b.filled.push({ kind: "person", id: person.id, field: "notes", value: person.notes });
          touchedPeople.add(person.id);
        }
      }
      b.counts = {
        accountsCreated: b.created.accounts.length,
        accountsUpdated: [...touchedAccounts].filter((d) => !b.created.accounts.includes(d)).length,
        peopleCreated: b.created.people.length,
        peopleUpdated: touchedPeople.size,
      };
      return b;
    })
  ).value;

  await mutateNetwork((n) => {
    n.imports.unshift(batch);
  });
  // The same people among the founder's LinkedIn connections, by email or profile URL (SPEC W2 step 5).
  if (matched.length) await tagMatchingConnections(matched);
  return batch;
}

/** Tags connections that are the same person as a signup, user or customer row. Returns how many changed. */
export async function tagMatchingConnections(people: { email?: string; linkedin?: string; tag: RelationshipTag }[]): Promise<number> {
  const byEmail = new Map(people.filter((p) => p.email).map((p) => [p.email!, p.tag]));
  const byUrl = new Map(people.filter((p) => p.linkedin).map((p) => [linkedinKey(p.linkedin), p.tag]));
  return updateConnections((rows) => {
    let n = 0;
    for (const r of rows) {
      const tag = (r.email && byEmail.get(r.email.toLowerCase())) || (r.url && byUrl.get(linkedinKey(r.url)));
      if (!tag || r.tags?.includes(tag)) continue;
      r.tags = [...(r.tags ?? []), tag];
      n++;
    }
    return n;
  });
}

/* ───────────── Undo ───────────── */

function personTouched(ws: Workspace, id: string): boolean {
  return (
    Object.values(ws.outreach).some((p) => p.personId === id) ||
    ws.activities.some((a) => a.personId === id) ||
    Object.values(ws.deals).some((d) => d.contacts.some((c) => c.personId === id)) ||
    Object.values(ws.meetings).some((m) => m.attendees.some((a) => a.personId === id))
  );
}

function accountTouched(ws: Workspace, acc: Account, removable: Set<string>, setStatus?: Account["status"]): boolean {
  return Boolean(
    acc.dealId ||
      acc.dossier ||
      acc.watch ||
      acc.signals.length ||
      (acc.status !== "new" && acc.status !== setStatus) ||
      acc.peopleIds.some((id) => !removable.has(id)) ||
      Object.values(ws.outreach).some((p) => p.accountDomain === acc.domain) ||
      ws.activities.some((a) => a.accountDomain === acc.domain),
  );
}

export async function undoImport(batchId: string): Promise<{ batch: ImportBatch; message: string }> {
  const batch = readNetwork().imports.find((b) => b.id === batchId);
  if (!batch) throw new ActionError("That import isn't in your history anymore.");
  if (batch.undoneAt) throw new ActionError("That import was already undone.");
  if (batch.kind === "linkedin") throw new ActionError("LinkedIn imports can't be undone. Re-import a newer Connections.csv instead.");

  const result = (
    await mutateWorkspace((ws) => {
      let removedPeople = 0;
      let removedAccounts = 0;
      let kept = 0;
      const removed = new Set<string>();
      for (const id of batch.created.people) {
        const person = ws.people[id];
        if (!person) continue;
        if (personTouched(ws, id)) {
          kept++;
          continue;
        }
        delete ws.people[id];
        removed.add(id);
        const acc = ws.accounts[person.accountDomain];
        if (acc) acc.peopleIds = acc.peopleIds.filter((p) => p !== id);
        removedPeople++;
      }
      for (const domain of batch.created.accounts) {
        const acc = ws.accounts[domain];
        if (!acc) continue;
        const setStatus = batch.statusChanged.find((s) => s.domain === domain)?.to;
        if (accountTouched(ws, acc, removed, setStatus)) {
          kept++;
          continue;
        }
        delete ws.accounts[domain];
        removedAccounts++;
      }
      for (const f of batch.filled) {
        if (f.kind === "account") {
          const acc = ws.accounts[f.id];
          if (!acc) continue;
          if (f.field === "tag") acc.tags = (acc.tags ?? []).filter((t) => t !== f.value);
          else if (f.field === "hqCity" && acc.hqCity === f.value) delete acc.hqCity;
          else if (f.field === "oneLiner" && acc.oneLiner === f.value) delete acc.oneLiner;
        } else {
          const p = ws.people[f.id];
          if (!p) continue;
          if (f.field === "contactPath") p.contactPaths = p.contactPaths.filter((c) => !(c.kind === "integration" && c.value === f.value));
          else if (f.field === "tag") p.tags = (p.tags ?? []).filter((t) => t !== f.value);
          else if (f.field === "title" && p.title === f.value) p.title = "";
          else if ((f.field === "email" || f.field === "linkedinUrl" || f.field === "location" || f.field === "notes") && p[f.field] === f.value) delete p[f.field];
        }
      }
      for (const s of batch.statusChanged) {
        const acc = ws.accounts[s.domain];
        if (acc && acc.status === s.to) acc.status = s.from;
      }
      return { removedPeople, removedAccounts, kept };
    })
  ).value;

  const undoneAt = nowISO();
  const updated = await mutateNetwork((n) => {
    const b = n.imports.find((x) => x.id === batchId)!;
    b.undoneAt = undoneAt;
    b.undo = result;
    return { ...b };
  });
  const parts = [
    result.removedAccounts ? plural(result.removedAccounts, "company", "companies") : null,
    result.removedPeople ? plural(result.removedPeople, "person", "people") : null,
  ].filter(Boolean);
  const message = `${parts.length ? `Removed ${parts.join(" and ")}.` : "Nothing left to remove."}${result.kept ? ` Kept ${plural(result.kept, "record")} you've already worked on.` : ""}`;
  return { batch: updated, message };
}

/* ───────────── LinkedIn Connections.csv ───────────── */

export async function importConnections(input: { fileName: string; text: string }): Promise<ImportBatch> {
  if (input.text.length > CSV_LIMITS.bytes) throw new ActionError("That file is over 8 MB. Use the Connections.csv from LinkedIn's data export as is.");
  const parsed = parseCsv(input.text, { isHeader: isLinkedInHeader });
  if (!isLinkedInHeader(parsed.headers)) {
    throw new ActionError("This doesn't look like LinkedIn's Connections.csv. It needs the First Name, Last Name, URL, Company and Position columns.");
  }
  if (parsed.rows.length > CSV_LIMITS.connections) throw new ActionError(`That's ${plural(parsed.rows.length, "row")}. I can screen up to ${CSV_LIMITS.connections.toLocaleString("en-US")} connections.`);
  const keys = parsed.headers.map(headerKey);
  const col = (...names: string[]) => keys.findIndex((k) => names.includes(k));
  const c = {
    first: col("firstname"),
    last: col("lastname"),
    url: col("url", "profileurl"),
    email: col("emailaddress", "email"),
    company: col("company"),
    position: col("position"),
    connected: col("connectedon"),
  };
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").replace(/\s+/g, " ").trim() : "");

  const at = nowISO();
  const today = todayISO();
  let skipped = 0;
  const stats = { total: 0, added: 0, changed: 0, removed: 0, withEmail: 0 };

  const ws = readWorkspace();
  await updateConnections((rows) => {
    const byKey = new Map<string, Connection>();
    const keyOf = (first: string, last: string, url: string, company: string) => linkedinKey(url) || `name:${first} ${last}|${normalizeCompany(company)}`.toLowerCase();
    for (const r of rows) byKey.set(keyOf(r.firstName, r.lastName, r.url, r.company), r);
    const next: Connection[] = [];
    const seen = new Set<string>();
    for (const r of parsed.rows) {
      const firstName = get(r, c.first).slice(0, 60);
      const lastName = get(r, c.last).slice(0, 60);
      const url = get(r, c.url).slice(0, 300);
      const company = get(r, c.company).slice(0, 120);
      const position = get(r, c.position).slice(0, 160);
      const emailRaw = get(r, c.email).toLowerCase();
      const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw.slice(0, 254) : undefined;
      if (!firstName && !lastName && !url) {
        skipped++;
        continue;
      }
      const key = keyOf(firstName, lastName, url, company);
      // Asked to have their details deleted: LinkedIn's file still lists them, but nothing here keeps them.
      if (wasForgotten(ws, { email, linkedinUrl: url })) {
        skipped++;
        continue;
      }
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      const connectedOn = parseLinkedInDate(get(r, c.connected));
      const companyNorm = normalizeCompany(company);
      if (email) stats.withEmail++;
      const prev = byKey.get(key);
      if (!prev) {
        next.push({
          id: newId("con"),
          firstName,
          lastName,
          url,
          ...(email ? { email } : {}),
          company,
          position,
          ...(connectedOn ? { connectedOn } : {}),
          companyNorm,
          history: [{ company, position, seenOn: today }],
        });
        stats.added++;
        continue;
      }
      const companyChanged = !!company && normalizeCompany(prev.company) !== companyNorm;
      const titleChanged = !!position && normalizeTitle(prev.position) !== normalizeTitle(position);
      const conn: Connection = { ...prev, firstName, lastName, url: url || prev.url, company: company || prev.company, position: position || prev.position, companyNorm: company ? companyNorm : prev.companyNorm };
      if (email) conn.email = email;
      if (connectedOn) conn.connectedOn = connectedOn;
      if (companyChanged || titleChanged) {
        stats.changed++;
        conn.previous = { company: prev.company, position: prev.position, changedOn: today };
        const history = prev.history?.length ? prev.history : [{ company: prev.company, position: prev.position, seenOn: prev.connectedOn ?? today }];
        conn.history = [...history, { company: conn.company, position: conn.position, seenOn: today }].slice(-6);
        delete conn.titleRole;
        delete conn.screen;
        if (companyChanged) {
          delete conn.fit;
          delete conn.fitReason;
          delete conn.matchedDomain;
          delete conn.personId;
        }
      }
      next.push(conn);
    }
    stats.removed = rows.filter((r) => !seen.has(keyOf(r.firstName, r.lastName, r.url, r.company))).length;
    stats.total = next.length;
    rows.splice(0, rows.length, ...next);
  });

  const batch: ImportBatch = {
    id: newId("imp"),
    kind: "linkedin",
    fileName: input.fileName.slice(0, 120) || "Connections.csv",
    importedAt: at,
    rows: parsed.rows.length,
    skipped,
    counts: { accountsCreated: 0, accountsUpdated: 0, peopleCreated: 0, peopleUpdated: 0 },
    linkedin: stats,
    created: { accounts: [], people: [] },
    filled: [],
    statusChanged: [],
  };
  await mutateNetwork((n) => {
    n.imports.unshift(batch);
  });
  // The summary shows the import right away; the screen fills in the rest.
  await mutateWorkspace((ws) => {
    const prev = ws.network;
    ws.network = {
      ...(prev ?? { atIcpCompanies: 0, buyerTitles: 0 }),
      importedAt: at,
      total: stats.total,
      jobChanges: stats.changed,
      withEmail: stats.withEmail,
      fileName: batch.fileName,
    };
  });
  return batch;
}

/* ───────────── Warm paths and "track these companies" ───────────── */

/** Account tags for the founder's own early users (onboarding's "last 3 users"): small teams that all used it. */
export const USER_ACCOUNT_TAGS = ["design_partner", "past_user"];

/**
 * Someone who used the product, was a design partner, signed up or worked with the founder: tagged by the
 * founder, matched to a signup or user list, a champion on file, or (before a move) at one of the companies
 * the founder named as their users or design partners.
 */
export function knowsProduct(ws: Workspace, c: Connection): boolean {
  if (knowsByTag(c.tags)) return true;
  const before = [c.previous?.company, ...(c.history ?? []).slice(0, -1).map((h) => h.company)].filter((x): x is string => !!x).map(normalizeCompany);
  if (before.length) {
    for (const a of Object.values(ws.accounts)) {
      if (!(a.tags ?? []).some((t) => USER_ACCOUNT_TAGS.includes(t))) continue;
      const n = normalizeCompany(a.name);
      if (n && before.includes(n)) return true;
    }
  }
  const person = (c.personId && ws.people[c.personId]) || findPerson(ws, { linkedinUrl: c.url, email: c.email ?? null });
  if (!person) return false;
  if (knowsByTag(person.tags)) return true;
  if (person.champion) return true;
  if (ws.accounts[person.accountDomain]?.status === "customer") return true;
  return Object.values(ws.deals).some((d) => d.contacts.some((x) => x.personId === person.id) && (d.stage === "won" || d.stage === "pilot"));
}

const fullName = (c: Connection) => `${c.firstName} ${c.lastName}`.trim();

/** Best person to ask for an intro: most senior first, then oldest connection. */
export function bestConnector(rows: Connection[], excludeUrl?: string): Connection | undefined {
  return rows
    .filter((r) => linkedinKey(r.url) !== linkedinKey(excludeUrl))
    .sort((a, b) => seniority(normalizeTitle(b.position)) - seniority(normalizeTitle(a.position)) || (a.connectedOn ?? "9999").localeCompare(b.connectedOn ?? "9999"))[0];
}

/**
 * Attaches warm paths to the people already known at an account: a direct LinkedIn path when the
 * person IS a connection, otherwise one intro path through the best connector. Idempotent.
 */
export function attachWarmPaths(ws: Workspace, domain: string, rows: Connection[]): number {
  const acc = ws.accounts[domain];
  if (!acc || !rows.length) return 0;
  let added = 0;
  acc.warmPathCount = Math.max(acc.warmPathCount, rows.length);
  for (const pid of acc.peopleIds) {
    const p = ws.people[pid];
    if (!p || p.doNotContact) continue;
    const self = rows.find((r) => (p.linkedinUrl && linkedinKey(r.url) === linkedinKey(p.linkedinUrl)) || fullName(r).toLowerCase() === p.name.trim().toLowerCase());
    if (self) {
      if (!p.contactPaths.some((x) => x.kind === "linkedin" && linkedinKey(x.value) === linkedinKey(self.url))) {
        p.contactPaths.unshift({ kind: "linkedin", value: self.url, via: "Your 1st-degree connection", verified: true, founderConfirmed: true });
        added++;
      }
      if (!p.linkedinUrl && self.url) p.linkedinUrl = self.url;
      continue;
    }
    if (p.contactPaths.some((x) => x.kind === "warm_intro")) continue;
    const via = bestConnector(rows);
    if (!via) continue;
    const path: ContactPath = {
      kind: "warm_intro",
      value: `Ask ${fullName(via)}${via.position ? ` (${via.position.slice(0, 60)})` : ""} for an intro`,
      via: fullName(via),
      sourceUrl: via.url || undefined,
      verified: true,
      founderConfirmed: false,
    };
    p.contactPaths.push(path);
    added++;
  }
  return added;
}

/**
 * The connection as a person at `domain`. When they're already known at another company they moved:
 * the old record stays (its deals, meetings and activity belong there) and is marked as having left,
 * and a new record at the new company carries what matters (role, champion), never the old work email.
 */
export function connectionPerson(ws: Workspace, domain: string, c: Connection): Person {
  const name = fullName(c);
  const li = c.url ? linkedinKey(c.url) : "";
  const here = Object.values(ws.people).find(
    (p) =>
      p.accountDomain === domain &&
      ((li && p.linkedinUrl && linkedinKey(p.linkedinUrl) === li) || (c.email && p.email?.toLowerCase() === c.email) || p.name.trim().toLowerCase() === name.toLowerCase()),
  );
  const old = here ? undefined : findPerson(ws, { linkedinUrl: c.url || null, email: c.email ?? null });
  let person: Person;
  if (old && old.accountDomain !== domain) {
    old.mayHaveLeft = true;
    const email = c.email && c.email !== old.email?.toLowerCase() ? c.email : undefined;
    person = {
      id: newId("per"),
      accountDomain: domain,
      name,
      title: c.position,
      ...(email ? { email } : {}),
      ...(c.url ? { linkedinUrl: c.url } : {}),
      ...(old.role ? { role: old.role } : {}),
      ...(old.champion ? { champion: old.champion } : {}),
      notes: `Knew your product at ${ws.accounts[old.accountDomain]?.name ?? old.accountDomain}.`,
      source: "founder_network",
      confidence: "high",
      mayHaveLeft: false,
      doNotContact: old.doNotContact,
      jurisdiction: "unknown",
      evidenceIds: [],
      contactPaths: [
        ...(c.url ? [{ kind: "linkedin" as const, value: c.url, via: "Your 1st-degree connection", verified: true, founderConfirmed: true }] : []),
        ...(email ? [{ kind: "integration" as const, value: email, via: "LinkedIn connections", verified: false, founderConfirmed: false }] : []),
      ],
    };
    ws.people[person.id] = person;
    const acc = ws.accounts[domain];
    if (acc && !acc.peopleIds.includes(person.id)) acc.peopleIds.push(person.id);
    return person;
  }
  if (here) {
    // Same gap-filling as ensurePerson, without its global lookup (which could land on an old record elsewhere).
    if (!here.email && c.email) here.email = c.email;
    if (!here.title && c.position) here.title = c.position;
    if (!here.linkedinUrl && c.url) here.linkedinUrl = c.url;
    if (c.email && !here.contactPaths.some((p) => p.value.toLowerCase() === c.email)) {
      here.contactPaths.push({ kind: "integration", value: c.email, via: "LinkedIn connections", verified: false, founderConfirmed: false });
    }
    person = here;
  } else {
    person = ensurePerson(
      ws,
      { domain, email: c.email ?? null, name, title: c.position, linkedinUrl: c.url || null },
      { via: "LinkedIn connections", source: "founder_network" },
    ).person;
  }
  for (const p of person.contactPaths) {
    if (p.kind === "linkedin" && linkedinKey(p.value) === linkedinKey(c.url)) Object.assign(p, { via: "Your 1st-degree connection", verified: true, founderConfirmed: true });
  }
  if (person.confidence !== "high") person.confidence = "high";
  return person;
}

export interface TrackResult {
  tracked: number;
  created: number;
  people: number;
  skipped: { name: string; reason: string }[];
}

/** The founder's approval point: ticked companies from the network screen become tracked accounts with warm paths. */
export async function trackCompanies(items: { name: string; domain: string }[]): Promise<TrackResult> {
  const at = nowISO();
  const result: TrackResult = { tracked: 0, created: 0, people: 0, skipped: [] };
  await updateConnections(async (rows) => {
    await mutateWorkspace((ws) => {
      const own = ws.company?.domain?.toLowerCase();
      for (const item of items.slice(0, 50)) {
        const domain = normalizeDomain(item.domain);
        const name = item.name.trim().slice(0, 120);
        if (!domain || isFreeMail(domain) || /(^|\.)linkedin\.com$/.test(domain)) {
          result.skipped.push({ name, reason: "Not a company website" });
          continue;
        }
        if (own && (domain === own || domain.endsWith(`.${own}`))) {
          result.skipped.push({ name, reason: "Your own company" });
          continue;
        }
        if (isSuppressed(ws, undefined, domain)) {
          result.skipped.push({ name, reason: "On your do-not-contact list" });
          continue;
        }
        const norm = normalizeCompany(name);
        const at_ = rows.filter((r) => r.matchedDomain === domain || (norm && r.companyNorm === norm));
        const { account, created } = ensureAccount(ws, { domain, name }, { source: "founder_network", sourceDetail: "LinkedIn connections", at, tag: "warm" });
        if (account.status === "disqualified") {
          result.skipped.push({ name, reason: "You disqualified it earlier" });
          continue;
        }
        if (created) result.created++;
        account.watch = true;
        if (account.status === "new") account.status = "tracked";
        result.tracked++;
        for (const r of at_) r.matchedDomain = domain;
        const buyers = at_
          .filter((r) => r.titleRole && BUYER_ROLES.includes(r.titleRole))
          .sort((a, b) => seniority(normalizeTitle(b.position)) - seniority(normalizeTitle(a.position)))
          .slice(0, 3);
        for (const r of buyers) {
          const person = connectionPerson(ws, domain, r);
          if (r.titleRole && !person.role) person.role = r.titleRole;
          r.personId = person.id;
          result.people++;
        }
        attachWarmPaths(ws, domain, at_);
      }
    });
  });
  return result;
}

export { fullName };
