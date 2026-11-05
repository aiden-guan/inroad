import { describe, expect, it } from "vitest";
import type { Workspace } from "@/lib/domain/types";
import { NOW, TODAY, at, makeAccount, makeCompany, makeDeal, makeMeeting, makeMove, makeWorkspace } from "@/test/factories";
import { classify, conferenceOf, guessCompanyName, identityFor } from "./classify";
import type { Occurrence } from "./ics";
import { applyCalendarMoves, bookingId, buildDigest, newCompanyMoves, planSync, policyFor, type SentEntry } from "./plan";
import { readFeed } from "./read";
import { CALENDAR_MOVE_RULE, type StoredEvent } from "./types";

const now = NOW.getTime();
const LISTS = { ignored: [] as string[], accepted: [] as string[] };

function occ(id: string, patch: Partial<Occurrence> = {}): Occurrence {
  return { id, uid: id, recurring: false, title: "Call", start: Date.parse(at(1, "10:00")), allDay: false, status: "confirmed", sequence: 0, attendees: [], ...patch };
}

function ev(id: string, domain: string | null, patch: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id,
    title: `${domain ?? "Coffee"} call`,
    start: at(1, "10:00"),
    status: "confirmed",
    companies: domain ? [{ domain, guests: [{ email: `ana@${domain}`, name: "Ana Ruiz" }] }] : [],
    personal: domain ? [] : [{ email: "rui.costa@gmail.com", name: "Rui Costa" }],
    ...patch,
  };
}

/** Ledgerline's founder with one open deal (northwind), one tracked company with no deal (fernwick) and a customer. */
function workspace(): Workspace {
  return makeWorkspace({
    company: makeCompany({ name: "Ledgerline", domain: "ledgerline.example" }),
    founder: { name: "Priya Raman", email: "priya@ledgerline.example" },
    accounts: {
      "northwind.example": makeAccount("northwind.example", { name: "Northwind Metrics", status: "in_pipeline", dealId: "deal_nw" }),
      "fernwick.example": makeAccount("fernwick.example", { name: "Fernwick" }),
      "wrenfield.example": makeAccount("wrenfield.example", { name: "Wrenfield", status: "customer" }),
      "meterbook.example": makeAccount("meterbook.example", { status: "disqualified" }),
    },
    deals: { deal_nw: makeDeal("deal_nw", "northwind.example", { meetingIds: [] }) },
  });
}

describe("who counts as the founder", () => {
  it("adds the calendar's owner, the address on most events, and their company domain", () => {
    const ws = makeWorkspace({ founder: { name: "Priya" } });
    const events = [1, 2, 3, 4].map((n) => occ(`e${n}`, { attendees: [{ email: "priya@ledgerline.example" }, { email: `guest${n}@northwind.example` }] }));
    const id = identityFor(ws, events);
    expect(id.emails.has("priya@ledgerline.example")).toBe(true);
    expect(id.domains.has("ledgerline.example")).toBe(true);
    expect(id.domains.has("northwind.example")).toBe(false);
  });

  it("never treats a personal mailbox's domain as the company's", () => {
    const id = identityFor(makeWorkspace({ founder: { name: "Priya", email: "priya.raman@gmail.com" } }), [], "priya.raman@gmail.com");
    expect(id.emails.has("priya.raman@gmail.com")).toBe(true);
    expect(id.domains.has("gmail.com")).toBe(false);
  });
});

