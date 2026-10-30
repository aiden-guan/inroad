export type WaitlistProvider = "convex" | "postgres";

export interface WaitlistTable {
  name: string;
  schema?: string;
}

export interface WaitlistSource {
  provider: WaitlistProvider;
  /** Identifies the database, role and table, without storing credentials. */
  id: string;
  label: string;
  table: WaitlistTable;
}

export interface WaitlistReading {
  sourceId: string;
  at: string;
  total: number;
}

export interface WaitlistTracking {
  source: WaitlistSource;
  enabled: boolean;
  connectedAt: string;
  current: WaitlistReading;
  /** First reading and latest daily readings; earlier sources survive replacement. */
  history: WaitlistReading[];
  nextSyncAt?: string;
  lastError?: string;
  goal?: number;
}

export function tableLabel(table: WaitlistTable): string {
  return table.schema ? `${table.schema}.${table.name}` : table.name;
}

/** Only an unambiguous waitlist name can be selected without asking. */
export function detectWaitlist(tables: WaitlistTable[]): WaitlistTable | undefined {
  const matches = tables.filter((t) => /^(waitlists?|waitlistsignups|waitlistentries|waitinglist|earlyaccess|earlyaccesssignups)$/.test(t.name.toLowerCase().replace(/[^a-z0-9]/g, "")));
  return matches.length === 1 ? matches[0] : undefined;
}

export function recordWaitlist(history: WaitlistReading[], reading: WaitlistReading): WaitlistReading[] {
  const next = [...history];
  const first = next.findIndex((r) => r.sourceId === reading.sourceId);
  const day = reading.at.slice(0, 10);
  const latest = next.findLastIndex((r) => r.sourceId === reading.sourceId && r.at.slice(0, 10) === day);
  if (latest < 0 || (latest === first && next[first].total !== reading.total)) next.push(reading);
  else if (latest !== first) next[latest] = reading;
  return next;
}

/** A change in the table's size, which can include removals; never called new signups. */
export function waitlistChange(state: WaitlistTracking): { value: number; since: string } | null {
  const points = state.history.filter((r) => r.sourceId === state.source.id && r.at < state.current.at).sort((a, b) => a.at.localeCompare(b.at));
  if (!points.length) return null;
  const cutoff = new Date(Date.parse(state.current.at) - 7 * 86_400_000).toISOString();
  const base = points.filter((r) => r.at <= cutoff).at(-1) ?? points[0];
  return { value: state.current.total - base.total, since: base.at };
}
