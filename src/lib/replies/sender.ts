import type { Connection, ID, Workspace } from "@/lib/domain/types";
import { companyDomainOf, normalizeEmail } from "@/lib/hub/records";

/**
 * ⌘K "Paste a reply": who sent it, worked out in code from what the founder pasted (zero tokens).
 * Read the sender from the headers a mail client copies (From:, or Gmail's "Name <address>" first
 * line), else any address that isn't the founder's, else the name under the sign-off. Then match it
 * to a person on file by email or name, failing that to a LinkedIn connection, failing that to a new
 * person at the company the address belongs to.
 */

export interface ParsedSender {
  email?: string;
  name?: string;
}

export interface OwnIdentity {
  emails: string[];
  domains: string[];
}

export type SenderMatch =
  | { kind: "person"; personId: ID; name: string; title?: string; domain: string; company: string; why: "email" | "name" }
  | { kind: "connection"; connectionId: ID; name: string; title?: string; domain: string; company: string; why: "email" | "name" }
  | { kind: "new"; name: string; email?: string; domain: string; company: string; knownCompany: boolean; why: "domain" };

/** Who the founder confirmed sent it: one of the matches, by its id, or a new person at a company. */
export type PasteTarget = { personId: ID } | { connectionId: ID } | { domain: string; name: string; email?: string; company?: string };

/** The confirmed match as a target the log step accepts. */
export function targetOf(m: SenderMatch): PasteTarget {
  if (m.kind === "person") return { personId: m.personId };
  if (m.kind === "connection") return { connectionId: m.connectionId };
  return { domain: m.domain, name: m.name, email: m.email, company: m.company };
}

const EMAIL = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const HEADER = /^\s*(?:from|von|de|da)\s*:\s*(.+)$/im;
const QUOTE_INTRO = /^\s*(?:on\s.{4,120}?wrote:|-{2,}\s*original message\s*-{2,}|_{8,})\s*$/im;
const SIGN_OFF = /^(?:best|thanks|thank you|thanks again|many thanks|cheers|regards|best regards|kind regards|warm regards|warmly|all the best|talk soon|thx|sincerely)[,.!]?$/i;
const NAME = /^[\p{Lu}][\p{L}'’.-]*(?:\s+[\p{Lu}][\p{L}'’.-]*){0,3}$/u;

/** The founder's own addresses and domains: never the sender of a reply to them. */
export function ownIdentity(ws: Pick<Workspace, "founder" | "sender" | "company">): OwnIdentity {
  const emails = [ws.founder.email, ws.sender?.email].map((e) => normalizeEmail(e)).filter((e): e is string => !!e);
  const domains = [ws.company?.domain, ws.sender?.sendingDomain, ...emails.map((e) => e.split("@")[1])].filter((d): d is string => !!d).map((d) => d.toLowerCase());
  return { emails: [...new Set(emails)], domains: [...new Set(domains)] };
}

function isOwn(email: string, own: OwnIdentity): boolean {
  const d = email.split("@")[1] ?? "";
  return own.emails.includes(email) || own.domains.some((o) => d === o || d.endsWith(`.${o}`));
}

/** "Dana Kim <dana@x.io>", "\"Kim, Dana\" <dana@x.io>", "dana@x.io", "Dana Kim [mailto:dana@x.io]". */
function parseAddress(raw: string): ParsedSender {
  const email = normalizeEmail(raw.match(EMAIL)?.[0]);
  let name = raw
    .replace(/<[^>]*>|\[mailto:[^\]]*\]|\([^)]*@[^)]*\)/gi, "")
    .replace(EMAIL, "")
    .replace(/["“”]/g, "")
    .trim();
  // "Kim, Dana" → "Dana Kim"
  const comma = name.match(/^([^,]+),\s*([^,]+)$/);
  if (comma) name = `${comma[2]} ${comma[1]}`;
  name = name.replace(/\s+/g, " ").trim();
  return { ...(email ? { email } : {}), ...(name && name.length <= 80 && !/[@<>]/.test(name) ? { name } : {}) };
}

/** Their own words: the paste without copied headers and without the quoted thread below. */
export function replyBody(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  // Header block at the top: "From: / Sent: / To: / Cc: / Subject: / Date:" or Gmail's "Name <a@b>", time, "to me".
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const top = i;
  while (
    i < lines.length &&
    (/^\s*(?:from|sent|to|cc|bcc|subject|date|reply-to|von|gesendet|an|betreff|de|para|asunto|envoyé|objet)\s*:/i.test(lines[i]) ||
      (i - top < 4 && /^[^\n]{0,80}<[^>\s]+@[^>\s]+>\s*$/.test(lines[i])) ||
      (i - top < 4 && /^\s*(?:\d{1,2}:\d{2}\s*(?:am|pm)?|\w{3},? \w{3} \d{1,2}).{0,60}$/i.test(lines[i]) && i > top) ||
      (i - top < 5 && /^\s*to\s+(?:me|\S+@\S+)(?:,.*)?\s*$/i.test(lines[i])))
  )
    i++;
  let body = lines.slice(i).join("\n");
  const quote = body.search(QUOTE_INTRO);
  if (quote >= 0) body = body.slice(0, quote);
  body = body
    .split("\n")
    .filter((l) => !/^\s*>/.test(l))
    .join("\n")
    .trim();
  return body.length >= 2 ? body : text.trim();
}

/** Who sent the pasted reply, as far as the text says. */
export function parseSender(text: string, own: OwnIdentity): ParsedSender {
  const header = text.match(HEADER);
  if (header) {
    const p = parseAddress(header[1]);
    if (p.email && !isOwn(p.email, own)) return p;
  }
  // Gmail's copy starts with the sender: "Dana Kim <dana@northwind.io>".
  const first = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3);
  for (const line of first) {
    const m = line.match(/^(.{0,80}?)\s*<([^>\s]+@[^>\s]+)>/);
    if (!m) continue;
    const p = parseAddress(line);
    if (p.email && !isOwn(p.email, own)) return p;
  }
  // Any other address that isn't the founder's (a signature, a "wrote:" line from someone else).
  const email = (text.match(EMAIL) ?? []).map((e) => normalizeEmail(e)).find((e): e is string => !!e && !isOwn(e, own));
  const name = signatureName(replyBody(text));
  return { ...(email ? { email } : {}), ...(name ? { name } : {}) };
}

