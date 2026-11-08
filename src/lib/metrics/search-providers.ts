import "server-only";
import { sign } from "node:crypto";
import { z } from "zod";
import { request } from "@/lib/connectors/http";
import { fail, ok, type ConnectorConfig, type Result } from "@/lib/connectors/types";
import { searchConfig } from "./search-config";
import type { BingSettings, PostHogSearchSettings, SearchConsoleSettings } from "./search-config";
import type { SearchMetric, SearchProviderId, SearchSnapshot } from "./search-types";

const DAY = 86_400_000;
const count = z.number().int().nonnegative().safe();
const number = z.number().finite().nonnegative();
const numericCount = z.union([count, z.string().regex(/^\d+$/).transform(Number).pipe(count)]);
const literal = (value: string) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const ratio = (a: number | null, b: number | null) => a === null || !b ? null : a / b;
const malformed = (name: string) => fail("upstream", `${name} returned incomplete search metrics. Your previous figures have been kept.`);

/** Calendar dates, not rolling hours. A three-day lag avoids most unfinished search data. */
export function searchWindow(now: Date, timezone = "America/Los_Angeles") {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const end = shift(`${part("year")}-${part("month")}-${part("day")}`, -3);
  return { start: shift(end, -27), end, previousStart: shift(end, -55), previousEnd: shift(end, -28) };
}

const ServiceAccount = z.object({ type: z.literal("service_account"), client_email: z.email(), private_key: z.string().min(100).max(12000) });

/** Fixed Google token audience; token_uri from the uploaded file is never trusted. */
async function googleToken(key: string, now: Date): Promise<Result<string>> {
  let account: z.infer<typeof ServiceAccount>;
  try { account = ServiceAccount.parse(JSON.parse(key)); }
  catch { return fail("validation", "Paste the complete service-account JSON downloaded from Google Cloud, including client_email and private_key."); }
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const iat = Math.floor(now.getTime() / 1000);
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: account.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 })}`;
  let assertion: string;
  try { assertion = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), account.private_key).toString("base64url")}`; }
  catch { return fail("validation", "Google's private key could not be read. Download a fresh service-account JSON key."); }
  const response = await request({
    tool: "Google authorization", method: "POST", url: "https://oauth2.googleapis.com/token",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    secrets: [key, account.private_key, assertion], retries: 0,
  });
  if (!response.ok) return response;
  const parsed = z.object({ access_token: z.string().min(1) }).safeParse(response.value);
  return parsed.success ? ok(parsed.data.access_token) : malformed("Google authorization");
}

async function google(key: string, cfg: SearchConsoleSettings, now: Date): Promise<Result<SearchSnapshot>> {
  const token = await googleToken(key, now);
  if (!token.ok) return token;
  const window = searchWindow(now);
  const totals = async (startDate: string, endDate: string) => {
    const result = await request({
      tool: "Google Search Console", method: "POST",
      url: `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(cfg.siteUrl)}/searchAnalytics/query`,
      headers: { authorization: `Bearer ${token.value}` },
      body: { startDate, endDate, type: "web", dataState: "final", aggregationType: "byProperty", dimensions: [], rowLimit: 1 },
      secrets: [key, token.value], retries: 1,
    });
    if (!result.ok) return result;
    const parsed = z.object({ rows: z.array(z.object({ clicks: number, impressions: number, ctr: number.max(1), position: number })).max(1).optional() }).safeParse(result.value);
    return parsed.success ? ok(parsed.data.rows?.[0] ?? null) : malformed("Google Search Console");
  };
  const current = await totals(window.start, window.end);
  if (!current.ok) return current;
  const previous = await totals(window.previousStart, window.previousEnd);
  if (!previous.ok) return previous;
  const metrics: SearchMetric[] = (["clicks", "impressions", "ctr", "position"] as const).map((key) => ({
    key, label: { clicks: "Google clicks", impressions: "Google impressions", ctr: "Click-through rate", position: "Average position" }[key],
    value: current.value?.[key] ?? null, previousValue: previous.value?.[key] ?? null,
    ...(key === "ctr" ? { format: "percent" as const } : key === "position" ? { format: "decimal" as const } : {}),
    period: "28 days · Pacific time", definition: key === "position" ? "Google's property-level average position. Lower is better; this is not the rank of one keyword." : "Google Search Console's property-level Web search total, using finalized data and no query/page grouping. AI-specific visibility is not isolated by this API request.",
  }));
  return ok({
    provider: "google-search-console", syncedAt: now.toISOString(), windowStart: window.start, windowEnd: window.end,
    accountLabel: cfg.siteUrl, environment: "live", metrics,
    comparisonPeriod: `${window.previousStart} – ${window.previousEnd}`,
    notes: ["Date ranges are inclusive, in Search Console's Pacific timezone, ending three days before today. Missing reported data is shown as —, not zero.", "Google's separate Search Generative AI reports show AI-feature impressions in Search Console. The documented Search Analytics API does not expose a dedicated generative-AI search type."],
    links: [{ label: "Open Search Console and AI reports", href: `https://search.google.com/search-console?resource_id=${encodeURIComponent(cfg.siteUrl)}` }],
  });
}

