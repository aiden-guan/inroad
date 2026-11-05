import { describe, expect, it } from "vitest";
import { looksLikeTranscript } from "@/lib/deals/rules";
import { sampleTranscript } from "@/lib/sample/transcript";
import { NOW } from "@/test/factories";
import { findWhen, parseTranscript, renameSpeakers, seconds } from "./parse";

const FOUNDER = ["Priya Raman"];
const parse = (text: string, fileName?: string) => parseTranscript(text, { fileName, now: NOW, founderNames: FOUNDER });
const names = (p: ReturnType<typeof parse>) => p.speakers.map((s) => s.name);

describe("timestamps and dates", () => {
  it("reads every timestamp shape the tools write", () => {
    expect(seconds("00:01:23.456")).toBeCloseTo(83.456);
    expect(seconds("01:23,5")).toBeCloseTo(83.5);
    expect(seconds("1:02:03")).toBe(3723);
    expect(seconds("12:34")).toBe(754);
    expect(seconds("12:75")).toBeNull();
  });

  it("finds when the call happened in file names and headers", () => {
    expect(findWhen("GMT20261019-220112_Recording.transcript.vtt", "file name", NOW)).toEqual({ date: "2026-10-19", time: "15:01", iso: "2026-10-19T22:01:12.000Z", from: "file name" });
    expect(findWhen("2026-10-19 15.00.12 Priya Raman's Zoom Meeting", "file name", NOW)).toEqual({ date: "2026-10-19", time: "15:00", from: "file name" });
    expect(findWhen("Tidewell discovery (2026-10-19 15:00 GMT-7) - Transcript", "transcript", NOW)?.iso).toBe("2026-10-19T22:00:00.000Z");
    expect(findWhen("Mon, Oct 19, 2026 3:00PM • 17:24", "transcript", NOW)).toEqual({ date: "2026-10-19", time: "15:00", from: "transcript" });
    // No year: the most recent October 19, never one far in the future.
    expect(findWhen("Tidewell discovery - October 19", "transcript", NOW)?.date).toBe("2026-10-19");
    expect(findWhen("Planning - December 30", "transcript", NOW)?.date).toBe("2025-12-30");
    expect(findWhen("northwind_20261012.txt", "file name", NOW)?.date).toBe("2026-10-12");
    expect(findWhen("call notes.txt", "file name", NOW)).toBeUndefined();
  });
});

