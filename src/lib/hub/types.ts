/** Hub records shared by the server store and the Integrations page. Plain data only. */
import type { HubEventType, ISODateTime } from "@/lib/domain/types";

export interface InboundCounts {
  accounts: number;
  people: number;
  activities: number;
  meetings: number;
  skipped: number;
}

export interface InboundLogEntry {
  id: string;
  source: string;
  at: ISODateTime;
  status: "ok" | "duplicate" | "unmapped" | "error";
  /** "1 reply · interested", "3 companies, 2 people". Built in code. */
  summary: string;
  counts: InboundCounts;
  /** Top-level fields we didn't recognise, so the founder can fix their mapping. */
  unmapped?: string[];
  /** Read by polling the tool's API rather than pushed to the hook URL. */
  via?: "poll";
}

/** Where a connector's change feed stands (GET /api/integrations/status → `poll`). */
export interface PollStatus {
  lastAt?: ISODateTime;
  /** Plain sentence about the last poll that found or failed something. */
  lastSummary?: string;
  lastError?: string;
  /** Not before this time (after a rate limit or an error). */
  nextAt?: ISODateTime;
}

export interface DeliveryLogEntry {
  id: string;
  webhookId: string;
  type: HubEventType;
  at: ISODateTime;
  status: number | "error";
  attempts: number;
  error?: string;
  test?: boolean;
}

export interface SyncLogEntry {
  id: string;
  integrationId: string;
  at: ISODateTime;
  ok: boolean;
  message: string;
}

/** GET /api/integrations/status */
export interface HubStatus {
  /** Where this app is reachable from this browser, as last seen by the server. */
  appUrl?: string;
  inbound: { secret: string; events: InboundLogEntry[] };
  signing: { secret: string };
  deliveries: DeliveryLogEntry[];
  sync: SyncLogEntry[];
  /** Which native connectors have a saved key. Never the key itself. */
  keys: Record<string, boolean>;
  slack: { briefSentOn?: string };
  /** Connectors read by polling because no public URL reaches this app. */
  poll?: Record<string, PollStatus>;
}
