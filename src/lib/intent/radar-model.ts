import { bestSentence, isBotLogin, plainText } from "./parse";
import { lexicalScore, words, type IntentProfile } from "./profile";
import { nameFromDomain } from "./resolve";
import { ACTIVITY_LABEL, INTENT_LIMITS, type RadarActivity, type RadarActivityKind, type RadarCompany, type RadarPerson, type RadarState } from "./types";

/**
 * Developer radar, the pure half: GitHub's public activity on a repository (forks, issues, pull requests, comments,
 * discussions) → people, then people placed at companies → one row per company with the evidence. GitHub stopped
 * listing who starred a repository to anyone but its admins (July 2026), so stars are a weekly count, never people.
 */

const REPO = /^([a-z\d](?:[a-z\d-]{0,38}))\/([\w.-]{1,100})$/i;

/** The id a radar company's evidence and signal carry on its account ("rad_fernwick_example"). */
export const radarFindingId = (domain: string) => `rad_${domain.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

/** Up to five owner/name pairs from pasted text: links, "owner/name", commas or new lines. */
export function parseRepoInput(raw: string, max: number = INTENT_LIMITS.repos): string[] {
  const out: string[] = [];
  for (const token of raw.split(/[\s,;]+/)) {
    const t = token
      .trim()
      .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "")
      .replace(/\.git$/i, "")
      .replace(/[?#].*$/, "")
      .split("/")
      .slice(0, 2)
      .join("/");
    const m = t.match(REPO);
    if (!m || m[2] === "." || m[2] === "..") continue;
    const full = `${m[1]}/${m[2]}`;
    if (!out.some((r) => r.toLowerCase() === full.toLowerCase())) out.push(full);
    if (out.length >= max) break;
  }
  return out;
}

interface GhUser {
  login?: string;
  type?: string;
  html_url?: string;
}

const staff = (association?: string) => !!association && /^(OWNER|MEMBER|COLLABORATOR)$/.test(association);
const human = (u: GhUser | null | undefined): u is GhUser & { login: string } => !!u?.login && u.type !== "Bot" && !isBotLogin(u.login);

export interface RawActivity extends RadarActivity {
  login: string;
  /** The account that did it is an organization (an org forked the repo). */
  org?: boolean;
  text?: string;
}

const within = (iso: string | undefined, since: number) => !!iso && Date.parse(iso) >= since;

/** GET /repos/{repo}/forks?sort=newest. An organization fork is the company itself. */
export function parseForks(json: unknown, repo: string, since: number): RawActivity[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((f: { owner?: GhUser; created_at?: string; html_url?: string }): RawActivity[] => {
    if (!human(f.owner) || !within(f.created_at, since)) return [];
    return [{ kind: "fork", repo, url: f.html_url ?? `https://github.com/${f.owner.login}`, at: f.created_at!, login: f.owner.login, ...(f.owner.type === "Organization" ? { org: true } : {}) }];
  });
}

/** GET /repos/{repo}/issues?state=all&sort=created: issues and pull requests, without the repo's own staff and bots. */
export function parseRepoIssues(json: unknown, repo: string, since: number): RawActivity[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap(
    (i: { user?: GhUser; author_association?: string; created_at?: string; html_url?: string; title?: string; body?: string | null; pull_request?: unknown }): RawActivity[] => {
      if (!human(i.user) || staff(i.author_association) || !within(i.created_at, since) || !i.html_url) return [];
      return [
        {
          kind: i.pull_request ? "pull" : "issue",
          repo,
          url: i.html_url,
          at: i.created_at!,
          login: i.user.login,
          ...(i.title ? { title: i.title.slice(0, 160) } : {}),
          // The body alone: the title is shown on its own, so the quote is the next thing they wrote.
          text: plainText(i.body, 1500) || i.title || "",
        },
      ];
    },
  );
}

/** GET /repos/{repo}/issues/comments?sort=created&direction=desc&since=… */
export function parseRepoComments(json: unknown, repo: string, since: number): RawActivity[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((c: { user?: GhUser; author_association?: string; created_at?: string; html_url?: string; body?: string | null }): RawActivity[] => {
    if (!human(c.user) || staff(c.author_association) || !within(c.created_at, since) || !c.html_url) return [];
    return [{ kind: "comment", repo, url: c.html_url, at: c.created_at!, login: c.user.login, text: plainText(c.body, 1200) }];
  });
}

