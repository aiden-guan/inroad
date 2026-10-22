import "server-only";
import { readSettings } from "@/lib/store/settings";
import { TTL, cached } from "./cache";
import { politeGate } from "./gate";
import { API_UA, fetchText, toDomain } from "./http";

/**
 * GitHub's REST API, free: an org's public repos and members, and who starred a repo (a developer-tool
 * founder's warmest list). Without a token GitHub allows 60 requests an hour per IP, so at most about 50
 * profiles an hour; with the optional token from Settings, 5,000.
 * https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
 *
 * The remaining budget is read from every response's x-ratelimit-* headers and kept per process, so
 * a long import stops cleanly at the limit (rateLimited) instead of failing request by request.
 */

const API = "https://api.github.com";
/** Requests kept back for the founder's next lookup when the budget runs low. */
const RESERVE = 3;

export interface GithubRepo {
  name: string;
  stars: number;
  language?: string;
  pushedAt: string;
  url: string;
  description?: string;
}

export interface GithubOrg {
  org: string;
  name?: string;
  /** The website the org lists, as a domain. */
  domain?: string;
  repos: GithubRepo[];
  publicMembers: { login: string; url: string }[];
  rateLimited: boolean;
}

export interface Stargazer {
  login: string;
  url: string;
  name?: string;
  company?: string;
  blog?: string;
  location?: string;
  email?: string;
  starredAt?: string;
  /** The company's domain when it can be told: from "@org" in the company field, or a site that matches the company name. */
  domain?: string;
  domainBasis?: "company_org" | "company_site" | "email";
}

interface Budget {
  remaining?: number;
  resetAt?: number;
}

function budget(): Budget {
  const g = globalThis as unknown as { __inroadGithub?: Budget };
  g.__inroadGithub ??= {};
  return g.__inroadGithub;
}

/** Tests start with a fresh budget. */
export function resetGithubBudget() {
  (globalThis as unknown as { __inroadGithub?: Budget }).__inroadGithub = {};
}

export function hasGithubToken(): boolean {
  return Boolean(readSettings().githubToken?.trim());
}

