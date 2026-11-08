import type { SearchProviderId } from "./search-types";

export const SEARCH_PROVIDERS: Record<SearchProviderId, { name: string; domain: string; blurb: string; keyLabel: string; placeholder: string; setup: string; href: string; scopes: string }> = {
  "google-search-console": {
    name: "Google Search Console", domain: "search.google.com",
    blurb: "Google clicks, impressions, CTR and average position, compared with the preceding 28 days.",
    keyLabel: "Service account JSON", placeholder: '{"type":"service_account",…}',
    setup: "Enable the Search Console API in a Google Cloud project, create a service account and download its JSON key. Add its client_email as a user of your verified Search Console property. Paste the exact property below: sc-domain:example.com or https://www.example.com/.",
    href: "https://developers.google.com/webmaster-tools/v1/how-tos/prerequisites",
    scopes: "webmasters.readonly. Grant the service account access to the selected property in Search Console.",
  },
  "bing-webmaster": {
    name: "Bing Webmaster Tools", domain: "bing.com",
    blurb: "Bing clicks, impressions and CTR, with matched 28-day comparisons.",
    keyLabel: "Webmaster API key", placeholder: "Paste your Bing Webmaster API key",
    setup: "Verify your site in Bing Webmaster Tools, then open Settings → API access → API Key. Use the site's exact registered URL, including its protocol and trailing slash.",
    href: "https://www.bing.com/webmasters/api",
    scopes: "Inroad only calls GetRankAndTrafficStats. The Bing API key itself can allow other operations; keep it private.",
  },
  "posthog-search": {
    name: "PostHog · Search & AI", domain: "posthog.com",
    blurb: "Organic search and AI referral sessions, conversions and conversion rates for your website.",
    keyLabel: "Personal API key", placeholder: "phx_…",
    setup: "Connect the PostHog project that records your website's pageviews. Choose its exact hostname and an optional conversion event, such as signup_completed. This connection includes anonymous sessions independently of your active-user settings.",
    href: "https://posthog.com/docs/data/sessions",
    scopes: "query:read, limited to this project. Conversion events need the same $session_id as the website session.",
  },
};

export function formatSearchMetric(value: number | null, currency?: string, format?: "percent" | "decimal"): string {
  if (value === null) return "—";
  if (format === "percent") return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 }).format(value);
  const formatter = new Intl.NumberFormat("en-US", currency
    ? { style: "currency", currency, currencyDisplay: "code" }
    : { maximumFractionDigits: format === "decimal" ? 2 : 0 });
  // The currency code is shown alongside the period, leaving room for the full amount in a card.
  return formatter.formatToParts(value).filter((part) => part.type !== "currency" && part.type !== "literal").map((part) => part.value).join("");
}