/** The name under a sign-off ("Best,\nDana Kim"), or after a dash ("— Dana"). */
function signatureName(body: string): string | undefined {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const dash = lines[i].match(/^[—–-]{1,2}\s*(.+)$/);
    if (dash && NAME.test(dash[1]) && dash[1].length <= 40) return dash[1];
    if (SIGN_OFF.test(lines[i]) && lines[i + 1] && NAME.test(lines[i + 1]) && lines[i + 1].length <= 40) return lines[i + 1];
  }
  return undefined;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const firstOf = (s: string) => norm(s).split(" ")[0] ?? "";
const connName = (c: Connection) => `${c.firstName} ${c.lastName}`.trim();
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function companyName(ws: Workspace, domain: string): string {
  return ws.accounts[domain]?.name ?? titleCase(domain.split(".")[0] ?? domain);
}

/** "dana.kim@x.io" → "Dana Kim" (only when the local part looks like a name). */
function nameFromEmail(email: string): string | undefined {
  const local = email.split("@")[0] ?? "";
  if (!/^[a-z]+(?:[._-][a-z]+){0,2}$/i.test(local) || /^(?:info|hello|hi|team|sales|support|contact|admin|office|founders?|ceo|billing|accounts?|noreply|no-reply)$/i.test(local)) return undefined;
  return local
    .split(/[._-]/)
    .map(titleCase)
    .join(" ");
}

function personHasEmail(p: Workspace["people"][string], email: string): boolean {
  return p.email?.toLowerCase() === email || p.contactPaths.some((c) => c.value.toLowerCase() === email);
}

/** People touched in the last `days` days, newest first: a first name alone is matched among them. */
function recentlyTouched(ws: Workspace, now: Date, days = 60): Set<ID> {
  const since = now.getTime() - days * 86_400_000;
  const out = new Set<ID>();
  for (const a of ws.activities) if (a.personId && (a.kind === "touch_sent" || a.kind === "linkedin_dm" || a.kind === "intro_requested") && Date.parse(a.at) >= since) out.add(a.personId);
  return out;
}

/**
 * Candidates for who sent it, best first (at most 5). Email beats name; people on file beat connections;
 * a new person is offered only for an address at a company (never a personal mailbox).
 */
export function matchSender(ws: Workspace, connections: Connection[], parsed: ParsedSender, now: Date): SenderMatch[] {
  const out: SenderMatch[] = [];
  const seen = new Set<string>();
  const push = (m: SenderMatch) => {
    const key = m.kind === "person" ? `p:${m.personId}` : m.kind === "connection" ? `c:${m.connectionId}` : `n:${m.domain}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(m);
  };
  const asPerson = (id: ID, why: "email" | "name") => {
    const p = ws.people[id];
    if (p) push({ kind: "person", personId: p.id, name: p.name, ...(p.title ? { title: p.title } : {}), domain: p.accountDomain, company: companyName(ws, p.accountDomain), why });
  };
  const asConnection = (c: Connection, why: "email" | "name") => {
    if (c.personId && ws.people[c.personId]) return asPerson(c.personId, why);
    if (!c.matchedDomain) return;
    push({ kind: "connection", connectionId: c.id, name: connName(c), ...(c.position ? { title: c.position } : {}), domain: c.matchedDomain, company: ws.accounts[c.matchedDomain]?.name ?? (c.company || companyName(ws, c.matchedDomain)), why });
  };
  const people = Object.values(ws.people);
  const email = parsed.email ? normalizeEmail(parsed.email) : null;
  const name = parsed.name ? norm(parsed.name) : email ? norm(nameFromEmail(email) ?? "") : "";

  if (email) {
    for (const p of people) if (personHasEmail(p, email)) asPerson(p.id, "email");
    for (const c of connections) if (c.email && c.email.toLowerCase() === email) asConnection(c, "email");
    const domain = companyDomainOf(email);
    if (domain) {
      const atCompany = people.filter((p) => p.accountDomain === domain);
      const named = name ? atCompany.filter((p) => norm(p.name) === name || (!name.includes(" ") && firstOf(p.name) === name)) : [];
      for (const p of named) asPerson(p.id, "name");
      if (!out.length) {
        push({
          kind: "new",
          name: parsed.name?.trim() || nameFromEmail(email) || email.split("@")[0],
          email,
          domain,
          company: companyName(ws, domain),
          knownCompany: !!ws.accounts[domain],
          why: "domain",
        });
      }
    }
  }

  if (name) {
    const exact = people.filter((p) => norm(p.name) === name);
    for (const p of exact) asPerson(p.id, "name");
    if (!name.includes(" ") && !exact.length) {
      const touched = recentlyTouched(ws, now);
      const byFirst = people.filter((p) => firstOf(p.name) === name);
      const recent = byFirst.filter((p) => touched.has(p.id));
      for (const p of recent.length ? recent : byFirst.length <= 3 ? byFirst : []) asPerson(p.id, "name");
    }
    for (const c of connections) if (norm(connName(c)) === name) asConnection(c, "name");
  }
  return out.slice(0, 5);
}
