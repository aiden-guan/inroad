import type { Account } from "@/lib/domain/types";
import { isFreeMail, normalizeDomain } from "@/lib/hub/records";
import { decodeEntities } from "./parse";
import type { IntentCompany } from "./types";

/**
 * Where an author works, only when their own profile says so plainly: a work email, or a site named next to a role
 * ("CTO at fernwick.com", "Building acme.io"). Personal sites, hosting and social domains never count, and nothing
 * is ever inferred from a username. Pure.
 */

const PERSONAL =
  /(^|\.)(github\.io|gitlab\.io|github\.com|gitlab\.com|medium\.com|substack\.com|linktr\.ee|about\.me|dev\.to|hashnode\.dev|wordpress\.com|blogspot\.com|vercel\.app|netlify\.app|pages\.dev|herokuapp\.com|linkedin\.com|twitter\.com|x\.com|bsky\.app|bsky\.social|mastodon\.social|threads\.net|youtube\.com|notion\.site|carrd\.co|keybase\.io|ycombinator\.com|google\.com|gmail\.com|calendly\.com|buymeacoffee\.com|patreon\.com|ko-fi\.com|wikipedia\.org|stackoverflow\.com|reddit\.com)$/i;

/** True for a domain that says nothing about an employer. */
export const isPersonalDomain = (domain: string) => PERSONAL.test(domain) || isFreeMail(domain);

const ROLE = String.raw`(?:i\s+work|working|work|engineer(?:ing)?|developer|dev|cto|ceo|coo|cfo|cpo|founder|co-?founder|vp|head|lead|director|manager|controller|accountant|analyst|architect|building|i\s+build|i\s+run|running|i\s+own)`;
const SITE = String.raw`(https?:\/\/[^\s<>"')\]]+|(?:[a-z0-9-]+\.)+[a-z]{2,24})`;
const ROLE_SITE = new RegExp(`\\b${ROLE}\\b[^.\\n]{0,40}?(?:\\bat\\b|\\bof\\b|@|\\bon\\b|:)?\\s*${SITE}`, "i");
const EMAIL = /\b[a-z0-9._%+-]+@((?:[a-z0-9-]+\.)+[a-z]{2,24})\b/i;

/** A Hacker News "about" field (HTML) → the company it names, with the words that show it. */
export function aboutCompany(aboutHtml: string | null | undefined, source = "Hacker News"): IntentCompany | undefined {
  const about = decodeEntities((aboutHtml ?? "").replace(/<a\s[^>]*href="([^"]+)"[^>]*>[^<]*<\/a>/gi, " $1 ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  if (!about) return undefined;
  const mail = about.match(EMAIL);
  const mailDomain = mail ? normalizeDomain(mail[1]) : null;
  if (mailDomain && !isPersonalDomain(mailDomain)) {
    return { name: nameFromDomain(mailDomain), domain: mailDomain, basis: "profile_email", evidence: `${source} profile lists an email at ${mailDomain}` };
  }
  const role = about.match(ROLE_SITE);
  const siteDomain = role ? normalizeDomain(role[1]) : null;
  if (siteDomain && !isPersonalDomain(siteDomain) && /\.[a-z]{2,}$/.test(siteDomain)) {
    const phrase = role![0].trim().slice(0, 90);
    return { name: nameFromDomain(siteDomain), domain: siteDomain, basis: "profile_site", evidence: `${source} profile: “${phrase}”` };
  }
  return undefined;
}

/** "fernwick.example" → "Fernwick". Only a display name until the account has a real one. */
export function nameFromDomain(domain: string): string {
  const stem = domain.split(".")[0] ?? domain;
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(inc|llc|ltd|corp|corporation|co|gmbh|plc|sa|bv|hq|the|labs?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The workspace account a domain or a company name points at: by domain (or a subdomain of it), else by exact name. */
export function matchAccount(accounts: Record<string, Pick<Account, "domain" | "name" | "status">>, q: { domain?: string; name?: string }): string | undefined {
  const d = q.domain ? normalizeDomain(q.domain) : null;
  if (d) {
    if (accounts[d]) return d;
    const parent = Object.keys(accounts).find((a) => d.endsWith(`.${a}`));
    if (parent) return parent;
  }
  const n = q.name ? normalizeCompany(q.name) : "";
  if (n.length >= 3) return Object.values(accounts).find((a) => normalizeCompany(a.name) === n)?.domain;
  return undefined;
}
