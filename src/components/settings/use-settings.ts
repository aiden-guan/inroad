"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { CompanyIcons, Geocoder, NewsSource, SettingsStatus } from "./types";

/* ───────────── Local settings (GET/POST /api/settings) ───────────── */

export function useSettingsStatus() {
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        return (await res.json()) as SettingsStatus;
      })
      .then((s) => !cancelled && setStatus(s))
      .catch(() => !cancelled && setError("Couldn't read your local settings. Is the app still running?"));
    return () => {
      cancelled = true;
    };
  }, []);

  /** Posts a change; returns an error message to show inline, or null when it saved. */
  const save = useCallback(async (body: { anthropicApiKey?: string | null; newsSource?: NewsSource; geocoder?: Geocoder; companyIcons?: CompanyIcons; githubToken?: string | null; secContact?: string | null }): Promise<string | null> => {
    try {
      const res = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) return json?.error ?? "That didn't save. Try again.";
      setStatus(json as SettingsStatus);
      setError(null);
      return null;
    } catch {
      return "Couldn't reach the app to save that. Is it still running?";
    }
  }, []);

  return { status, error, save };
}

/* ───────────── Theme: System / Light / Dark ───────────── */

export type ThemePref = "system" | "light" | "dark";

function readPref(): ThemePref {
  try {
    const t = localStorage.getItem("theme");
    if (t === "light" || t === "dark") return t;
  } catch {
    // private mode: fall through to the attribute
  }
  const attr = document.documentElement.dataset.theme;
  return attr === "light" || attr === "dark" ? attr : "system";
}

function subscribePref(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  window.addEventListener("storage", cb);
  return () => {
    obs.disconnect();
    window.removeEventListener("storage", cb);
  };
}

/** Same storage as the sidebar toggle: localStorage "theme" plus data-theme on <html>. System clears both. */
export function useThemePref() {
  const pref = useSyncExternalStore(subscribePref, readPref, () => null);
  const setPref = (next: ThemePref) => {
    try {
      if (next === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", next);
    } catch {
      // private mode: the choice lasts for this tab
    }
    if (next === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
  };
  return { pref, setPref };
}
