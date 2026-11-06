import { z } from "zod";
import type { Workspace } from "@/lib/domain/types";
import { METRIC_PROVIDERS } from "@/lib/metrics/catalog";
import { METRIC_PROVIDER_IDS } from "@/lib/metrics/types";

const sections = ["waitlist", "goal", "weekly", "priorities", "plan", "channels", "review"] as const;
export const GrowthDashboardSchema = z.object({
  cards: z.array(z.object({
    id: z.string().max(180).refine((id) => sections.some((s) => s === id) || /^metric:(posthog|stripe|polar):[a-zA-Z0-9_]+$/.test(id), "Choose a Growth card."),
    wide: z.boolean(),
  })).max(50).refine((cards) => new Set(cards.map((c) => c.id)).size === cards.length, "Each card can only appear once."),
});
export type GrowthDashboardLayout = z.infer<typeof GrowthDashboardSchema>;
export type GrowthCard = GrowthDashboardLayout["cards"][number];
export interface GrowthCardOption { id: string; title: string; description: string; group: string; wide: boolean }

const SECTION_OPTIONS: GrowthCardOption[] = [
  { id: "waitlist", title: "Waitlist", description: "Signups, target and growth from your database.", group: "Your numbers", wide: false },
  { id: "goal", title: "Growth goal", description: "Your weekly goal, pace and retention reading.", group: "Planning & reviews", wide: true },
  { id: "weekly", title: "Weekly numbers", description: "Log a week and review your growth history.", group: "Planning & reviews", wide: true },
  { id: "priorities", title: "GTM priorities", description: "Initiatives, owners and measured progress.", group: "Planning & reviews", wide: true },
  { id: "plan", title: "What it takes", description: "The signups and conversations your goal needs.", group: "Planning & reviews", wide: true },
  { id: "channels", title: "What's working", description: "Channels, creators and referrals you've tracked.", group: "Planning & reviews", wide: true },
  { id: "review", title: "Growth review", description: "Run your Monday review when you're ready.", group: "Planning & reviews", wide: true },
];

/** Stable card keys survive reconnects; the reading and its history retain their full source identity. */
export function growthCardOptions(ws: Workspace): GrowthCardOption[] {
  const metrics = METRIC_PROVIDER_IDS.flatMap((provider) => {
    const name = METRIC_PROVIDERS[provider].name;
    const available = ws.businessMetrics?.[provider]?.metrics ?? (provider === "posthog" ? [
      { key: "active_1d", label: "Active users", period: "24 hours" },
      { key: "active_7d", label: "Active users", period: "7 days" },
      { key: "active_30d", label: "Active users", period: "30 days" },
    ] : []);
    return available.map((metric) => ({
      id: `metric:${provider}:${metric.key}`, title: metric.label,
      description: `${metric.period}${"currency" in metric && metric.currency ? ` · ${metric.currency}` : ""}`,
      group: name, wide: false,
    }));
  });
  return [SECTION_OPTIONS[0], ...metrics, ...SECTION_OPTIONS.slice(1)];
}

export function defaultGrowthDashboard(ws: Workspace): GrowthDashboardLayout {
  const options = growthCardOptions(ws);
  const billingCards = METRIC_PROVIDER_IDS.filter((id) => id !== "posthog" && ws.integrations[id]?.enabled).flatMap((id) => options.filter((o) => o.id.startsWith(`metric:${id}:`)).map((o) => o.id));
  const ids = ["waitlist", "metric:posthog:active_7d", ...billingCards, "goal", "priorities", "weekly", "plan", "channels", "review"];
  return { cards: ids.map((id) => ({ id, wide: options.find((o) => o.id === id)?.wide ?? false })) };
}

export function readGrowthDashboard(ws: Workspace): GrowthDashboardLayout {
  const parsed = GrowthDashboardSchema.safeParse(ws.growthDashboard);
  return parsed.success ? parsed.data : defaultGrowthDashboard(ws);
}

export function moveGrowthCard(cards: GrowthCard[], from: string, to: string): GrowthCard[] {
  const start = cards.findIndex((c) => c.id === from); const end = cards.findIndex((c) => c.id === to);
  if (start < 0 || end < 0 || start === end) return cards;
  const result = [...cards]; result.splice(end, 0, result.splice(start, 1)[0]);
  return result;
}
