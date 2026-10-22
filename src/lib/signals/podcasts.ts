import "server-only";
import { TTL, cached } from "./cache";
import { politeGate } from "./gate";
import { API_UA, fetchJSON } from "./http";

/**
 * Podcast episodes from Apple's free iTunes Search API, for what a champion or an attendee has said in
 * public. About 20 calls a minute are allowed, so calls are spaced and cached for a week.
 * https://performance-partners.apple.com/search-api
 */

export interface PodcastEpisode {
  title: string;
  podcast: string;
  releaseDate: string;
  url: string;
  description: string;
}

interface ItunesResp {
  results?: {
    wrapperType?: string;
    kind?: string;
    trackName?: string;
    collectionName?: string;
    releaseDate?: string;
    trackViewUrl?: string;
    description?: string;
    shortDescription?: string;
  }[];
}

/** The cache key of one search (its file name holds only a hash of it, see cache.ts). */
export const podcastCacheKey = (term: string, limit: number) => `podcasts:v1:${term.trim().slice(0, 120).toLowerCase()}:${Math.max(1, Math.min(20, limit))}`;

/** The searches episodesWith makes for a person, so "Delete their details" can drop what they found. */
export const personPodcastKeys = (person: string, company?: string) => [podcastCacheKey(`${person.trim()}${company ? ` ${company}` : ""}`, 10), podcastCacheKey(person, 10)];

export async function podcastSearch(term: string, limit = 8): Promise<PodcastEpisode[]> {
  const q = term.trim().slice(0, 120);
  if (q.length < 3) return [];
  const n = Math.max(1, Math.min(20, limit));
  try {
    return await cached(podcastCacheKey(q, n), TTL.week, async () => {
      await politeGate("itunes");
      const data = await fetchJSON<ItunesResp>(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=podcast&entity=podcastEpisode&limit=${n}`, 10_000, {
        headers: { "User-Agent": API_UA },
      });
      if (!data) throw new Error("iTunes unreachable");
      return (data.results ?? []).flatMap((r) =>
        r.trackName && r.trackViewUrl && r.releaseDate
          ? [
              {
                title: r.trackName.slice(0, 200),
                podcast: (r.collectionName ?? "").slice(0, 120),
                releaseDate: r.releaseDate,
                url: r.trackViewUrl,
                description: (r.description ?? r.shortDescription ?? "").replace(/\s+/g, " ").trim().slice(0, 600),
              },
            ]
          : [],
      );
    });
  } catch {
    return [];
  }
}

/**
 * Episodes that are about this person: their full name in the title or description, and (when given)
 * their company too, so a common name doesn't bring in a stranger. Newest first.
 */
export async function episodesWith(person: string, company?: string, limit = 3): Promise<PodcastEpisode[]> {
  const name = person.trim();
  if (name.split(/\s+/).length < 2) return [];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameRe = new RegExp(`\\b${esc(name)}\\b`, "i");
  const companyRe = company ? new RegExp(`\\b${esc(company)}\\b`, "i") : null;
  const all = await podcastSearch(`${name}${company ? ` ${company}` : ""}`, 10);
  return all
    .filter((e) => {
      const text = `${e.title} ${e.description}`;
      return nameRe.test(text) && (!companyRe || companyRe.test(text));
    })
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
    .slice(0, limit);
}
