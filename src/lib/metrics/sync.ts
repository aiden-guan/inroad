import "server-only";
import { randomUUID } from "node:crypto";
import { fail, type Result } from "@/lib/connectors/types";
import { getSecret, mutateWorkspace, readSecrets, readWorkspace, setSecrets } from "@/lib/store/workspace";
import { METRIC_PROVIDERS } from "./catalog";
import { metricConfig } from "./config";
import { fetchMetrics } from "./providers";
import { METRIC_PROVIDER_IDS, type MetricProviderId, type MetricSnapshot } from "./types";
import { posthogToken, revokePosthog, type PostHogOAuth } from "./posthog-auth";
import { recordProviderHistory } from "@/lib/gtm/metrics";

export const METRIC_SYNC_MS = 15 * 60_000;
const SECRET = "apiKey";

/** Shared across route bundles. A disconnect or replacement cannot race an older sync into saving. */
function serialized<T>(id: MetricProviderId, work: () => Promise<T>): Promise<T> {
  const global = globalThis as typeof globalThis & { __metricQueues?: Map<MetricProviderId, Promise<void>> };
  const queues = global.__metricQueues ??= new Map();
  const run = (queues.get(id) ?? Promise.resolve()).then(work);
  const tail = run.then(() => undefined, () => undefined);
  queues.set(id, tail);
  void tail.then(() => { if (queues.get(id) === tail) queues.delete(id); });
  return run;
}

async function saveSnapshot(id: MetricProviderId, snapshot: MetricSnapshot, config?: ReturnType<typeof metricConfig>, connected = false) {
  await mutateWorkspace((ws) => {
    const previous = ws.integrations[id];
    ws.integrations[id] = {
      id, enabled: true, connectedAt: connected ? snapshot.syncedAt : previous?.connectedAt,
      config: { ...(config ?? previous?.config), metricConnectionId: connected ? randomUUID() : previous?.config.metricConnectionId ?? `legacy:${id}:${previous?.connectedAt ?? ""}`, accountLabel: snapshot.accountLabel, nextMetricSyncAt: new Date(Date.now() + METRIC_SYNC_MS).toISOString() },
      lastSyncAt: snapshot.syncedAt,
    };
    ws.businessMetrics ??= {};
    ws.businessMetrics[id] = snapshot;
    recordProviderHistory(ws, snapshot, ws.integrations[id]!);
  });
}

export function connectMetrics(id: MetricProviderId, key: string, rawConfig: unknown, options: { oauth?: PostHogOAuth; stillActive?: () => boolean } = {}): Promise<Result<MetricSnapshot>> {
  return serialized(id, async () => {
    if (readWorkspace().sample) return fail("validation", "Leave the sample workspace before connecting a real provider.");
    const config = metricConfig(id, rawConfig);
    if (id === "posthog") config.authMode = options.oauth ? "oauth" : "key";
    const result = await fetchMetrics(id, key, config);
    if (!result.ok) return result;
    if (options.stillActive && !options.stillActive()) return fail("validation", "Connection canceled.");
    const previous = readSecrets()[id] ?? {};
    const secrets = { [SECRET]: key, ...(id === "posthog" ? { oauthClientId: options.oauth?.clientId ?? null, oauthRefreshToken: options.oauth?.refreshToken ?? null, oauthExpiresAt: options.oauth?.expiresAt ?? null } : {}) };
    setSecrets(id, secrets);
    try {
      await saveSnapshot(id, result.value, config, true);
    } catch (error) {
      setSecrets(id, Object.fromEntries(Object.keys(secrets).map((name) => [name, previous[name] ?? null])));
      throw error;
    }
    return result;
  });
}

