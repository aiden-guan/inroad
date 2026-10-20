import "server-only";
import { FileDB, singletonDB } from "@/lib/store/file-db";
import type { DeliveryLogEntry, InboundLogEntry, PollStatus, SyncLogEntry } from "./types";

/**
 * Hub bookkeeping in `.data/hub.json`, separate from the workspace because it's write-heavy and
 * the browser doesn't need most of it:
 *  - refs: our id → their id per connector (search indexes lag, so this ledger prevents duplicates)
 *  - seen: idempotency keys for inbound events and activities
 *  - known: domains imported from a CRM; companies the founder already knows, never suggested as prospects
 *  - logs: recent inbound events, outbound deliveries and CRM syncs, for the cards
 *  - poll: per-connector change-feed cursors, for when no public URL reaches us
 */
export interface HubState {
  refs: Record<string, { id: string; url?: string; at: string }>;
  seen: Record<string, string>;
  /** Domain → the CRM it came from. */
  known?: Record<string, string>;
  inbound: InboundLogEntry[];
  deliveries: DeliveryLogEntry[];
  sync: SyncLogEntry[];
  slack: { briefSentOn?: string };
  appUrl?: string;
  poll?: Record<string, PollStatus & { cursor: Record<string, string> }>;
}

const LIMITS = { seen: 5000, inbound: 100, deliveries: 100, sync: 50 };

function empty(): HubState {
  return { refs: {}, seen: {}, inbound: [], deliveries: [], sync: [], slack: {} };
}

const db = () => singletonDB<HubState>("hub.json", () => new FileDB("hub.json", empty, (raw) => ({ ...empty(), ...(raw as Partial<HubState>) })));

export function readHub(): HubState {
  return db().read();
}

export async function mutateHub<R = void>(fn: (hub: HubState) => R): Promise<R> {
  const { value } = await db().update((draft) => {
    const value = fn(draft);
    draft.inbound = draft.inbound.slice(0, LIMITS.inbound);
    draft.deliveries = draft.deliveries.slice(0, LIMITS.deliveries);
    draft.sync = draft.sync.slice(0, LIMITS.sync);
    const keys = Object.keys(draft.seen);
    if (keys.length > LIMITS.seen) for (const k of keys.slice(0, keys.length - LIMITS.seen)) delete draft.seen[k];
    return value;
  });
  return value;
}

/** Domains the founder already has in their CRM; discovery excludes them. */
export function knownDomains(): string[] {
  return Object.keys(readHub().known ?? {});
}

export const refKey = (integration: string, object: "company" | "person" | "deal", ourKey: string) => `${integration}:${object}:${ourKey.toLowerCase()}`;
