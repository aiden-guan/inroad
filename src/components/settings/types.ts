/** Shapes shared by the settings routes and the settings page. Types only, safe on both sides. */

export type NewsSource = "gdelt" | "google_news" | "off";
export type Geocoder = "osm" | "off";
export type CompanyIcons = "letters" | "site";

/** GET/POST /api/settings. The key itself never leaves the server; only where it came from and its last 4. */
export interface SettingsStatus {
  hasKey: boolean;
  keySource: "settings" | "env" | null;
  keyHint: string | null;
  newsSource: NewsSource;
  /** Whether places outside the built-in city list are looked up on OpenStreetMap. */
  geocoder: Geocoder;
  /** Company marks: first letters only (nothing sent), or each company's icon from its own site. */
  companyIcons: CompanyIcons;
  /** A GitHub token is saved (its last 4 only); it lifts GitHub's limit from 60 to 5,000 lookups an hour. */
  githubTokenHint: string | null;
  /** The contact named to SEC EDGAR with Form D lookups, or null. */
  secContact: string | null;
  /** Absolute path of the folder that holds workspace.json, settings.json and the caches. */
  dataDir: string;
  /** The data folder is inside Inroad's own folder (no GTM_DATA_DIR), so deleting or re-cloning Inroad deletes it. */
  dataDirInApp: boolean;
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
