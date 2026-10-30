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
    blurb: "Your active users, connected in a few clicks.",
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
    setup: "Create an organization access token in Polar → Settings → Developers, with read access to metrics. No organization ID is needed.",
    href: "https://polar.sh/dashboard",
    scopes: "metrics:read. No write permissions needed.",
  },
};

export function formatMetric(value: number, currency?: string): string {
  const formatter = new Intl.NumberFormat("en-US", currency
    ? { style: "currency", currency, currencyDisplay: "code" }
    : { maximumFractionDigits: 0 });
  // The currency code is shown alongside the period, leaving room for the full amount in a card.
  return formatter.formatToParts(value).filter((part) => part.type !== "currency" && part.type !== "literal").map((part) => part.value).join("");
}
