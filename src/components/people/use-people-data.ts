"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { DEFAULT_MONTHLY_DATA_CREDITS } from "@/lib/connectors/catalog";
import type { FoundEmail, PersonPreview } from "@/lib/connectors/types";
import { monthKey } from "@/lib/domain/ids";

export interface Preview extends PersonPreview {
  personId?: string;
}

interface ErrorBody {
  error?: string;
  code?: string;
  fixUrl?: string;
}

function showError(body: ErrorBody, fallback: string) {
  const fixUrl = body.fixUrl;
  toast.error(body.error ?? fallback, fixUrl ? { action: { label: "Open Firecrawl", onClick: () => window.open(fixUrl, "_blank", "noopener,noreferrer") } } : undefined);
}

async function post<T>(path: string, body: unknown, fallback: string): Promise<T | null> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      showError(json as ErrorBody, fallback);
      return null;
    }
    return json as T;
  } catch {
    showError({}, "Couldn't reach Inroad. Is it still running?");
    return null;
  }
}

export const credits = (n: number) => `${n.toLocaleString("en-US")} credit${n === 1 ? "" : "s"}`;

/** People data through Firecrawl: free search, paid add and email lookups, all in code. */
export function usePeopleData() {
  const { ws, refresh } = useWorkspace();
  const st = ws?.integrations.firecrawl;
  const connected = !!st?.enabled;
  const used = ws?.usage[monthKey()]?.dataCredits ?? 0;
  const configured = Number(st?.config.monthlyCredits);
  const limit = Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_MONTHLY_DATA_CREDITS;

  const find = useCallback((domain: string, titles?: string[]) => post<{ people: Preview[]; titles: string[]; total?: number }>("/api/people/find", { domain, titles }, "Couldn't search for people."), []);

  /** Free: buyers by title around a place ("New York, NY"), at any company. */
  const findNear = useCallback((near: string, titles?: string[]) => post<{ people: Preview[]; titles: string[]; total?: number }>("/api/people/find", { near, titles }, "Couldn't search near there."), []);

  const add = useCallback(
    async (domain: string | undefined, id: string) => {
      const r = await post<{ personId: string; credits: number; email: FoundEmail | null; movedOn: boolean; domain: string }>("/api/people/add", { domain, id }, "Couldn't add that person.");
      if (r) await refresh();
      return r;
    },
    [refresh],
  );

  const workEmail = useCallback(
    async (personId: string) => {
      const r = await post<{ email: FoundEmail | null; credits: number }>("/api/people/email", { personId }, "Couldn't look up an email.");
      if (r) await refresh();
      return r;
    },
    [refresh],
  );

  return { connected, used, limit, find, findNear, add, workEmail };
}
