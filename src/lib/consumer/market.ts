import type { ConsumerModel, Market, Workspace } from "@/lib/domain/types";

/**
 * Business or consumer: which playbook the agent writes, which moves Today shows and which rules the drafts follow.
 * Pure and isomorphic. Workspaces made before consumer mode have no market and read as business.
 */

export function marketOf(ws: Pick<Workspace, "company">): Market {
  return ws.company?.market ?? "b2b";
}

export function isConsumer(ws: Pick<Workspace, "company">): boolean {
  return marketOf(ws) === "consumer";
}

/**
 * The market the playbook on file was written for, or null before there is one. Consumer channel plans always carry
 * the retention-first funnel, so it tells even when the founder has switched markets since.
 */
export function playbookMarket(ws: Pick<Workspace, "foundation">): Market | null {
  if (!ws.foundation) return null;
  return ws.foundation.channelPlan.funnel.consumer ? "consumer" : "b2b";
}

/** The consumer model, defaulting to "app" (the most common early consumer company) when the site didn't say. */
export function consumerModelOf(ws: Pick<Workspace, "company">): ConsumerModel {
  return ws.company?.consumerModel ?? "app";
}

export const MARKET_LABELS: Record<Market, string> = {
  b2b: "Businesses",
  consumer: "Consumers",
};

export const CONSUMER_MODEL_LABELS: Record<ConsumerModel, { label: string; hint: string }> = {
  app: { label: "Consumer app", hint: "Mobile or web software people use on their own, free or paid." },
  dtc: { label: "Direct-to-consumer brand", hint: "Physical products sold from your own store, and maybe marketplaces or retail." },
  marketplace: { label: "Marketplace", hint: "Two sides: buyers and sellers, hosts and guests, clients and pros." },
  social: { label: "Social or community", hint: "The people on it are the product: friends, groups, creators, posts." },
  prosumer: { label: "Prosumer tool", hint: "Individuals paying for a tool they use for work or a serious hobby." },
};

export interface MarketRead {
  market: Market;
  model: ConsumerModel | null;
  /** What the pages showed, for the snapshot prompt and the "What I learned" receipt. */
  hints: string[];
  /** How sure the code read is: the fast tier and the founder can overrule it. */
  confidence: "high" | "medium" | "low";
}

interface Marker {
  re: RegExp;
  hint: string;
  side: "consumer" | "b2b";
  weight: number;
  model?: ConsumerModel;
}

/* Raw HTML markers (links, platform assets) are stronger than words: a store link is hard to fake by accident. */
const HTML_MARKERS: Marker[] = [
  { re: /apps\.apple\.com\/[^"'\s]*app\/|itunes\.apple\.com\/[^"'\s]*app\//i, hint: "App Store link", side: "consumer", weight: 3, model: "app" },
  { re: /play\.google\.com\/store\/apps/i, hint: "Google Play link", side: "consumer", weight: 3, model: "app" },
  { re: /cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i, hint: "Shopify store", side: "consumer", weight: 3, model: "dtc" },
  { re: /\/cart(\.js)?["'?]|data-add-to-cart|add-to-cart/i, hint: "Shopping cart", side: "consumer", weight: 2, model: "dtc" },
  { re: /calendly\.com|chilipiper|meetings\.hubspot\.com/i, hint: "Sales booking link", side: "b2b", weight: 2 },
];

/* Visible text markers. Each counts once, however often it appears. */
const TEXT_MARKERS: Marker[] = [
  { re: /\b(add to (cart|bag)|shop now|free shipping|subscribe (&|and) save|in stock|ships (in|within))\b/i, hint: "Checkout language", side: "consumer", weight: 2, model: "dtc" },
  { re: /\b(download (the|our) app|get the app|available on the app store|get it on google play)\b/i, hint: "Download the app", side: "consumer", weight: 2, model: "app" },
  { re: /\b(become a (host|seller|tasker|driver|sitter|tutor)|list your (space|home|item|items|car)|sell on \w+|for (buyers|sellers))\b/i, hint: "Two-sided signup", side: "consumer", weight: 2, model: "marketplace" },
  { re: /\b(invite (your )?friends|follow (your )?friends|share with (your )?friends|join the community|your feed)\b/i, hint: "Friends and feed language", side: "consumer", weight: 1, model: "social" },
  { re: /\b(for (creators|freelancers|individuals|students)|personal plan|individual plan|family plan)\b/i, hint: "Individual or family plans", side: "consumer", weight: 1 },
  { re: /\b(book a demo|request a demo|talk to sales|contact sales|schedule a demo)\b/i, hint: "Demo or sales CTA", side: "b2b", weight: 2 },
  { re: /\b(per (seat|user)( per month)?|\/seat|\/user\/mo)\b/i, hint: "Per-seat pricing", side: "b2b", weight: 2 },
  { re: /\b(soc ?2|sso|saml|hipaa compliant|enterprise plan|for (teams|enterprises))\b/i, hint: "Security or enterprise terms", side: "b2b", weight: 1 },
];

/**
 * A first read from code, before any model: store links, carts and two-sided signups say consumer; demo CTAs and
 * per-seat pricing say business. Prosumer can't be told from the page alone, so it's left to the model and the founder.
 */
export function readMarket(html: string, text: string): MarketRead {
  const hits: Marker[] = [];
  for (const m of HTML_MARKERS) if (m.re.test(html)) hits.push(m);
  for (const m of TEXT_MARKERS) if (m.re.test(text)) hits.push(m);
  const score = (side: Marker["side"]) => hits.filter((h) => h.side === side).reduce((n, h) => n + h.weight, 0);
  const consumer = score("consumer");
  const b2b = score("b2b");
  const market: Market = consumer > b2b ? "consumer" : "b2b";

  const byModel = new Map<ConsumerModel, number>();
  for (const h of hits) if (h.side === "consumer" && h.model) byModel.set(h.model, (byModel.get(h.model) ?? 0) + h.weight);
  const model = market === "consumer" ? ([...byModel.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null) : null;

  const gap = Math.abs(consumer - b2b);
  const confidence = gap >= 4 ? "high" : gap >= 2 ? "medium" : "low";
  const hints = [...new Set(hits.filter((h) => h.side === market).map((h) => h.hint))].slice(0, 4);
  return { market, model, hints, confidence };
}
