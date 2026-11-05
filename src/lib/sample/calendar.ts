import type { ID } from "@/lib/domain/types";
import { bookingId } from "@/lib/calendar/plan";
import type { CalendarSource, FeedStats, StoredEvent } from "@/lib/calendar/types";
import { makeClock, upcomingToday, type Clock } from "./clock";
import { DOMAIN, MEETING } from "./ids";
import { pipelineDates } from "./pipeline";
import { tidewellCallAt } from "./transcript";

/**
 * Ledgerline's calendar, as the Calendar connection reads it: Priya's Google calendar over the last 60 days
 * and the next 30. Meetings with pipeline companies are the sample's own meetings (the two upcoming ones are
 * marked as from the calendar); four companies aren't in the pipeline yet (Track or Ignore), one guest uses
 * a personal address, and internal and all-day events are only counted. Every company is fictional.
 */

export const SAMPLE_TIDEWELL = { domain: "tidewell.example", name: "Tidewell" } as const;

const EVENT = {
  lumenwireToday: "cal_lumenwire_checkin@google.com",
  northwindDeepDive: "cal_northwind_deepdive@google.com",
  northwindYesterday: "cal_northwind_followup@google.com",
  northwindDiscovery: "cal_northwind_discovery@google.com",
  saltmarshDiscovery: "cal_saltmarsh_discovery@google.com",
  rowanstackProposal: "cal_rowanstack_proposal@google.com",
  lumenwireKickoff: "cal_lumenwire_kickoff@google.com",
  quillfeatherTechnical: "cal_quillfeather_technical@google.com",
  tidewell: "cal_tidewell_discovery@google.com",
  halcyon: "cal_halcyon_intro@google.com",
  pinecrest: "cal_pinecrest_catchup@google.com",
  orchard: "cal_orchard_intro@google.com",
  rui: "cal_rui_coffee@google.com",
} as const;


const g = (name: string, domain: string) => ({ name, email: `${name.split(" ")[0].toLowerCase()}@${domain}` });

