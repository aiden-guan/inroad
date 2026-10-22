import type Anthropic from "@anthropic-ai/sdk";
import type { AskTurn, Connection, EntityRef, ID, Person, RunStep, Suppression, Workspace } from "@/lib/domain/types";
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
 *    nothing ever writes to them again;
 *  - one-way fingerprints of their LinkedIn profile and of their name at their company remain
 *    (`ws.forgotten`), so a restore or an import recognises them even when they had no email.
 * Pure: the reducer runs it in the browser and on the server. Files outside the workspace
 * (connections.json, network.json, run logs, Ask conversations, CRM links) go through the same
 * matchers, on the server.
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

/** Does this text spell out one of their email addresses? */
const mentionsEmail = (text: string | undefined, emails: string[]) => !!text && emails.some((e) => text.toLowerCase().includes(e));
/** A case-insensitive pattern for any of their addresses, or null when they have none. */
const emailsPattern = (emails: string[], flags: string) => (emails.length ? new RegExp(emails.map(escape).join("|"), flags) : null);

/** Replaces their full name (and, with `firstName`, their first name) with a neutral phrase. */
export function redactName(text: string, person: Person, opts: { firstName?: boolean } = {}): string {
  const parts = nameParts(person);
  let out = text;
  if (parts.length >= 2) out = out.replace(wordsPattern(parts, "giu"), "a deleted contact");
  if (opts.firstName && (parts[0]?.length ?? 0) >= 2) out = out.replace(wordsPattern([parts[0]], "giu"), "a deleted contact");
  return out;
}

/** Other people here with the same full name: wherever only a name points at them, it could be one of these. */
export function namesakesOf(ws: Pick<Workspace, "people">, person: Person): Person[] {
  return Object.values(ws.people).filter((p) => p.id !== person.id && sameName(p.name, person.name));
}

/**
 * Where a name alone may be taken to mean them. Anywhere, when no one else here has that name; with a
 * namesake, only on their own company's records, and nowhere if the namesake works there too.
 */
function nameScope(ws: Pick<Workspace, "people">, person: Person): (domain: string | undefined) => boolean {
  const namesakes = namesakesOf(ws, person);
  if (!namesakes.length) return () => true;
  const shared = namesakes.some((p) => p.accountDomain === person.accountDomain);
  return (domain) => !shared && domain === person.accountDomain;
}

/** Runs about them: titles that name them, or their company's runs that use their first name ("Reading Dana's reply"). */
export function runsAbout(ws: Workspace, person: Person): ID[] {
  const first = nameParts(person)[0] ?? "";
  const firstRe = first.length >= 2 ? wordsPattern([first], "iu") : null;
  const scope = nameScope(ws, person);
  const ours = (r: Workspace["runs"][number]) => r.ref?.kind === "account" && r.ref.id === person.accountDomain;
  return ws.runs.filter((r) => (namesPerson(r.title, person) && scope(r.ref?.kind === "account" ? r.ref.id : undefined)) || (ours(r) && scope(person.accountDomain) && !!firstRe?.test(r.title))).map((r) => r.id);
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

/** Two 53-bit string hashes (cyrb53): enough to recognise someone again, not to read back who it was. Sync, so the reducer can use it. */
function fingerprint(text: string): string {
  const hash = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, "0");
  };
  return hash(0) + hash(1);
}

/** Who someone is, as an import, a sync or a backup describes them. */
export interface Identity {
  email?: string | null;
  linkedinUrl?: string | null;
  name?: string;
  /** Their company's domain: a name only identifies someone together with it. */
  domain?: string | null;
}

/** The fingerprints `ws.forgotten` holds for someone: their LinkedIn profile, and their full name at their company. */
export function forgetKeys(who: Identity): string[] {
  const keys: string[] = [];
  const li = linkedinKey(who.linkedinUrl ?? undefined);
  if (li) keys.push(`li:${fingerprint(li)}`);
  const name = who.name?.trim().toLowerCase().replace(/\s+/g, " ");
  const domain = who.domain?.trim().toLowerCase();
  if (name && domain) keys.push(`nm:${fingerprint(`${name}@${domain}`)}`);
  return keys;
}

/**
 * Did they ask to have their details deleted? Their address on the suppression list as requested_delete,
 * or their profile or name-at-company among the fingerprints a deletion keeps. Imports, syncs and a
 * restore skip them, so nothing brings a deleted person back.
 */
