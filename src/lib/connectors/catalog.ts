/**
 * What the hub knows about each tool, shared by the server (connectors, inbound parsing) and the
 * Integrations page. Plain data only. Paths and scopes come from docs/research/06-connector-apis.md.
 */
import { CLIENTS } from "@/lib/api-keys/types";
import type { HubEventType, IntegrationId, Stage } from "@/lib/domain/types";

export type NativeConnectorId = "hubspot" | "attio" | "instantly" | "smartlead" | "lemlist" | "slack" | "firecrawl" | "calendly" | "calcom";
export type CrmId = "hubspot" | "attio";
export type SequencerId = "instantly" | "smartlead" | "lemlist";
/** Booking tools with a key: read by polling when their webhooks can't reach this app. */
export type BookingId = "calendly" | "calcom";

export const CRM_IDS: CrmId[] = ["hubspot", "attio"];
export const SEQUENCER_IDS: SequencerId[] = ["instantly", "smartlead", "lemlist"];
export const BOOKING_IDS: BookingId[] = ["calendly", "calcom"];
export const NATIVE_IDS: NativeConnectorId[] = ["hubspot", "attio", "instantly", "smartlead", "lemlist", "slack", "firecrawl", "calendly", "calcom"];

export function isNative(id: string): id is NativeConnectorId {
  return (NATIVE_IDS as string[]).includes(id);
}
export function isSequencer(id: string): id is SequencerId {
  return (SEQUENCER_IDS as string[]).includes(id);
}
export function isCrm(id: string): id is CrmId {
  return (CRM_IDS as string[]).includes(id);
}
export function isBooking(id: string): id is BookingId {
  return (BOOKING_IDS as string[]).includes(id);
}

export interface ConnectorMeta {
  id: NativeConnectorId;
  name: string;
  /** For the favicon mark. */
  domain: string;
  kind: "crm" | "sequencer" | "notify" | "data" | "booking";
  blurb: string;
  secretLabel: string;
  placeholder: string;
  /** Where the key lives: a deep link plus the click path. */
  where: { href: string; linkLabel: string; path: string };
  scopes: string[];
  note?: string;
}