describe("formats", () => {
  it("reads Zoom's VTT: cues, speakers, the time from the file name, a 15–20 minute call", () => {
    const { fileName, text } = sampleTranscript(NOW);
    const p = parse(text, fileName);
    expect(p).toMatchObject({ format: "zoom_vtt", formatLabel: "Zoom transcript (.vtt)", isTranscript: true });
    expect(names(p)).toEqual(expect.arrayContaining(["Priya Raman", "Maren Holt", "Arjun Patel"]));
    expect(p.speakers.find((s) => s.name === "Priya Raman")?.founder).toBe(true);
    expect(p.durationSec).toBeGreaterThanOrEqual(15 * 60);
    expect(p.durationSec).toBeLessThanOrEqual(20 * 60);
    expect(p.when?.iso).toBeDefined();
    expect(p.text.split("\n")[0]).toBe("[00:03] Priya Raman: Hi Maren, thanks for making the time. Can you hear me okay?");
    // Consecutive cues by the same speaker are one turn.
    expect(p.turns.every((t, i) => i === 0 || t.speaker !== p.turns[i - 1].speaker)).toBe(true);
    expect(looksLikeTranscript(p.text)).toBe(true);
    const shares = p.speakers.reduce((s, x) => s + x.share, 0);
    expect(shares).toBeCloseTo(1, 5);
  });

  it("reads Teams VTT voice tags, cue ids and companies in labels", () => {
    const p = parse(
      [
        "WEBVTT",
        "",
        "0f0c3c2e-1c1d-4b3a-9e55-2a1f6c0b9b9e/12-0",
        "00:00:02.150 --> 00:00:05.610",
        "<v Priya Raman>Hi Dana, thanks for joining.</v>",
        "",
        "0f0c3c2e-1c1d-4b3a-9e55-2a1f6c0b9b9e/13-0",
        "00:00:06.020 --> 00:00:09.880",
        "<v Dana Okafor (Northwind Metrics)>Happy to. Marcus is joining late,</v>",
        "",
        "0f0c3c2e-1c1d-4b3a-9e55-2a1f6c0b9b9e/13-1",
        "00:00:09.900 --> 00:00:12.000",
        "<v Dana Okafor (Northwind Metrics)>he&#39;s in board prep.</v>",
      ].join("\r\n"),
    );
    expect(p.format).toBe("teams_vtt");
    expect(p.speakers.map((s) => [s.name, s.company])).toEqual([
      ["Dana Okafor", "Northwind Metrics"],
      ["Priya Raman", undefined],
    ]);
    expect(p.text).toBe("[00:02] Priya Raman: Hi Dana, thanks for joining.\n[00:06] Dana Okafor (Northwind Metrics): Happy to. Marcus is joining late, he's in board prep.");
  });

  it("reads SRT subtitles", () => {
    const p = parse("1\n00:00:01,000 --> 00:00:04,000\nPriya: Thanks for making time.\n\n2\n00:00:04,500 --> 00:00:07,250\nLeo: Sure. Month-end takes about a week.\n");
    expect(p.format).toBe("srt");
    expect(p.text).toBe("[00:01] Priya: Thanks for making time.\n[00:04] Leo: Sure. Month-end takes about a week.");
  });

  it("reads Zoom's saved .txt, whose stamps are clock times", () => {
    const p = parse("[Priya Raman] 15:01:12\nThanks for making the time.\n\n[Leo Marchetti] 15:01:20\nOf course. Month-end takes\nabout a week for us.\n\n[Priya Raman] 15:02:05\nWhat takes the longest?\n", "2026-10-14 15.00.48 Priya Raman's Zoom Meeting.txt");
    expect(p.format).toBe("zoom_txt");
    expect(p.text).toBe("[00:00] Priya Raman: Thanks for making the time.\n[00:08] Leo Marchetti: Of course. Month-end takes about a week for us.\n[00:53] Priya Raman: What takes the longest?");
    expect(p.when).toMatchObject({ date: "2026-10-14", time: "15:00" });
    expect(p.speakers.find((s) => s.founder)?.questions).toBe(1);
  });

  it("reads a Google Meet transcript doc with its attendee list and clock lines", () => {
    const p = parse(
      [
        "Tidewell discovery (2026-10-19 15:00 GMT-7) - Transcript",
        "Attendees",
        "Arjun Patel, Maren Holt, Priya Raman",
        "Transcript",
        "00:00:00",
        "",
        "Priya Raman: Hi Maren, thanks for making the time.",
        "Maren Holt: Of course. Arjun's joining in a minute.",
        "00:05:00",
        "",
        "Arjun Patel: The usage tie-out takes about six days.",
        "Priya Raman: What makes it take that long?",
        "Arjun Patel: Late events, mostly.",
      ].join("\n"),
    );
    expect(p.format).toBe("meet");
    expect(p.title).toBe("Tidewell discovery");
    expect(p.listed).toEqual(["Arjun Patel", "Maren Holt", "Priya Raman"]);
    expect(p.when?.iso).toBe("2026-10-19T22:00:00.000Z");
    expect(p.text.split("\n")[2]).toBe("[05:00] Arjun Patel: The usage tie-out takes about six days.");
  });

  it("reads Fathom's copied transcript", () => {
    const p = parse(
      [
        "Tidewell discovery - October 19",
        "VIEW RECORDING - 17 mins (No highlights): https://fathom.video/share/abc123",
        "",
        "---",
        "",
        "0:00 - Priya Raman (Ledgerline)",
        "  Hi Maren, thanks for making the time.",
        "",
        "0:06 - Maren Holt (Tidewell)",
        "  Of course. Arjun's joining in a minute.",
        "  He's finishing another call.",
        "",
        "0:41 - Arjun Patel (Tidewell)",
        "  The usage tie-out takes about six days.",
      ].join("\n"),
    );
    expect(p).toMatchObject({ format: "fathom", title: "Tidewell discovery", durationSec: 17 * 60, when: { date: "2026-10-19" } });
    expect(p.speakers.map((s) => s.company)).toEqual(expect.arrayContaining(["Ledgerline", "Tidewell"]));
    expect(p.text.split("\n")[1]).toBe("[00:06] Maren Holt (Tidewell): Of course. Arjun's joining in a minute. He's finishing another call.");
  });

  it("reads Otter's export: header, speakers list, unnamed speakers", () => {
    const p = parse(
      [
        "Tidewell discovery",
        "Mon, Oct 19, 2026 3:00PM • 17:24",
        "",
        "SUMMARY KEYWORDS",
        "usage, invoices, snowflake, stripe",
        "",
        "SPEAKERS",
        "Priya Raman, Maren Holt, Arjun Patel",
        "",
        "Priya Raman  0:02",
        "Hi Maren, thanks for making the time.",
        "",
        "Maren Holt  0:06",
        "Of course. Arjun's joining in a minute.",
        "",
        "Unknown Speaker  0:41",
        "Sorry, I'm here.",
      ].join("\n"),
    );
    expect(p).toMatchObject({ format: "otter", title: "Tidewell discovery", durationSec: 1044, when: { date: "2026-10-19", time: "15:00" } });
    expect(p.listed).toEqual(["Priya Raman", "Maren Holt", "Arjun Patel"]);
    expect(p.speakers.find((s) => s.name === "Unknown Speaker")?.generic).toBe(true);
    expect(p.warnings).toContain("Some speakers aren't named. Name them below if you can.");
  });

  it("reads Granola's Me and Them, and renames them", () => {
    const p = parse("Me: Thanks for making time, Maren.\nThem: Of course. Arjun's joining soon.\nMe: How does month-end work today?\nThem: The usage tie-out takes about six days.\n");
    expect(p.format).toBe("granola");
    expect(p.speakers.map((s) => [s.name, s.founder, s.generic])).toEqual([
      ["Them", false, true],
      ["Me", true, false],
    ]);
    const named = renameSpeakers(p, { Me: "Priya Raman", Them: "Maren Holt" }, FOUNDER);
    expect(named.text).toBe("Priya Raman: Thanks for making time, Maren.\nMaren Holt: Of course. Arjun's joining soon.\nPriya Raman: How does month-end work today?\nMaren Holt: The usage tie-out takes about six days.");
    expect(named.speakers.map((s) => s.name)).toEqual(["Maren Holt", "Priya Raman"]);
    expect(named.warnings).toEqual([]);
  });

  it("reads plain speaker lines with stamps, and Markdown bold labels", () => {
    const stamped = parse("[00:02:14] Dana Okafor: Usage tie-out took us five days.\n[00:06:40] Marcus Lindqvist: True-ups hit at quarter-end.\n[00:09:03] Dana Okafor: The hire is mostly to run that export.\n[00:21:55] Marcus Lindqvist: I can approve it.");
    expect(stamped.format).toBe("speaker_text");
    expect(stamped.text.split("\n")[3]).toBe("[21:55] Marcus Lindqvist: I can approve it.");
    const md = parse("# Northwind call\n\n**Priya:** How do you close today?\n**Dana:** Five days of spreadsheets.\n**Priya:** Who signs?\n**Dana:** Marcus does.");
    expect(md.format).toBe("speaker_text");
    expect(md.title).toBe("Northwind call");
    expect(md.text).toBe("Priya: How do you close today?\nDana: Five days of spreadsheets.\nPriya: Who signs?\nDana: Marcus does.");
  });

  it("treats notes as notes, even with a few 'Label:' lines", () => {
    const p = parse("Dana walked through the close. Usage export from ClickHouse, invoices from billing.\nAgenda: pricing and the pilot.\nNext steps: security questionnaire by Friday.\nShe wants Marcus on the next call.");
    expect(p).toMatchObject({ format: "notes", isTranscript: false, speakers: [] });
    expect(p.text).toContain("Dana walked through the close.");
    expect(p.warnings[0]).toMatch(/^No speaker labels/);
  });

  it("folds a one-word label that appears once in a long call back into the text", () => {
    const cues = Array.from({ length: 24 }, (_, i) => `${i + 1}\n00:00:${String(10 + i * 2).padStart(2, "0")}.000 --> 00:00:${String(11 + i * 2).padStart(2, "0")}.000\n${i === 9 ? "Okay: so the thing is the export." : `${i % 2 ? "Maren Holt" : "Priya Raman"}: Line ${i}.`}\n`);
    const p = parse(`WEBVTT\n\n${cues.join("\n")}`);
    expect(names(p).sort()).toEqual(["Maren Holt", "Priya Raman"]);
    expect(p.text).toContain("Okay: so the thing is the export.");
  });
});
