"use client";

import { useEffect, useState } from "react";
import type { AiStatus, SettingsStatus } from "@/components/settings/types";
import { providerById } from "@/lib/ai/providers";

/** Where "Add credits" goes when no provider is known yet (Anthropic, as before providers were a choice). */
const FALLBACK_BILLING = providerById("anthropic")!.billingUrl;

let pending: Promise<AiStatus | null> | null = null;

/** The AI provider setup, read once per page load and shared by every component that asks. */
function loadAi(): Promise<AiStatus | null> {
  pending ??= fetch("/api/settings", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<SettingsStatus>) : null))
    .then((s) => s?.ai ?? null)
    .catch(() => null);
  return pending;
}

/** The provider setup (null until read, or when it can't be). Labels models and prices by what's really in use. */
export function useAiStatus(): AiStatus | null {
  const [ai, setAi] = useState<AiStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadAi().then((a) => !cancelled && setAi(a));
    return () => {
      cancelled = true;
    };
  }, []);
  return ai;
}

/** The active provider's billing page, for "Add credits" links on out-of-credit errors. */
export function useBillingUrl(): string {
  return useAiStatus()?.active?.billingUrl || FALLBACK_BILLING;
}

/** After the provider changes in Settings, the next read asks the server again. */
export function forgetActiveProvider() {
  pending = null;
}