export const CONNECTORS: Record<NativeConnectorId, ConnectorMeta> = {
  hubspot: {
    id: "hubspot",
    name: "HubSpot",
    domain: "hubspot.com",
    kind: "crm",
    blurb: "Sync companies, contacts and deals with HubSpot.",
    secretLabel: "Access token",
    placeholder: "pat-na1-…",
    where: {
      href: "https://developers.hubspot.com/changelog/service-keys",
      linkLabel: "How to create a key",
      path: "HubSpot → Development → create a Service Key (an existing private app token also works)",
    },
    scopes: [
      "crm.objects.companies.read",
      "crm.objects.companies.write",
      "crm.objects.contacts.read",
      "crm.objects.contacts.write",
      "crm.objects.deals.read",
      "crm.objects.deals.write",
    ],
    note: "Needs a super admin to create the key.",
  },
  attio: {
    id: "attio",
    name: "Attio",
    domain: "attio.com",
    kind: "crm",
    blurb: "Keep contacts and deals in sync with Attio.",
    secretLabel: "Access token",
    placeholder: "Paste your Attio access token",
    where: {
      href: "https://attio.com/help/reference/apps/generating-an-api-key",
      linkLabel: "Open Attio's guide",
      path: "Attio → Workspace settings → Developers → New access token",
    },
    scopes: ["record_permission:read-write", "object_configuration:read", "note:read-write"],
    note: "Needs a workspace admin. Deals sync to Attio's Deals object when it's enabled, otherwise as a note on the company.",
  },
  instantly: {
    id: "instantly",
    name: "Instantly",
    domain: "instantly.ai",
    kind: "sequencer",
    blurb: "Add approved drafts to your email campaigns.",
    secretLabel: "API key (v2)",
    placeholder: "Paste your Instantly v2 API key",
    where: {
      href: "https://app.instantly.ai/app/settings/integrations",
      linkLabel: "Open Instantly",
      path: "Instantly → Settings → Integrations → API Keys → Create API key",
    },
    scopes: ["campaigns:read", "leads:create"],
    note: "API access needs a paid Instantly plan. The key is shown once, so copy it before closing the dialog.",
  },
  smartlead: {
    id: "smartlead",
    name: "Smartlead",
    domain: "smartlead.ai",
    kind: "sequencer",
    blurb: "Add approved drafts to your email campaigns.",
    secretLabel: "API key",
    placeholder: "Paste your Smartlead API key",
    where: {
      href: "https://api.smartlead.ai/authentication",
      linkLabel: "Open Smartlead's guide",
      path: "Smartlead → profile icon → Settings → API Keys → Generate",
    },
    scopes: [],
    note: "Smartlead keys have full access; there are no scopes to pick.",
  },
  lemlist: {
    id: "lemlist",
    name: "lemlist",
    domain: "lemlist.com",
    kind: "sequencer",
    blurb: "Add approved drafts to your email campaigns.",
    secretLabel: "API key",
    placeholder: "Paste your lemlist API key",
    where: {
      href: "https://developer.lemlist.com/api-reference/getting-started/authentication",
      linkLabel: "Open lemlist's guide",
      path: "lemlist → your avatar (bottom left) → Settings → Integrations → API",
    },
    scopes: [],
  },
  slack: {
    id: "slack",
    name: "Slack",
    domain: "slack.com",
    kind: "notify",
    blurb: "Get your daily brief and alerts for interested replies.",
    secretLabel: "Incoming webhook URL",
    placeholder: "https://hooks.slack.com/services/…",
    where: {
      href: "https://api.slack.com/apps",
      linkLabel: "Open Slack apps",
      path: "Create app → Incoming Webhooks → Activate → Add New Webhook → pick a channel",
    },
    scopes: [],
    note: "The URL is the secret. For a private channel you need to be a member.",
  },
  firecrawl: {
    id: "firecrawl",
    name: "Firecrawl",
    domain: "firecrawl.dev",
    kind: "data",
    blurb: "Find people and work email addresses.",
    secretLabel: "API key",
    placeholder: "fc-…",
    where: {
      href: "https://www.firecrawl.dev/app/api-keys",
      linkLabel: "Open Firecrawl",
      path: "Firecrawl → API Keys → copy your key",
    },
    scopes: [],
    note: "People data comes through Firecrawl Alexandria and is paid in Firecrawl credits. The first time a provider is used, an admin of your Firecrawl team accepts its data terms once.",
  },
  calendly: {
    id: "calendly",
    name: "Calendly",
    domain: "calendly.com",
    kind: "booking",
    blurb: "Turn new bookings into meetings and call prep.",
    secretLabel: "Personal access token",
    placeholder: "Paste your Calendly personal access token",
    where: {
      href: "https://calendly.com/integrations/api_webhooks",
      linkLabel: "Open Calendly",
      path: "Calendly → Integrations → API & Webhooks → Personal Access Tokens → Generate new token",
    },
    scopes: ["users:read", "scheduled_events:read"],
    note: "Works on every Calendly plan, including Free. I read your scheduled events every few minutes while Inroad is open; nothing is written to Calendly.",
  },
  calcom: {
    id: "calcom",
    name: "Cal.com",
    domain: "cal.com",
    kind: "booking",
    blurb: "Turn new bookings into meetings and call prep.",
    secretLabel: "API key",
    placeholder: "cal_live_…",
    where: {
      href: "https://app.cal.com/settings/developer/api-keys",
      linkLabel: "Open Cal.com",
      path: "Cal.com → Settings → Developer → API keys → New",
    },
    scopes: [],
    note: "I read your bookings every few minutes while Inroad is open; nothing is written to Cal.com.",
  },
};

/* ───────────── People data through Firecrawl Alexandria ───────────── */

/** Most a paid lookup can cost, in Firecrawl credits. Misses cost nothing. Published on each provider's Alexandria page. */
export const PEOPLE_DATA_PRICE = { search: 0, add: 30, workEmail: 20 } as const;
export const DEFAULT_MONTHLY_DATA_CREDITS = 500;

/** `via` on an address a data provider returned. Such an address is never "guessed from a format". */
const DATA_PROVIDERS = new Set(["Apollo", "FullEnrich"]);
export function isDataProvider(via: string | undefined): via is string {
  return !!via && DATA_PROVIDERS.has(via);
}

