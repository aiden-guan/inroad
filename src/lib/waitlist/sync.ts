import "server-only";
import { isConsumer } from "@/lib/consumer/market";
import { getSecret, mutateWorkspace, readWorkspace, setSecrets } from "@/lib/store/workspace";
import { cleanCredential, discoverTables, readWaitlist, WaitlistError } from "./databases";
import { detectWaitlist, recordWaitlist, type WaitlistProvider, type WaitlistReading, type WaitlistTable } from "./types";

const SYNC_MS = 15 * 60_000;

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const global = globalThis as typeof globalThis & { __waitlistQueue?: Promise<void> };
  const result = (global.__waitlistQueue ?? Promise.resolve()).then(work);
  const tail = result.then(() => undefined, () => undefined);
  global.__waitlistQueue = tail;
  void tail.then(() => { if (global.__waitlistQueue === tail) delete global.__waitlistQueue; });
  return result;
}

function canConnect() {
  const ws = readWorkspace();
  if (ws.sample) throw new WaitlistError("Leave the sample workspace before connecting a real waitlist.");
  if (!isConsumer(ws)) throw new WaitlistError("Waitlist tracking is available for consumer companies in Growth.");
}

export function connectWaitlist(provider: WaitlistProvider, raw: string, selected?: WaitlistTable) {
  return serialized(async () => {
    canConnect();
    const credential = cleanCredential(raw);
    const tables = await discoverTables(provider, credential);
    const table = selected ? tables.find((t) => t.name === selected.name && t.schema === selected.schema) : detectWaitlist(tables);
    if (selected && !table) throw new WaitlistError("That table is no longer available. Choose a table from the list.");
    if (!table) return { status: "choose" as const, tables };
    const result = await readWaitlist(provider, credential, table);
    canConnect();
    const previous = getSecret("waitlist", "credential") ?? null;
    setSecrets("waitlist", { credential });
    try {
      await mutateWorkspace((ws) => {
        if (ws.sample || !isConsumer(ws)) throw new WaitlistError("Open your consumer workspace before connecting a waitlist.");
        const at = new Date().toISOString();
        const reading: WaitlistReading = { at, total: result.total, sourceId: result.source.id };
        const before = ws.waitlist;
        ws.waitlist = {
          source: result.source, enabled: true, connectedAt: before?.source.id === result.source.id ? before.connectedAt : at,
          current: reading, history: recordWaitlist(before?.history ?? [], reading),
          goal: before?.goal, nextSyncAt: new Date(Date.now() + SYNC_MS).toISOString(),
        };
      });
    } catch (error) {
      setSecrets("waitlist", { credential: previous });
      throw error;
    }
    return { status: "done" as const };
  });
}

export function disconnectWaitlist() {
  return serialized(async () => {
    // Retain the history and target for reconnecting or switching markets.
    await mutateWorkspace((ws) => {
      if (!ws.waitlist) return;
      ws.waitlist.enabled = false;
      delete ws.waitlist.lastError;
      delete ws.waitlist.nextSyncAt;
    });
    setSecrets("waitlist", { credential: null });
  });
}

export function setWaitlistGoal(goal: number | null) {
  return serialized(async () => {
    if (goal !== null && (!Number.isSafeInteger(goal) || goal <= 0)) throw new WaitlistError("Use a positive whole number for the waitlist target.");
    await mutateWorkspace((ws) => {
      if (!ws.waitlist) throw new WaitlistError("Connect your waitlist first.");
      if (goal === null) delete ws.waitlist.goal;
      else ws.waitlist.goal = goal;
    });
  });
}

/** null = not due. Failed reads never replace a working total with zero. */
export function syncWaitlist(force = true) {
  return serialized(async () => {
    const ws = readWorkspace();
    if (ws.sample || !isConsumer(ws)) return null;
    const state = ws.waitlist;
    if (!state?.enabled) {
      if (force) throw new WaitlistError("Connect your waitlist first.");
      return null;
    }
    if (!force && Date.parse(state.nextSyncAt ?? "") > Date.now()) return null;
    try {
      const credential = getSecret("waitlist", "credential");
      if (!credential) throw new WaitlistError("Your saved database login is missing. Reconnect your waitlist.");
      const result = await readWaitlist(state.source.provider, credential, state.source.table);
      if (result.source.id !== state.source.id) throw new WaitlistError("The saved database connection changed. Reconnect your waitlist.");
      let changed = false;
      await mutateWorkspace((draft) => {
        const current = draft.waitlist;
        if (!current?.enabled || current.source.id !== state.source.id || draft.sample || !isConsumer(draft)) return;
        const reading = { sourceId: result.source.id, at: new Date().toISOString(), total: result.total };
        current.current = reading;
        current.history = recordWaitlist(current.history, reading);
        current.nextSyncAt = new Date(Date.now() + SYNC_MS).toISOString();
        delete current.lastError;
        changed = true;
      });
      return { id: "waitlist", ok: true, changed };
    } catch (error) {
      const message = error instanceof WaitlistError ? error.message : "Couldn't sync your waitlist. Your last successful total has been kept.";
      await mutateWorkspace((draft) => {
        if (!draft.waitlist?.enabled || draft.waitlist.source.id !== state.source.id || draft.sample || !isConsumer(draft)) return;
        draft.waitlist.lastError = message;
        draft.waitlist.nextSyncAt = new Date(Date.now() + SYNC_MS).toISOString();
      });
      return { id: "waitlist", ok: false, changed: true, summary: message };
    }
  });
}
