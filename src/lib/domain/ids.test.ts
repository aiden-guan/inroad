import { describe, expect, it } from "vitest";
import { addBusinessDays, addDays, daysBetween, localDay, todayISO, weekOf } from "./ids";

/**
 * Day math on the founder's wall clock. The suite runs in America/Los_Angeles (vitest.config.mts), where 2026's clocks
 * spring forward on Sunday Mar 8 (02:00 → 03:00) and fall back on Sunday Nov 1 (02:00 → 01:00), and where every
 * evening from 4 or 5 pm on is already the next day in UTC.
 */

it("runs in a zone with daylight saving time", () => {
  expect(new Date(2026, 2, 7, 12).getTimezoneOffset()).toBe(480);
  expect(new Date(2026, 2, 9, 12).getTimezoneOffset()).toBe(420);
  expect(new Date(2026, 10, 2, 12).getTimezoneOffset()).toBe(480);
});

describe("dates", () => {
  it("counts days across both clock changes", () => {
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-03-08", "2026-03-09")).toBe(1);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(daysBetween("2026-11-01", "2026-11-02")).toBe(1);
    expect(daysBetween("2026-03-01", "2026-11-30")).toBe(274);
    expect(daysBetween("2026-03-09", "2026-03-07")).toBe(-2);
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
  });

  it("adds days across both clock changes, month ends and leap days", () => {
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
    expect(addDays("2026-11-02", -2)).toBe("2026-10-31");
    expect(addDays("2026-03-01", 274)).toBe("2026-11-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("agrees with the local calendar on every day of four years", () => {
    let day = "2025-01-01";
    for (let i = 0; i < 4 * 366; i++) {
      const [y, m, d] = day.split("-").map(Number);
      const next = todayISO(new Date(y, m - 1, d + 1, 12));
      expect(addDays(day, 1), day).toBe(next);
      expect(daysBetween("2025-01-01", day), day).toBe(i);
      const monday = new Date(y, m - 1, d - ((new Date(y, m - 1, d, 12).getDay() + 6) % 7), 12);
      expect(weekOf(day), day).toBe(todayISO(monday));
      day = next;
    }
  });

  it("starts weeks on Monday", () => {
    expect(weekOf("2026-03-08")).toBe("2026-03-02"); // the Sunday the clocks spring forward
    expect(weekOf("2026-03-09")).toBe("2026-03-09");
    expect(weekOf("2026-11-01")).toBe("2026-10-26"); // the Sunday they fall back
    expect(weekOf("2026-11-04")).toBe("2026-11-02");
    expect(weekOf("2027-01-01")).toBe("2026-12-28");
  });

  it("skips the weekend of a clock change when adding working days", () => {
    expect(addBusinessDays("2026-03-06", 1)).toBe("2026-03-09");
    expect(addBusinessDays("2026-10-30", 1)).toBe("2026-11-02");
    expect(addBusinessDays("2026-10-30", 0)).toBe("2026-10-30");
  });
});

describe("timestamps", () => {
  it("count on the local date they happened, not the UTC one", () => {
    // 6:30 pm on Oct 20 in Los Angeles is already Oct 21 in UTC.
    const evening = "2026-10-21T01:30:00.000Z";
    expect(localDay(evening)).toBe("2026-10-20");
    expect(daysBetween(evening, "2026-10-20")).toBe(0);
    expect(daysBetween(evening, "2026-10-21")).toBe(1);
    expect(daysBetween("2026-10-19", evening)).toBe(1);
    expect(addDays(evening, 1)).toBe("2026-10-21");
    expect(weekOf("2026-10-26T06:00:00.000Z")).toBe("2026-10-19"); // Sunday 11 pm, not Monday
    expect(addBusinessDays("2026-10-24T03:00:00.000Z", 1)).toBe("2026-10-26"); // Friday 8 pm
  });

  it("stay on the right date across the clock changes", () => {
    // 1:30 am happens twice on Nov 1: in PDT, then an hour later in PST.
    expect(localDay("2026-11-01T08:30:00.000Z")).toBe("2026-11-01");
    expect(localDay("2026-11-01T09:30:00.000Z")).toBe("2026-11-01");
    expect(daysBetween("2026-11-01T08:30:00.000Z", "2026-11-01T09:30:00.000Z")).toBe(0);
    // 1:59 am PST, then 3:00 am PDT a minute later.
    expect(daysBetween("2026-03-08T09:59:00.000Z", "2026-03-08T10:00:00.000Z")).toBe(0);
    // A minute either side of midnight before the change.
    expect(localDay("2026-03-08T07:59:00.000Z")).toBe("2026-03-07");
    expect(localDay("2026-03-08T08:00:00.000Z")).toBe("2026-03-08");
    // 8 pm one evening to 8 pm the next, with the change in between: one day.
    expect(daysBetween("2026-03-07T20:00:00-08:00", "2026-03-08T20:00:00-07:00")).toBe(1);
    expect(daysBetween("2026-10-31T20:00:00-07:00", "2026-11-01T20:00:00-08:00")).toBe(1);
  });

  it("leaves dates as they are, and doesn't throw on text that isn't a date", () => {
    expect(localDay("2026-10-20")).toBe("2026-10-20");
    expect(localDay("")).toBe("");
    expect(localDay("soon")).toBe("soon");
    expect(addDays("", 1)).toBe("NaN-NaN-NaN");
    expect(daysBetween("", "2026-10-20")).toBeNaN();
  });
});