/** Bing's legacy JSON dates carry a UTC epoch plus the reporting offset. */
export function bingDate(value: string): string | null {
  const match = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(value);
  if (match) {
    const offset = match[2];
    const minutes = offset ? (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(3))) * (offset[0] === "+" ? 1 : -1) : 0;
    const at = new Date(Number(match[1]) + minutes * 60_000);
    return Number.isNaN(at.getTime()) ? null : at.toISOString().slice(0, 10);
  }
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(value)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date ? date : null;
}

async function bing(key: string, cfg: BingSettings, now: Date): Promise<Result<SearchSnapshot>> {
  const params = new URLSearchParams({ siteUrl: cfg.siteUrl, apikey: key });
  const response = await request({ tool: "Bing Webmaster Tools", url: `https://ssl.bing.com/webmaster/api.svc/json/GetRankAndTrafficStats?${params}`, secrets: [key, encodeURIComponent(key)], retries: 1 });
  if (!response.ok) return response;
  const parsed = z.object({ d: z.array(z.object({ Date: z.string(), Clicks: count, Impressions: count })) }).safeParse(response.value);
  if (!parsed.success) return malformed("Bing Webmaster Tools");
  const window = searchWindow(now);
  const seen = new Set<string>();
  const rows: { date: string; clicks: number; impressions: number }[] = [];
  for (const row of parsed.data.d) {
    const date = bingDate(row.Date);
    if (!date || seen.has(date)) return malformed("Bing Webmaster Tools");
    seen.add(date);
    rows.push({ date, clicks: row.Clicks, impressions: row.Impressions });
  }
  const sum = (start: string, end: string, key: "clicks" | "impressions") => {
    const selected = rows.filter((r) => r.date >= start && r.date <= end);
    return selected.length ? selected.reduce((n, r) => n + r[key], 0) : null;
  };
  const clicks = sum(window.start, window.end, "clicks"), impressions = sum(window.start, window.end, "impressions");
  const oldClicks = sum(window.previousStart, window.previousEnd, "clicks"), oldImpressions = sum(window.previousStart, window.previousEnd, "impressions");
  const definition = "Sum of Bing's reported dated traffic rows. Bing includes Web, Chat, News, Images, Videos and Knowledge Panel traffic; this is not an AI citation count. Unreported dates are not filled with zero.";
  return ok({
    provider: "bing-webmaster", syncedAt: now.toISOString(), windowStart: window.start, windowEnd: window.end,
    accountLabel: cfg.siteUrl, environment: "live", comparisonPeriod: `${window.previousStart} – ${window.previousEnd}`,
    metrics: [
      { key: "clicks", label: "Bing clicks", value: clicks, previousValue: oldClicks, period: "28 reporting dates", definition },
      { key: "impressions", label: "Bing impressions", value: impressions, previousValue: oldImpressions, period: "28 reporting dates", definition },
      { key: "ctr", label: "Click-through rate", value: ratio(clicks, impressions), previousValue: ratio(oldClicks, oldImpressions), format: "percent", period: "28 reporting dates", definition: "Reported clicks divided by reported impressions. No rate is shown when impressions are zero or unavailable." },
    ],
    notes: ["Ranges are inclusive, ending three days before today's Pacific date. Bing dates retain their supplied reporting offset. Bing does not supply a coverage flag; missing dates may mean no activity or unreported data.", `Reported dates: ${rows.filter((r) => r.date >= window.start && r.date <= window.end).length}/28 current, ${rows.filter((r) => r.date >= window.previousStart && r.date <= window.previousEnd).length}/28 previous.`, "Bing's AI Performance report measures citations separately. This integration uses only the documented traffic API; review AI Performance in Bing for its citation metrics."],
    links: [{ label: "Open Bing AI Performance", href: "https://www.bing.com/webmasters/aiperformance" }],
  });
}