function headers(accept = "application/vnd.github+json"): Record<string, string> {
  const token = readSettings().githubToken?.trim();
  return { "User-Agent": API_UA, "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: accept };
}

type Got<T> = { data: T | null; rateLimited: boolean };

async function get<T>(path: string, accept?: string): Promise<Got<T>> {
  const b = budget();
  if (b.remaining !== undefined && b.remaining <= RESERVE && b.resetAt && Date.now() < b.resetAt) return { data: null, rateLimited: true };
  await politeGate("github");
  const h = headers(accept);
  const res = await fetchText(`${API}${path}`, {
    timeoutMs: 10_000,
    maxBytes: 3_000_000,
    accept: h.Accept,
    headers: h,
    allowErrors: true,
    responseHeaders: ["x-ratelimit-remaining", "x-ratelimit-reset"],
  });
  if (!res) return { data: null, rateLimited: false };
  const remaining = res.headers?.["x-ratelimit-remaining"];
  const reset = res.headers?.["x-ratelimit-reset"];
  if (remaining !== undefined && /^\d+$/.test(remaining)) b.remaining = Number(remaining);
  if (reset !== undefined && /^\d+$/.test(reset)) b.resetAt = Number(reset) * 1000;
  if ((res.status === 403 || res.status === 429) && (remaining === "0" || /rate limit/i.test(res.body))) {
    b.remaining = 0;
    b.resetAt ??= Date.now() + TTL.hour;
    return { data: null, rateLimited: true };
  }
  if (res.status < 200 || res.status >= 300) return { data: null, rateLimited: false };
  try {
    return { data: JSON.parse(res.body) as T, rateLimited: false };
  } catch {
    return { data: null, rateLimited: false };
  }
}

/** Cached GET: a hit costs no budget. Failures and rate limits aren't cached. */
async function cachedGet<T>(key: string, ttl: number, path: string, accept?: string): Promise<Got<T>> {
  let limited = false;
  try {
    const data = await cached<T | null>(key, ttl, async () => {
      const r = await get<T>(path, accept);
      limited = r.rateLimited;
      return r.data;
    });
    return { data: data ?? null, rateLimited: limited };
  } catch {
    return { data: null, rateLimited: limited };
  }
}

/* ─────────────────────────── Orgs ─────────────────────────── */

interface RawOwner {
  login: string;
  type?: string;
  name?: string | null;
  blog?: string | null;
  company?: string | null;
  location?: string | null;
  email?: string | null;
  html_url?: string;
}
interface RawRepo {
  name: string;
  html_url: string;
  stargazers_count?: number;
  language?: string | null;
  pushed_at?: string;
  description?: string | null;
  fork?: boolean;
  archived?: boolean;
}

const LOGIN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;

export async function githubOrg(org: string): Promise<GithubOrg | null> {
  const login = org.trim().replace(/^@/, "");
  if (!LOGIN.test(login)) return null;
  const owner = await cachedGet<RawOwner>(`gh:owner:${login.toLowerCase()}`, TTL.week, `/users/${login}`);
  if (!owner.data) return owner.rateLimited ? { org: login, repos: [], publicMembers: [], rateLimited: true } : null;
  const isOrg = owner.data.type === "Organization";
  const repos = await cachedGet<RawRepo[]>(`gh:repos:${login.toLowerCase()}`, TTL.day, `/${isOrg ? "orgs" : "users"}/${login}/repos?sort=pushed&per_page=30`);
  const members = isOrg ? await cachedGet<RawOwner[]>(`gh:members:${login.toLowerCase()}`, TTL.week, `/orgs/${login}/public_members?per_page=30`) : { data: [], rateLimited: false };
  return {
    org: owner.data.login,
    ...(owner.data.name ? { name: owner.data.name } : {}),
    ...(owner.data.blog && toDomain(owner.data.blog) ? { domain: toDomain(owner.data.blog)! } : {}),
    repos: (Array.isArray(repos.data) ? repos.data : [])
      .filter((r) => !r.fork && !r.archived)
      .map((r) => ({
        name: r.name,
        stars: r.stargazers_count ?? 0,
        ...(r.language ? { language: r.language } : {}),
        pushedAt: r.pushed_at ?? "",
        url: r.html_url,
        ...(r.description ? { description: r.description.slice(0, 160) } : {}),
      }))
      .sort((a, b) => b.stars - a.stars)
      .slice(0, 12),
    publicMembers: (Array.isArray(members.data) ? members.data : []).slice(0, 30).map((m) => ({ login: m.login, url: m.html_url ?? `https://github.com/${m.login}` })),
    rateLimited: repos.rateLimited || members.rateLimited,
  };
}

/** One line for a prompt or a screening card: "42 public repos · top: acme-sdk (1.2k★, TypeScript) · pushed Oct 12". */
export function orgLine(o: GithubOrg): string {
  const top = o.repos[0];
  const stars = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k★` : `${n}★`);
  const pushed = o.repos.map((r) => r.pushedAt).sort().pop();
  return [
    `GitHub ${o.org}: ${o.repos.length} public repos`,
    top ? `top: ${top.name} (${stars(top.stars)}${top.language ? `, ${top.language}` : ""})` : null,
    pushed ? `pushed ${pushed.slice(0, 10)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/* ─────────────────────────── Stargazers ─────────────────────────── */

const PERSONAL = /(^|\.)(github\.io|gitlab\.io|medium\.com|substack\.com|linktr\.ee|about\.me|dev\.to|hashnode\.dev|wordpress\.com|blogspot\.com|vercel\.app|netlify\.app|pages\.dev|linkedin\.com|twitter\.com|x\.com|bsky\.app|mastodon\.social|youtube\.com|notion\.site|carrd\.co)$/i;
const FREE_MAIL = /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|mac|proton|protonmail|pm|aol|gmx|hey|fastmail|yandex|qq|163|126)\./i;

const squash = (s: string) => s.toLowerCase().replace(/\b(inc|llc|ltd|corp|co|hq|labs?|the)\b/g, "").replace(/[^a-z0-9]/g, "");

/** Where a stargazer works, as a domain, when the profile says so plainly. Never a personal site. */
async function companyDomain(p: RawOwner): Promise<Pick<Stargazer, "domain" | "domainBasis"> & { rateLimited?: boolean }> {
  const company = p.company?.trim() ?? "";
  const handle = company.match(/^@([a-z\d][a-z\d-]{0,38})\b/i)?.[1];
  if (handle) {
    const org = await cachedGet<RawOwner>(`gh:owner:${handle.toLowerCase()}`, TTL.week, `/users/${handle}`);
    const d = org.data?.type === "Organization" && org.data.blog ? toDomain(org.data.blog) : null;
    if (d && !PERSONAL.test(d)) return { domain: d, domainBasis: "company_org" };
    if (org.rateLimited) return { rateLimited: true };
  }
  const blog = p.blog ? toDomain(p.blog) : null;
  const name = squash(company.replace(/^@/, ""));
  if (blog && !PERSONAL.test(blog) && name.length >= 3) {
    const stem = squash(blog.split(".")[0]);
    if (stem === name || (stem.length >= 4 && (stem.includes(name) || name.includes(stem)))) return { domain: blog, domainBasis: "company_site" };
  }
  const mail = p.email?.split("@")[1]?.toLowerCase();
  if (mail && !FREE_MAIL.test(mail) && !PERSONAL.test(mail) && (!name || squash(mail.split(".")[0]) === name)) return { domain: mail, domainBasis: "email" };
  return {};
}

interface RawStar {
  starred_at?: string;
  user?: RawOwner;
}

/**
 * The most recent stargazers of `owner/name` with their public profiles (company, site, location).
 * Profiles are cached for a month, so a re-import only pays for new stars.
 */
export async function githubStargazers(repo: string, opts: { maxProfiles?: number } = {}): Promise<{ repo: string; total: number; stargazers: Stargazer[]; rateLimited: boolean } | null> {
  const m = repo.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$|\/$/g, "").match(/^([a-z\d][a-z\d-]{0,38})\/([\w.-]{1,100})$/i);
  if (!m) return null;
  const full = `${m[1]}/${m[2]}`;
  const max = Math.min(opts.maxProfiles ?? (hasGithubToken() ? 300 : 50), 500);
  const meta = await get<{ full_name?: string; stargazers_count?: number }>(`/repos/${full}`);
  if (!meta.data) return meta.rateLimited ? { repo: full, total: 0, stargazers: [], rateLimited: true } : null;
  const total = meta.data.stargazers_count ?? 0;
  // GitHub lists the oldest stars first; the newest are on the last pages.
  const lastPage = Math.max(1, Math.min(400, Math.ceil(total / 100)));
  const stars: RawStar[] = [];
  let limited = false;
  for (let page = lastPage; page >= 1 && stars.length < max; page--) {
    const r = await get<RawStar[]>(`/repos/${full}/stargazers?per_page=100&page=${page}`, "application/vnd.github.star+json");
    if (r.rateLimited) {
      limited = true;
      break;
    }
    if (!Array.isArray(r.data) || !r.data.length) break;
    stars.push(...[...r.data].reverse());
  }
  const out: Stargazer[] = [];
  for (const s of stars.slice(0, max)) {
    const login = s.user?.login;
    if (!login || limited) {
      if (login) out.push({ login, url: s.user?.html_url ?? `https://github.com/${login}`, ...(s.starred_at ? { starredAt: s.starred_at } : {}) });
      continue;
    }
    const p = await cachedGet<RawOwner>(`gh:owner:${login.toLowerCase()}`, 4 * TTL.week, `/users/${login}`);
    if (p.rateLimited) limited = true;
    const profile = p.data ?? s.user!;
    const where = p.data ? await companyDomain(p.data) : {};
    if (where.rateLimited) limited = true;
    out.push({
      login,
      url: profile.html_url ?? `https://github.com/${login}`,
      ...(profile.name ? { name: profile.name.slice(0, 80) } : {}),
      ...(profile.company ? { company: profile.company.replace(/^@/, "").trim().slice(0, 80) } : {}),
      ...(profile.blog ? { blog: profile.blog.slice(0, 200) } : {}),
      ...(profile.location ? { location: profile.location.slice(0, 80) } : {}),
      ...(profile.email ? { email: profile.email.toLowerCase().slice(0, 254) } : {}),
      ...(s.starred_at ? { starredAt: s.starred_at } : {}),
      ...(where.domain ? { domain: where.domain, domainBasis: where.domainBasis } : {}),
    });
  }
  return { repo: meta.data.full_name ?? full, total, stargazers: out, rateLimited: limited };
}
