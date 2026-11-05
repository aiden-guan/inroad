import { describe, expect, it } from "vitest";
import { sampleWorkspace } from "@/lib/sample";
import { sampleCalendar } from "@/lib/sample/calendar";
import { MEETING } from "@/lib/sample/ids";
import { sampleTranscript } from "@/lib/sample/transcript";
import { NOW, at, makeAccount, makeDeal, makeMeeting, makeWorkspace } from "@/test/factories";
import { matchTranscript, type CalendarCandidate } from "./match";
import { parseTranscript } from "./parse";

const FOUNDER = ["Priya Raman"];
const parse = (text: string, fileName?: string) => parseTranscript(text, { fileName, now: NOW, founderNames: FOUNDER });

function calendarCandidates(): CalendarCandidate[] {
  const ws = sampleWorkspace(NOW);
  return sampleCalendar(NOW)
    .events.filter((e) => e.companies[0] && !ws.accounts[e.companies[0].domain])
    .map((e) => ({ eventId: e.id, domain: e.companies[0].domain, company: e.companies[0].domain.split(".")[0], title: e.title, start: e.start, guests: e.companies[0].guests.map((g) => g.name ?? "") }));
}

describe("matchTranscript", () => {
  it("matches the sample transcript to Tidewell's call on the calendar, with reasons", () => {
    const { fileName, text } = sampleTranscript(NOW);
    const m = matchTranscript(parse(text, fileName), { ws: sampleWorkspace(NOW), calendar: calendarCandidates(), now: NOW, founderNames: FOUNDER });
    expect(m.confidence).toBe("high");
    expect(m.best).toMatchObject({ kind: "calendar", domain: "tidewell.example" });
    expect(m.best?.reasons).toEqual(["Recorded at the meeting's time", "Maren Holt and Arjun Patel spoke"]);
  });

  it("matches a call to the meeting at that time with the people who spoke", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:02.000 --> 00:00:05.000",
      "<v Priya Raman>Thanks, both of you.</v>",
      "",
      "00:00:06.000 --> 00:00:09.000",
      "<v Dana Okafor (Northwind Metrics)>Usage tie-out took us five days last close.</v>",
      "",
      "00:00:10.000 --> 00:00:14.000",
      "<v Marcus Lindqvist (Northwind Metrics)>I can approve it out of the finance tools budget.</v>",
    ].join("\n");
    const m = matchTranscript(parse(vtt, "2026-10-19 11.01.03 Priya Raman's Zoom Meeting.vtt"), { ws: sampleWorkspace(NOW), now: NOW, founderNames: FOUNDER });
    expect(m.best).toMatchObject({ kind: "meeting", meetingId: MEETING.northwindYesterday });
    expect(m.best?.reasons).toEqual(["Recorded at the meeting's time", "Dana Okafor and Marcus Lindqvist spoke", "Speaker labels say Northwind Metrics", "Already debriefed"]);
    expect(m.confidence).toBe("high");
  });

  it("asks when nothing fits, and never picks a call that hasn't happened", () => {
    const ws = makeWorkspace({
      accounts: { "acme.example": makeAccount("acme.example", { name: "Acme", dealId: "deal_a" }) },
      deals: { deal_a: makeDeal("deal_a", "acme.example", { meetingIds: ["mtg_next"] }) },
      meetings: { mtg_next: makeMeeting("mtg_next", "deal_a", { startsAt: at(5, "10:00"), attendees: [{ name: "Ana Ruiz" }] }) },
    });
    const m = matchTranscript(parse("Priya Raman: Hi Ana.\nAna Ruiz: Hi.\nPriya Raman: How's the close?\nAna Ruiz: Slow."), { ws, now: NOW, founderNames: FOUNDER });
    expect(m).toEqual({ confidence: "low", candidates: [] });
  });

  it("proposes the most recent past call when the file has no date", () => {
    const ws = makeWorkspace({
      accounts: { "acme.example": makeAccount("acme.example", { name: "Acme", dealId: "deal_a" }) },
      deals: { deal_a: makeDeal("deal_a", "acme.example", { meetingIds: ["mtg_old", "mtg_new"] }) },
      meetings: {
        mtg_old: makeMeeting("mtg_old", "deal_a", { startsAt: at(-20, "10:00"), attendees: [{ name: "Ana Ruiz" }] }),
        mtg_new: makeMeeting("mtg_new", "deal_a", { startsAt: at(-1, "10:00"), attendees: [{ name: "Ana Ruiz" }] }),
      },
    });
    const m = matchTranscript(parse("Priya Raman: Hi Ana.\nAna Ruiz: Hi.\nPriya Raman: How's the close?\nAna Ruiz: Slow."), { ws, now: NOW, founderNames: FOUNDER });
    expect(m.best?.meetingId).toBe("mtg_new");
    expect(m.confidence).toBe("medium");
    expect(m.candidates.map((c) => c.meetingId)).toEqual(["mtg_new", "mtg_old"]);
  });

  it("offers a new call with a company the title names when no meeting fits", () => {
    const ws = makeWorkspace({ accounts: { "glassmoor.example": makeAccount("glassmoor.example", { name: "Glassmoor" }) } });
    const p = parse("# Glassmoor intro\n\nPriya Raman: Thanks Lena.\nLena Fischer: Happy to.\nPriya Raman: How do you close?\nLena Fischer: Slowly.");
    const m = matchTranscript(p, { ws, now: NOW, founderNames: FOUNDER });
    expect(m.candidates).toMatchObject([{ kind: "account", domain: "glassmoor.example", reasons: ["The title names Glassmoor", "No meeting on file for this call"] }]);
    expect(m.confidence).toBe("low");
  });

  it("only looks at the meetings it's given (a drop on one meeting row)", () => {
    const ws = sampleWorkspace(NOW);
    const { fileName, text } = sampleTranscript(NOW);
    const m = matchTranscript(parse(text, fileName), { ws, now: NOW, founderNames: FOUNDER, meetingIds: [MEETING.saltmarshDiscovery] });
    expect(m.candidates.every((c) => c.meetingId === MEETING.saltmarshDiscovery)).toBe(true);
  });
});