describe("classify", () => {
  const id = { emails: new Set(["priya@ledgerline.example"]), domains: new Set(["ledgerline.example"]) };

  it("tells external, internal, personal, solo, all-day and declined events apart", () => {
    const me = { email: "priya@ledgerline.example" };
    expect(classify(occ("a", { attendees: [me, { email: "dana@northwind.example", name: "Dana" }] }), id)).toMatchObject({ kind: "external", companies: [{ domain: "northwind.example", guests: [{ email: "dana@northwind.example", name: "Dana" }] }] });
    expect(classify(occ("b", { attendees: [me, { email: "sam@ledgerline.example" }] }), id).kind).toBe("internal");
    expect(classify(occ("c", { attendees: [me, { email: "rui.costa@gmail.com", name: "Rui" }] }), id)).toMatchObject({ kind: "personal", personal: [{ email: "rui.costa@gmail.com", name: "Rui" }] });
    expect(classify(occ("d", { attendees: [me] }), id).kind).toBe("solo");
    expect(classify(occ("e", { allDay: true, attendees: [{ email: "x@northwind.example" }] }), id).kind).toBe("all_day");
    expect(classify(occ("f", { attendees: [{ ...me, partstat: "DECLINED" }, { email: "x@northwind.example" }] }), id).kind).toBe("declined");
  });

  it("ignores rooms, resource calendars and no-reply robots, and puts the busiest company first", () => {
    const c = classify(
      occ("g", {
        organizer: { email: "maren@tidewell.example" },
        attendees: [
          { email: "c_188@resource.calendar.google.com", name: "Room 4" },
          { email: "boardroom@ledgerline.example", cutype: "ROOM" },
          { email: "noreply@zoom.us" },
          { email: "jo@partner.example" },
          { email: "maren@tidewell.example" },
          { email: "arjun@tidewell.example" },
          { email: "lee@tidewell.example", partstat: "DECLINED" },
        ],
      }),
      id,
    );
    expect(c.kind).toBe("external");
    expect(c.companies.map((x) => [x.domain, x.guests.length])).toEqual([
      ["tidewell.example", 2],
      ["partner.example", 1],
    ]);
  });

  it("matches on the organizer when a published calendar leaves the guest list out", () => {
    expect(classify(occ("h", { organizer: { email: "dana@northwind.example", name: "Dana" } }), id).companies[0]?.domain).toBe("northwind.example");
  });
});

describe("names and links", () => {
  it("takes the company's name from the title when it fits the domain", () => {
    expect(guessCompanyName("halcyonfreight.example", ["Halcyon Freight <> Ledgerline: intro"], ["Ledgerline"])).toBe("Halcyon Freight");
    expect(guessCompanyName("tidewell.example", ["Ledgerline / Tidewell discovery"], ["Ledgerline"])).toBe("Tidewell");
    expect(guessCompanyName("acme.io", ["Quick sync"], ["Ledgerline"])).toBe("Acme");
  });

  it("reads the video link", () => {
    expect(conferenceOf({ location: "https://us02web.zoom.us/j/8812?pwd=x" })).toBe("Zoom");
    expect(conferenceOf({ conference: "https://meet.google.com/abc-defg-hij" })).toBe("Google Meet");
    expect(conferenceOf({ description: "Join: https://teams.microsoft.com/l/meetup-join/19%3a" })).toBe("Teams");
    expect(conferenceOf({ location: "Blue Bottle, Hayes St" })).toBeUndefined();
  });
});

