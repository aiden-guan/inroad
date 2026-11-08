import { z } from "zod";
import type { IntegrationState } from "@/lib/domain/types";
import type { SearchProviderId } from "./search-types";

const SiteURL = z.url().refine((value) => {
  const u = new URL(value);
  return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash;
}, "Use your verified site's HTTP or HTTPS URL, without credentials, a query or a fragment.");
const SearchConsoleConfig = z.object({ siteUrl: z.union([SiteURL, z.string().regex(/^sc-domain:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i, "Use sc-domain:example.com or the exact URL-prefix property.")]) });
const BingConfig = z.object({ siteUrl: SiteURL });
const PostHogSearchConfig = z.object({
  region: z.enum(["us", "eu"]).default("us"),
  projectId: z.string().trim().regex(/^\d+$/).max(20),
  siteHost: z.string().trim().toLowerCase().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/, "Use a hostname, such as www.example.com, without https:// or a path."),
  conversionEvent: z.string().trim().max(200).default(""),
});

export type SearchConsoleSettings = z.infer<typeof SearchConsoleConfig>;
export type BingSettings = z.infer<typeof BingConfig>;
export type PostHogSearchSettings = z.infer<typeof PostHogSearchConfig>;

export function searchConfig(id: SearchProviderId, raw: unknown): IntegrationState["config"] {
  if (id === "google-search-console") return SearchConsoleConfig.parse(raw);
  if (id === "bing-webmaster") return BingConfig.parse(raw);
  return PostHogSearchConfig.parse(raw);
}

export const SearchConnectBody = z.object({ key: z.string().trim().min(8, "Paste the whole key.").max(20000), config: z.record(z.string(), z.unknown()).default({}) });