export function disconnectMetrics(id: MetricProviderId): Promise<void> {
  return serialized(id, async () => {
    const refreshToken = id === "posthog" ? getSecret(id, "oauthRefreshToken") : undefined;
    const clientId = id === "posthog" ? getSecret(id, "oauthClientId") : undefined;
    setSecrets(id, { [SECRET]: null, ...(id === "posthog" ? { oauthClientId: null, oauthRefreshToken: null, oauthExpiresAt: null } : {}) });
    await mutateWorkspace((ws) => {
      const state = ws.integrations[id];
      if (!state) return;
      state.enabled = false;
      delete state.lastError;
      delete state.config.nextMetricSyncAt;
      // Keep the last aggregate snapshot on disk, but disconnected sources never appear as current.
    });
    if (refreshToken && clientId) await revokePosthog(refreshToken, clientId).catch(() => undefined);
  });
}

async function metricKey(id: MetricProviderId, forceRefresh = false): Promise<Result<string>> {
  const key = getSecret(id, SECRET);
  if (!key) return fail("auth", `The saved ${METRIC_PROVIDERS[id].name} connection is missing. Connect again.`);
  if (id !== "posthog" || readWorkspace().integrations.posthog?.config.authMode !== "oauth") return { ok: true, value: key };
  if (!forceRefresh && Number(getSecret(id, "oauthExpiresAt")) > Date.now() + 60_000) return { ok: true, value: key };
  const refreshToken = getSecret(id, "oauthRefreshToken");
  const clientId = getSecret(id, "oauthClientId");
  if (!refreshToken || !clientId) return fail("auth", "Connect PostHog again to renew access.");
  const result = await posthogToken({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }, refreshToken);
  if (!result.ok) return result;
  setSecrets(id, { apiKey: result.value.key, oauthRefreshToken: result.value.oauth.refreshToken, oauthExpiresAt: result.value.oauth.expiresAt });
  return { ok: true, value: result.value.key };
}

/** Change optional preferences without asking the founder to paste credentials again. */
export function updateMetricSettings(id: MetricProviderId, patch: Record<string, unknown>): Promise<Result<MetricSnapshot>> {
  return serialized(id, async () => {
    const ws = readWorkspace();
    const state = ws.integrations[id];
    if (ws.sample || !state?.enabled) return fail("validation", "Connect the provider first.");
    const key = await metricKey(id);
    if (!key.ok) return key;
    const config = metricConfig(id, { ...state.config, ...patch });
    const result = await fetchMetrics(id, key.value, config);
    if (result.ok) await saveSnapshot(id, result.value, config);
    return result;
  });
}

/** null means not due. Failures keep the last good snapshot and back off instead of showing zero. */
export function syncMetrics(id: MetricProviderId, force = true): Promise<Result<MetricSnapshot> | null> {
  return serialized(id, async () => {
    const ws = readWorkspace();
    if (ws.sample) return null;
    const state = ws.integrations[id];
    if (!state?.enabled) return force ? fail("validation", `${METRIC_PROVIDERS[id].name} isn't connected.`) : null;
    if (!force && Date.parse(String(state.config.nextMetricSyncAt ?? "")) > Date.now()) return null;
    let result: Result<MetricSnapshot>;
    try {
      const key = await metricKey(id);
      result = key.ok ? await fetchMetrics(id, key.value, state.config) : key;
      if (!result.ok && result.error.code === "auth" && id === "posthog" && state.config.authMode === "oauth" && key.ok) {
        const refreshed = await metricKey(id, true);
        result = refreshed.ok ? await fetchMetrics(id, refreshed.value, state.config) : refreshed;
      }
    } catch {
      result = fail("validation", `${METRIC_PROVIDERS[id].name}'s saved settings couldn't be used. Reconnect the provider to update them.`);
    }
    if (result.ok) {
      await saveSnapshot(id, result.value);
    } else {
      const error = result.error;
      const wait = error.code === "auth" || error.code === "forbidden" ? 60 * 60_000 : METRIC_SYNC_MS;
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

export async function pollMetrics() {
  if (readWorkspace().sample) return [];
  const results = await Promise.all(METRIC_PROVIDER_IDS.map(async (id) => {
    const result = await syncMetrics(id, false);
    return { id, ok: result?.ok ?? true, changed: result !== null, ...(result && !result.ok ? { summary: result.error.message } : {}) };
  }));
  return results.filter((r) => r.changed);
}
