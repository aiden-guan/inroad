import { useSyncExternalStore } from "react";
import { TOOL_DOMAINS } from "@/lib/connectors/catalog";

/**
 * Which company marks the browser may load. Letters until the founder turns on "Each company's own
 * icon" (Settings → General), so a target list never reaches a favicon service: icons come only from
 * this app's /api/favicon, which reads each company's own site. Tool marks always load.
 */

export type CompanyIcons = "letters" | "site";

let mode: CompanyIcons | null = null;
let loading = false;
const listeners = new Set<() => void>();

function load() {
  if (loading || mode) return;
  loading = true;
  fetch("/api/settings", { cache: "no-store" })
    .then((res) => (res.ok ? (res.json() as Promise<{ companyIcons?: CompanyIcons }>) : null))
    .then((s) => s?.companyIcons && setCompanyIcons(s.companyIcons))
    .catch(() => undefined)
    .finally(() => {
      loading = false;
    });
}

/** Settings calls this after saving, so every mark on screen follows at once. */
export function setCompanyIcons(next: CompanyIcons) {
  mode = next;
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  load();
  return () => listeners.delete(cb);
}

export function useCompanyIcons(): CompanyIcons {
  return useSyncExternalStore(
    subscribe,
    () => mode ?? "letters",
    () => "letters",
  );
}

/** Where a mark's image comes from, or null for the letter alone. Always same-origin. */
export function iconSrc(domain: string | undefined, setting: CompanyIcons): string | null {
  const d = (domain ?? "").trim().toLowerCase().replace(/^www\./, "");
  if (!d || !d.includes(".")) return null;
  return TOOL_DOMAINS.has(d) || setting === "site" ? `/api/favicon?domain=${encodeURIComponent(d)}` : null;
}