export function wasForgotten(ws: Pick<Workspace, "suppression" | "forgotten">, who: Identity): boolean {
  const email = who.email?.trim().toLowerCase();
  if (email && ws.suppression.some((s) => s.reason === "requested_delete" && s.email?.trim().toLowerCase() === email)) return true;
  if (!ws.forgotten?.length) return false;
  const held = new Set(ws.forgotten);
  return forgetKeys(who).some((k) => held.has(k));
}

/** Is this person (by any of their addresses, their profile or their name at their company) someone who asked to be deleted? */
export function personWasForgotten(ws: Pick<Workspace, "suppression" | "forgotten">, person: Person): boolean {
  const base = { linkedinUrl: person.linkedinUrl, name: person.name, domain: person.accountDomain };
  if (wasForgotten(ws, base)) return true;
  return emailsOf(person).some((email) => wasForgotten(ws, { email }));
}

/** The connection row as an identity (the company is only known once it's matched to a domain). */
export const connectionIdentity = (row: Connection): Identity => ({ email: row.email, linkedinUrl: row.url, name: `${row.firstName} ${row.lastName}`.trim(), domain: row.matchedDomain });

/** Deletes everything held about one person, keeping only their email(s) as `requested_delete`. No-op for unknown ids. */
export function forgetPerson(ws: Workspace, id: ID, at: string, suppressionId: ID): void {
  const person = ws.people[id];
  if (!person) return;
  // Their id, addresses and profile point at them anywhere. Their name alone does only where no one else
  // here has it (nameScope): deleting one "Sam Lee" never touches the other's records.
  const scope = nameScope(ws, person);
  const namesakeIds = new Set(namesakesOf(ws, person).map((p) => p.id));
  const named = (text: string | undefined, domain: string | undefined) => scope(domain) && namesPerson(text, person);
  const isThem = (name: string | undefined, domain: string | undefined) => scope(domain) && sameName(name, person.name);
  const company = ws.accounts[person.accountDomain]?.name;
  const atTheirCompany = (other: string | undefined) => !!company && !!other && normalizeCompany(other) === normalizeCompany(company);
  /** A lead named on any company's call ("Dana Okafor at Northwind"): with a namesake, only with their company named too. */
  const namedLead = (text: string | undefined) => namesPerson(text, person) && (scope(undefined) || (scope(person.accountDomain) && !!company && wordsPattern(company.trim().split(/\s+/), "iu").test(text!)));
  const li = linkedinKey(person.linkedinUrl);
  const emails = emailsOf(person);
  const dealDomain = (dealId: ID | undefined) => (dealId ? ws.deals[dealId]?.accountDomain : undefined);

  // 1. Evidence about them, or that names them or their address, and what was built on it. Named only by
  // name, it counts where the name does: evidence cited on their company, unless a namesake cites it.
  const citedHere = new Set(evidenceCitedOn(ws, person.accountDomain));
  const namesakeCites = new Set([...namesakeIds].flatMap((x) => ws.people[x]?.evidenceIds ?? []));
  const gone = new Set(person.evidenceIds);
  for (const ev of Object.values(ws.evidence)) {
    const where = scope(undefined) || (citedHere.has(ev.id) && !namesakeCites.has(ev.id)) ? person.accountDomain : undefined;
    if (named(ev.claim, where) || named(ev.quote, where) || mentionsEmail(ev.claim, emails) || mentionsEmail(ev.quote, emails) || (li && linkedinKey(ev.url) === li)) gone.add(ev.id);
  }
  for (const e of gone) delete ws.evidence[e];
  const keep = (ids: ID[]) => ids.filter((x) => !gone.has(x));

  // 2. Their drafts, and the cards and intros that point at them or at those drafts.
  const pkgs = new Set(Object.values(ws.outreach).filter((p) => p.personId === id).map((p) => p.id));
  const modes = new Map([...pkgs].map((p) => [p, ws.outreach[p].mode]));
  for (const p of pkgs) delete ws.outreach[p];
  for (const p of Object.values(ws.outreach)) {
    if (p.reply?.referral?.name && isThem(p.reply.referral.name, p.accountDomain)) delete p.reply.referral;
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

  // 3. Their history stays as counts, without who it was or what was said: one opaque id for them, and what
  // each touch was (a cold first touch still uses its slot of the cap).
  for (const a of ws.activities) {
    if (a.personId !== id && !(a.draftRef && pkgs.has(a.draftRef.packageId))) continue;
    const mode = a.draftRef ? modes.get(a.draftRef.packageId) : undefined;
    a.forgotten = { who: suppressionId, ...(a.draftRef && mode ? { draft: { packageId: a.draftRef.packageId, step: a.draftRef.step, mode } } : {}) };
    delete a.personId;
    delete a.body;
    delete a.draftRef;
    a.summary = FORGOTTEN;
  }

  // 4. Everywhere else they appear by id or by name.
  const unname = (card: { champion: { name?: string }; economicBuyer: { name?: string } } | undefined, domain: string | undefined) => {
    if (card && isThem(card.champion.name, domain)) delete card.champion.name;
    if (card && isThem(card.economicBuyer.name, domain)) delete card.economicBuyer.name;
  };
  const unown = (map: { milestones: { ownerName?: string }[] } | undefined, domain: string | undefined) => {
    for (const ms of map?.milestones ?? []) if (isThem(ms.ownerName, domain)) delete ms.ownerName;
  };
  // An attendee is them by id, or by name when the row isn't someone else's.
  const attendee = (x: { personId?: ID; name: string }, domain: string | undefined) => x.personId === id || (!(x.personId && namesakeIds.has(x.personId)) && isThem(x.name, domain));
  for (const deal of Object.values(ws.deals)) {
    deal.contacts = deal.contacts.filter((c) => c.personId !== id);
    unname(deal.card, deal.accountDomain);
    unown(deal.map, deal.accountDomain);
  }
  for (const m of Object.values(ws.meetings)) {
    const domain = dealDomain(m.dealId);
    m.attendees = m.attendees.filter((x) => !attendee(x, domain));
    if (m.brief) m.brief.attendees = m.brief.attendees.filter((x) => !attendee(x, domain));
    if (m.debrief) {
      m.debrief.committeeUpdates = m.debrief.committeeUpdates.filter((x) => !isThem(x.name, domain));
      for (const q of m.debrief.quotes) if (isThem(q.speaker, domain)) delete q.speaker;
      // Named as a referral on someone else's call: no longer a lead.
      m.debrief.referrals = m.debrief.referrals.filter((r) => !namedLead(r) && !isThem(r, domain));
      if (m.debrief.referralPeople) m.debrief.referralPeople = m.debrief.referralPeople.filter((r) => !(sameName(r.name, person.name) && (scope(undefined) || (scope(person.accountDomain) && atTheirCompany(r.company)))));
      unname(m.debrief.card, domain);
      unown(m.debrief.map, domain);
    }
  }
  for (const ev of Object.values(ws.events)) {
    for (const g of Object.values(ev.guests)) {
      if (g.personId === id) delete ev.guests[g.id];
      else if (isThem(g.warmPath, undefined)) delete g.warmPath;
    }
  }
  for (const acc of Object.values(ws.accounts)) {
    acc.peopleIds = acc.peopleIds.filter((x) => x !== id);
    acc.signals = acc.signals.filter((s) => !(s.evidenceId && gone.has(s.evidenceId)) && !named(s.headline, acc.domain));
    const d = acc.dossier;
    if (!d) continue;
    for (const c of d.committee) c.personIds = c.personIds.filter((x) => x !== id);
    if (d.recommendation.personId === id) delete d.recommendation.personId;
    d.facts = d.facts.filter((f) => !named(f.text, acc.domain)).map((f) => ({ ...f, evidenceIds: keep(f.evidenceIds) }));
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
    if (p.contactPaths.some((c) => isThem(c.via, undefined))) p.contactPaths = p.contactPaths.filter((c) => !isThem(c.via, undefined));
  }
  for (const c of ws.claims) c.evidenceIds = keep(c.evidenceIds);
  const runs = new Set(runsAbout(ws, person));
  for (const r of ws.runs) if (runs.has(r.id)) r.title = redactName(r.title, person, { firstName: true });
  delete ws.people[id];
  // Whatever still spells out their full name (call notes, a recap, a note on someone else) loses it.
  redactEverywhere(ws, person, scope);

  // 5. Only their email stays, so nothing writes to them again, and fingerprints, so nothing brings them back.
  const keys = forgetKeys({ linkedinUrl: person.linkedinUrl, name: person.name, domain: person.accountDomain });
  for (const c of person.contactPaths) if (c.kind === "linkedin") keys.push(...forgetKeys({ linkedinUrl: c.value }));
  const held = new Set(ws.forgotten ?? []);
  const fresh = [...new Set(keys)].filter((k) => !held.has(k));
  if (fresh.length) ws.forgotten = [...(ws.forgotten ?? []), ...fresh];
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

/** Takes their full name (unless `byName` is false) and email addresses out of one string, or null when there's nothing to look for. */
function scrubber(person: Person, byName = true): ((s: string) => string) | null {
  const parts = nameParts(person);
  const name = byName && parts.length >= 2 ? wordsPattern(parts, "giu") : null;
  const mail = emailsPattern(emailsOf(person), "gi");
  if (!name && !mail) return null;
  return (s) => {
    let out = s;
    if (name && out.search(name) !== -1) out = out.replace(name, "a deleted contact");
    if (mail && out.search(mail) !== -1) out = out.replace(mail, "a deleted contact");
    return out;
  };
}

/**
 * Replaces their full name and email addresses in every string it reaches (in place). Ids and URLs
 * never contain a spaced name; an address is only ever their address.
 */
function redactDeep(node: unknown, person: Person, byName = true): void {
  const clean = scrubber(person, byName);
  if (!clean) return;
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) {
      n.forEach((v, i) => {
        if (typeof v === "string") n[i] = clean(v);
        else visit(v);
      });
    } else if (n && typeof n === "object") {
      const rec = n as Record<string, unknown>;
      for (const [k, v] of Object.entries(rec)) {
        if (typeof v === "string") rec[k] = clean(v);
        else visit(v);
      }
    }
  };
  visit(node);
}

