/** A feed's text → the meetings with people outside the company, and counts of everything else. Pure. */
import type { Workspace } from "@/lib/domain/types";
import { classify, conferenceOf, identityFor } from "./classify";
import { expandFeed, parseFeed } from "./ics";
import { syncWindow } from "./plan";
import type { FeedStats, HiddenCounts, StoredEvent } from "./types";

export interface FeedRead {
  name?: string;
  events: StoredEvent[];
  stats: FeedStats;
}

/**
 * `known(id)` says an occurrence was sent to a deal before: a single event moved outside the window is
 * still read, so its meeting moves with it instead of looking deleted.
 */
export function readFeed(text: string, { ws, now, known = () => false }: { ws: Pick<Workspace, "company" | "sender" | "founder">; now: number; known?: (eventId: string) => boolean }): FeedRead {
  const feed = parseFeed(text);
  const { from, to } = syncWindow(now);
  const { occurrences, skipped } = expandFeed(feed, { from, to });
  const inWindow = occurrences.filter((o) => o.start >= from && o.start <= to);
  const kept = occurrences.filter((o) => (o.start >= from && o.start <= to) || known(o.id));
  const identity = identityFor(ws, inWindow, feed.name);
  const hidden: HiddenCounts = { internal: 0, solo: 0, allDay: 0, declined: 0 };
  const events: StoredEvent[] = [];
  for (const occ of kept) {
    const c = classify(occ, identity);
    const counted = occ.start >= from && occ.start <= to;
    if (c.kind === "external" || c.kind === "personal") {
      const conference = conferenceOf(occ);
      events.push({
        id: occ.id,
        title: occ.title,
        start: new Date(occ.start).toISOString(),
        ...(occ.end !== undefined ? { end: new Date(occ.end).toISOString() } : {}),
        status: occ.status,
        companies: c.companies,
        personal: c.personal,
        ...(conference ? { conference } : {}),
        ...(occ.recurring ? { recurring: true } : {}),
      });
    } else if (counted) {
      if (c.kind === "all_day") hidden.allDay++;
      else if (c.kind === "declined") hidden.declined++;
      else if (c.kind === "internal") hidden.internal++;
      else hidden.solo++;
    }
  }
  const timed = inWindow.filter((o) => !o.allDay);
  const busyOnly = timed.length >= 3 && timed.every((o) => !o.attendees.length && /^(busy|)$/i.test(o.title.trim()));
  return {
    ...(feed.name ? { name: feed.name } : {}),
    events,
    stats: {
      at: new Date(now).toISOString(),
      total: inWindow.length,
      hidden,
      skipped,
      complete: feed.complete,
      withGuests: inWindow.filter((o) => o.attendees.length > 0).length,
      ...(busyOnly ? { busyOnly } : {}),
    },
  };
}