const AI_DOMAINS: Record<string, string[]> = {
  ChatGPT: ["chatgpt.com", "chat.openai.com"], Perplexity: ["perplexity.ai"], Claude: ["claude.ai"],
  Gemini: ["gemini.google.com"], Copilot: ["copilot.microsoft.com"], "Meta AI": ["meta.ai"], Grok: ["grok.com"],
};
const AI_LABELS = Object.keys(AI_DOMAINS);

async function posthogSearch(key: string, cfg: PostHogSearchSettings, now: Date): Promise<Result<SearchSnapshot>> {
  if (!key.startsWith("phx_")) return fail("validation", "Use a PostHog personal API key (phx_…), not a public project key.");
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - 28 * DAY), previousStart = new Date(end.getTime() - 56 * DAY);
  const date = (d: Date) => `toDateTime(${literal(d.toISOString().slice(0, 19).replace("T", " "))}, 'UTC')`;
  // $entry_referring_domain is normally a bare host; domain() expects a URL.
  const host = "lower(domain(concat('https://', s.$entry_referring_domain)))";
  const classifiers = Object.entries(AI_DOMAINS).map(([label, domains]) => `${domains.map((d) => `(${host} = ${literal(d)} OR endsWith(${host}, ${literal(`.${d}`)}))`).join(" OR ")}, ${literal(label)}`);
  const source = `multiIf(${classifiers.join(", ")}, s.$channel_type = 'Organic Search', 'Organic search', 'Other')`;
  const conversion = cfg.conversionEvent
    ? `LEFT JOIN (SELECT properties.$session_id AS sid, min(timestamp) AS converted_at FROM events WHERE event = ${literal(cfg.conversionEvent)} AND timestamp >= ${date(previousStart)} AND timestamp < ${date(end)} AND properties.$session_id IS NOT NULL GROUP BY sid) c ON s.session_id = c.sid`
    : "";
  const converted = cfg.conversionEvent ? `uniqExactIf(s.session_id, c.converted_at >= s.$start_timestamp AND c.converted_at < s.$start_timestamp + INTERVAL 24 HOUR AND c.converted_at < if(s.$start_timestamp >= ${date(start)}, ${date(end)}, ${date(start)}))` : "0";
  const sql = `SELECT if(s.$start_timestamp >= ${date(start)}, 'current', 'previous') AS period, ${source} AS source, uniqExact(s.session_id), ${converted} FROM sessions s ${conversion} WHERE s.$start_timestamp >= ${date(previousStart)} AND s.$start_timestamp < ${date(end)} AND domain(s.$entry_current_url) = ${literal(cfg.siteHost)} AND s.$pageview_count > 0 GROUP BY period, source ORDER BY period, source LIMIT 100`;
  const response = await request({ tool: "PostHog", method: "POST", url: `https://${cfg.region}.posthog.com/api/projects/${cfg.projectId}/query/`, headers: { authorization: `Bearer ${key}` }, body: { query: { kind: "HogQLQuery", query: sql }, name: "Inroad search and AI acquisition", async: false }, secrets: [key], timeoutMs: 25_000, retries: 1 });
  if (!response.ok) return response;
  const parsed = z.object({ results: z.array(z.tuple([z.enum(["current", "previous"]), z.string().refine((v) => [...AI_LABELS, "Organic search", "Other"].includes(v)), numericCount, numericCount])).max(99) }).safeParse(response.value);
  if (!parsed.success) return malformed("PostHog");
  const seen = new Set<string>();
  for (const [period, label, sessions, conversions] of parsed.data.results) {
    if (conversions > sessions || seen.has(`${period}:${label}`)) return malformed("PostHog");
    seen.add(`${period}:${label}`);
  }
  const sum = (period: string, ai: boolean, index: 2 | 3) => parsed.data.results.filter((r) => r[0] === period && (ai ? AI_LABELS.includes(r[1]) : r[1] === "Organic search")).reduce((n, r) => n + r[index], 0);
  const metrics: SearchMetric[] = [];
  for (const [name, ai] of [["AI referral", true], ["Organic search", false]] as const) {
    const sessions = sum("current", ai, 2), previous = sum("previous", ai, 2);
    const conversions = sum("current", ai, 3), oldConversions = sum("previous", ai, 3);
    const definition = ai ? "Distinct website sessions whose entry referrer is a recognized AI assistant host or its subdomain. Includes anonymous visitors. Referrers can be stripped; this measures observed referrals, not AI answer visibility." : "Distinct website sessions classified by PostHog as Organic Search, excluding recognized AI hosts. Includes anonymous visitors and follows PostHog's channel rules.";
    metrics.push({ key: `${ai ? "ai" : "organic"}_sessions`, label: `${name} sessions`, value: sessions, previousValue: previous, period: "28 complete days · UTC", definition });
    if (cfg.conversionEvent) metrics.push(
      { key: `${ai ? "ai" : "organic"}_conversions`, label: `${name} conversions`, value: conversions, previousValue: oldConversions, period: "28 complete days · UTC", definition: `Sessions with at least one “${cfg.conversionEvent}” event after entry and before that period's reporting cutoff, using the same $session_id. Each session counts once; later-session conversions are excluded.` },
      { key: `${ai ? "ai" : "organic"}_rate`, label: `${name} conversion rate`, value: ratio(conversions, sessions), previousValue: ratio(oldConversions, previous), format: "percent", period: "28 complete days · UTC", definition: "Converted sessions divided by attributed sessions. — means there were no sessions to calculate a rate." },
    );
  }
  return ok({
    provider: "posthog-search", syncedAt: now.toISOString(), windowStart: start.toISOString(), windowEnd: end.toISOString(), accountLabel: `${cfg.siteHost} · Project ${cfg.projectId} · ${cfg.region.toUpperCase()}`, environment: "live", metrics,
    comparisonPeriod: `${previousStart.toISOString().slice(0, 10)} – ${new Date(start.getTime() - DAY).toISOString().slice(0, 10)} · UTC`,
    breakdown: [...AI_LABELS, "Organic search"].map((label) => { const row = parsed.data.results.find((r) => r[0] === "current" && r[1] === label); return { label, sessions: row?.[2] ?? 0, ...(cfg.conversionEvent ? { conversions: row?.[3] ?? 0 } : {}) }; }),
    notes: ["Exact entry hostname only. Referrer matching uses hostname boundaries; lookalike domains do not count. Direct/unknown traffic is not reassigned to AI. Google AI Overviews and AI Mode generally cannot be separated from Google organic referrals here.", "Counts depend on your website's PostHog capture, consent, blocking and bot/internal traffic settings. Session attribution is not proof of causation or a count of citations.", cfg.conversionEvent ? `Conversion event: ${cfg.conversionEvent}. Server events must carry the website's $session_id. Conversions after their reporting window are excluded in both periods.` : "Add a conversion event to measure outcomes alongside visits. No conversion rate is inferred without one."],
  });
}

export async function fetchSearchMetrics(id: SearchProviderId, key: string, rawConfig: ConnectorConfig, now = new Date()): Promise<Result<SearchSnapshot>> {
  const cfg = searchConfig(id, rawConfig);
  if (id === "google-search-console") return google(key, cfg as SearchConsoleSettings, now);
  if (id === "bing-webmaster") return bing(key, cfg as BingSettings, now);
  return posthogSearch(key, cfg as PostHogSearchSettings, now);
}
