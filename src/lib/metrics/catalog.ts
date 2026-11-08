import type { MetricProviderId } from "./types";

export const METRIC_PROVIDERS: Record<MetricProviderId, {
  name: string;
  domain: string;
  blurb: string;
  keyLabel: string;
  placeholder: string;
  setup: string;
  href: string;
  scopes: string;
}> = {
  posthog: {
    name: "PostHog", domain: "posthog.com",
    blurb: "Active users over 24 hours, 7 days and 30 days, from the activity you choose.",
    keyLabel: "Personal API key", placeholder: "phx_…",
    setup: "Create a personal API key for your project in PostHog's account settings. Use your project ID from Project settings, not your public project API key.",
    href: "https://posthog.com/docs/api/personal-api-keys",
    scopes: "Query: Read (query:read), limited to the project you connect.",
  },
  stripe: {
    name: "Stripe", domain: "stripe.com",
    blurb: "Collected revenue, paying customers and customers with active subscriptions.",
    keyLabel: "Restricted API key", placeholder: "rk_live_…",
    setup: "Create a restricted key in Stripe → Developers → API keys. Live keys import real payments; test keys are clearly labeled as test data.",
    href: "https://dashboard.stripe.com/apikeys",
    scopes: "Read access to Charges and Subscriptions. No write permissions needed.",
  },
  polar: {
    name: "Polar", domain: "polar.sh",
    blurb: "Revenue, monthly recurring revenue and active subscriptions from Polar's metrics.",
    keyLabel: "Organization access token", placeholder: "polar_oat_…",
    setup: "Create an organization access token in Polar → Settings → Developers, then copy your organization ID from its settings.",
    href: "https://polar.sh/docs/api-reference/metrics/get",
    scopes: "metrics:read. No write permissions needed.",
  },
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

export function formatMetric(value: number | null, currency?: string, format?: "percent" | "decimal"): string {
  if (value === null) return "—";
  if (format === "percent") return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 }).format(value);
  const formatter = new Intl.NumberFormat("en-US", currency
    ? { style: "currency", currency, currencyDisplay: "code" }
    : { maximumFractionDigits: format === "decimal" ? 2 : 0 });
  // The currency code is shown alongside the period, leaving room for the full amount in a card.
  return formatter.formatToParts(value).filter((part) => part.type !== "currency" && part.type !== "literal").map((part) => part.value).join("");
}
