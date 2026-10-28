/** One index for navigation, search and existing deep links. Never indexes saved values or keys. */
export const SETTINGS_PAGES = [
  { id: "general", label: "General", group: "Workspace", description: "Appearance, company icons and app updates." },
  { id: "you", label: "Profile & workflow", group: "Workspace", description: "Your details, Gmail, booking and daily routine." },
  { id: "company", label: "Company", group: "Workspace", description: "Who you sell to and the playbook for your market." },
  { id: "sending", label: "Sending", group: "Workspace", description: "Sender identity, domain health and outreach limits." },
  { id: "ai", label: "AI & models", group: "AI & research", description: "Providers, connections, models and task routing." },
  { id: "search", label: "Web search", group: "AI & research", description: "Search providers, page readers and daily limits." },
  { id: "images", label: "Images", group: "AI & research", description: "Image generation for Studio graphics." },
  { id: "sources", label: "Data sources", group: "AI & research", description: "News, maps and public records." },
  { id: "usage", label: "Usage & budget", group: "Manage", description: "AI spend, monthly budget and run receipts." },
  { id: "data", label: "Data & backups", group: "Manage", description: "Export, restore and manage your local workspace." },
] as const;

export type SettingsPageId = (typeof SETTINGS_PAGES)[number]["id"];
export const SETTINGS_GROUPS = ["Workspace", "AI & research", "Manage"] as const;

export const SETTINGS_ITEMS: { id: string; page: SettingsPageId; label: string; description: string; keywords?: string }[] = [
  { id: "appearance", page: "general", label: "Appearance", description: "System, light or dark theme.", keywords: "display color mode" },
  { id: "icons", page: "general", label: "Company icons", description: "Initials or icons from company websites.", keywords: "favicon logos privacy" },
  { id: "updates", page: "general", label: "Updates", description: "App version and update checks.", keywords: "upgrade release" },
  { id: "profile", page: "you", label: "About you", description: "Your name, title and email address.", keywords: "founder profile" },
  { id: "gmail", page: "you", label: "Gmail", description: "The inbox used for drafts and checking replies." },
  { id: "booking", page: "you", label: "Booking", description: "Meeting link and availability.", keywords: "calendar schedule timezone" },
  { id: "your-day", page: "you", label: "Your day", description: "When to show your daily close-out.", keywords: "routine time" },
  { id: "linkedin", page: "you", label: "LinkedIn", description: "Your LinkedIn profile." },
  { id: "market", page: "company", label: "Who you sell to", description: "Business or consumer market and company model.", keywords: "b2b audience playbook" },
  { id: "sender", page: "sending", label: "Sender identity", description: "Email signature, sender details and postal address.", keywords: "footer" },
  { id: "domain", page: "sending", label: "Sending domain", description: "Check your email domain's health.", keywords: "dns spf dkim dmarc" },
  { id: "caps", page: "sending", label: "Caps", description: "Daily outreach and cold email limits.", keywords: "sending rate" },
  { id: "suppression", page: "sending", label: "Suppression list", description: "People and domains you never contact.", keywords: "unsubscribe block do not contact" },
  { id: "api-key", page: "ai", label: "AI provider", description: "Choose your provider, API key and default models.", keywords: "anthropic claude openai google gemini groq ollama local server" },
  { id: "ai-routing", page: "ai", label: "AI connections and task routing", description: "Connect accounts and choose models for each task.", keywords: "automatic gateway" },
  { id: "web-search", page: "search", label: "Web search", description: "Search engine, page reader, browser extraction and daily request limits.", keywords: "firecrawl tinyfish endpoint" },
  { id: "images", page: "images", label: "Images for Studio graphics", description: "OpenAI key and image generation model.", keywords: "photos illustrations gpt image" },
  { id: "news", page: "sources", label: "News signals", description: "GDELT, Google News RSS or no news." },
  { id: "places", page: "sources", label: "Places on the map", description: "Built-in cities and OpenStreetMap lookups.", keywords: "geocoder location privacy" },
  { id: "public-data", page: "sources", label: "Public records", description: "GitHub token and SEC contact email.", keywords: "form d filings hacker news podcasts" },
  { id: "usage", page: "usage", label: "Usage & budget", description: "Monthly AI spend and budget limit.", keywords: "cost billing money price" },
  { id: "runs", page: "usage", label: "Recent runs", description: "Model, sources, time and cost for each run.", keywords: "history receipts log" },
  { id: "cost", page: "usage", label: "How Inroad keeps cost down", description: "What runs in code and what uses AI tokens." },
  { id: "export", page: "data", label: "Export", description: "Download your workspace or CSV spreadsheets.", keywords: "backup companies contacts people deals" },
  { id: "backups", page: "data", label: "Backups", description: "Restore a saved workspace.", keywords: "import recovery" },
  { id: "reset", page: "data", label: "Start over", description: "Reset your workspace or try sample data.", keywords: "delete clear" },
];

export function settingsPageFor(hash: string): SettingsPageId {
  return SETTINGS_ITEMS.find((item) => item.id === hash)?.page
    ?? SETTINGS_PAGES.find((page) => page.id === hash)?.id
    ?? "general";
}

export function searchSettings(query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return SETTINGS_ITEMS.filter((item) => {
    const page = SETTINGS_PAGES.find((page) => page.id === item.page)!;
    const text = `${item.label} ${item.description} ${item.keywords ?? ""} ${page.label} ${page.group}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
