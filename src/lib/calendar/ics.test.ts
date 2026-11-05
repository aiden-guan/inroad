import { describe, expect, it } from "vitest";
import { expandFeed, parseDuration, parseFeed, parseLine, unescapeText, unfold, type Occurrence } from "./ics";
import { resolveZone, wallToUtc, type VTimezone } from "./tz";

/** Builds a feed from VEVENT bodies (CRLF line endings, like the real thing). */
function feed(events: string[], head: string[] = []): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Google Inc//Google Calendar 70.9054//EN", ...head, ...events.flatMap((e) => ["BEGIN:VEVENT", ...e.trim().split("\n").map((l) => l.trim()), "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");
}

const iso = (ms: number) => new Date(ms).toISOString();
const WIDE = { from: Date.UTC(2026, 0, 1), to: Date.UTC(2027, 11, 31) };
const occurrences = (text: string, window = WIDE) => expandFeed(parseFeed(text), window);
const starts = (o: Occurrence[]) => o.map((x) => iso(x.start));

describe("content lines", () => {
  it("unfolds lines continued with a space or a tab, whatever the line endings", () => {
    expect(unfold("SUMMARY:Quarterly \r\n  review\r\nDESCRIPTION:a\r\n\tb\r\n")).toEqual(["SUMMARY:Quarterly  review", "DESCRIPTION:ab"]);
    expect(unfold("﻿BEGIN:VCALENDAR\nX:1\n")).toEqual(["BEGIN:VCALENDAR", "X:1"]);
  });

  it("reads quoted parameters that contain colons, semicolons and commas", () => {
    const p = parseLine('ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN="Okafor, Dana; Controller";X-NUM-GUESTS=0:mailto:dana@northwind.example');
    expect(p).toEqual({
      name: "ATTENDEE",
      params: { CUTYPE: "INDIVIDUAL", ROLE: "REQ-PARTICIPANT", PARTSTAT: "ACCEPTED", CN: "Okafor, Dana; Controller", "X-NUM-GUESTS": "0" },
      value: "mailto:dana@northwind.example",
    });
    expect(parseLine("URL;VALUE=URI:https://zoom.us/j/123?pwd=a:b")?.value).toBe("https://zoom.us/j/123?pwd=a:b");
    expect(parseLine("ATTENDEE;CN=Ana ^'Lu^' Ruiz:mailto:ana@x.example")?.params.CN).toBe('Ana "Lu" Ruiz');
    expect(parseLine("not a property")).toBeNull();
  });

  it("unescapes text values", () => {
    expect(unescapeText("Agenda:\\n1\\, pricing\\; 2\\, next steps \\\\ end")).toBe("Agenda:\n1, pricing; 2, next steps \\ end");
  });

  it("reads durations", () => {
    expect(parseDuration("PT1H30M")).toBe(90 * 60_000);
    expect(parseDuration("P1D")).toBe(86_400_000);
    expect(parseDuration("P1W")).toBe(7 * 86_400_000);
    expect(parseDuration("PT")).toBeNull();
    expect(parseDuration("soon")).toBeNull();
  });
});

