/** Search is independent of the model: any supported model can use any of these providers. */
export const SEARCH_PROVIDERS = [
  { id: "firecrawl", name: "Firecrawl", env: "FIRECRAWL_API_KEY", keyUrl: "https://www.firecrawl.dev/app/api-keys" },
  { id: "deepseek", name: "DeepSeek", env: "DEEPSEEK_API_KEY", keyUrl: "https://platform.deepseek.com/api_keys" },
  { id: "tinyfish", name: "TinyFish", env: "TINYFISH_API_KEY", keyUrl: "https://agent.tinyfish.ai" },
  { id: "tavily", name: "Tavily", env: "TAVILY_API_KEY", keyUrl: "https://app.tavily.com" },
  { id: "exa", name: "Exa", env: "EXA_API_KEY", keyUrl: "https://dashboard.exa.ai/api-keys" },
  { id: "brave", name: "Brave Search", env: "BRAVE_SEARCH_API_KEY", keyUrl: "https://api-dashboard.search.brave.com" },
  { id: "custom", name: "Custom search endpoint", env: "INROAD_SEARCH_KEY", keyUrl: "" },
  { id: "connected", name: "Connected search tool", env: "INROAD_SEARCH_CONNECTION_ID", keyUrl: "" },
] as const;

export type SearchProviderId = (typeof SEARCH_PROVIDERS)[number]["id"];
export type SearchChoice = SearchProviderId | "auto" | "off";
export const SEARCH_CHOICES = ["auto", "off", ...SEARCH_PROVIDERS.map((p) => p.id)] as [SearchChoice, ...SearchChoice[]];

export interface SearchSettings {
  provider: SearchChoice;
  /** Full URL of a custom adapter, not an API base URL. Keys live in the integration secret store. */
  endpoint?: string;
  connectionId?: string;
  dailyLimit?: number;
  browser?: "off" | "tinyfish";
  browserDailyLimit?: number;
  pageConnectionId?: string;
}

export interface SearchStatus {
  chosen: SearchChoice;
  active: { id: SearchProviderId; name: string; keySource: "saved" | "env" | "integration" | "ai" | "none" } | null;
  endpoint: string | null;
  connectionId?: string;
  dailyLimit?: number;
  browser?: "off" | "tinyfish";
  browserDailyLimit?: number;
  pageConnectionId?: string;
  saved: Partial<Record<SearchProviderId, string>>;
  env: SearchProviderId[];
}

export function isSearchChoice(value: unknown): value is SearchChoice {
  return typeof value === "string" && SEARCH_CHOICES.includes(value as SearchChoice);
}

/** Custom adapters may run on this computer; all other endpoints must use HTTPS. */
export function cleanSearchEndpoint(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.href;
  } catch {
    return null;
  }
}
