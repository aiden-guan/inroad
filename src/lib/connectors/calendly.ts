import "server-only";
import { request } from "./http";
import { fail, ok, type Connector, type ConnectorFactory, type PollCursor, type SequencerPoll } from "./types";

/**
 * Calendly with a personal access token (Bearer). Its API works on every plan, Free included, while
 * webhooks need Standard or above, so polling is how most founders get bookings in.
 *
 * `GET /users/me` validates the token and gives the user URI. A poll lists the scheduled events that
 * start from yesterday on (`GET /scheduled_events?user=…&min_start_time=…`), keeps the ones updated
 * since the cursor, and reads their invitees. Each invitee becomes the payload Calendly's webhook would
 * have sent (`invitee.created` / `invitee.canceled`, with `old_invitee` on a reschedule), so polled and
 * pushed bookings take the same path and dedupe on the event URI. Field names follow Calendly's v2
 * docs (research 06 §11); the `updated_at` filter and sort parameter are UNVERIFIED.
 */

const BASE = "https://api.calendly.com";
const TOOL = "Calendly";
const LOOKBACK_MS = 86_400_000;
const MAX_EVENTS = 20;

type RawEvent = { uri?: string; name?: string; status?: string; start_time?: string; created_at?: string; updated_at?: string };
type RawInvitee = { uri?: string; email?: string; name?: string; status?: string; rescheduled?: boolean; old_invitee?: string | null; created_at?: string; updated_at?: string };

export const calendly: ConnectorFactory = (key, config) => {
  const call = <T>(path: string) => request<T>({ tool: TOOL, method: "GET", url: path.startsWith("http") ? path : BASE + path, headers: { authorization: `Bearer ${key}` }, secrets: [key] });

  const connector: Connector = {
    id: "calendly",
    name: TOOL,

    async validate() {
      const me = await call<{ resource?: { uri?: string; name?: string; email?: string; current_organization?: string } }>("/users/me");
      if (!me.ok) return me;
      const r = me.value?.resource;
      if (!r?.uri) return fail("validation", "Calendly answered without your user. Check the token and try again.");
      return ok({ accountLabel: r.name || r.email || "Calendly", config: { userUri: r.uri } });
    },

    booking: {
      async pollEvents(cursor: PollCursor) {
        const userUri = typeof config.userUri === "string" ? config.userUri : undefined;
        if (!userUri) return fail("validation", "Reconnect Calendly so I know whose bookings to read.");
        const now = Date.now();
        const since = cursor.since ?? new Date(now - LOOKBACK_MS).toISOString();
        const q = new URLSearchParams({ user: userUri, min_start_time: new Date(now - LOOKBACK_MS).toISOString(), count: "100", sort: "start_time:asc" });
        const list = await call<{ collection?: RawEvent[] }>(`/scheduled_events?${q}`);
        if (!list.ok) return list;
        const changed = (list.value?.collection ?? []).filter((e) => e.uri && (e.updated_at ?? e.created_at ?? "") > since);
        const warnings: string[] = [];
        if (changed.length > MAX_EVENTS) warnings.push(`Read the first ${MAX_EVENTS} of ${changed.length} changed bookings; the rest come next time.`);

        const events: SequencerPoll["events"] = [];
        let newest = since;
        for (const e of changed.slice(0, MAX_EVENTS)) {
          const invitees = await call<{ collection?: RawInvitee[] }>(`${e.uri}/invitees?count=100`);
          if (!invitees.ok) {
            if (invitees.error.code === "auth") return invitees;
            warnings.push(invitees.error.message);
            continue;
          }
          const stamp = e.updated_at ?? e.created_at ?? since;
          if (stamp > newest) newest = stamp;
          const scheduled_event = { uri: e.uri, name: e.name, start_time: e.start_time };
          for (const i of invitees.value?.collection ?? []) {
            const payload = { email: i.email, name: i.name, uri: i.uri, old_invitee: i.old_invitee ?? undefined, rescheduled: i.rescheduled === true, scheduled_event };
            if (i.status === "canceled" || e.status === "canceled") events.push({ event: "invitee.canceled", payload });
            else events.push({ event: "invitee.created", payload });
          }
        }
        return ok({ events, cursor: { since: newest }, ...(warnings.length ? { warnings } : {}) });
      },
    },
  };
  return connector;
};
