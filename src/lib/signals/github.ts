import "server-only";
import { apiFetch, intentMockBase } from "@/lib/intent/http";
import { readSettings } from "@/lib/store/settings";
import { TTL, cached } from "./cache";
import { politeGate } from "./gate";
import { API_UA, fetchText, toDomain } from "./http";

/**
 * GitHub's REST API, free: an org's public repos and members, who starred a repo you administer (a developer-tool
 * founder's warmest list), and the public activity on any repo (forks, issues, pull requests, comments) for the
 * developer radar. Without a token GitHub allows 60 requests an hour per IP (10 searches a minute); with the
 * optional token from Settings, 5,000 (30 searches a minute).
 * https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
 *
 * Since July 2026 GitHub lists a repository's stargazers only to its admins and collaborators; anyone else gets
 * weekly star counts (GET /repos/{repo}/stargazers/history), never who starred.
 * https://docs.github.com/en/rest/activity/starring
 *
 * The remaining budget is read from every response's x-ratelimit-* headers and kept per process and per bucket
 * (core, search, graphql), so a long import stops cleanly at the limit (rateLimited) instead of failing request
 * by request.
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

type Bucket = "core" | "search" | "graphql";

interface Budget {
  remaining?: number;
  resetAt?: number;
}

function budget(bucket: Bucket = "core"): Budget {
  const g = globalThis as unknown as { __inroadGithub?: Partial<Record<Bucket, Budget>> };
  g.__inroadGithub ??= {};
  return (g.__inroadGithub[bucket] ??= {});
}

const bucketOf = (path: string): Bucket => (path.startsWith("/search/") ? "search" : path === "/graphql" ? "graphql" : "core");

/** The cache key of a GitHub user or org profile. */
export const githubOwnerKey = (login: string) => `gh:owner:${login.toLowerCase()}`;

/** Tests start with a fresh budget. */
export function resetGithubBudget() {
  (globalThis as unknown as { __inroadGithub?: unknown }).__inroadGithub = {};
}

export function hasGithubToken(): boolean {
  return Boolean(readSettings().githubToken?.trim());
}

/** What's left in a bucket this hour (or minute, for search), when GitHub has said. */
export function githubBudget(bucket: Bucket = "core"): { remaining?: number; resetAt?: number } {
  return { ...budget(bucket) };
}