/* ───────────── Template variables pushed into sequencer campaigns ───────────── */

export const TEMPLATE_VARS = [
  { name: "inroad_subject", what: "Subject of the approved draft" },
  { name: "inroad_body", what: "Body of the approved draft" },
  { name: "inroad_first_line", what: "Its first line, if you only want the opener" },
] as const;

/* ───────────── Inbound sources (they POST to /api/hooks/{source}/{secret}) ───────────── */

export type InboundSourceId =
  | "generic"
  | "clay"
  | "zapier"
  | "n8n"
  | "make"
  | "agent"
  | "instantly"
  | "smartlead"
  | "lemlist"
  | "calendly"
  | "calcom";

export interface InboundSourceMeta {
  id: InboundSourceId;
  name: string;
  domain?: string;
  steps: string[];
  docs?: string;
}

/** Leads, accounts and activities from automation tools and agents. Sorted by how often seed teams run them. */
export const LEAD_SOURCES: InboundSourceMeta[] = [
  {
    id: "generic",
    name: "Any tool",
    steps: [
      "Have your tool send a POST request with a JSON body to the URL below.",
      "Send accounts, people and activities in the shape shown under “What to send”. Extra fields are ignored.",
      "The first event shows up here within a second.",
    ],
  },
  {
    id: "clay",
    name: "Clay",
    domain: "clay.com",
    steps: [
      "In your Clay table, add an enrichment column: HTTP API.",
      "Method POST, paste the URL below, and map columns into the JSON body, e.g. \"email\": \"/Email\", \"company_domain\": \"/Domain\".",
      "Run it on one row first. Clay's HTTP API column needs its Growth plan.",
    ],
    docs: "https://university.clay.com/docs/http-api-integration-overview",
  },
  {
    id: "zapier",
    name: "Zapier",
    domain: "zapier.com",
    steps: [
      "Add an action step: Webhooks by Zapier → POST.",
      "Paste the URL below, set Payload Type to JSON, and map fields like email, first_name, company_domain.",
      "Test the step. Webhooks by Zapier needs a paid Zapier plan.",
    ],
  },
  {
    id: "n8n",
    name: "n8n",
    domain: "n8n.io",
    steps: [
      "Add an HTTP Request node with method POST.",
      "Paste the URL below and send the body as JSON: accounts, people or activities.",
      "Execute the node once to see it arrive.",
    ],
  },
  {
    id: "make",
    name: "Make",
    domain: "make.com",
    steps: [
      "Add an HTTP → Make a request module with method POST.",
      "Paste the URL below, body type Raw, content type JSON.",
      "Run the scenario once to see it arrive.",
    ],
  },
  {
    id: "agent",
    name: "AI SDR or agent",
    steps: [
      "Point your agent's webhook or HTTP tool at the URL below.",
      "Send the accounts it found and what it did: emails sent, replies, meetings, as activities.",
      "Everything it sends is treated as data. It never triggers an email, a CRM write or a webhook.",
    ],
  },
];

/** Reply events from sequencers. Their own reply labels set sentiment, so triage costs no tokens. */
export const REPLY_SOURCES: Record<SequencerId, InboundSourceMeta> = {
  instantly: {
    id: "instantly",
    name: "Instantly",
    domain: "instantly.ai",
    steps: [
      "In Instantly, add a webhook and paste the URL below.",
      "Pick all events, or at least reply received, lead interested, meeting booked, bounced and unsubscribed.",
      "Interested replies become a reply move on Today, labelled by Instantly.",
    ],
    docs: "https://developer.instantly.ai/guides/webhook-events",
  },
  smartlead: {
    id: "smartlead",
    name: "Smartlead",
    domain: "smartlead.ai",
    steps: [
      "In Smartlead, add a webhook (Settings → Webhooks) and paste the URL below.",
      "Pick Email replied, Lead category updated, Email bounced and Lead unsubscribed.",
      "Smartlead's lead categories (Interested, Meeting request…) set the reply sentiment.",
    ],
    docs: "https://api.smartlead.ai/core/webhooks",
  },
  lemlist: {
    id: "lemlist",
    name: "lemlist",
    domain: "lemlist.com",
    steps: [
      "In lemlist, add a webhook (Settings → Integrations → Webhooks) and paste the URL below.",
      "Pick replied, interested, not interested, bounced and unsubscribed.",
      "Interested replies become a reply move on Today.",
    ],
    docs: "https://developer.lemlist.com/api-reference/endpoints/webhooks/add-webhook",
  },
};