/**
 * Every string of the workspace except the suppression list, which keeps their address on purpose. Their
 * addresses come out everywhere; their name only where it means them (nameScope): with a namesake here,
 * just the records of their own company that aren't the namesake's.
 */
function redactEverywhere(ws: Workspace, person: Person, scope: (domain: string | undefined) => boolean): void {
  const skip = new Set(["suppression", "forgotten"]);
  if (scope(undefined)) {
    for (const [key, value] of Object.entries(ws)) if (!skip.has(key)) redactDeep(value, person);
    return;
  }
  for (const [key, value] of Object.entries(ws)) if (!skip.has(key)) redactDeep(value, person, false);
  if (!scope(person.accountDomain)) return;
  const domain = person.accountDomain;
  const others = new Set(namesakesOf(ws, person).map((p) => p.id));
  const dealIds = new Set(Object.values(ws.deals).filter((d) => d.accountDomain === domain).map((d) => d.id));
  redactDeep(ws.accounts[domain], person);
  for (const d of Object.values(ws.deals)) if (dealIds.has(d.id)) redactDeep(d, person);
  for (const m of Object.values(ws.meetings)) if (dealIds.has(m.dealId)) redactDeep(m, person);
  for (const p of Object.values(ws.outreach)) if (p.accountDomain === domain && !(p.personId && others.has(p.personId))) redactDeep(p, person);
  for (const a of ws.activities) if (a.accountDomain === domain && !(a.personId && others.has(a.personId))) redactDeep(a, person);
  for (const m of Object.values(ws.moves)) if (m.ref?.kind === "account" && m.ref.id === domain) redactDeep(m, person);
}