/** GraphQL repository.discussions (needs a token). */
export function parseDiscussions(json: unknown, repo: string, since: number): RawActivity[] {
  const nodes = (json as { data?: { repository?: { discussions?: { nodes?: unknown[] } } } } | null)?.data?.repository?.discussions?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap((d): RawActivity[] => {
    const n = d as { title?: string; url?: string; createdAt?: string; bodyText?: string; authorAssociation?: string; author?: { login?: string } | null };
    const login = n.author?.login;
    if (!login || isBotLogin(login) || staff(n.authorAssociation) || !within(n.createdAt, since) || !n.url) return [];
    return [{ kind: "discussion", repo, url: n.url, at: n.createdAt!, login, ...(n.title ? { title: n.title.slice(0, 160) } : {}), text: plainText(n.bodyText, 1500) || n.title || "" }];
  });
}

/** GET /repos/{repo}/stargazers/history: weekly counts, newest first. Stars in the last `days`, by whole weeks. */
export function starsInWindow(json: unknown, now: number, days = 30): number | undefined {
  if (!Array.isArray(json)) return undefined;
  const since = now / 1000 - days * 86_400;
  let total = 0;
  let any = false;
  for (const w of json as { week?: number; total?: number; days?: number[] }[]) {
    if (typeof w.week !== "number" || typeof w.total !== "number") continue;
    any = true;
    if (w.week + 7 * 86_400 <= since) continue;
    if (w.week >= since) total += w.total;
    else if (Array.isArray(w.days)) total += w.days.filter((_, i) => w.week! + i * 86_400 >= since).reduce((a, b) => a + (b ?? 0), 0);
  }
  return any ? total : undefined;
}

const WEIGHT: Record<RadarActivityKind, number> = { issue: 3, discussion: 3, pull: 2, comment: 2, fork: 1 };

/** At most `max` words, verbatim, from the activity's text: the sentence that best shows the pain. */
export function shortQuote(text: string | undefined, tokens: string[], max = 25): string | undefined {
  if (!text?.trim()) return undefined;
  const s = bestSentence(text, tokens);
  const w = s.replace(/…$/, "").split(/\s+/);
  return w.length > max ? `${w.slice(0, max).join(" ")}…` : s;
}

/** Raw activity → one row per person, newest first, each with at most five activities. */
export function peopleFrom(raw: RawActivity[], profile: IntentProfile | null): RadarPerson[] {
  const tokens = profile ? [...profile.pains, ...profile.categoryTerms].flatMap((t) => t.tokens) : [];
  const by = new Map<string, RadarPerson>();
  for (const a of [...raw].sort((x, y) => y.at.localeCompare(x.at))) {
    const key = a.login.toLowerCase();
    const p = by.get(key) ?? { login: a.login, url: `https://github.com/${a.login}`, activity: [] };
    if (p.activity.length < 5 && !p.activity.some((x) => x.url === a.url)) {
      const quote = a.kind === "fork" ? undefined : shortQuote(a.text, tokens);
      p.activity.push({ kind: a.kind, repo: a.repo, url: a.url, at: a.at, ...(a.title ? { title: a.title } : {}), ...(quote ? { quote } : {}) });
    }
    by.set(key, p);
  }
  return [...by.values()];
}

const strength = (p: RadarPerson) => p.activity.reduce((n, a) => n + WEIGHT[a.kind], 0);

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 people at Fernwick engaged with getlago/lago in the last 30 days: 2 forks, 1 issue about metered billing." */
export function radarLine(c: Pick<RadarCompany, "name" | "logins" | "counts" | "repos" | "quote">, windowDays: number): string {
  const parts = (Object.keys(ACTIVITY_LABEL) as RadarActivityKind[])
    .filter((k) => c.counts[k])
    .map((k) => {
      const n = c.counts[k]!;
      const label = count(n, ACTIVITY_LABEL[k].one, ACTIVITY_LABEL[k].many);
      return c.quote?.pain && c.quote.kind === k ? `${label} about ${c.quote.pain.toLowerCase().replace(/[.]$/, "")}` : label;
    });
  const repos = c.repos.length === 1 ? c.repos[0] : c.repos.length === 2 ? c.repos.join(" and ") : `${c.repos.length} repositories`;
  return `${count(c.logins.length, "person", "people")} at ${c.name} engaged with ${repos} in the last ${windowDays} days: ${parts.join(", ")}.`;
}

