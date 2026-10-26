import "server-only";
import { formDDetail, formDSearch, shortUsd, type FormDFiling } from "./edgar";
import { githubOrg, orgLine, type GithubOrg } from "./github";
import { episodesWith, podcastSearch, type PodcastEpisode } from "./podcasts";

/**
 * The public record around one company, beyond its site, boards and news (SPEC W4 step 5): its Form D
 * filings (amounts, dates, executives), its GitHub org when the ICP is developer tooling, and podcast
 * episodes with the people the founder would talk to. Free, cached, each as text a prompt can quote
 * and a source the evidence ledger can check quotes against.
 */

export interface RecordSource {
  url: string;
  sourceType: "filing" | "first_party" | "podcast";
  publishedAt?: string;
  /** Exactly what the prompt shows for this URL. */
  text: string;
}

export interface PublicRecords {
  filings: FormDFiling[];
  github: GithubOrg | null;
  podcasts: (PodcastEpisode & { about: string })[];
  sources: RecordSource[];
  /** Dated lines for "what happened when" (filings and episodes). */
  dated: string[];
  /** Markdown sections to append to a digest. Empty when nothing was found. */
  digest: string;
  lookups: number;
}

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|co|pbc|the|technologies|labs)\b\.?/g, "")
    .replace(/[^a-z0-9]/g, "");

const day = (iso: string) => iso.slice(0, 10);

function filingText(f: FormDFiling): string {
  const sold = shortUsd(f.amountSoldUsd);
  const offered = shortUsd(f.totalOfferingUsd);
  return [
    `${f.filedAt} · Form D filed by ${f.company}${f.location ? ` (${f.location})` : ""} · ${f.url}`,
    f.totalOfferingUsd !== undefined ? `Total Offering Amount: $${f.totalOfferingUsd.toLocaleString("en-US")}` : offered ? `Offered: ${offered}` : null,
    f.amountSoldUsd !== undefined ? `Total Amount Sold: $${f.amountSoldUsd.toLocaleString("en-US")}` : sold ? `Sold: ${sold}` : null,
    f.firstSaleOn ? `Date of First Sale: ${f.firstSaleOn}` : null,
    f.industry ? `Industry Group: ${f.industry}` : null,
    f.yearOfInc ? `Year of Incorporation: ${f.yearOfInc}` : null,
    f.relatedPersons.length ? `Related persons: ${f.relatedPersons.map((p) => `${p.name} (${p.relationship})`).join("; ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function publicRecords(
  domain: string,
  name: string,
  opts: { github?: boolean | string; people?: string[]; today?: string } = {},
): Promise<PublicRecords> {
  let lookups = 0;
  const own = squash(name);

  // Form D: filings whose issuer is this company by name, newest first. A name too short to tell apart is skipped.
  const filingsP = (async () => {
    if (own.length < 4) return [];
    const hits = await formDSearch({ query: `"${name}"`, sinceDays: 730, limit: 10, today: opts.today });
    lookups++;
    const mine = hits.filter((f) => squash(f.company) === own).slice(0, 2);
    lookups += mine.length;
    return Promise.all(mine.map(formDDetail));
  })();

  // GitHub: the org the site links to (or the domain's stem), kept only when the org's own site is this domain.
  const githubP = (async () => {
    if (!opts.github) return null;
    const login = typeof opts.github === "string" ? opts.github : domain.split(".")[0];
    const org = await githubOrg(login);
    lookups += 3;
    if (!org || org.rateLimited || !org.repos.length) return null;
    return org.domain === domain || typeof opts.github === "string" ? org : null;
  })();

  // Podcasts: episodes that name each person with the company, and episodes whose title names the company.
  const podcastsP = (async () => {
    const out: (PodcastEpisode & { about: string })[] = [];
    for (const person of (opts.people ?? []).slice(0, 2)) {
      lookups++;
      for (const e of await episodesWith(person, name, 2)) out.push({ ...e, about: person });
    }
    if (name.length >= 5) {
      lookups++;
      const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      for (const e of (await podcastSearch(name, 8)).filter((x) => re.test(x.title)).slice(0, 2)) out.push({ ...e, about: name });
    }
    const seen = new Set<string>();
    return out.filter((e) => !seen.has(e.url) && seen.add(e.url)).slice(0, 4);
  })();

  const [filings, github, podcasts] = await Promise.all([filingsP, githubP, podcastsP]);

  const sources: RecordSource[] = [];
  const dated: string[] = [];
  const parts: string[] = [];
  if (filings.length) {
    const texts = filings.map((f) => {
      const text = filingText(f);
      sources.push({ url: f.url, sourceType: "filing", publishedAt: f.filedAt, text });
      dated.push(`${f.filedAt} · SEC filing · Form D${shortUsd(f.amountSoldUsd) ? `, ${shortUsd(f.amountSoldUsd)} sold` : ""} · ${f.url}`);
      return text;
    });
    parts.push(`\n## SEC Form D filings\n${texts.join("\n\n")}`);
  }
  if (github) {
    const text = [orgLine(github), ...github.repos.slice(0, 5).map((r) => `- ${r.name}: ${r.stars}★${r.language ? ` · ${r.language}` : ""} · pushed ${day(r.pushedAt)}${r.description ? ` · ${r.description}` : ""}`)].join("\n");
    const url = `https://github.com/${github.org}`;
    sources.push({ url, sourceType: "first_party", text });
    parts.push(`\n## GitHub (${url})\n${text}`);
  }
  if (podcasts.length) {
    const lines = podcasts.map((e) => {
      const text = `${day(e.releaseDate)} · ${e.podcast}: ${e.title}${e.description ? ` — ${e.description.slice(0, 300)}` : ""}`;
      sources.push({ url: e.url, sourceType: "podcast", publishedAt: day(e.releaseDate), text });
      dated.push(`${day(e.releaseDate)} · podcast · ${e.title} · ${e.url}`);
      return `- ${text} · ${e.url}`;
    });
    parts.push(`\n## Podcast episodes\n${lines.join("\n")}`);
  }
  return { filings, github, podcasts, sources, dated, digest: parts.join("\n"), lookups };
}

/**
 * Podcast episodes the people on a call appeared on (SPEC W7: podcast_search for attendees): their own
 * words, in public, with the company named so a namesake never slips in. Up to three people.
 */
export async function attendeeEpisodes(attendees: { name: string }[], company: string): Promise<{ person: string; line: string; url: string; date: string }[]> {
  const out: { person: string; line: string; url: string; date: string }[] = [];
  for (const a of attendees.filter((x) => x.name.trim().split(/\s+/).length >= 2).slice(0, 3)) {
    for (const e of await episodesWith(a.name, company, 2)) {
      if (out.some((x) => x.url === e.url)) continue;
      out.push({ person: a.name, url: e.url, date: day(e.releaseDate), line: `${day(e.releaseDate)} · podcast · ${a.name} on ${e.podcast}: ${e.title}` });
    }
  }
  return out;
}