function headers(accept = "application/vnd.github+json"): Record<string, string> {
  const token = readSettings().githubToken?.trim();
  return { "User-Agent": API_UA, "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: accept };
}

type Got<T> = { data: T | null; rateLimited: boolean; status?: number };

async function get<T>(path: string, accept?: string): Promise<Got<T>> {
  const b = budget(bucketOf(path));
  const reserve = bucketOf(path) === "search" ? 1 : RESERVE;
  if (b.remaining !== undefined && b.remaining <= reserve && b.resetAt && Date.now() < b.resetAt) return { data: null, rateLimited: true };
  await politeGate("github");
  const h = headers(accept);
  const res = await apiFetch(`${API}${path}`, {
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
    return { data: null, rateLimited: true, status: res.status };
  }
  if (res.status < 200 || res.status >= 300) return { data: null, rateLimited: false, status: res.status };
  try {
    return { data: JSON.parse(res.body) as T, rateLimited: false, status: res.status };
  } catch {
    return { data: null, rateLimited: false, status: res.status };
  }
}

/** Cached GET: a hit costs no budget. Failures and rate limits aren't cached. */
async function cachedGet<T>(key: string, ttl: number, path: string, accept?: string): Promise<Got<T> & { cached: boolean }> {
  let limited = false;
  let status: number | undefined;
  let fetched = false;
  try {
    const data = await cached<T | null>(key, ttl, async () => {
      fetched = true;
      const r = await get<T>(path, accept);
      limited = r.rateLimited;
      status = r.status;
      return r.data;
    });
    return { data: data ?? null, rateLimited: limited, cached: !fetched, ...(status !== undefined ? { status } : {}) };
  } catch {
    return { data: null, rateLimited: limited, cached: false };
  }
}

/** Asks GitHub whether a token works (GET /rate_limit costs nothing). "unknown" when GitHub can't be reached. */
export async function checkGithubToken(token: string): Promise<"ok" | "bad" | "unknown"> {
  const res = await fetchText(`${API}/rate_limit`, {
    timeoutMs: 8000,
    accept: "application/vnd.github+json",
    headers: { "User-Agent": API_UA, "X-GitHub-Api-Version": "2022-11-28", Authorization: `Bearer ${token}` },
    allowErrors: true,
  });
  if (!res) return "unknown";
  if (res.status === 401) return "bad";
  return res.status >= 200 && res.status < 300 ? "ok" : "unknown";
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
  const owner = await cachedGet<RawOwner>(githubOwnerKey(login), TTL.week, `/users/${login}`);
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

/* ─────────────────────────── People: where a profile says they work ─────────────────────────── */

const PERSONAL = /(^|\.)(github\.io|gitlab\.io|medium\.com|substack\.com|linktr\.ee|about\.me|dev\.to|hashnode\.dev|wordpress\.com|blogspot\.com|vercel\.app|netlify\.app|pages\.dev|linkedin\.com|twitter\.com|x\.com|bsky\.app|mastodon\.social|youtube\.com|notion\.site|carrd\.co)$/i;
const FREE_MAIL = /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|mac|proton|protonmail|pm|aol|gmx|hey|fastmail|yandex|qq|163|126)\./i;

const squash = (s: string) => s.toLowerCase().replace(/\b(inc|llc|ltd|corp|co|hq|labs?|the)\b/g, "").replace(/[^a-z0-9]/g, "");

/**
 * Where someone works, as a domain, when the profile says so plainly: an "@org" in the company field (at the start,
 * or after a role: "Backend Engineer @acme") whose org lists its site, a site that matches the company name, or a
 * work email. Never a personal site.
 */
async function companyDomain(p: RawOwner): Promise<Pick<Stargazer, "domain" | "domainBasis"> & { rateLimited?: boolean }> {
  const company = p.company?.trim() ?? "";
  const handle = company.match(/^@([a-z\d][a-z\d-]{0,38})\b/i)?.[1] ?? company.match(/(?:^|\s)@([a-z\d][a-z\d-]{0,38})\b/i)?.[1];
  if (handle) {
    const org = await cachedGet<RawOwner>(githubOwnerKey(handle), TTL.week, `/users/${handle}`);
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

export interface GithubPerson extends Omit<Stargazer, "starredAt"> {
  type?: string;
  rateLimited?: boolean;
  /** No network request was made: the profile (and its org) came from the cache. */
  cached?: boolean;
}

/** A user's public profile and the company it places them at. Cached for four weeks. */
export async function githubPerson(login: string): Promise<GithubPerson | null> {
  if (!LOGIN.test(login)) return null;
  const p = await cachedGet<RawOwner>(githubOwnerKey(login), 4 * TTL.week, `/users/${login}`);
  if (!p.data) return p.rateLimited ? { login, url: `https://github.com/${login}`, rateLimited: true } : null;
  const profile = p.data;
  // An organization (one that forked the repo) is the company itself: its own site places it.
  const orgSite = profile.type === "Organization" && profile.blog ? toDomain(profile.blog) : null;
  const where: Pick<Stargazer, "domain" | "domainBasis"> & { rateLimited?: boolean } =
    orgSite && !PERSONAL.test(orgSite) ? { domain: orgSite, domainBasis: "company_org" } : await companyDomain(profile);
  return {
    login: profile.login ?? login,
    url: profile.html_url ?? `https://github.com/${login}`,
    ...(profile.type ? { type: profile.type } : {}),
    ...(profile.name ? { name: profile.name.slice(0, 80) } : {}),
    ...(profile.company ? { company: profile.company.replace(/^@/, "").trim().slice(0, 80) } : {}),
    ...(profile.blog ? { blog: profile.blog.slice(0, 200) } : {}),
    ...(profile.location ? { location: profile.location.slice(0, 80) } : {}),
    ...(profile.email ? { email: profile.email.toLowerCase().slice(0, 254) } : {}),
    ...(where.domain ? { domain: where.domain, domainBasis: where.domainBasis } : {}),
    ...(where.rateLimited ? { rateLimited: true } : {}),
    ...(p.cached ? { cached: true } : {}),
  };
}

/* ─────────────────────────── Stargazers ─────────────────────────── */

interface RawStar {
  starred_at?: string;
  user?: RawOwner;
}

const REPO = /^([a-z\d][a-z\d-]{0,38})\/([\w.-]{1,100})$/i;
const repoName = (repo: string) =>
  repo
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$|\/$/g, "")
    .match(REPO);

/**
 * The most recent stargazers of `owner/name` with their public profiles (company, site, location).
 * Profiles are cached for a month, so a re-import only pays for new stars. `restricted` means GitHub refused the
 * list: since July 2026 only the repo's admins and collaborators can see it, with a token from such an account.
 */
export async function githubStargazers(
  repo: string,
  opts: { maxProfiles?: number } = {},
): Promise<{ repo: string; total: number; stargazers: Stargazer[]; rateLimited: boolean; restricted?: boolean } | null> {
  const m = repoName(repo);
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
  let restricted = false;
  for (let page = lastPage; page >= 1 && stars.length < max; page--) {
    const r = await get<RawStar[]>(`/repos/${full}/stargazers?per_page=100&page=${page}`, "application/vnd.github.star+json");
    if (r.rateLimited) {
      limited = true;
      break;
    }
    if (r.status === 401 || r.status === 403 || r.status === 404) {
      restricted = !stars.length;
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
    const p = await cachedGet<RawOwner>(githubOwnerKey(login), 4 * TTL.week, `/users/${login}`);
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
  return { repo: meta.data.full_name ?? full, total, stargazers: out, rateLimited: limited, ...(restricted ? { restricted } : {}) };
}

/* ─────────────────────────── Developer radar: public activity on any repo ─────────────────────────── */

export interface GithubRepoMeta {
  full: string;
  url: string;
  stars: number;
  description?: string;
  owner: string;
  ownerType?: string;
}

/** A public repo's name, stars and owner. Cached for a day. */
export async function githubRepoMeta(repo: string): Promise<(GithubRepoMeta & { rateLimited?: boolean }) | null> {
  const m = repoName(repo);
  if (!m) return null;
  const full = `${m[1]}/${m[2]}`;
  const r = await cachedGet<{ full_name?: string; html_url?: string; stargazers_count?: number; description?: string | null; owner?: { login?: string; type?: string } }>(
    `gh:repo:${full.toLowerCase()}`,
    TTL.day,
    `/repos/${full}`,
  );
  if (!r.data) return r.rateLimited ? { full, url: `https://github.com/${full}`, stars: 0, owner: m[1], rateLimited: true } : null;
  return {
    full: r.data.full_name ?? full,
    url: r.data.html_url ?? `https://github.com/${full}`,
    stars: r.data.stargazers_count ?? 0,
    ...(r.data.description ? { description: r.data.description.slice(0, 200) } : {}),
    owner: r.data.owner?.login ?? m[1],
    ...(r.data.owner?.type ? { ownerType: r.data.owner.type } : {}),
  };
}

export interface RepoActivityRaw {
  forks: unknown;
  issues: unknown;
  comments: unknown;
  history: unknown;
  discussions?: unknown;
  rateLimited: boolean;
  /** Requests that went to GitHub (cache misses). */
  requests: number;
}

/**
 * The newest forks, issues and pull requests, issue comments since `since`, and the weekly star counts of a public
 * repo: four requests, each cached for an hour. With a token, the newest discussions too (GraphQL needs one).
 */
export async function githubRepoActivity(full: string, since: string): Promise<RepoActivityRaw> {
  const key = full.toLowerCase();
  const hour = TTL.hour;
  const sinceHour = since.slice(0, 13);
  const calls = await Promise.all([
    cachedGet<unknown[]>(`gh:forks:${key}`, hour, `/repos/${full}/forks?sort=newest&per_page=100`),
    cachedGet<unknown[]>(`gh:issues:${key}`, hour, `/repos/${full}/issues?state=all&sort=created&direction=desc&per_page=100`),
    cachedGet<unknown[]>(`gh:comments:${key}:${sinceHour}`, hour, `/repos/${full}/issues/comments?sort=created&direction=desc&per_page=100&since=${encodeURIComponent(since)}`),
    cachedGet<unknown[]>(`gh:stars:${key}`, hour * 6, `/repos/${full}/stargazers/history`),
  ]);
  let discussions: unknown;
  let discussionRequest = 0;
  const token = readSettings().githubToken?.trim();
  if (token) {
    const [owner, name] = full.split("/");
    discussions = await cached(`gh:discussions:${key}`, hour, async () => {
      discussionRequest = 1;
      return githubDiscussions(owner, name, token).catch(() => null);
    }).catch(() => null);
  }
  return {
    forks: calls[0].data,
    issues: calls[1].data,
    comments: calls[2].data,
    history: calls[3].data,
    ...(discussions ? { discussions } : {}),
    rateLimited: calls.some((c) => c.rateLimited),
    requests: calls.filter((c) => !c.cached).length + discussionRequest,
  };
}

const DISCUSSIONS = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){discussions(first:50,orderBy:{field:CREATED_AT,direction:DESC}){nodes{title url createdAt bodyText authorAssociation author{login}}}}}`;

/** GraphQL needs a POST, and the guarded fetch only GETs: discussions go through the connectors' request runner. */
async function githubDiscussions(owner: string, name: string, token: string): Promise<unknown> {
  const { request } = await import("@/lib/connectors/http");
  const mock = intentMockBase();
  const res = await request<unknown>({
    tool: "GitHub",
    method: "POST",
    url: mock ? `${mock}/gh/graphql` : `${API}/graphql`,
    headers: { ...headers("application/json"), Authorization: `Bearer ${token}` },
    body: { query: DISCUSSIONS, variables: { owner, name } },
    timeoutMs: 10_000,
    retries: 0,
    secrets: [token],
  });
  return res.ok ? res.value : null;
}

/* ─────────────────────────── Search ─────────────────────────── */

export interface IssueSearch {
  data: unknown;
  rateLimited: boolean;
  cached: boolean;
}

/** GET /search/issues: issues (never pull requests) matching `q`, newest first. Cached for an hour. */
export async function githubSearchIssues(q: string): Promise<IssueSearch> {
  const path = `/search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=20`;
  const r = await cachedGet<unknown>(`gh:search:${q.toLowerCase()}`, TTL.hour, path);
  return { data: r.data, rateLimited: r.rateLimited, cached: r.cached };
}

/** GET /search/repositories, most stars first. Cached for a day. */
export async function githubSearchRepos(q: string, perPage = 3): Promise<{ full: string; url: string; stars: number; description?: string; ownerLogin: string }[]> {
  const r = await cachedGet<{ items?: { full_name?: string; html_url?: string; stargazers_count?: number; description?: string | null; owner?: { login?: string } }[] }>(
    `gh:repos-search:${q.toLowerCase()}:${perPage}`,
    TTL.day,
    `/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${perPage}`,
  );
  return (r.data?.items ?? []).flatMap((i) =>
    i.full_name && i.html_url
      ? [{ full: i.full_name, url: i.html_url, stars: i.stargazers_count ?? 0, ...(i.description ? { description: i.description.slice(0, 160) } : {}), ownerLogin: i.owner?.login ?? i.full_name.split("/")[0] }]
      : [],
  );
}
