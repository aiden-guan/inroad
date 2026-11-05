/** Calendar records shared by the server (sync, store) and the Integrations page. Plain data only. */
import type { ISODateTime } from "@/lib/domain/types";
import type { EventStatus, SkipReason } from "./ics";

export type CalendarProvider = "google" | "outlook" | "icloud" | "fastmail" | "proton" | "zoho" | "other";

/** Where the feed lives, without the secret part of the address. */
export interface CalendarSource {
  provider: CalendarProvider;
  /** "Google Calendar", "Outlook". */
  label: string;
  host: string;
  /** The last few characters of the private address, so two addresses can be told apart. Never the address. */
  hint: string;
  /** The feed's own name (X-WR-CALNAME), often the owner's address. */
  name?: string;
}

export interface Guest {
  email?: string;
  name?: string;
}

/** One occurrence of a meeting with someone outside the company, as kept between syncs. Internal events are counted, not kept. */
export interface StoredEvent {
  /** The occurrence id from the feed: UID, plus the original start for an occurrence of a series. */
  id: string;
  title: string;
  start: ISODateTime;
  end?: ISODateTime;
  status: EventStatus;
  /** Guests at companies, by company domain, the busiest company first. */
  companies: { domain: string; guests: Guest[] }[];
  /** Guests with personal addresses (gmail.com and the like): people without a company. */
  personal: Guest[];
  /** Zoom, Google Meet, Teams or Webex, when the invite says. */
  conference?: string;
  recurring?: boolean;
}

/** Events in the window that aren't external meetings, counted so the founder can see nothing was lost. */
export interface HiddenCounts {
  internal: number;
  /** No guests besides the founder (focus time, holds). */
  solo: number;
  allDay: number;
  declined: number;
}

/** What the last read of the feed found. */
export interface FeedStats {
  at: ISODateTime;
  /** Occurrences in the window, before any filtering. */
  total: number;
  hidden: HiddenCounts;
  skipped: Partial<Record<SkipReason, number>>;
  /** The feed ended properly; a cut-off file never cancels meetings. */
  complete: boolean;
  /** Events that carry a guest list at all. Outlook's published calendars often leave it out. */
  withGuests: number;
  /** Every event is "Busy" with no title or guests: the public free/busy address, not the private one. */
  busyOnly?: boolean;
}

export type ReviewStatus = "new" | "known" | "customer";

/** A company on the calendar that isn't in the pipeline: Track or Ignore. */
export interface ReviewCompany {
  domain: string;
  name: string;
  status: ReviewStatus;
  next?: { id: string; title: string; start: ISODateTime };
  last?: { id: string; title: string; start: ISODateTime };
  meetings: number;
  guests: Guest[];
}

export type AgendaKind = "pipeline" | "review" | "personal" | "ignored";

/** One upcoming external meeting, for the "Coming up" list. */
export interface AgendaItem {
  id: string;
  title: string;
  start: ISODateTime;
  end?: ISODateTime;
  kind: AgendaKind;
  domain?: string;
  company?: string;
  /** The meeting it made on a deal, once applied. */
  meetingId?: string;
  guests: Guest[];
  conference?: string;
  cancelled?: boolean;
}

/** GET /api/calendar */
export interface CalendarDigest {
  state: "off" | "connected" | "sample";
  /** The workspace sells to consumers: meetings are read, never turned into deals. */
  consumer?: boolean;
  source?: CalendarSource;
  connectedAt?: ISODateTime;
  lastSyncAt?: ISODateTime;
  lastError?: string;
  nextSyncAt?: ISODateTime;
  window: { pastDays: number; futureDays: number };
  upcoming: { total: number; pipeline: number; newCompanies: number; personal: number };
  past: { total: number; onDeals: number };
  hidden: HiddenCounts;
  /** Plain sentences about what was skipped and why. */
  notes: string[];
  review: ReviewCompany[];
  agenda: AgendaItem[];
}

export const PAST_DAYS = 60;
export const FUTURE_DAYS = 30;
/** How far ahead "Coming up" lists meetings. */
export const AGENDA_DAYS = 14;
/** The rule on standalone Today cards for meetings with companies that aren't tracked yet. */
export const CALENDAR_MOVE_RULE = "calendar.new_company";
