import "server-only";
import { AgentError } from "@/lib/ai/errors";
import { recordOperation } from "@/lib/automation/store";
import type { Workspace } from "@/lib/domain/types";
import { normalizeDomain } from "@/lib/hub/records";
import { githubOrg, githubPerson, githubRepoActivity, githubRepoMeta, githubSearchRepos, hasGithubToken } from "@/lib/signals/github";
import type { WorkflowContext } from "@/lib/workflows/types";
import { intentProfile } from "./profile";
import { aggregateRadar, capPeople, parseDiscussions, parseForks, parseRepoComments, parseRepoInput, parseRepoIssues, peopleFrom, radarSummary, starsInWindow, type RawActivity } from "./radar-model";
import { isPersonalDomain, matchAccount } from "./resolve";
import { emptyIntent, type RadarRepo, type RadarState, type RadarSuggestion } from "./types";

/**
 * Developer radar, the network half: for up to five repos, GitHub's public activity in the window (four requests
 * a repo, cached for an hour), then each active person's public profile (cached for four weeks) until the hourly
 * budget's reserve, issue and discussion authors first. Zero tokens.
 */

export const RADAR_WINDOW = 30;

type Ctx = WorkflowContext<{ mode: "asks" | "radar"; repos?: string[]; windowDays?: number }>;

export async function runRadarScan(ctx: Ctx): Promise<{ companies: number; people: number; placed: number; requests: number }> {
  const started = Date.now();
  const repos = parseRepoInput((ctx.args.repos ?? []).join("\n"));
  if (!repos.length) throw new AgentError("Paste at least one public GitHub repository, like getlago/lago.", "bad_request");
  const windowDays = ctx.args.windowDays ?? RADAR_WINDOW;
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const ws = ctx.read();
  const profile = intentProfile(ws);
  const withToken = hasGithubToken();
  let requests = 0;
  let rateLimited = false;
  const warnings: string[] = [];
  const rows: RadarRepo[] = [];
  const raw: RawActivity[] = [];
  const ownerDomains: string[] = [];

  for (const full of repos) {
    ctx.signal.throwIfAborted();
    ctx.emit({ type: "search", query: `GitHub: activity on ${full}` });
    const meta = await githubRepoMeta(full);
    if (!meta) {
      rows.push({ full, url: `https://github.com/${full}`, error: "Not found. It has to be a public repository." });
      continue;
    }
    if (meta.rateLimited) {
      rateLimited = true;
      rows.push({ full, url: meta.url, error: "GitHub's hourly limit ran out before this one." });
      continue;
    }
    const owner = await githubOrg(meta.owner).catch(() => null);
    const ownerDomain = owner?.domain && !isPersonalDomain(owner.domain) ? owner.domain : undefined;
    if (ownerDomain) ownerDomains.push(ownerDomain);
    const act = await githubRepoActivity(meta.full, since);
    requests += act.requests + 1;
    if (act.rateLimited) rateLimited = true;
    const sinceMs = Date.parse(since);
    raw.push(
      ...parseForks(act.forks, meta.full, sinceMs),
      ...parseRepoIssues(act.issues, meta.full, sinceMs),
      ...parseRepoComments(act.comments, meta.full, sinceMs),
      ...(act.discussions ? parseDiscussions(act.discussions, meta.full, sinceMs) : []),
    );
    rows.push({
      full: meta.full,
      url: meta.url,
      stars: meta.stars,
      ...(starsInWindow(act.history, Date.now(), windowDays) !== undefined ? { starsLast30: starsInWindow(act.history, Date.now(), windowDays) } : {}),
      ...(meta.description ? { description: meta.description } : {}),
      ...(ownerDomain ? { ownerDomain } : {}),
    });
  }
  if (!rows.some((r) => !r.error)) throw new AgentError(rows[0]?.error ?? "None of those repositories could be read.", "bad_request");

  let people = peopleFrom(raw, profile);
  ctx.emit({ type: "action", text: `${people.length} ${people.length === 1 ? "person" : "people"} forked, filed or commented in the last ${windowDays} days` });

  // Profiles: issue and discussion authors first (they wrote down a need), then pull requests, comments, forks.
  const rank = (kind: string) => ({ issue: 0, discussion: 0, pull: 1, comment: 2, fork: 3 })[kind] ?? 4;
  people.sort((a, b) => Math.min(...a.activity.map((x) => rank(x.kind))) - Math.min(...b.activity.map((x) => rank(x.kind))));
  const cap = withToken ? 150 : 35;
  let read = 0;
  if (people.length) ctx.emit({ type: "status", text: `Reading up to ${Math.min(cap, people.length)} public GitHub profiles` });
  for (let i = 0; i < Math.min(cap, people.length) && !rateLimited; i++) {
    ctx.signal.throwIfAborted();
    const p = people[i];
    const prof = await githubPerson(p.login).catch(() => null);
    if (!prof) continue;
    if (prof.rateLimited) {
      rateLimited = true;
      break;
    }
    read++;
    if (!prof.cached) requests++;
    const domain = prof.domain ? normalizeDomain(prof.domain) : null;
    people[i] = {
      ...p,
      ...(prof.name ? { name: prof.name } : {}),
      ...(prof.company ? { company: prof.company } : {}),
      ...(domain && !isPersonalDomain(domain) ? { domain, basis: prof.domainBasis } : {}),
    };
  }
  ctx.noteFreeSignals(requests);
  if (rateLimited) warnings.push(withToken ? "GitHub's hourly limit stopped me early; the rest come in the next run." : "GitHub allows 60 requests an hour without a token, so some profiles weren't read. Add a token in Settings → General for 5,000.");

  const own = ws.company?.domain?.toLowerCase();
  const competitorDomains = (ws.foundation?.competitors ?? []).map((c) => c.domain?.toLowerCase()).filter(Boolean) as string[];
  const exclude = [...new Set([...ownerDomains, ...competitorDomains, ...(own ? [own] : [])])];
  // The maintainers' own people (and the founder's) are neither engaged buyers nor placeable leads.
  const staff = (d?: string) => !!d && exclude.some((x) => d === x || d.endsWith(`.${x}`));
  people = people.filter((p) => !staff(p.domain));
  const names = Object.fromEntries(
    people.flatMap((p) => {
      const d = p.domain ? matchAccount(ws.accounts, { domain: p.domain }) : undefined;
      return d && ws.accounts[d] ? [[p.domain!, ws.accounts[d].name]] : [];
    }),
  );
  const companies = aggregateRadar(people, { windowDays, profile, exclude, names });
  const radar: RadarState = {
    repos: rows,
    windowDays,
    at: new Date().toISOString(),
    people: capPeople(people),
    companies,
    totals: { engaged: people.length, profilesRead: read, placed: people.filter((p) => p.domain).length, rateLimited, withToken },
    requests,
    warnings,
    durationMs: Date.now() - started,
    runId: ctx.runId,
  };
  await ctx.mutate((draft) => {
    draft.intent = { ...(draft.intent ?? emptyIntent()), radar };
  });
  await recordOperation({
    kind: "fetch",
    provider: "GitHub",
    query: `Developer radar: ${rows.map((r) => r.full).join(", ")}`.slice(0, 1000),
    durationMs: Date.now() - started,
    resultCount: people.length,
    requests,
    cached: requests === 0,
    costUsd: 0,
  }).catch(() => undefined);
  const known = companies.filter((c) => matchAccount(ws.accounts, { domain: c.domain })).length;
  ctx.emit({ type: "status", text: radarSummary(radar, known) });
  return { companies: companies.length, people: people.length, placed: radar.totals.placed, requests };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, "");

