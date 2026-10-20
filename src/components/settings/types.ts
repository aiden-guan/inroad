/** Shapes shared by the settings routes and the settings page. Types only, safe on both sides. */

export type NewsSource = "gdelt" | "google_news" | "off";

/** GET/POST /api/settings. The key itself never leaves the server; only where it came from and its last 4. */
export interface SettingsStatus {
  hasKey: boolean;
  keySource: "settings" | "env" | null;
  keyHint: string | null;
  newsSource: NewsSource;
  /** Absolute path of the folder that holds workspace.json, settings.json and the caches. */
  dataDir: string;
}

export type CheckStatus = "pass" | "warn" | "fail";

export interface DomainCheck {
  id: "mx" | "spf" | "dkim" | "dmarc";
  label: string;
  status: CheckStatus;
  /** One plain sentence: what I found. */
  summary: string;
  /** What to change, when something should change. */
  fix?: string;
  /** A DNS record to paste, when the fix is a record. */
  record?: { host: string; type: "TXT"; value: string };
  /** What is published today, verbatim. */
  found?: string;
}

/** POST /api/settings/domain-health → this. */
export interface DomainHealthReport {
  domain: string;
  provider: "google" | "microsoft" | "other" | "none";
  checks: DomainCheck[];
  checkedAt: string;
  /** DNS queries made (free, no tokens). */
  lookups: number;
}
