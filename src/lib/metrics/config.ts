import { z } from "zod";
import type { IntegrationState } from "@/lib/domain/types";
import type { MetricProviderId } from "./types";

const PostHogConfig = z.object({
  region: z.enum(["us", "eu"]).default("us"),
  projectId: z.string().trim().regex(/^\d+$/, "Use the numeric project ID from PostHog.").max(20),
  activityEvent: z.string().trim().max(200).default("$pageview"),
  identifiedOnly: z.boolean().default(true),
});
const StripeConfig = z.object({ currency: z.string().trim().regex(/^[a-zA-Z]{3}$/, "Use a three-letter currency code, such as USD.").transform((v) => v.toLowerCase()).default("usd") });
const PolarConfig = z.object({ organizationId: z.uuid("Use the organization UUID from Polar settings.") });

export type PostHogSettings = z.infer<typeof PostHogConfig>;
export type StripeSettings = z.infer<typeof StripeConfig>;
export type PolarSettings = z.infer<typeof PolarConfig>;

/** Explicit allowlists: tokens, arbitrary API hosts and unknown settings cannot enter workspace.json. */
export function metricConfig(id: MetricProviderId, raw: unknown): IntegrationState["config"] {
  if (id === "posthog") return PostHogConfig.parse(raw);
  if (id === "stripe") return StripeConfig.parse(raw);
  return PolarConfig.parse(raw);
}

export const MetricConnectBody = z.object({
  key: z.string().trim().min(8, "Paste the whole key.").max(4000),
  config: z.record(z.string(), z.unknown()).default({}),
});