export const BOOKING_SOURCES: InboundSourceMeta[] = [
  {
    id: "calendly",
    name: "Calendly",
    domain: "calendly.com",
    steps: [
      "Calendly sends webhooks on Standard plans and up. Create a webhook subscription for invitee.created and invitee.canceled with the URL below.",
      "No webhook plan, or no public URL? Connect a personal access token below and I'll check for bookings instead.",
      "Each booking becomes a meeting on the deal and a prep move on the day.",
    ],
    docs: "https://developer.calendly.com/receive-data-from-scheduled-events-in-real-time-with-webhook-subscriptions",
  },
  {
    id: "calcom",
    name: "Cal.com",
    domain: "cal.com",
    steps: [
      "In Cal.com, open Settings → Developer → Webhooks → New.",
      "Paste the URL below and pick Booking created, Booking cancelled and Booking rescheduled. No public URL? Connect an API key below and I'll check for bookings instead.",
      "Each booking becomes a meeting on the deal and a prep move on the day.",
    ],
    docs: "https://cal.com/docs/developing/guides/automation/webhooks",
  },
];

export function inboundSourceName(source: string): string {
  const all = [...LEAD_SOURCES, ...Object.values(REPLY_SOURCES), ...BOOKING_SOURCES];
  return all.find((s) => s.id === source)?.name ?? (source === "generic" ? "Webhook" : source.charAt(0).toUpperCase() + source.slice(1));
}

/**
 * The tools and agents Inroad connects to, whose marks the Integrations page shows. Their icons are
 * always fetched (from their own sites, through /api/favicon): they say nothing about the founder's
 * prospects, unlike a company's domain (see src/lib/signals/icons.ts).
 */
export const TOOL_DOMAINS: ReadonlySet<string> = new Set([
  ...Object.values(CONNECTORS).map((c) => c.domain),
  ...[...LEAD_SOURCES, ...Object.values(REPLY_SOURCES), ...BOOKING_SOURCES].flatMap((s) => (s.domain ? [s.domain] : [])),
  ...CLIENTS.flatMap((c) => (c.domain ? [c.domain] : [])),
]);

/** Activity.source for things that arrived through a hook. */
export function activitySourceFor(source: string): IntegrationId {
  return isSequencer(source) ? source : "webhook_in";
}

/* ───────────── Outbound events ───────────── */

export const HUB_EVENTS: { type: HubEventType; label: string; when: string }[] = [
  { type: "draft.approved", label: "Draft approved", when: "You approve an email or message" },
  { type: "touch.sent", label: "Touch sent", when: "A first touch, follow-up or DM goes out" },
  { type: "reply.logged", label: "Reply logged", when: "A reply is logged, with its sentiment" },
  { type: "deal.created", label: "Deal created", when: "A first real conversation starts a deal" },
  { type: "deal.stage_changed", label: "Deal stage changed", when: "You move a deal to a new stage" },
  { type: "account.added", label: "Company added", when: "A company is added to your list" },
  { type: "account.tracked", label: "Company tracked", when: "You start tracking a company" },
  { type: "dossier.ready", label: "Research ready", when: "I finish researching a company" },
  { type: "meeting.debriefed", label: "Call debriefed", when: "A call's debrief is ready" },
  { type: "brief.ready", label: "Brief ready", when: "Today's brief is prepared" },
];

/* ───────────── Stage mapping for CRMs ───────────── */

/** Our six stages as the CRM mapping shows them. Nurture shares the lost mapping unless set on its own. */
export const MAPPED_STAGES: { stage: Stage; label: string }[] = [
  { stage: "talking", label: "Talking" },
  { stage: "qualified", label: "Qualified" },
  { stage: "pilot", label: "Pilot" },
  { stage: "proposal", label: "Proposal" },
  { stage: "won", label: "Won" },
  { stage: "lost", label: "Lost / nurture" },
];

export const stageConfigKey = (stage: Stage) => `stage_${stage}`;