/**
 * Repositories worth watching, from the competitors in the playbook: the competitor's own GitHub org when its
 * website matches the competitor's domain (verified), else the most-starred repository named after it (to check).
 */
export async function repoSuggestions(ws: Workspace): Promise<RadarSuggestion[]> {
  const out: RadarSuggestion[] = [];
  const competitors = [
    ...(ws.foundation?.competitors ?? []).map((c) => ({ name: c.name, domain: c.domain })),
    ...(ws.foundation?.positioning.alternatives ?? []).filter((a) => a.kind === "competitor").map((a) => ({ name: a.name, domain: a.domain })),
  ]
    .filter((c, i, all) => c.name && all.findIndex((x) => x.name.toLowerCase() === c.name.toLowerCase()) === i)
    .slice(0, 3);
  for (const c of competitors) {
    const domain = c.domain ? normalizeDomain(c.domain) : null;
    const logins = [...new Set([slug(c.name), ...(domain ? [slug(domain.split(".")[0])] : [])])].filter((l) => /^[a-z\d][a-z\d-]{0,38}$/.test(l));
    let found = false;
    for (const login of logins) {
      const org = await githubOrg(login).catch(() => null);
      if (!org || org.rateLimited || !org.repos.length) continue;
      const verified = !!domain && !!org.domain && (org.domain === domain || org.domain.endsWith(`.${domain}`) || domain.endsWith(`.${org.domain}`));
      if (!verified && domain) continue;
      for (const r of org.repos.slice(0, 2)) {
        out.push({ full: `${org.org}/${r.name}`, url: r.url, stars: r.stars, why: verified ? `${c.name}'s own repository (their site, ${org.domain}, is on the org)` : `Under the GitHub org “${org.org}”; check it's ${c.name}'s`, verified });
      }
      found = true;
      break;
    }
    if (!found && !domain) {
      const hit = (await githubSearchRepos(`${c.name} in:name`, 1).catch(() => []))[0];
      if (hit) out.push({ full: hit.full, url: hit.url, stars: hit.stars, why: `Most-starred repository named “${c.name}”; check it's theirs`, verified: false });
    }
  }
  return out.filter((s, i, all) => all.findIndex((x) => x.full.toLowerCase() === s.full.toLowerCase()) === i).slice(0, 6);
}
