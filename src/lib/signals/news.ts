import "server-only";
import { readSettings } from "@/lib/store/settings";
import { fetchJSON, fetchText } from "./http";

/** Recent news and community mentions from free feeds. No tokens. */
export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt?: string;
}

function decode(s: string) {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function tag(xml: string, name: string) {
  return xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1];
}

/** Google News RSS search. */
export async function googleNews(query: string, limit = 12): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetchText(url, { accept: "application/rss+xml,application/xml,text/xml" });
  if (!res) return [];
  const items = res.body.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items.slice(0, limit).flatMap((xml) => {
    const rawTitle = decode(tag(xml, "title") ?? "");
    const source = decode(tag(xml, "source") ?? "");
    const date = tag(xml, "pubDate");
    if (!rawTitle) return [];
    return [
      {
        // Google appends " - Source" to titles; strip it since the source is shown separately.
        title: source && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -(source.length + 3)) : rawTitle,
        url: decode(tag(xml, "link") ?? ""),
        source,
        publishedAt: date ? new Date(date).toISOString() : undefined,
      },
    ];
  });
}

interface AlgoliaResp {
  hits?: { title?: string; url?: string; objectID: string; created_at?: string; points?: number }[];
}

/** Hacker News stories that link to the company's own domain (precise even for generic names). */
export async function hackerNews(domain: string, limit = 5): Promise<NewsItem[]> {
  const data = await fetchJSON<AlgoliaResp>(
    `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(domain)}&restrictSearchableAttributes=url&tags=story&hitsPerPage=${limit}`,
  );
  return (data?.hits ?? [])
    .filter((h) => h.title)
    .map((h) => ({
      title: h.title!,
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      source: `Hacker News${h.points ? ` · ${h.points} points` : ""}`,
      publishedAt: h.created_at,
    }));
}

interface GdeltResp {
  articles?: { url: string; title: string; seendate?: string; domain?: string }[];
}

/** GDELT allows one request every 5 seconds per client; queue politely (shared across route bundles). */
async function gdeltGate() {
  const g = globalThis as unknown as { __gdeltNextSlot?: number };
  const now = Date.now();
  const next = g.__gdeltNextSlot ?? 0;
  const wait = Math.max(0, next - now);
  g.__gdeltNextSlot = Math.max(now, next) + 5200;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

/** GDELT DOC 2.0 article search: open data, noisier than Google News. */
export async function gdeltNews(query: string, limit = 15): Promise<NewsItem[]> {
  await gdeltGate();
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=${limit}&timespan=90d&sourcelang=english&sort=datedesc`;
  const data = await fetchJSON<GdeltResp>(url, 12_000);
  return (data?.articles ?? []).map((a) => {
    const d = a.seendate?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    return {
      title: a.title,
      url: a.url,
      source: a.domain ?? "",
      publishedAt: d ? new Date(Date.UTC(+d[1], +d[2] - 1, +d[3], +d[4], +d[5], +d[6])).toISOString() : undefined,
    };
  });
}

const SIGNAL =
  /\b(raises?|raised|funding|series [a-e]\b|seed round|pre-seed|led by|valuation|acquires?|acquired|acquisition|launch(es|ed)?|unveils?|partners? with|partnership|expands?|hires?|appoints?|names|joins as|layoffs?|ipo)\b/i;
const CONTEXT = /\b(startup|company|platform|software|ai|app|founder|ceo|raises|funding|launch)/i;

/**
 * News about a company, newest first. Uses two precise queries (domain, and quoted name with
 * company-context words) and drops headlines that don't name the company, which keeps
 * generic-word names ("Linear", "Notion") from pulling in unrelated stories.
 */
export async function companyNews(name: string, domain: string): Promise<(NewsItem & { signal: boolean })[]> {
  const source = readSettings().newsSource ?? "gdelt";
  if (source === "off") return [];
  const [byDomain, byName] =
    source === "google_news"
      ? await Promise.all([
          googleNews(`"${domain}"`, 8),
          googleNews(`"${name}" (startup OR raises OR funding OR launches OR CEO OR customers)`, 15),
        ])
      : // Concurrent: the gate still spaces them 5.2s apart, but the second no longer waits on the first's latency.
        await Promise.all([gdeltNews(`"${domain}"`, 10), gdeltNews(`"${name}" (startup OR raises OR funding OR launches OR customers)`, 20)]);
  const nameRe = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const seen = new Set<string>();
  return [...byDomain, ...byName.filter((n) => nameRe.test(n.title) && (SIGNAL.test(n.title) || CONTEXT.test(n.title)))]
    .filter((n) => {
      const key = n.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, 10)
    .map((n) => ({ ...n, signal: SIGNAL.test(n.title) }));
}