describe("time zones", () => {
  const nov5 = { y: 2026, mo: 11, d: 5, h: 10, mi: 0, s: 0 };

  it("resolves IANA, Windows, Outlook display names and prefixed ids", () => {
    expect(iso(wallToUtc(nov5, resolveZone("America/New_York")!))).toBe("2026-11-05T15:00:00.000Z");
    expect(iso(wallToUtc(nov5, resolveZone("Eastern Standard Time")!))).toBe("2026-11-05T15:00:00.000Z");
    expect(iso(wallToUtc(nov5, resolveZone("W. Europe Standard Time")!))).toBe("2026-11-05T09:00:00.000Z");
    expect(iso(wallToUtc(nov5, resolveZone("(UTC-08:00) Pacific Time (US & Canada)")!))).toBe("2026-11-05T18:00:00.000Z");
    expect(iso(wallToUtc(nov5, resolveZone("/mozilla.org/20070129_1/Europe/London")!))).toBe("2026-11-05T10:00:00.000Z");
    expect(iso(wallToUtc(nov5, resolveZone("India Standard Time")!))).toBe("2026-11-05T04:30:00.000Z");
    expect(resolveZone("Narnia Standard Time")).toBeNull();
    expect(resolveZone("(UTC+05:30) Somewhere")).toBeNull();
  });

  it("follows daylight saving time in the zone, not on this machine", () => {
    const ny = resolveZone("America/New_York")!;
    expect(iso(wallToUtc({ ...nov5, mo: 10, d: 27 }, ny))).toBe("2026-10-27T14:00:00.000Z");
    expect(iso(wallToUtc(nov5, ny))).toBe("2026-11-05T15:00:00.000Z");
  });

  it("uses a feed's own VTIMEZONE rules when the TZID is unknown", () => {
    const vt: VTimezone = {
      tzid: "Custom Eastern",
      observances: [
        { start: { y: 2007, mo: 11, d: 4, h: 2, mi: 0, s: 0 }, from: -240, to: -300, yearly: { month: 11, weekday: { n: 1, wd: 0 } }, dates: [] },
        { start: { y: 2007, mo: 3, d: 11, h: 2, mi: 0, s: 0 }, from: -300, to: -240, yearly: { month: 3, weekday: { n: 2, wd: 0 } }, dates: [] },
      ],
    };
    const zone = resolveZone("Custom Eastern", new Map([["Custom Eastern", vt]]))!;
    expect(zone.kind).toBe("rules");
    expect(iso(wallToUtc({ ...nov5, mo: 7, d: 1 }, zone))).toBe("2026-07-01T14:00:00.000Z");
    expect(iso(wallToUtc({ ...nov5, mo: 12, d: 1 }, zone))).toBe("2026-12-01T15:00:00.000Z");
    // The day the clocks go back: 01:30 happens twice; either reading is a real moment that morning.
    expect([wallToUtc({ y: 2026, mo: 11, d: 1, h: 1, mi: 30, s: 0 }, zone)]).toSatisfy(([ms]: number[]) => ms === Date.UTC(2026, 10, 1, 5, 30) || ms === Date.UTC(2026, 10, 1, 6, 30));
  });
});

describe("events", () => {
  it("reads a Google event: zone, guests, organizer, conference link", () => {
    const text = feed(
      [
        `UID:3k2j4h5g6f@google.com
        DTSTART;TZID=America/New_York:20261105T100000
        DTEND;TZID=America/New_York:20261105T103000
        SUMMARY:Northwind <> Ledgerline: deep-dive
        ORGANIZER;CN=Priya Raman:mailto:priya@ledgerline.example
        ATTENDEE;CN=Priya Raman;PARTSTAT=ACCEPTED:mailto:priya@ledgerline.example
        ATTENDEE;CN="Reyes, Sofia";PARTSTAT=NEEDS-ACTION:MAILTO:Sofia@Northwind.example
        ATTENDEE;CN=dana@northwind.example;PARTSTAT=ACCEPTED:mailto:dana@northwind.example
        ATTENDEE;CUTYPE=ROOM;CN=Room 4:mailto:c_188@resource.calendar.google.com
        X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij
        SEQUENCE:2
        STATUS:CONFIRMED`,
      ],
      ["X-WR-CALNAME:priya@ledgerline.example", "X-WR-TIMEZONE:America/New_York"],
    );
    const parsed = parseFeed(text);
    expect(parsed.name).toBe("priya@ledgerline.example");
    expect(parsed.complete).toBe(true);
    const [o] = expandFeed(parsed, WIDE).occurrences;
    expect(o).toMatchObject({ id: "3k2j4h5g6f@google.com", recurring: false, title: "Northwind <> Ledgerline: deep-dive", allDay: false, status: "confirmed", sequence: 2, conference: "https://meet.google.com/abc-defg-hij" });
    expect(iso(o.start)).toBe("2026-11-05T15:00:00.000Z");
    expect(o.end! - o.start).toBe(30 * 60_000);
    expect(o.organizer).toEqual({ email: "priya@ledgerline.example", name: "Priya Raman" });
    expect(o.attendees).toEqual([
      { email: "priya@ledgerline.example", name: "Priya Raman", partstat: "ACCEPTED" },
      { email: "sofia@northwind.example", name: "Reyes, Sofia", partstat: "NEEDS-ACTION" },
      // Google writes the address as the name when it has none.
      { email: "dana@northwind.example", partstat: "ACCEPTED" },
      { email: "c_188@resource.calendar.google.com", name: "Room 4", cutype: "ROOM" },
    ]);
  });

  it("keeps an alarm's description and guests out of its event", () => {
    const text = feed([
      `UID:a1
      DTSTART:20261105T150000Z
      SUMMARY:Call
      BEGIN:VALARM
      ACTION:EMAIL
      DESCRIPTION:This is an event reminder
      ATTENDEE:mailto:reminders@example.com
      END:VALARM`,
    ]);
    const [o] = occurrences(text).occurrences;
    expect(o.description).toBeUndefined();
    expect(o.attendees).toEqual([]);
  });

  it("reads all-day dates, UTC times, floating times and DURATION", () => {
    const text = feed(
      [
        "UID:allday\nDTSTART;VALUE=DATE:20261105\nDTEND;VALUE=DATE:20261106\nSUMMARY:Money20/20",
        "UID:utc\nDTSTART:20261105T150000Z\nDURATION:PT45M\nSUMMARY:UTC call",
        "UID:floating\nDTSTART:20261105T100000\nSUMMARY:Floating",
      ],
      ["X-WR-TIMEZONE:Europe/Berlin"],
    );
    const byId = Object.fromEntries(occurrences(text).occurrences.map((o) => [o.id, o]));
    expect(byId.allday).toMatchObject({ allDay: true });
    expect(byId.utc.end! - byId.utc.start).toBe(45 * 60_000);
    // Floating times are read in the calendar's own zone.
    expect(iso(byId.floating.start)).toBe("2026-11-05T09:00:00.000Z");
  });

  it("skips an event whose zone can't be resolved, and says so", () => {
    const r = occurrences(feed(["UID:x\nDTSTART;TZID=Somewhere Odd:20261105T100000\nSUMMARY:?"]));
    expect(r.occurrences).toEqual([]);
    expect(r.skipped).toEqual({ time_zone: 1 });
  });

  it("uses the higher SEQUENCE when an event appears twice", () => {
    const text = feed([
      "UID:dup\nSEQUENCE:1\nDTSTART:20261105T150000Z\nSUMMARY:Old time",
      "UID:dup\nSEQUENCE:3\nDTSTART:20261106T150000Z\nSUMMARY:New time",
    ]);
    const r = occurrences(text);
    expect(r.occurrences).toHaveLength(1);
    expect(r.occurrences[0]).toMatchObject({ title: "New time", sequence: 3 });
  });

  it("flags cancelled events instead of dropping them", () => {
    const [o] = occurrences(feed(["UID:c\nDTSTART:20261105T150000Z\nSTATUS:CANCELLED\nSUMMARY:Call"])).occurrences;
    expect(o.status).toBe("cancelled");
  });

  it("notices a feed that was cut off, and refuses something that isn't a calendar", () => {
    expect(parseFeed("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261105T150000Z\r\nEND:VEVENT").complete).toBe(false);
    expect(() => parseFeed("<!doctype html><html>Sign in</html>")).toThrow("not_ics");
  });
});

