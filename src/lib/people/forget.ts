import type { Connection, ID, Person, RunStep, Suppression, Workspace } from "@/lib/domain/types";
import { linkedinKey, normalizeCompany } from "@/lib/network/csv";
import type { ImportBatch } from "@/lib/network/types";

/**
 * "Delete their details" (SPEC §6, data rules). Cold emails to the EU, the UK and unknown places
 * carry a footer that promises it, so a "stop" from someone there has to end in this:
 *  - the Person and their contact paths are gone, with every draft to them and the cards, intros and
 *    guest-list seats built on those;
 *  - evidence about them, or that names them, is deleted, and the facts and signals that quote it;
 *  - their history stays as counts (caps and the scoreboard still add up) with no name and no text;
 *  - one `requested_delete` suppression entry per address remains, holding only the email, so
 *    nothing ever writes to them again.
 * Pure: the reducer runs it in the browser and on the server. Files outside the workspace
 * (connections.json, network.json, run logs) go through the same matchers, on the server.
 */

/** Every email address on file for them, lowercased, without repeats. */
export function emailsOf(person: Person): string[] {
  const all = [person.email, ...person.contactPaths.map((c) => c.value)].filter((v): v is string => !!v && v.includes("@") && !/^https?:\/\//i.test(v));
  return [...new Set(all.map((e) => e.trim().toLowerCase()))];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sameName = (a: string | undefined, b: string) => !!a && a.trim().toLowerCase() === b.trim().toLowerCase();
const nameParts = (person: Person) => person.name.trim().split(/\s+/).filter(Boolean);
/** A whole-word, case-insensitive pattern for the given words. */
const wordsPattern = (words: string[], flags: string) => new RegExp(`(?<!\\p{L})${words.map(escape).join("\\s+")}(?!\\p{L})`, flags);

/** Does this text name them? Full names only: a first name alone would match too many other people. */
export function namesPerson(text: string | undefined, person: Person): boolean {
  const parts = nameParts(person);
  return !!text && parts.length >= 2 && wordsPattern(parts, "iu").test(text);
}

/** Replaces their full name (and, with `firstName`, their first name) with a neutral phrase. */
export function redactName(text: string, person: Person, opts: { firstName?: boolean } = {}): string {
  const parts = nameParts(person);
  let out = text;
  if (parts.length >= 2) out = out.replace(wordsPattern(parts, "giu"), "a deleted contact");
  if (opts.firstName && (parts[0]?.length ?? 0) >= 2) out = out.replace(wordsPattern([parts[0]], "giu"), "a deleted contact");
  return out;
}

/** Runs about them: titles that name them, or their company's runs that use their first name ("Reading Dana's reply"). */
export function runsAbout(ws: Workspace, person: Person): ID[] {
  const first = nameParts(person)[0] ?? "";
  const firstRe = first.length >= 2 ? wordsPattern([first], "iu") : null;
  return ws.runs.filter((r) => namesPerson(r.title, person) || (r.ref?.kind === "account" && r.ref.id === person.accountDomain && !!firstRe?.test(r.title))).map((r) => r.id);
}

/** A row of the founder's LinkedIn connections that is this person. */
export function connectionIsPerson(row: Connection, person: Person, companyName?: string): boolean {
  if (row.personId === person.id) return true;
  const li = linkedinKey(person.linkedinUrl);
  if (li && linkedinKey(row.url) === li) return true;
  if (row.email && emailsOf(person).includes(row.email.trim().toLowerCase())) return true;
  if (!sameName(`${row.firstName} ${row.lastName}`, person.name)) return false;
  // Same name: only when it's the same company too.
  return row.matchedDomain === person.accountDomain || (!!companyName && !!row.company && normalizeCompany(row.company) === normalizeCompany(companyName));
}

/** network.json import history: undo lists and filled-in values that point at them. Returns whether anything changed. */
export function forgetInImports(imports: ImportBatch[], personId: ID): boolean {
  let changed = false;
  for (const b of imports) {
    if (b.created.people.includes(personId)) {
      b.created.people = b.created.people.filter((id) => id !== personId);
      changed = true;
    }
    const filled = b.filled.filter((f) => !(f.kind === "person" && f.id === personId));
    if (filled.length !== b.filled.length) {
      b.filled = filled;
      changed = true;
    }
  }
  return changed;
}

/** Run logs (runs.json) of the runs about them: their name comes out of every step. Returns whether anything changed. */
export function redactRunSteps(steps: Record<ID, RunStep[]>, runIds: ID[], person: Person): boolean {
  let changed = false;
  for (const id of runIds) {
    for (const s of steps[id] ?? []) {
      const text = redactName(s.text, person, { firstName: true });
      if (text !== s.text) {
        s.text = text;
        changed = true;
      }
    }
  }
  return changed;
}

const FORGOTTEN = "Details deleted at their request";

/** Deletes everything held about one person, keeping only their email(s) as `requested_delete`. No-op for unknown ids. */
export function forgetPerson(ws: Workspace, id: ID, at: string, suppressionId: ID): void {
  const person = ws.people[id];
  if (!person) return;
  const named = (text: string | undefined) => namesPerson(text, person);
  const li = linkedinKey(person.linkedinUrl);

  // 1. Evidence about them, or that names them, and what was built on it.
  const gone = new Set(person.evidenceIds);
  for (const ev of Object.values(ws.evidence)) {
    if (named(ev.claim) || named(ev.quote) || (li && linkedinKey(ev.url) === li)) gone.add(ev.id);
  }
  for (const e of gone) delete ws.evidence[e];
  const keep = (ids: ID[]) => ids.filter((x) => !gone.has(x));

  // 2. Their drafts, and the cards and intros that point at them or at those drafts.
  const pkgs = new Set(Object.values(ws.outreach).filter((p) => p.personId === id).map((p) => p.id));
  for (const p of pkgs) delete ws.outreach[p];
  for (const p of Object.values(ws.outreach)) {
    if (p.reply?.referral?.name && sameName(p.reply.referral.name, person.name)) delete p.reply.referral;
  }
  const intros = ws.intros ?? {};
  for (const intro of Object.values(intros)) {
    if (intro.personId === id || intro.sides?.some((s) => s.personId === id) || (intro.packageId && pkgs.has(intro.packageId))) delete intros[intro.id];
  }
  for (const m of Object.values(ws.moves)) {
    if ((m.ref?.kind === "person" && m.ref.id === id) || (m.draft && pkgs.has(m.draft.packageId))) {
      delete ws.moves[m.id];
      continue;
    }
    // A card about several people ("Dana, Grace and 1 more") loses them until the next prepare rewrites it.
    if (m.subjectIds?.includes(id)) {
      m.subjectIds = m.subjectIds.filter((x) => x !== id);
      m.title = redactName(m.title, person, { firstName: true });
      m.why = redactName(m.why, person, { firstName: true });
    }
    m.evidenceIds = keep(m.evidenceIds);
  }

  // 3. Their history stays as counts, without who it was or what was said.
  for (const a of ws.activities) {
    if (a.personId !== id && !(a.draftRef && pkgs.has(a.draftRef.packageId))) continue;
    delete a.personId;
    delete a.body;
    delete a.draftRef;
    a.summary = FORGOTTEN;
  }

  // 4. Everywhere else they appear by id or by name.
  const unname = (card: { champion: { name?: string }; economicBuyer: { name?: string } } | undefined) => {
    if (card && sameName(card.champion.name, person.name)) delete card.champion.name;
    if (card && sameName(card.economicBuyer.name, person.name)) delete card.economicBuyer.name;
  };
  const unown = (map: { milestones: { ownerName?: string }[] } | undefined) => {
    for (const ms of map?.milestones ?? []) if (sameName(ms.ownerName, person.name)) delete ms.ownerName;
  };
  for (const deal of Object.values(ws.deals)) {
    deal.contacts = deal.contacts.filter((c) => c.personId !== id);
    unname(deal.card);
    unown(deal.map);
  }
  for (const m of Object.values(ws.meetings)) {
    m.attendees = m.attendees.filter((x) => x.personId !== id && !sameName(x.name, person.name));
    if (m.brief) m.brief.attendees = m.brief.attendees.filter((x) => x.personId !== id && !sameName(x.name, person.name));
    if (m.debrief) {
      m.debrief.committeeUpdates = m.debrief.committeeUpdates.filter((x) => !sameName(x.name, person.name));
      for (const q of m.debrief.quotes) if (sameName(q.speaker, person.name)) delete q.speaker;
      unname(m.debrief.card);
      unown(m.debrief.map);
    }
  }
  for (const ev of Object.values(ws.events)) {
    for (const g of Object.values(ev.guests)) {
      if (g.personId === id) delete ev.guests[g.id];
      else if (sameName(g.warmPath, person.name)) delete g.warmPath;
    }
  }
  for (const acc of Object.values(ws.accounts)) {
    acc.peopleIds = acc.peopleIds.filter((x) => x !== id);
    acc.signals = acc.signals.filter((s) => !(s.evidenceId && gone.has(s.evidenceId)) && !named(s.headline));
    const d = acc.dossier;
    if (!d) continue;
    for (const c of d.committee) c.personIds = c.personIds.filter((x) => x !== id);
    if (d.recommendation.personId === id) delete d.recommendation.personId;
    d.facts = d.facts.filter((f) => !named(f.text)).map((f) => ({ ...f, evidenceIds: keep(f.evidenceIds) }));
    for (const a of d.angles) a.evidenceIds = keep(a.evidenceIds);
    for (const h of d.painHypotheses) h.evidenceIds = keep(h.evidenceIds);
    if (d.snapshot.descriptionEvidenceIds) d.snapshot.descriptionEvidenceIds = keep(d.snapshot.descriptionEvidenceIds);
    if (d.snapshot.funding?.evidenceId && gone.has(d.snapshot.funding.evidenceId)) delete d.snapshot.funding.evidenceId;
  }
  // A 1st-degree connection was one of the company's warm paths.
  const acc = ws.accounts[person.accountDomain];
  if (acc && person.contactPaths.some((c) => c.via === "Your 1st-degree connection" || (c.kind === "warm_intro" && c.via === "connection"))) acc.warmPathCount = Math.max(0, acc.warmPathCount - 1);
  for (const p of Object.values(ws.people)) {
    if (p.id === id) continue;
    p.evidenceIds = keep(p.evidenceIds);
    // An intro path through them.
    if (p.contactPaths.some((c) => sameName(c.via, person.name))) p.contactPaths = p.contactPaths.filter((c) => !sameName(c.via, person.name));
  }
  for (const c of ws.claims) c.evidenceIds = keep(c.evidenceIds);
  const runs = new Set(runsAbout(ws, person));
  for (const r of ws.runs) if (runs.has(r.id)) r.title = redactName(r.title, person, { firstName: true });
  delete ws.people[id];
  // Whatever still spells out their full name (call notes, a recap, a note on someone else) loses it.
  redactEverywhere(ws, person);

  // 5. Only their email stays, so nothing writes to them again.
  emailsOf(person).forEach((email, i) => {
    const existing = ws.suppression.find((s) => s.email?.toLowerCase() === email);
    if (existing) {
      existing.reason = "requested_delete";
      return;
    }
    const entry: Suppression = { id: i === 0 ? suppressionId : `${suppressionId}_${i + 1}`, email, reason: "requested_delete", at };
    ws.suppression.push(entry);
  });
}

/** Replaces their full name in every string of the workspace (in place). Ids and URLs never contain a spaced name. */
function redactEverywhere(ws: Workspace, person: Person): void {
  const parts = nameParts(person);
  if (parts.length < 2) return;
  const test = wordsPattern(parts, "iu");
  const all = wordsPattern(parts, "giu");
  const clean = (s: string) => (test.test(s) ? s.replace(all, "a deleted contact") : s);
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach((v, i) => {
        if (typeof v === "string") node[i] = clean(v);
        else visit(v);
      });
    } else if (node && typeof node === "object") {
      const rec = node as Record<string, unknown>;
      for (const [k, v] of Object.entries(rec)) {
        if (typeof v === "string") rec[k] = clean(v);
        else visit(v);
      }
    }
  };
  visit(ws);
}
