import { describe, expect, it } from "vitest";
import type { VoiceCard } from "@/lib/domain/types";
import { at, makeWorkspace } from "@/test/factories";
import { editDistance, extractTraits, extractVoice, learnFromEdit, noteToneOff, traitLines } from "./voice";

const casual = [
  "Subject: your close\n\nHi Dana,\n\nSaw the posting for a billing analyst. We've built the reconciliation piece three times now. It's always the same script. Does yours run in Python or in the warehouse?",
  "Subject: the usage export\n\nHi Sam,\n\nYour pricing page moved to usage tiers in June. That's usually when month-end gets messy (two systems, one analyst). Is close still a spreadsheet?",
  "Hi Ana,\n\nI don't think dashboards fix this. They show the gap but don't close it. Who owns invoicing today?",
];

const formal = [
  "Subject: Reconciliation Process Review\n\nDear Mr. Lee,\n\nI am writing regarding the reconciliation process described in your recent posting, which suggests that the finance organization is consolidating its usage data across several systems at present. Please find a short summary of our approach below. Kind regards.",
];

describe("editDistance", () => {
  it("is 0 for an untouched draft and grows with the rewrite", () => {
    expect(editDistance("Dana, quick note on the close.", "Dana, quick note on the close.")).toBe(0);
    expect(editDistance("Dana, quick note on the close.", "Hi Dana, quick note on the close.")).toBe(0.14);
    expect(editDistance("Dana, quick note on the close.", "Totally different words here now")).toBe(1);
    expect(editDistance("", "")).toBe(0);
  });
});

describe("extractTraits", () => {
  it("reads a casual founder from their samples", () => {
    const t = extractTraits({ samples: casual.map((text) => ({ text, kind: "email" })), edits: [], toneOff: [] });
    expect(t).toMatchObject({ contractions: true, greeting: "hi_first_name", subjectStyle: "lowercase", formality: 2 });
    expect(t.avgSentenceWords).toBeGreaterThanOrEqual(5);
    expect(t.avgSentenceWords).toBeLessThanOrEqual(9);
    expect(t.punctuationHabits).toEqual(expect.arrayContaining(["Uses parentheses", "No exclamation marks", "Ends on a question"]));
  });

  it("reads a formal one, and title-case subjects", () => {
    const t = extractTraits({ samples: formal.map((text) => ({ text, kind: "email" })), edits: [], toneOff: [] });
    expect(t).toMatchObject({ contractions: false, subjectStyle: "title", greeting: "none" });
    expect(t.formality).toBeGreaterThanOrEqual(4);
  });

  it("learns the words a founder adds and cuts, ignoring names", () => {
    const edits = [1, 2].map(() => ({
      at: at(0),
      before: "Dana, I wanted to leverage this moment to reach out about Acme's process.",
      after: "Dana, your close runs nine days. Worth fixing before the audit?",
      subjectBefore: "Quick Question",
      subjectAfter: "your close",
      distance: 0.8,
    }));
    const t = extractTraits({ samples: [], edits, toneOff: ["Hope this finds you well! Excited to synergize.", "Excited to synergize with your team!"] });
    expect(t.avoidsWords).toEqual(expect.arrayContaining(["leverage", "wanted", "moment", "process", "excited", "synergize"]));
    expect(t.avoidsWords).not.toContain("acme's");
    expect(t.usesWords).toEqual(expect.arrayContaining(["close", "nine", "days", "audit"]));
    expect(t.subjectStyle).toBe("lowercase");
  });

  it("leaves out what it can't tell", () => {
    expect(extractTraits({ samples: [], edits: [], toneOff: [] })).toEqual({ usesWords: [], avoidsWords: [], punctuationHabits: [] });
  });
});

describe("the card", () => {
  it("suggests, never applies, and doesn't re-suggest what was accepted", () => {
    const v: VoiceCard = { samples: casual.map((text) => ({ text, kind: "email" })), summary: "", signOff: "", updatedAt: at(-1) };
    extractVoice(v, at(0));
    expect(v.suggested).toMatchObject({ greeting: "hi_first_name", basis: "3 samples", at: at(0) });
    expect(v.traits).toBeUndefined();
    const accepted = { ...v.suggested! } as Partial<typeof v.suggested>;
    delete accepted!.at;
    delete accepted!.basis;
    v.traits = accepted;
    delete v.suggested;
    extractVoice(v, at(0));
    expect(v.suggested).toBeUndefined();
  });

  it("keeps the last 20 edits and ignores sends that weren't edited", () => {
    const ws = makeWorkspace();
    learnFromEdit(ws, { before: "a", after: "a", distance: 0 }, at(0));
    expect(ws.voice).toBeNull();
    for (let i = 0; i < 25; i++) learnFromEdit(ws, { before: `draft ${i}`, after: `sent ${i}`, distance: 0.5 }, at(0));
    expect(ws.voice?.edits).toHaveLength(20);
    expect(ws.voice?.edits?.[0].before).toBe("draft 5");
    // The 20th edit re-read the voice; five since.
    expect(ws.voice?.editsSinceExtract).toBe(5);
  });

  it("keeps the last 10 tone-off drafts", () => {
    const ws = makeWorkspace();
    for (let i = 0; i < 12; i++) noteToneOff(ws, `draft ${i}`, at(0), `mv_${i}`);
    expect(ws.voice?.toneOff?.map((t) => t.text)).toEqual(Array.from({ length: 10 }, (_, i) => `draft ${i + 2}`));
  });
});

describe("traitLines", () => {
  it("says the traits in words the drafting prompt can follow", () => {
    expect(traitLines({ avgSentenceWords: 9, contractions: true, greeting: "first_name", subjectStyle: "lowercase", avoidsWords: ["leverage"], formality: 2 })).toEqual([
      "Sentences average about 9 words.",
      "Uses contractions (it's, we're, don't).",
      'Opens with the first name and a comma ("Dana,").',
      "Subject lines in all lowercase.",
      "Words they cut from drafts (never use): leverage.",
      "Formality 2 of 5.",
    ]);
    expect(traitLines(undefined)).toEqual([]);
  });
});
