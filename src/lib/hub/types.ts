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
}
