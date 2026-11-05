import { describe, expect, it } from "vitest";
import { at, makeActivity, makePackage, makePerson, makeWorkspace } from "@/test/factories";
import { isAutoReply, parseReferral, parseReturnDate, parseRevisit, readIntent, readOf, replyBy } from "./intent";

/** Tuesday 20 Oct 2026, 09:30 local (the suite's NOW). */
const tuesday = at(0, "09:30");

describe("readIntent", () => {
  it("reads opt-outs and auto-replies first, as the compose workflow does", () => {
    expect(readIntent("Please remove me from your list.")?.intent).toBe("unsubscribe");
    expect(readIntent("stop")?.intent).toBe("unsubscribe");
    expect(readIntent("I'm out of the office until Thursday. For anything urgent, contact Ethan Brooks.")?.intent).toBe("ooo");
    // A person answering inside an auto-reply is a person.
    expect(readIntent("Automatic reply: away until Thursday. Actually yes, let's talk.")?.intent).not.toBe("ooo");
  });

  it("reads a referral, a not now, a no and pushback", () => {
    expect(readIntent("I'm not the right person anymore. Nora Vance owns the close now, worth reaching out to her.")?.intent).toBe("referral");
    expect(readIntent("Not a priority right now. Can you check back next quarter?")?.intent).toBe("not_now");
    expect(readIntent("Not interested, thanks.")?.intent).toBe("negative");
    expect(readIntent("We built this in-house last year.")?.intent).toBe("objection");
  });

  it("reads a product question as a question and a plain yes as interested", () => {
    const dana = readIntent("Recap looks right. Sofia is in for the deep-dive and will send the invite. One question: can the security answers cover EU data, since Sofia's team is in Lisbon?");
    expect(dana).toEqual({ intent: "info_request", cue: "One question: can the security answers cover EU data, since Sofia's team is in Lisbon?" });
    expect(readIntent("Send me the deck and I'll take a look.")?.intent).toBe("info_request");
    expect(readIntent("Yes, happy to chat. Thursday works.")?.intent).toBe("positive");
  });

  it("leaves what no phrase decides unread", () => {
    expect(readIntent("Thanks!")).toBeNull();
    expect(readIntent("   ")).toBeNull();
  });
});

describe("readOf", () => {
  const ws = makeWorkspace({ people: { per_a: makePerson("per_a", "acme.io") } });
  const reply = (patch = {}) => makeActivity("act_r", { kind: "reply_received", personId: "per_a", at: at(-1), body: "Yes, let's talk next week.", ...patch });

  it("prefers the founder's correction, then the model's read, then code, then the sequencer's label", () => {
    expect(readOf(ws, reply({ intent: "objection" }))).toEqual({ intent: "objection", by: "founder" });
    const drafted = makeWorkspace({
      people: ws.people,
      outreach: { pkg: makePackage("pkg", "acme.io", { mode: "reply", personId: "per_a", reply: { text: "Yes, let's talk next week.", intent: "info_request", summary: "", receivedAt: at(-1) } }) },
    });
    expect(readOf(drafted, reply())).toEqual({ intent: "info_request", by: "model" });
    expect(readOf(ws, reply())).toMatchObject({ intent: "positive", by: "code" });
    expect(readOf(ws, reply({ body: undefined, sentiment: "negative", source: "instantly" }))).toEqual({ intent: "negative", by: "vendor", source: "instantly" });
    expect(readOf(ws, reply({ body: "Thanks!", sentiment: "neutral" }))).toEqual({ intent: null, by: null });
  });

  it("knows an auto-reply by its label, the founder's word, or its words", () => {
    expect(isAutoReply(ws, reply({ sentiment: "ooo", body: undefined }))).toBe(true);
    expect(isAutoReply(ws, reply({ body: "Out of office until Monday." }))).toBe(true);
    expect(isAutoReply(ws, reply({ body: "Out of office until Monday.", intent: "positive" }))).toBe(false);
    expect(isAutoReply(ws, reply())).toBe(false);
  });
});