/** Evidence the company's own records cite: its signals, its dossier and its people. */
function evidenceCitedOn(ws: Workspace, domain: string): ID[] {
  const acc = ws.accounts[domain];
  if (!acc) return [];
  const d = acc.dossier;
  return [
    ...acc.signals.flatMap((s) => (s.evidenceId ? [s.evidenceId] : [])),
    ...(d ? [...d.facts.flatMap((f) => f.evidenceIds), ...d.angles.flatMap((a) => a.evidenceIds), ...d.painHypotheses.flatMap((h) => h.evidenceIds), ...(d.snapshot.descriptionEvidenceIds ?? [])] : []),
    ...acc.peopleIds.flatMap((x) => ws.people[x]?.evidenceIds ?? []),
  ];
}

/* ───────────── Ask conversations (threads.json) ───────────── */

/** An Ask conversation as stored on the server (structurally `StoredThread`). */
export interface ForgettableThread {
  title: string;
  context?: EntityRef;
  contextLabel?: string;
  turns: AskTurn[];
  messages: Anthropic.Beta.BetaMessageParam[];
  noted?: object;
}

const isPersonRef = (ref: EntityRef | undefined, id: ID) => ref?.kind === "person" && ref.id === id;

/** Does this text point at them: their id, full name (unless `byName` is false), an address or their profile? */
function pointsAt(text: string | undefined, person: Person, byName = true): boolean {
  if (!text) return false;
  const li = linkedinKey(person.linkedinUrl);
  return text.includes(person.id) || (byName && namesPerson(text, person)) || mentionsEmail(text, emailsOf(person)) || (!!li && text.toLowerCase().includes(li));
}

