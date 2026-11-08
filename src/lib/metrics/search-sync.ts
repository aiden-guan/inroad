import "server-only";
import { fail, type Result } from "@/lib/connectors/types";
import { getSecret, mutateWorkspace, readWorkspace, setSecrets } from "@/lib/store/workspace";
import { SEARCH_PROVIDERS } from "./search-catalog";
import { searchConfig } from "./search-config";
import { fetchSearchMetrics } from "./search-providers";
import { SEARCH_PROVIDER_IDS, type SearchProviderId, type SearchSnapshot } from "./search-types";

export const SEARCH_SYNC_MS = 15 * 60_000;
const SECRET = "apiKey";

/** Shared across route bundles. A disconnect or replacement cannot race an older sync into saving. */
function serialized<T>(id: SearchProviderId, work: () => Promise<T>): Promise<T> {
  const global = globalThis as typeof globalThis & { __searchMetricQueues?: Map<SearchProviderId, Promise<void>> };
  const queues = global.__searchMetricQueues ??= new Map();
  const run = (queues.get(id) ?? Promise.resolve()).then(work);
  const tail = run.then(() => undefined, () => undefined);
  queues.set(id, tail);
  void tail.then(() => { if (queues.get(id) === tail) queues.delete(id); });
  return run;
}

async function saveSnapshot(id: SearchProviderId, snapshot: SearchSnapshot, config?: ReturnType<typeof searchConfig>) {
  await mutateWorkspace((ws) => {
    const previous = ws.integrations[id];
    ws.integrations[id] = {
      id, enabled: true, connectedAt: config ? snapshot.syncedAt : previous?.connectedAt,
      config: { ...(config ?? previous?.config), accountLabel: snapshot.accountLabel, nextMetricSyncAt: new Date(Date.now() + SEARCH_SYNC_MS).toISOString() },
      lastSyncAt: snapshot.syncedAt,
    };
    ws.searchMetrics ??= {};
    ws.searchMetrics[id] = snapshot;
  });
}

export function connectSearchMetrics(id: SearchProviderId, key: string, rawConfig: unknown): Promise<Result<SearchSnapshot>> {
  return serialized(id, async () => {
    if (readWorkspace().sample) return fail("validation", "Leave the sample workspace before connecting a real provider.");
    const config = searchConfig(id, rawConfig);
    const result = await fetchSearchMetrics(id, key, config);
    if (!result.ok) return result;
    const previousKey = getSecret(id, SECRET);
    setSecrets(id, { [SECRET]: key });
    try {
      await saveSnapshot(id, result.value, config);
    } catch (error) {
      setSecrets(id, { [SECRET]: previousKey ?? null });
      throw error;
    }
    return result;
  });
}

export function disconnectSearchMetrics(id: SearchProviderId): Promise<void> {
  return serialized(id, async () => {
    setSecrets(id, { [SECRET]: null });
    await mutateWorkspace((ws) => {
      const state = ws.integrations[id];
      if (!state) return;
      state.enabled = false;
      delete state.lastError;
      delete state.config.nextMetricSyncAt;
      // Keep the last aggregate snapshot on disk, but disconnected sources never appear as current.
    });
  });
}

/** null means not due. Failures keep the last good snapshot and back off instead of showing zero. */
export function syncSearchMetrics(id: SearchProviderId, force = true): Promise<Result<SearchSnapshot> | null> {
  return serialized(id, async () => {
    const ws = readWorkspace();
    if (ws.sample) return null;
    const state = ws.integrations[id];
    if (!state?.enabled) return force ? fail("validation", `${SEARCH_PROVIDERS[id].name} isn't connected.`) : null;
    if (!force && Date.parse(String(state.config.nextMetricSyncAt ?? "")) > Date.now()) return null;
    const key = getSecret(id, SECRET);
    let result: Result<SearchSnapshot>;
    try {
      result = key ? await fetchSearchMetrics(id, key, state.config) : fail("auth", `The saved ${SEARCH_PROVIDERS[id].name} key is missing. Reconnect the provider.`);
    } catch {
      result = fail("validation", `${SEARCH_PROVIDERS[id].name}'s saved settings couldn't be used. Reconnect the provider to update them.`);
    }
    if (result.ok) {
      await saveSnapshot(id, result.value);
    } else {
      const error = result.error;
      const wait = error.code === "auth" || error.code === "forbidden" ? 60 * 60_000 : SEARCH_SYNC_MS;
      await mutateWorkspace((draft) => {
        const st = draft.integrations[id];
        if (!st) return;
        st.lastError = { at: new Date().toISOString(), message: error.message };
        st.config.nextMetricSyncAt = new Date(Date.now() + wait).toISOString();
      });
    }
    return result;
  });
}

export async function pollSearchMetrics() {
  if (readWorkspace().sample) return [];
  const results = await Promise.all(SEARCH_PROVIDER_IDS.map(async (id) => {
    const result = await syncSearchMetrics(id, false);
    return { id, ok: result?.ok ?? true, changed: result !== null, ...(result && !result.ok ? { summary: result.error.message } : {}) };
  }));
  return results.filter((r) => r.changed);
}