describe("parseReturnDate", () => {
  it("reads the day after until, back or returning, counted from when it arrived", () => {
    expect(parseReturnDate("I'm out of the office until Thursday.", tuesday)).toBe("2026-10-22");
    expect(parseReturnDate("Back on Monday, November 2.", tuesday)).toBe("2026-11-02");
    expect(parseReturnDate("Returning 11/4. Limited access to email.", tuesday)).toBe("2026-11-04");
    expect(parseReturnDate("On leave until the 28th.", tuesday)).toBe("2026-10-28");
    expect(parseReturnDate("Out of office, back 2026-11-09.", tuesday)).toBe("2026-11-09");
  });

  it("treats through as back the next working day, and says nothing without a date", () => {
    expect(parseReturnDate("Out through Friday.", tuesday)).toBe("2026-10-26");
    expect(parseReturnDate("Out of office. Limited access to email.", tuesday)).toBeNull();
  });

  it("rolls a month and day that already passed into next year", () => {
    expect(parseReturnDate("Away until January 4.", tuesday)).toBe("2027-01-04");
  });
});

describe("parseRevisit", () => {
  it("reads next quarter, a named month, the new year and spans of time", () => {
    expect(parseRevisit("Can you check back next quarter?", tuesday)).toBe("2027-01-04");
    expect(parseRevisit("Ping me in March.", tuesday)).toBe("2027-03-01");
    expect(parseRevisit("After the holidays works better.", tuesday)).toBe("2027-01-04");
    expect(parseRevisit("Try me in a few weeks.", tuesday)).toBe("2026-11-10");
    expect(parseRevisit("Circle back in two months.", tuesday)).toBe("2026-12-21");
    expect(parseRevisit("Not right now, maybe in Q2.", tuesday)).toBe("2027-04-01");
  });

  it("returns null when they gave no time", () => {
    expect(parseRevisit("Not a priority right now.", tuesday)).toBeNull();
  });
});

describe("parseReferral", () => {
  const sam = "Thanks Priya. I'm not the right person for this anymore. Nora Vance (nora.vance@cinderpath.example), our new Revenue Accounting Manager, owns the close now. Worth reaching out to her.";

  it("reads the name, the address and the title they gave, never the sender's or the founder's", () => {
    expect(parseReferral(sam, { names: ["Sam Whitlock", "Priya Raman"], emails: ["sam@cinderpath.example"] })).toEqual({ name: "Nora Vance", email: "nora.vance@cinderpath.example", title: "Revenue Accounting Manager" });
    expect(parseReferral("You should talk to Marco Ruiz, he runs billing.", {})?.name).toBe("Marco Ruiz");
    expect(parseReferral("Looping in jo.lee@acme.io who owns this.", {})).toEqual({ name: "Jo Lee", email: "jo.lee@acme.io" });
  });

  it("returns null when nobody is named", () => {
    expect(parseReferral("Not me, sorry.", {})).toBeNull();
  });
});

describe("replyBy", () => {
  it("is the same working day for a yes or a question, one day for pushback, two for a referral", () => {
    expect(replyBy("positive", tuesday)).toBe("2026-10-20");
    expect(replyBy("info_request", tuesday)).toBe("2026-10-20");
    expect(replyBy(null, tuesday)).toBe("2026-10-20");
    expect(replyBy("objection", tuesday)).toBe("2026-10-21");
    expect(replyBy("referral", tuesday)).toBe("2026-10-22");
  });

  it("starts the clock the next working day after 5pm or on a weekend, and owes nothing for a no", () => {
    expect(replyBy("positive", at(0, "18:30"))).toBe("2026-10-21");
    // Saturday 24 Oct → Monday 26 Oct.
    expect(replyBy("positive", at(4, "10:00"))).toBe("2026-10-26");
    for (const intent of ["not_now", "negative", "unsubscribe", "ooo"] as const) expect(replyBy(intent, tuesday)).toBeNull();
  });
});