/**
 * Does anything in this conversation (the founder's view or the model's history, thinking included) point
 * at them? `byName: false` when someone else here has the same name: then only their id, addresses and
 * profile count.
 */
export function threadMentions(thread: ForgettableThread, person: Person, byName = true): boolean {
  return isPersonRef(thread.context, person.id) || pointsAt(JSON.stringify(thread), person, byName);
}

/** What the model sees of a long pasted message (the same cut the Ask workflow makes). */
const clipForModel = (text: string) => (text.length > 4000 ? `${text.slice(0, 3000)}\n\n[… ${text.length - 3000} more characters not shown.]` : text);

/** The conversation as plain text turns: what was asked and answered, without tool calls, results or thinking. */
function transcript(turns: AskTurn[]): Anthropic.Beta.BetaMessageParam[] {
  const out: { role: "user" | "assistant"; content: Anthropic.Beta.BetaTextBlockParam[] }[] = [];
  for (const t of turns) {
    if (t.pending || t.error) continue;
    const text =
      t.role === "founder"
        ? clipForModel(t.text)
        : t.text || (t.instant ? [t.instant.title, ...t.instant.rows.map((r) => `- ${r.label}${r.detail ? `: ${r.detail}` : ""}`)].join("\n") : "");
    if (!text.trim()) continue;
    const role = t.role === "founder" ? "user" : "assistant";
    const last = out.at(-1);
    if (last?.role === role) last.content[0].text += `\n\n${text}`;
    else out.push({ role, content: [{ type: "text", text }] });
  }
  while (out[0]?.role === "assistant") out.shift();
  // A question that never got an answer stays on screen; the next one follows on from the last answer.
  if (out.at(-1)?.role === "user") out.pop();
  return out;
}

/**
 * Deleting someone from an Ask conversation. A conversation opened on their record is about them, so
 * it goes ("delete"). Elsewhere, whatever names them comes out of what the founder sees (records,
 * rows, proposals and sources about them; their name and address in the text), and the model's
 * history is rebuilt from that redacted view. The history can't be edited in place: thinking blocks
 * are signed, and tool results and web pages may hold them too. Returns whether anything changed.
 */
export function forgetInThread(thread: ForgettableThread, person: Person, byName = true): "delete" | boolean {
  if (isPersonRef(thread.context, person.id)) return "delete";
  if (!threadMentions(thread, person, byName)) return false;
  const aboutThem = (x: unknown) => pointsAt(JSON.stringify(x), person, byName);
  for (const t of thread.turns) {
    if (t.records) t.records = t.records.filter((r) => !isPersonRef(r.ref, person.id));
    if (t.instant) t.instant.rows = t.instant.rows.filter((r) => !isPersonRef(r.ref, person.id));
    // A chip to add, write to or suppress them; a page about them.
    if (t.proposals) t.proposals = t.proposals.filter((p) => !aboutThem(p));
    if (t.citations) t.citations = t.citations.filter((c) => !aboutThem(c));
  }
  redactDeep(thread.turns, person, byName);
  const scrub = scrubber(person, byName);
  if (scrub) {
    thread.title = scrub(thread.title);
    if (thread.contextLabel) thread.contextLabel = scrub(thread.contextLabel);
  }
  thread.messages = transcript(thread.turns);
  // The context notes went with the old history: the next answer gets the open record again.
  delete thread.noted;
  return true;
}

/* ───────────── Links to connected tools (hub.json) ───────────── */

/** Their CRM record links, keyed by their address ("hubspot:person:dana@…"). */
export function hubRefsOf(refs: Record<string, unknown>, person: Person): string[] {
  const keys = new Set(emailsOf(person).map((e) => `:person:${e}`));
  return Object.keys(refs).filter((key) => {
    const i = key.indexOf(":person:");
    return i !== -1 && keys.has(key.slice(i).toLowerCase());
  });
}