describe("readFeed", () => {
  const feed = (events: string[]) =>
    ["BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-CALNAME:priya@ledgerline.example", ...events.flatMap((e) => ["BEGIN:VEVENT", ...e.split("\n").map((l) => l.trim()), "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");

  it("keeps meetings with outsiders and counts the rest", () => {
    const r = readFeed(
      feed([
        `UID:ext\nDTSTART:20261021T170000Z\nDTEND:20261021T173000Z\nSUMMARY:Northwind deep-dive\nLOCATION:https://zoom.us/j/1\nATTENDEE:mailto:priya@ledgerline.example\nATTENDEE;CN=Dana Okafor:mailto:dana@northwind.example`,
        `UID:int\nDTSTART:20261021T190000Z\nSUMMARY:GTM sync\nATTENDEE:mailto:priya@ledgerline.example\nATTENDEE:mailto:sam@ledgerline.example`,
        `UID:solo\nDTSTART:20261022T190000Z\nSUMMARY:Focus`,
        `UID:allday\nDTSTART;VALUE=DATE:20261023\nSUMMARY:Conference`,
        `UID:old\nDTSTART:20250101T170000Z\nSUMMARY:Long ago\nATTENDEE:mailto:x@northwind.example`,
      ]),
      { ws: makeWorkspace({ founder: { name: "Priya" } }), now },
    );
    expect(r.name).toBe("priya@ledgerline.example");
    expect(r.events.map((e) => [e.id, e.conference])).toEqual([["ext", "Zoom"]]);
    expect(r.stats).toMatchObject({ total: 4, complete: true, withGuests: 2, hidden: { internal: 1, solo: 1, allDay: 1, declined: 0 } });
  });

  it("still reads a single event that moved outside the window when it was sent before", () => {
    const text = feed([`UID:moved\nDTSTART:20270301T170000Z\nSUMMARY:Pushed out\nATTENDEE:mailto:priya@ledgerline.example\nATTENDEE:mailto:dana@northwind.example`]);
    expect(readFeed(text, { ws: makeWorkspace(), now }).events).toEqual([]);
    expect(readFeed(text, { ws: makeWorkspace(), now, known: (id) => id === "moved" }).events.map((e) => e.id)).toEqual(["moved"]);
  });

  it("notices a busy-only (public) address", () => {
    const busy = [1, 2, 3].map((n) => `UID:b${n}\nDTSTART:2026102${n}T170000Z\nSUMMARY:Busy`);
    expect(readFeed(feed(busy), { ws: makeWorkspace(), now }).stats.busyOnly).toBe(true);
  });
});

describe("policy", () => {
  const ws = workspace();
  const tomorrow = Date.parse(at(1));
  const lastWeek = Date.parse(at(-7));

  it("puts meetings with deals on the deal, past or future", () => {
    expect(policyFor(ws, "northwind.example", lastWeek, now, LISTS)).toBe("apply");
    expect(policyFor(ws, "northwind.example", tomorrow, now, LISTS)).toBe("apply");
  });

  it("starts a deal for an upcoming meeting with a tracked company, but asks about a past one", () => {
    expect(policyFor(ws, "fernwick.example", tomorrow, now, LISTS)).toBe("apply");
    expect(policyFor(ws, "fernwick.example", lastWeek, now, LISTS)).toBe("review");
  });

  it("asks about new companies and customers without a deal; leaves ignored and disqualified ones alone", () => {
    expect(policyFor(ws, "halcyon.example", tomorrow, now, LISTS)).toBe("review");
    expect(policyFor(ws, "wrenfield.example", tomorrow, now, LISTS)).toBe("review");
    expect(policyFor(ws, "halcyon.example", tomorrow, now, { ignored: ["halcyon.example"], accepted: [] })).toBe("skip");
    expect(policyFor(ws, "meterbook.example", tomorrow, now, LISTS)).toBe("skip");
    expect(policyFor(ws, "halcyon.example", lastWeek, now, { ignored: [], accepted: ["halcyon.example"] })).toBe("apply");
  });
});

describe("planSync", () => {
  const base = { lists: LISTS, complete: true, now, refs: {} as Record<string, string> };

  it("sends meetings that go on deals, with the company's guests first, and nothing else", () => {
    const ws = workspace();
    const multi = ev("nw", "northwind.example", { companies: [{ domain: "northwind.example", guests: [{ email: "dana@northwind.example", name: "Dana" }] }, { domain: "partner.example", guests: [{ email: "jo@partner.example" }] }], personal: [{ email: "rui@gmail.com" }] });
    const plan = planSync({ ...base, ws, events: [multi, ev("new", "halcyon.example"), ev("p", null)], sent: {} });
    expect(plan.bookings).toEqual([
      { id: bookingId("nw", "northwind.example"), action: "created", title: multi.title, startsAt: multi.start, attendees: [{ email: "dana@northwind.example", name: "Dana" }, { email: "rui@gmail.com" }, { email: "jo@partner.example" }] },
    ]);
    expect(plan.added).toBe(1);
    expect(Object.keys(plan.sent)).toEqual([bookingId("nw", "northwind.example")]);
  });

  it("sends nothing the second time, then a move, then a cancellation", () => {
    const ws = workspace();
    const id = bookingId("nw", "northwind.example");
    const first = planSync({ ...base, ws, events: [ev("nw", "northwind.example")], sent: {} });
    const refs = { [id]: "mtg_1" };
    expect(planSync({ ...base, ws, refs, events: [ev("nw", "northwind.example")], sent: first.sent }).bookings).toEqual([]);
    const moved = planSync({ ...base, ws, refs, events: [ev("nw", "northwind.example", { start: at(2, "15:00") })], sent: first.sent });
    expect(moved.bookings).toMatchObject([{ id, action: "created", startsAt: at(2, "15:00") }]);
    expect(moved.moved).toBe(1);
    const cancelled = planSync({ ...base, ws, refs, events: [ev("nw", "northwind.example", { status: "cancelled" })], sent: moved.sent });
    expect(cancelled.bookings).toMatchObject([{ id, action: "canceled" }]);
    expect(cancelled.sent).toEqual({});
  });

  it("cancels an upcoming meeting deleted from a complete feed, forgets a past one, and trusts nothing from a cut-off feed", () => {
    const ws = workspace();
    const future = bookingId("f", "northwind.example");
    const past = bookingId("p", "northwind.example");
    const sent: Record<string, SentEntry> = { [future]: { fp: "x", start: at(3) }, [past]: { fp: "y", start: at(-3) } };
    const refs = { [future]: "mtg_f", [past]: "mtg_p" };
    const plan = planSync({ ...base, ws, refs, events: [], sent });
    expect(plan.bookings).toEqual([{ id: future, action: "canceled", title: "", attendees: [] }]);
    expect(plan.sent).toEqual({});
    expect(planSync({ ...base, ws, refs, complete: false, events: [], sent }).bookings).toEqual([]);
  });

  it("links a call already logged that day instead of adding a second meeting", () => {
    const ws = workspace();
    ws.meetings.mtg_logged = makeMeeting("mtg_logged", "deal_nw", { startsAt: at(-2, "16:40"), notesRaw: "Notes" });
    ws.deals.deal_nw.meetingIds = ["mtg_logged"];
    const plan = planSync({ ...base, ws, events: [ev("p", "northwind.example", { start: at(-2, "10:00") })], sent: {} });
    expect(plan.links).toEqual({ [bookingId("p", "northwind.example")]: "mtg_logged" });
    expect(plan.bookings).toEqual([]);
    expect(plan.sent[bookingId("p", "northwind.example")]).toMatchObject({ linked: true });
  });

  it("puts every meeting with a company on its deal once it's tracked from the calendar", () => {
    const ws = workspace();
    const plan = planSync({ ...base, ws, events: [ev("a", "halcyon.example", { start: at(-5) }), ev("b", "halcyon.example"), ev("c", "northwind.example")], sent: {}, onlyDomain: "halcyon.example" });
    expect(plan.bookings.map((b) => b.id)).toEqual([bookingId("a", "halcyon.example"), bookingId("b", "halcyon.example")]);
  });

  it("never brings back someone who asked to be deleted", () => {
    const ws = workspace();
    ws.suppression.push({ id: "sup_ana", email: "ana@northwind.example", reason: "requested_delete", at: NOW.toISOString() });
    expect(planSync({ ...base, ws, events: [ev("nw", "northwind.example")], sent: {} }).bookings).toEqual([]);
    const both = ev("nw2", "northwind.example", { companies: [{ domain: "northwind.example", guests: [{ email: "ana@northwind.example" }, { email: "lee@northwind.example" }] }] });
    expect(planSync({ ...base, ws, events: [both], sent: {} }).bookings[0].attendees).toEqual([{ email: "lee@northwind.example" }]);
  });

  it("writes nothing for a consumer company", () => {
    const ws = workspace();
    ws.company = makeCompany({ market: "consumer" });
    expect(planSync({ ...base, ws, events: [ev("nw", "northwind.example")], sent: {} }).bookings).toEqual([]);
  });
});

describe("buildDigest", () => {
  it("counts what's coming up, lists companies to review and the agenda", () => {
    const ws = workspace();
    const events = [
      ev("nw1", "northwind.example", { start: at(1, "10:00") }),
      ev("nw2", "northwind.example", { start: at(-3, "10:00") }),
      ev("hal", "halcyon.example", { title: "Halcyon Freight <> Ledgerline: intro", start: at(1, "11:30") }),
      ev("hal-past", "halcyon.example", { title: "Halcyon Freight <> Ledgerline", start: at(-9, "11:30") }),
      ev("cust", "wrenfield.example", { start: at(5) }),
      ev("me", null, { start: at(2) }),
      ev("gone", "northwind.example", { status: "cancelled", start: at(4) }),
      ev("far", "northwind.example", { start: at(40) }),
    ];
    const refs = { [bookingId("nw1", "northwind.example")]: "mtg_nw1", [bookingId("nw2", "northwind.example")]: "mtg_nw2" };
    ws.meetings.mtg_nw1 = makeMeeting("mtg_nw1", "deal_nw");
    ws.meetings.mtg_nw2 = makeMeeting("mtg_nw2", "deal_nw");
    const d = buildDigest({ ws, events, lists: LISTS, refs, now });
    expect(d.upcoming).toEqual({ total: 4, pipeline: 1, newCompanies: 1, personal: 1 });
    expect(d.past).toEqual({ total: 2, onDeals: 1 });
    expect(d.review.map((r) => [r.domain, r.name, r.status, r.meetings, r.next?.id, r.last?.id])).toEqual([
      ["halcyon.example", "Halcyon Freight", "new", 2, "hal", "hal-past"],
      ["wrenfield.example", "Wrenfield", "customer", 1, "cust", undefined],
    ]);
    expect(d.agenda.map((a) => [a.id, a.kind, a.meetingId])).toEqual([
      ["nw1", "pipeline", "mtg_nw1"],
      ["hal", "review", undefined],
      ["me", "personal", undefined],
      ["cust", "review", undefined],
    ]);
  });

  it("explains what it skipped", () => {
    const d = buildDigest({
      ws: workspace(),
      events: [],
      lists: LISTS,
      refs: {},
      now,
      stats: { at: NOW.toISOString(), total: 3, hidden: { internal: 0, solo: 0, allDay: 0, declined: 0 }, skipped: { rule: 2 }, complete: false, withGuests: 0 },
    });
    expect(d.notes).toEqual([
      "2 repeating events use a rule I can't expand exactly yet, so they're left out.",
      "Your calendar file was cut off, so I didn't treat anything missing from it as cancelled.",
      "None of these events list guests. Outlook's published calendars leave them out, so I can only match a meeting by its organizer.",
    ]);
  });
});

describe("Today cards for meetings with untracked companies", () => {
  const review = [
    { domain: "halcyon.example", name: "Halcyon Freight", status: "new" as const, next: { id: "hal", title: "Intro", start: at(1, "11:30") }, meetings: 1, guests: [{ name: "Jules Moreau" }] },
    { domain: "orchard.example", name: "Orchard", status: "new" as const, next: { id: "orc", title: "Intro", start: at(6, "11:30") }, meetings: 1, guests: [] },
  ];

  it("adds a card for tomorrow's meeting, not next week's", () => {
    const moves = newCompanyMoves(review, now);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ kind: "meeting_prep", rule: CALENDAR_MOVE_RULE, dueOn: TODAY, title: "Track Halcyon Freight before your call tomorrow at 11:30 AM" });
    expect(moves[0].why).toBe("New company on your calendar · Intro with Jules Moreau · Track it and I'll prep the brief");
  });

  it("settles cards that no longer apply and keeps the founder's own decisions", () => {
    const ws = makeWorkspace();
    const [card] = newCompanyMoves(review, now);
    expect(applyCalendarMoves(ws, [card], now)).toBe(true);
    expect(ws.moves[card.id].status).toBe("open");
    ws.moves.mv_cal_old = makeMove("mv_cal_old", { rule: CALENDAR_MOVE_RULE });
    ws.moves[card.id].status = "skipped";
    expect(applyCalendarMoves(ws, [card], now)).toBe(true);
    expect(ws.moves.mv_cal_old).toMatchObject({ status: "done", autoDone: true });
    expect(ws.moves[card.id].status).toBe("skipped");
    // Expired by the clock overnight: it comes back while the meeting is still ahead.
    Object.assign(ws.moves[card.id], { status: "done", autoDone: true, dueOn: "2026-10-19" });
    applyCalendarMoves(ws, [card], now);
    expect(ws.moves[card.id]).toMatchObject({ status: "open", dueOn: TODAY });
    expect(ws.moves[card.id].autoDone).toBeUndefined();
  });
});