function events(c: Clock): StoredEvent[] {
  const t = pipelineDates(c);
  const today = upcomingToday(c);
  const end = (iso: string, minutes = 30) => c.plus(iso, minutes);
  const mk = (id: string, title: string, start: string, domain: string, guests: { name: string; email: string }[], conference?: string, minutes = 30): StoredEvent => ({
    id,
    title,
    start,
    end: end(start, minutes),
    status: "confirmed",
    companies: [{ domain, guests }],
    personal: [],
    ...(conference ? { conference } : {}),
  });
  const tidewell = tidewellCallAt(c);
  return [
    mk(EVENT.lumenwireToday, "Lumenwire: mid-pilot check-in", today, DOMAIN.lumenwire, [g("Ethan Brooks", DOMAIN.lumenwire)], "Google Meet"),
    mk(EVENT.northwindDeepDive, "Northwind: technical deep-dive", c.at(t.deepDive, "10:00"), DOMAIN.northwind, [g("Dana Okafor", DOMAIN.northwind), g("Sofia Reyes", DOMAIN.northwind)], "Zoom", 45),
    mk(EVENT.northwindYesterday, "Northwind: follow-up with Marcus", c.at(-1, "11:00"), DOMAIN.northwind, [g("Dana Okafor", DOMAIN.northwind), g("Marcus Lindqvist", DOMAIN.northwind)], "Zoom"),
    mk(EVENT.northwindDiscovery, "Northwind: discovery", c.at(-12, "15:00"), DOMAIN.northwind, [g("Dana Okafor", DOMAIN.northwind)], "Zoom"),
    mk(EVENT.saltmarshDiscovery, "Saltmarsh: discovery", c.at(-6, "13:00"), DOMAIN.saltmarsh, [g("Leo Marchetti", DOMAIN.saltmarsh)], "Google Meet"),
    mk(EVENT.rowanstackProposal, "Rowanstack: proposal walkthrough", c.at(-9, "11:00"), DOMAIN.rowanstack, [g("Nadia Haddad", DOMAIN.rowanstack), g("Tom Becker", DOMAIN.rowanstack)], "Zoom", 45),
    mk(EVENT.lumenwireKickoff, "Lumenwire: pilot kickoff", c.at(-16, "10:00"), DOMAIN.lumenwire, [g("Ethan Brooks", DOMAIN.lumenwire), g("Grace Liu", DOMAIN.lumenwire)], "Google Meet", 60),
    mk(EVENT.quillfeatherTechnical, "Quillfeather: technical call", c.at(-20, "14:00"), DOMAIN.quillfeather, [g("Ben Adler", DOMAIN.quillfeather)], "Zoom"),
    // Not in the pipeline yet. Tidewell's call already happened: its transcript is the sample transcript.
    mk(EVENT.tidewell, "Tidewell <> Ledgerline: discovery", tidewell, SAMPLE_TIDEWELL.domain, [g("Maren Holt", SAMPLE_TIDEWELL.domain), g("Arjun Patel", SAMPLE_TIDEWELL.domain)], "Zoom"),
    mk(EVENT.halcyon, "Halcyon Freight <> Ledgerline: intro", c.at(1, "11:30"), "halcyonfreight.example", [g("Jules Moreau", "halcyonfreight.example")], "Google Meet"),
    mk(EVENT.pinecrest, "Pinecrest Capital catch-up", c.at(3, "09:00"), "pinecrestcapital.example", [g("Hannah Lee", "pinecrestcapital.example")]),
    mk(EVENT.orchard, "Orchard Pay x Ledgerline", c.at(8, "16:00"), "orchardpay.example", [g("Imani Okoro", "orchardpay.example"), g("Felix Brandt", "orchardpay.example")], "Zoom"),
    { id: EVENT.rui, title: "Coffee with Rui Costa", start: c.at(2, "08:30"), end: c.at(2, "09:15"), status: "confirmed", companies: [], personal: [{ name: "Rui Costa" }] },
  ];
}

/** The sample's own meetings that these calendar events are. */
const LINKED: [keyof typeof EVENT, ID, string][] = [
  ["lumenwireToday", MEETING.lumenwireToday, DOMAIN.lumenwire],
  ["northwindDeepDive", MEETING.northwindDeepDive, DOMAIN.northwind],
  ["northwindYesterday", MEETING.northwindYesterday, DOMAIN.northwind],
  ["northwindDiscovery", MEETING.northwindDiscovery, DOMAIN.northwind],
  ["saltmarshDiscovery", MEETING.saltmarshDiscovery, DOMAIN.saltmarsh],
  ["rowanstackProposal", MEETING.rowanstackProposal, DOMAIN.rowanstack],
  ["lumenwireKickoff", MEETING.lumenwireKickoff, DOMAIN.lumenwire],
  ["quillfeatherTechnical", MEETING.quillfeatherTechnical, DOMAIN.quillfeather],
];

export interface SampleCalendar {
  source: CalendarSource;
  events: StoredEvent[];
  stats: FeedStats;
  /** Booking id → the sample meeting it is. */
  refs: Record<string, ID>;
}

export function sampleCalendar(now = new Date()): SampleCalendar {
  const c = makeClock(now);
  const list = events(c);
  return {
    source: { provider: "google", label: "Google Calendar", host: "calendar.google.com", hint: "••••7c2e", name: "priya@ledgerline.example" },
    events: list,
    stats: {
      at: c.ago(4),
      total: list.length + 41,
      hidden: { internal: 29, solo: 8, allDay: 3, declined: 1 },
      // A "last weekday of the month" board-prep series (BYSETPOS), which the reader doesn't expand.
      skipped: { rule: 1 },
      complete: true,
      withGuests: list.length + 30,
    },
    refs: Object.fromEntries(LINKED.map(([event, meetingId, domain]) => [bookingId(EVENT[event], domain), meetingId])),
  };
}