/**
 * People placed at a company → company rows, strongest first. The repo owners' own domains and the founder's are
 * left out: their staff aren't buyers.
 */
export function aggregateRadar(people: RadarPerson[], opts: { windowDays: number; profile: IntentProfile | null; exclude: string[]; names?: Record<string, string> }): RadarCompany[] {
  const exclude = new Set(opts.exclude.map((d) => d.toLowerCase()));
  const by = new Map<string, RadarPerson[]>();
  for (const p of people) {
    const d = p.domain?.toLowerCase();
    if (!d || exclude.has(d) || [...exclude].some((x) => d.endsWith(`.${x}`))) continue;
    by.set(d, [...(by.get(d) ?? []), p]);
  }
  const out: RadarCompany[] = [];
  for (const [domain, group] of by) {
    const counts: RadarCompany["counts"] = {};
    const repos = new Set<string>();
    let lastAt = "";
    let best: { a: RadarActivity; login: string; pain?: string; score: number } | undefined;
    for (const p of group) {
      for (const a of p.activity) {
        counts[a.kind] = (counts[a.kind] ?? 0) + 1;
        repos.add(a.repo);
        if (a.at > lastAt) lastAt = a.at;
        if (!a.quote && !a.title) continue;
        const lex = opts.profile ? lexicalScore(`${a.title ?? ""}\n${a.quote ?? ""}`, opts.profile) : { score: 0, matched: [] };
        const pain = lex.matched.find((m) => m.kind === "pain" || m.kind === "category");
        // The kind of activity first (an issue is a written need), then how much of the playbook it mentions.
        const score = WEIGHT[a.kind] * 2 + lex.score;
        if (!best || score > best.score || (score === best.score && WEIGHT[a.kind] > WEIGHT[best.a.kind])) best = { a, login: p.login, ...(pain ? { pain: pain.label } : {}), score };
      }
    }
    const logins = group.map((p) => p.login);
    const name = opts.names?.[domain] ?? group.find((p) => p.company)?.company ?? nameFromDomain(domain);
    const quote = best && (best.a.quote || best.a.title)
      ? { text: (best.a.quote ?? best.a.title)!, url: best.a.url, repo: best.a.repo, kind: best.a.kind, login: best.login, at: best.a.at, ...(best.pain ? { pain: best.pain } : {}) }
      : undefined;
    const row: RadarCompany = {
      domain,
      name: name.replace(/^@/, "").trim().slice(0, 80) || nameFromDomain(domain),
      logins,
      counts,
      repos: [...repos],
      lastAt,
      ...(quote ? { quote } : {}),
      line: "",
      // A written need (an issue or a discussion) ranks above activity alone; one that names the pain, above that.
      score:
        group.reduce((n, p) => n + Math.min(6, strength(p)), 0) +
        (logins.length - 1) * 2 +
        (counts.issue || counts.discussion ? 1 : 0) +
        (quote?.pain ? 3 : 0),
    };
    row.line = radarLine(row, opts.windowDays);
    out.push(row);
  }
  return out.sort((a, b) => b.score - a.score || b.lastAt.localeCompare(a.lastAt)).slice(0, INTENT_LIMITS.radarCompanies);
}

/** "84 people engaged in the last 30 days. I could place 23 of them at 11 companies; 2 are in Companies already." */
export function radarSummary(r: Pick<RadarState, "totals" | "companies" | "windowDays">, known = 0): string {
  const { engaged, placed } = r.totals;
  if (!engaged) return `Nobody outside the maintainers forked, filed or commented in the last ${r.windowDays} days.`;
  const head = `${count(engaged, "person", "people")} engaged in the last ${r.windowDays} days.`;
  if (!placed) return `${head} None of their GitHub profiles say where they work, so I left them unplaced.`;
  const where = `I could place ${placed} of them at ${count(r.companies.length, "company", "companies")}`;
  return `${head} ${where}${known ? `; ${known} ${known === 1 ? "is" : "are"} in Companies already` : ""}.`;
}

/** Keeps the people worth showing: placed first, then the most active. */
export function capPeople(people: RadarPerson[], max: number = INTENT_LIMITS.radarPeople): RadarPerson[] {
  return [...people].sort((a, b) => Number(!!b.domain) - Number(!!a.domain) || strength(b) - strength(a)).slice(0, max);
}

export const painTokens = (profile: IntentProfile | null) => (profile ? profile.pains.flatMap((p) => words(p.label)) : []);
