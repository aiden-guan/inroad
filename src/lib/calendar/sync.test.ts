import { beforeEach, describe, expect, it } from "vitest";
import { mutateHub, readHub } from "@/lib/hub/store";
import { readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { makeAccount, makeCompany, makeDeal, makeWorkspace } from "@/test/factories";
import { calendarMoveId } from "./plan";
import { mutateCalendarStore, readCalendarStore } from "./store";
import { applyFeed, calendarDigest, ignoreCompany, trackCompany } from "./sync";
import { CALENDAR_MOVE_RULE } from "./types";

/**
 * The calendar end to end, on this test file's own data folder: a feed's text goes through the plan and
 * the same booking path Calendly uses, into meetings, people and deals; then a move, a deletion, Track
 * and Ignore. Times are relative to the real clock, since the sync reads it.
 */

const DAY = 86_400_000;
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const startOfToday = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const at = (days: number, hour: number) => startOfToday() + days * DAY + hour * 3_600_000;

function event(uid: string, start: number, summary: string, guests: string[], extra: string[] = []): string[] {
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(start + 30 * 60_000)}`,
    `SUMMARY:${summary}`,
    "ORGANIZER;CN=Priya Raman:mailto:priya@ledgerline.example",
    "ATTENDEE;CN=Priya Raman;PARTSTAT=ACCEPTED:mailto:priya@ledgerline.example",
    ...guests.map((g) => `ATTENDEE;CN=${g.split("@")[0].replace(/\b\w/g, (c) => c.toUpperCase())};PARTSTAT=ACCEPTED:mailto:${g}`),
    ...extra,
    "END:VEVENT",
  ];
}

const feed = (...events: string[][]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-CALNAME:priya@ledgerline.example", ...events.flat(), "END:VCALENDAR"].join("\r\n");

const northwind = (start = at(1, 10), extra: string[] = []) => event("nw-deepdive@google.com", start, "Northwind: deep-dive", ["dana@northwind.example", "sofia@northwind.example"], extra);
const fernwick = () => event("fw-intro@google.com", at(3, 15), "Fernwick intro", ["ola@fernwick.example"]);
const halcyon = () => event("hal-intro@google.com", at(1, 11.5), "Halcyon Freight <> Ledgerline: intro", ["jules@halcyonfreight.example"]);
const pinecrest = () => event("pine@google.com", at(4, 9), "Pinecrest Capital catch-up", ["hannah@pinecrestcapital.example"]);
const standup = () => event("standup@google.com", at(1, 9), "Standup", ["sam@ledgerline.example"]);

beforeEach(async () => {
  // Each test starts from nothing read and nothing sent.
  await mutateCalendarStore((s) => Object.assign(s, { events: [], sent: {}, ignored: [], accepted: [], sampleIgnored: [], stats: undefined, name: undefined }));
  await mutateHub((h) => {
    h.refs = {};
    h.seen = {};
    h.inbound = [];
  });
  await replaceWorkspace(
    makeWorkspace({
      company: makeCompany({ name: "Ledgerline", domain: "ledgerline.example", market: "b2b" }),
      founder: { name: "Priya Raman", email: "priya@ledgerline.example" },
      accounts: {
        "northwind.example": makeAccount("northwind.example", { name: "Northwind Metrics", status: "in_pipeline", dealId: "deal_nw" }),
        "fernwick.example": makeAccount("fernwick.example", { name: "Fernwick" }),
      },
      deals: { deal_nw: makeDeal("deal_nw", "northwind.example", { name: "Northwind Metrics", meetingIds: [] }) },
      integrations: { calendar: { id: "calendar", enabled: true, config: {} } },
    }),
  );
});

const meetingsOf = (domain: string) => {
  const ws = readWorkspace();
  const deal = ws.deals[ws.accounts[domain]?.dealId ?? ""];
  return (deal?.meetingIds ?? []).map((id) => ws.meetings[id]).filter(Boolean);
};

describe("calendar sync", () => {
  it("puts meetings with pipeline and tracked companies on their deals, and asks about the rest", async () => {
    const r = await applyFeed(feed(northwind(), fernwick(), halcyon(), standup()));
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(r.ok && r.summary).toBe("2 meetings added to deals · 1 new company to review");

    const [nw] = meetingsOf("northwind.example");
    expect(nw).toMatchObject({ title: "Northwind: deep-dive", source: "calendar", startsAt: new Date(at(1, 10)).toISOString() });
    // Both guests: the first as the booking's contact, her colleague added to the deal too.
    expect(nw.attendees.map((a) => a.name)).toEqual(["Dana", "Sofia"]);
    const ws = readWorkspace();
    expect(ws.deals.deal_nw.contacts).toHaveLength(2);

    // A tracked company's upcoming meeting starts its deal at Talking, like a booking.
    const fw = ws.deals[ws.accounts["fernwick.example"].dealId!];
    expect(fw).toMatchObject({ stage: "talking", notes: "Started from a meeting on your calendar." });
    expect(meetingsOf("fernwick.example")).toHaveLength(1);

    // A new company waits for the founder, with a card on Today for tomorrow's call.
    expect(ws.accounts["halcyonfreight.example"]).toBeUndefined();
    const cards = Object.values(ws.moves).filter((m) => m.rule === CALENDAR_MOVE_RULE);
    expect(cards.map((m) => [m.status, m.title])).toEqual([["open", expect.stringMatching(/^Track Halcyon Freight before your call tomorrow at 11:30/)]]);

    const d = calendarDigest();
    expect(d).toMatchObject({ state: "connected", upcoming: { total: 3, pipeline: 2, newCompanies: 1 }, hidden: { internal: 1 } });
    expect(d.review.map((x) => x.name)).toEqual(["Halcyon Freight"]);
  });

  it("changes nothing on an unchanged read, follows a move, and cancels a deleted meeting", async () => {
    await applyFeed(feed(northwind(), standup()));
    const id = meetingsOf("northwind.example")[0].id;
    expect(await applyFeed(feed(northwind(), standup()))).toEqual({ ok: true, changed: false });

    await applyFeed(feed(northwind(at(2, 14), ["SEQUENCE:1"]), standup()));
    expect(readWorkspace().meetings[id].startsAt).toBe(new Date(at(2, 14)).toISOString());

    // Gone from the feed while still ahead, with no brief or notes: it's removed from the deal.
    await applyFeed(feed(standup()));
    expect(readWorkspace().meetings[id]).toBeUndefined();
    expect(readWorkspace().deals.deal_nw.meetingIds).toEqual([]);
    expect(readCalendarStore().sent).toEqual({});
  });

  it("marks a cancelled meeting that already has a brief instead of deleting it", async () => {
    await applyFeed(feed(northwind()));
    const id = meetingsOf("northwind.example")[0].id;
    const ws = readWorkspace();
    ws.meetings[id].notesRaw = "Prep notes";
    await replaceWorkspace(ws);
    await applyFeed(feed(northwind(at(1, 10), ["STATUS:CANCELLED", "SEQUENCE:2"])));
    expect(readWorkspace().meetings[id].title).toBe("Canceled: Northwind: deep-dive");
  });

  it("links a meeting already on the deal at that time instead of adding a twin", async () => {
    const ws = readWorkspace();
    ws.meetings.mtg_hand = { id: "mtg_hand", dealId: "deal_nw", title: "Deep-dive", startsAt: new Date(at(1, 10) + 5 * 60_000).toISOString(), attendees: [] };
    ws.deals.deal_nw.meetingIds = ["mtg_hand"];
    await replaceWorkspace(ws);
    await applyFeed(feed(northwind()));
    expect(meetingsOf("northwind.example").map((m) => m.id)).toEqual(["mtg_hand"]);
    expect(Object.values(readHub().refs).map((r) => r.id)).toContain("mtg_hand");
  });

  it("tracks a company from the calendar: account, people, deal and meeting, and the Today card settles", async () => {
    await applyFeed(feed(halcyon(), pinecrest()));
    const r = await trackCompany("halcyonfreight.example");
    expect(r).toMatchObject({ ok: true, name: "Halcyon Freight", meetings: 1 });
    const ws = readWorkspace();
    expect(ws.accounts["halcyonfreight.example"]).toMatchObject({ name: "Halcyon Freight", status: "in_pipeline", sourceDetail: "Calendar" });
    expect(meetingsOf("halcyonfreight.example")[0]).toMatchObject({ title: "Halcyon Freight <> Ledgerline: intro", source: "calendar" });
    expect(ws.moves[calendarMoveId("halcyonfreight.example", "hal-intro@google.com")]).toMatchObject({ status: "done", autoDone: true });
    expect(calendarDigest().review.map((x) => x.domain)).toEqual(["pinecrestcapital.example"]);
  });

  it("ignores a domain for good, and asks again after an undo", async () => {
    await applyFeed(feed(pinecrest()));
    expect(calendarDigest().review).toHaveLength(1);
    await ignoreCompany("pinecrestcapital.example");
    expect(calendarDigest().review).toEqual([]);
    expect(calendarDigest().agenda.map((a) => a.kind)).toEqual(["ignored"]);
    await ignoreCompany("pinecrestcapital.example", true);
    expect(calendarDigest().review).toHaveLength(1);
  });

  it("reads but never writes for a consumer company", async () => {
    const ws = readWorkspace();
    ws.company = makeCompany({ market: "consumer" });
    await replaceWorkspace(ws);
    await applyFeed(feed(northwind(), halcyon()));
    expect(meetingsOf("northwind.example")).toEqual([]);
    expect(Object.values(readWorkspace().moves)).toEqual([]);
    expect(calendarDigest().notes).toContain("You sell to consumers, so meetings are read but not added to deals.");
  });
});
