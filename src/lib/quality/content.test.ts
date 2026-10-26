import { describe, expect, it } from "vitest";
import { sampleWorkspace } from "@/lib/sample";
import { NOW } from "@/test/factories";
import { contentNotes } from "./content";

const ws = sampleWorkspace(NOW);
const name = ws.company!.name;

const POST = `Nobody on the finance team trusts the month-end usage number.

On three calls this month, a controller told me the same thing. They export usage events, paste them next to invoices, and argue about the gap for a week. Nobody thinks the billing system is wrong. They just can't show why the totals differ, so the close waits until someone senior signs off on a guess.

What changed my mind was watching one of them do it live. The gap was not in the math. It was in timing: events that landed after the invoice ran, counted twice across two periods. Once she sorted by event time instead of invoice date, most of the gap went away in an afternoon.

So if your close drags, look at when usage lands, not only how much. Sort by the event's own timestamp and see what moves. Tell me if you have seen the same thing, or something else entirely.`;

describe("contentNotes", () => {
  it("passes a plain post of the right length", () => {
    expect(contentNotes(ws, "post", POST)).toEqual([]);
  });

  it("flags a post that's too short, has too many hashtags, a long hook or template words", () => {
    const notes = contentNotes(ws, "post", "Here is a really long opening line that goes on far past twelve words for sure\n\nWe leverage AI. #a #b #c");
    expect(notes.some((n) => /words\. Posts like this land best/.test(n))).toBe(true);
    expect(notes).toContain("3 hashtags. Two at most.");
    expect(notes.some((n) => /first line is 16 words/.test(n))).toBe(true);
    expect(notes.some((n) => /leverage/i.test(n))).toBe(true);
  });

  it("asks a community answer to disclose the founder's product and drop links", () => {
    const pitch = `Sort usage by event time before you reconcile. ${name} does this for you: https://example.com`;
    const notes = contentNotes(ws, "community_answer", pitch);
    expect(notes).toContain(`It names ${name} without saying you built it. Say so, or leave it out.`);
    expect(notes.some((n) => /link in a first answer/.test(n))).toBe(true);
    // Disclosed, no link: fine. Length isn't held to the post's 120-word floor.
    expect(contentNotes(ws, "community_answer", `Sort usage by event time before you reconcile. I built ${name}, so I'm biased, but a spreadsheet works too.`)).toEqual([]);
  });

  it("holds a launch post to Show HN's conventions", () => {
    expect(contentNotes(ws, "launch", `# ${name} – usage close in a day\n\nTry it at [[link]]. Please upvote if you like it.`)).toEqual([
      "Start the title with “Show HN:”.",
      "Don't ask for upvotes. Hacker News penalizes it.",
    ]);
    expect(contentNotes(ws, "launch", `# Show HN: ${name} – reconcile usage events with invoices\n\nTry it without a call at [[link]].`)).toEqual([]);
  });

  it("ignores other kinds", () => {
    expect(contentNotes(ws, "one_pager", "We leverage AI!")).toEqual([]);
  });
});
