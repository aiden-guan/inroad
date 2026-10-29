import { Building2, CalendarHeart, Handshake, Megaphone, NotebookPen, PenTool, Plug, Search, Settings, Sunrise, Target, TrendingUp, Zap, type LucideIcon } from "lucide-react";
import { marketOf } from "@/lib/consumer/market";
import type { Market, Workspace } from "@/lib/domain/types";

/**
 * The pages each market works from. The sidebar, the phone menu, "G then …", ⌘K's "Go to" and the shortcuts list
 * all read this, so a page one market doesn't use is gone from every one of them at once. Its URL still works:
 * old Today cards and the agent API link to it.
 */
export interface NavPage {
  href: string;
  label: string;
  icon: LucideIcon;
  /** "G then <key>". */
  key: string;
  /** What ⌘K matches besides the label. */
  keywords: string;
  /** The shortcuts list's name for it, when the label alone undersells the page. */
  long?: string;
}

const TODAY: NavPage = { href: "/today", label: "Today", icon: Sunrise, key: "T", keywords: "today daily brief moves" };
const REVENUE: NavPage = { href: "/revenue", label: "Revenue", icon: Target, key: "V", keywords: "revenue forecast pipeline commit coverage quota number", long: "Revenue: the forecast and the plan" };
const GROWTH: NavPage = { href: "/growth", label: "Growth", icon: TrendingUp, key: "W", keywords: "growth number weekly active users signups retention log numbers", long: "Growth: the goal and your weekly numbers" };
const COMPANIES: NavPage = { href: "/companies", label: "Companies", icon: Building2, key: "C", keywords: "companies accounts pipeline prospects deals" };
const PLAYS: NavPage = { href: "/plays", label: "Plays", icon: Zap, key: "Y", keywords: "plays signals triggers programs automation" };
const RESEARCH: NavPage = { href: "/research", label: "Research", icon: Search, key: "F", keywords: "research search web sources monitors" };
const INTROS: NavPage = { href: "/intros", label: "Intros", icon: Handshake, key: "N", keywords: "intros warm introductions connectors" };
const PARTNERS: NavPage = {
  href: "/partners",
  label: "Partners",
  icon: Megaphone,
  key: "R",
  keywords: "partners newsletters podcasts communities linkedin creators sponsors co-marketing",
  long: "Partners: newsletters, podcasts and communities",
};
const CREATORS: NavPage = { ...PARTNERS, label: "Creators", keywords: "creators communities influencers newsletters podcasts press", long: "Creators and communities" };
const EVENTS: NavPage = { href: "/events", label: "Events", icon: CalendarHeart, key: "E", keywords: "events dinners roundtables" };
const PLAYBOOK: NavPage = { href: "/playbook", label: "Playbook", icon: NotebookPen, key: "P", keywords: "playbook icp positioning strategy" };
const STUDIO: NavPage = { href: "/studio", label: "Studio", icon: PenTool, key: "M", keywords: "studio marketing copy launch post ad headline landing page tagline", long: "Studio (marketing copy)" };

/**
 * Businesses sell account by account: pipeline, plays, intros and rooms. Consumer companies grow on retention and on
 * the people their users already follow, so they get the number, creators and research, and none of the deal desk.
 */
const NAV: Record<Market, readonly NavPage[]> = {
  b2b: [TODAY, REVENUE, COMPANIES, PLAYS, RESEARCH, INTROS, PARTNERS, EVENTS, PLAYBOOK, STUDIO],
  consumer: [TODAY, GROWTH, CREATORS, RESEARCH, PLAYBOOK, STUDIO],
};

export const SECONDARY: readonly NavPage[] = [
  { href: "/integrations", label: "Integrations", icon: Plug, key: "I", keywords: "integrations connect tools" },
  { href: "/settings", label: "Settings", icon: Settings, key: "S", keywords: "settings usage api key" },
];

/** The same page under the other market's name: switching from one lands on the other. */
const COUNTERPART: Record<string, string> = { "/revenue": "/growth", "/growth": "/revenue" };

/** The market the shell shows. A workspace still loading reads as business, like `marketOf`. */
export function shellMarket(ws: Workspace | null | undefined): Market {
  return ws ? marketOf(ws) : "b2b";
}

/** The main pages for a market, in sidebar order. */
export function navFor(market: Market): readonly NavPage[] {
  return NAV[market];
}

/** "G then T" targets for a market: the letter, lowercased, to the page. */
export function goKeys(market: Market): Record<string, string> {
  return Object.fromEntries([...NAV[market], ...SECONDARY].map((p) => [p.key.toLowerCase(), p.href]));
}

/** The page a path belongs to ("/events/evt_1" → "/events"), when it's one of the shell's pages. */
function pageOf(pathname: string): string | null {
  const base = `/${pathname.split("/")[1] ?? ""}`;
  return [...NAV.b2b, ...NAV.consumer, ...SECONDARY].some((p) => p.href === base) ? base : null;
}

/**
 * Where to go after switching to `to`, when the page open now is one that market doesn't use: its counterpart
 * (Revenue and Growth), else Today. Null when the page stays.
 */
export function landingAfterSwitch(pathname: string, to: Market): string | null {
  const page = pageOf(pathname);
  if (!page || [...NAV[to], ...SECONDARY].some((p) => p.href === page)) return null;
  return COUNTERPART[page] ?? TODAY.href;
}