describe("recurrence", () => {
  const tueThu = `UID:weekly@google.com
    DTSTART;TZID=America/New_York:20261027T100000
    DTEND;TZID=America/New_York:20261027T103000
    RRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=6
    SUMMARY:Pipeline sync`;

  it("expands a weekly rule with BYDAY and COUNT, keeping 10:00 local across the DST change", () => {
    const r = occurrences(feed([tueThu]));
    expect(starts(r.occurrences)).toEqual([
      "2026-10-27T14:00:00.000Z",
      "2026-10-29T14:00:00.000Z",
      "2026-11-03T15:00:00.000Z",
      "2026-11-05T15:00:00.000Z",
      "2026-11-10T15:00:00.000Z",
      "2026-11-12T15:00:00.000Z",
    ]);
    expect(r.occurrences[2].id).toBe("weekly@google.com@20261103T150000Z");
    expect(r.occurrences.every((o) => o.recurring && o.end! - o.start === 30 * 60_000)).toBe(true);
  });

  it("removes EXDATEs and applies RECURRENCE-ID overrides, including a cancelled one", () => {
    const text = feed([
      `${tueThu}\nEXDATE;TZID=America/New_York:20261103T100000`,
      "UID:weekly@google.com\nRECURRENCE-ID;TZID=America/New_York:20261105T100000\nDTSTART;TZID=America/New_York:20261106T140000\nDTEND;TZID=America/New_York:20261106T143000\nSUMMARY:Pipeline sync (moved)",
      "UID:weekly@google.com\nRECURRENCE-ID:20261110T150000Z\nDTSTART:20261110T150000Z\nSTATUS:CANCELLED\nSUMMARY:Pipeline sync",
    ]);
    const r = occurrences(text).occurrences;
    expect(r.map((o) => [o.id.split("@").pop(), iso(o.start), o.title, o.status])).toEqual([
      ["20261027T140000Z", "2026-10-27T14:00:00.000Z", "Pipeline sync", "confirmed"],
      ["20261029T140000Z", "2026-10-29T14:00:00.000Z", "Pipeline sync", "confirmed"],
      // The moved occurrence keeps its original id, so the meeting it made follows the move.
      ["20261105T150000Z", "2026-11-06T19:00:00.000Z", "Pipeline sync (moved)", "confirmed"],
      ["20261110T150000Z", "2026-11-10T15:00:00.000Z", "Pipeline sync", "cancelled"],
      ["20261112T150000Z", "2026-11-12T15:00:00.000Z", "Pipeline sync", "confirmed"],
    ]);
  });

  it("handles INTERVAL with UNTIL, and weekdays-only DAILY rules", () => {
    const biweekly = occurrences(feed(["UID:b\nDTSTART:20261006T100000Z\nRRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20261201T000000Z\nSUMMARY:1:1"])).occurrences;
    expect(starts(biweekly)).toEqual(["2026-10-06T10:00:00.000Z", "2026-10-20T10:00:00.000Z", "2026-11-03T10:00:00.000Z", "2026-11-17T10:00:00.000Z"]);
    const weekdays = occurrences(feed(["UID:d\nDTSTART;TZID=America/Los_Angeles:20261019T090000\nRRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20261030T235959Z\nSUMMARY:Standup"])).occurrences;
    expect(weekdays).toHaveLength(10);
    expect(weekdays.map((o) => new Date(o.start).getUTCDay())).toEqual([1, 2, 3, 4, 5, 1, 2, 3, 4, 5]);
  });

  it("expands MONTHLY by nth weekday and by month day, skipping months without that day", () => {
    const second = occurrences(feed(["UID:m\nDTSTART:20261013T170000Z\nRRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=3\nSUMMARY:Board prep"])).occurrences;
    expect(starts(second)).toEqual(["2026-10-13T17:00:00.000Z", "2026-11-10T17:00:00.000Z", "2026-12-08T17:00:00.000Z"]);
    const last = occurrences(feed(["UID:l\nDTSTART:20261031T090000Z\nRRULE:FREQ=MONTHLY;BYMONTHDAY=31;COUNT=4\nSUMMARY:Close"])).occurrences;
    expect(starts(last)).toEqual(["2026-10-31T09:00:00.000Z", "2026-12-31T09:00:00.000Z", "2027-01-31T09:00:00.000Z", "2027-03-31T09:00:00.000Z"]);
  });

  it("only returns occurrences of a series inside the window, but always returns single events", () => {
    const window = { from: Date.UTC(2026, 10, 1), to: Date.UTC(2026, 10, 7) };
    const r = occurrences(feed([tueThu, "UID:single\nDTSTART:20260101T150000Z\nSUMMARY:Long ago"]), window);
    expect(r.occurrences.map((o) => o.id)).toEqual(["single", "weekly@google.com@20261103T150000Z", "weekly@google.com@20261105T150000Z"]);
  });

  it("skips rules it can't expand exactly, and counts them", () => {
    const r = occurrences(
      feed([
        "UID:setpos\nDTSTART:20261030T150000Z\nRRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1\nSUMMARY:Last workday",
        "UID:hourly\nDTSTART:20261030T150000Z\nRRULE:FREQ=HOURLY\nSUMMARY:Ping",
        "UID:range\nDTSTART:20261030T150000Z\nRRULE:FREQ=WEEKLY\nSUMMARY:Sync",
        "UID:range\nRECURRENCE-ID;RANGE=THISANDFUTURE:20261106T150000Z\nDTSTART:20261106T160000Z\nSUMMARY:Sync",
      ]),
    );
    expect(r.occurrences).toEqual([]);
    expect(r.skipped).toEqual({ rule: 2, range: 1 });
  });

  it("ends a rule whose filter never matches instead of spinning", () => {
    const r = occurrences(feed(["UID:never\nDTSTART:20260130T150000Z\nRRULE:FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=30\nSUMMARY:Never"]));
    expect(starts(r.occurrences)).toEqual(["2026-01-30T15:00:00.000Z"]);
  });

  it("keeps an override of someone else's series when the series itself isn't in the feed", () => {
    const r = occurrences(feed(["UID:theirs\nRECURRENCE-ID:20261112T170000Z\nDTSTART:20261112T170000Z\nSUMMARY:Their weekly, this week only"]));
    expect(r.occurrences.map((o) => o.id)).toEqual(["theirs@20261112T170000Z"]);
  });
});
