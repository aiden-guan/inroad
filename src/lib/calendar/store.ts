import "server-only";
import { FileDB, singletonDB } from "@/lib/store/file-db";
import type { SentEntry } from "./plan";
import type { FeedStats, StoredEvent } from "./types";

/**
 * Calendar bookkeeping in `.data/calendar.json`, beside the workspace (never in it): the meetings with
 * outsiders from the last good read, what was sent to deals (so only changes go through), and the
 * founder's Track and Ignore decisions. The private address itself is in secrets.json.
 */
export interface CalendarStore {
  events: StoredEvent[];
  stats?: FeedStats;
  /** Booking id (occurrence # company domain) → what the deal last got. */
  sent: Record<string, SentEntry>;
  /** Domains the founder said aren't sales meetings. */
  ignored: string[];
  /** Domains tracked from the calendar: all of their meetings go on the deal, past ones too. */
  accepted: string[];
  /** Ignore decisions made in the sample workspace, kept apart from the founder's own. */
  sampleIgnored: string[];
  /** The feed's name at the last read: a different calendar starts the sent ledger over. */
  name?: string;
  lastSyncAt?: string;
  lastError?: { at: string; message: string };
}

function empty(): CalendarStore {
  return { events: [], sent: {}, ignored: [], accepted: [], sampleIgnored: [] };
}

const db = () => singletonDB<CalendarStore>("calendar.json", () => new FileDB("calendar.json", empty, (raw) => ({ ...empty(), ...(raw as Partial<CalendarStore>) })));

export function readCalendarStore(): CalendarStore {
  return db().read();
}

export async function mutateCalendarStore<R = void>(fn: (s: CalendarStore) => R): Promise<R> {
  const { value } = await db().update(fn);
  return value;
}
