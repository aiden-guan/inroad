"use client";

import { useCallback, useEffect, useState } from "react";
import type { ModelTier } from "@/lib/ai/models";
import type { AccessLevel, AgentClient, CreateKeyResponse, KeyEffort, KeysResponse, UpdateKeyResponse } from "@/lib/api-keys/types";
import { tickNow } from "./bits";

async function readJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error ?? `Request failed (${res.status}).`);
  return body as T;
}

const fetchKeys = () => fetch("/api/mcp/keys", { cache: "no-store" }).then((r) => readJson<KeysResponse>(r));

/**
 * The founder's agent keys and their call feed. Refreshes on focus, and every 4s while `watching`
 * (right after creating a key, until the agent's first call arrives).
 */
export function useAgentKeys(watching: boolean) {
  const [data, setData] = useState<KeysResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchKeys();
      setData(next);
      setError(null);
      tickNow();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your agent keys.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchKeys()
      .then((next) => !cancelled && setData(next))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load your agent keys."));
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    if (!watching) return;
    const t = setInterval(() => void refresh(), 4000);
    // Stop polling after two minutes; focus still refreshes.
    const stop = setTimeout(() => clearInterval(t), 120_000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [watching, refresh]);

  const create = useCallback(
    async (input: { name: string; client: AgentClient; access: AccessLevel }) => {
      const res = await fetch("/api/mcp/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const created = await readJson<CreateKeyResponse>(res);
      setData((d) => (d ? { ...d, keys: [...d.keys, created.key] } : { keys: [created.key], calls: [] }));
      return created;
    },
    [],
  );

  const revoke = useCallback(async (id: string) => {
    const res = await fetch(`/api/mcp/keys/${encodeURIComponent(id)}`, { method: "DELETE" });
    await readJson(res);
    setData((d) => (d ? { ...d, keys: d.keys.filter((k) => k.id !== id) } : d));
  }, []);

  const update = useCallback(
    async (id: string, patch: { model?: ModelTier; effort?: KeyEffort }) => {
      // Optimistic: the picker moves at once; a failed save reloads what the server has.
      setData((d) => (d ? { ...d, keys: d.keys.map((k) => (k.id === id ? { ...k, ...patch } : k)) } : d));
      try {
        const res = await fetch(`/api/mcp/keys/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
        const { key } = await readJson<UpdateKeyResponse>(res);
        setData((d) => (d ? { ...d, keys: d.keys.map((k) => (k.id === id ? key : k)) } : d));
      } catch (e) {
        void refresh();
        throw e;
      }
    },
    [refresh],
  );

  return { data, error, refresh, create, revoke, update };
}
