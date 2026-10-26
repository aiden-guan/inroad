import "server-only";
import { request } from "./http";
import { fail, ok, type Connector, type ConnectorFactory, type PollCursor, type SequencerPoll } from "./types";

/**
 * Cal.com API v2 with an API key (Bearer, `cal_live_…`). Every request carries `cal-api-version`
 * (research 06 §11; it changes, so it's one constant). `GET /v2/me` validates the key.
 *
 * A poll reads upcoming and cancelled bookings that start from yesterday on, newest changes only after
 * the first time, and hands each to the webhook parser as the payload Cal.com would have sent
 * (BOOKING_CREATED, BOOKING_RESCHEDULED with the booking it replaces, BOOKING_CANCELLED). Bookings
 * dedupe on uid, action and start time, so reading the same upcoming booking again changes nothing.
 * A reschedule leaves the old booking cancelled; its webhook sends only BOOKING_RESCHEDULED, so a
 * cancelled booking that was moved (flagged, or replaced by an upcoming one) is skipped here too.
 * The `afterStart`/`status` parameters are from research 06; `rescheduledFromUid`, `rescheduled`,
 * `rescheduledToUid` and `updatedAt` are UNVERIFIED and only used when present.
 */

const BASE = "https://api.cal.com/v2";
const TOOL = "Cal.com";
const API_VERSION = "2026-05-01";
const LOOKBACK_MS = 86_400_000;

type RawAttendee = { email?: string; name?: string };
type RawBooking = {
  uid?: string;
  title?: string;
  start?: string;
  status?: string;
  attendees?: RawAttendee[];
  rescheduledFromUid?: string;
  fromReschedule?: string;
  rescheduled?: boolean;
  rescheduledToUid?: string;
  createdAt?: string;
  updatedAt?: string;
};

export const calcom: ConnectorFactory = (key) => {
  const call = <T>(path: string) =>
    request<T>({ tool: TOOL, method: "GET", url: BASE + path, headers: { authorization: `Bearer ${key}`, "cal-api-version": API_VERSION }, secrets: [key] });

  const connector: Connector = {
    id: "calcom",
    name: TOOL,

    async validate() {
      const me = await call<{ data?: { email?: string; username?: string; name?: string } }>("/me");
      if (!me.ok) return me;
      const d = me.value?.data;
      if (!d) return fail("validation", "Cal.com answered without your account. Check the key and try again.");
      return ok({ accountLabel: d.name || d.username || d.email || "Cal.com" });
    },

    booking: {
      async pollEvents(cursor: PollCursor) {
        const now = Date.now();
        const since = cursor.since;
        const afterStart = new Date(now - LOOKBACK_MS).toISOString();
        const events: SequencerPoll["events"] = [];
        const warnings: string[] = [];
        let newest = since ?? new Date(now).toISOString();
        let read = 0;
        const lists: Record<"upcoming" | "cancelled", RawBooking[]> = { upcoming: [], cancelled: [] };
        for (const status of ["upcoming", "cancelled"] as const) {
          const q = new URLSearchParams({ status, afterStart, limit: "100" });
          const r = await call<{ data?: RawBooking[] }>(`/bookings?${q}`);
          if (!r.ok) {
            if (r.error.code === "auth") return r;
            warnings.push(r.error.message);
            continue;
          }
          read++;
          lists[status] = (r.value?.data ?? []).filter((b) => b.uid);
        }
        const moved = new Set(lists.upcoming.map((b) => b.rescheduledFromUid ?? b.fromReschedule).filter(Boolean));
        for (const status of ["upcoming", "cancelled"] as const) {
          for (const b of lists[status]) {
            const changed = b.updatedAt ?? b.createdAt;
            // After the first poll, only what changed since; dedupe covers the rest when a date is missing.
            if (since && changed && changed <= since) continue;
            if (status === "cancelled" && (b.rescheduled === true || b.rescheduledToUid || moved.has(b.uid))) continue;
            if (changed && changed > newest) newest = changed;
            const replaces = b.rescheduledFromUid ?? b.fromReschedule;
            const payload = { uid: b.uid, title: b.title, startTime: b.start, attendees: b.attendees ?? [], ...(replaces ? { rescheduleUid: replaces } : {}) };
            const triggerEvent = status === "cancelled" ? "BOOKING_CANCELLED" : replaces ? "BOOKING_RESCHEDULED" : "BOOKING_CREATED";
            events.push({ triggerEvent, payload });
          }
        }
        if (!read) return fail("upstream", warnings[0] ?? "Cal.com didn't return any bookings.");
        return ok({ events, cursor: { since: newest }, ...(warnings.length ? { warnings } : {}) });
      },
    },
  };
  return connector;
};
