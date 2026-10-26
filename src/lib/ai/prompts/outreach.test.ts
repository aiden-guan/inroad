import { describe, expect, it } from "vitest";
import { at, makeWorkspace } from "@/test/factories";
import { fmtVoice } from "./outreach";

/** Drafts are written to the voice the founder confirmed, with their latest edits and tone-off skips as examples. */
describe("fmtVoice", () => {
  it("falls back to plain defaults with nothing learned yet", () => {
    expect(fmtVoice(makeWorkspace())).toBe("No samples yet. Write plainly, short sentences, contractions, no flourishes.");
  });

  it("gives accepted traits, real edits and skipped drafts; suggestions wait for the founder", () => {
    const ws = makeWorkspace();
    ws.voice = {
      samples: [],
      summary: "",
      signOff: "",
      updatedAt: at(0),
      traits: { greeting: "hi_first_name", contractions: true },
      suggested: { greeting: "none", at: at(0), basis: "3 samples" },
      edits: [
        { at: at(-1), before: "Dana, I wanted to reach out.", after: "Hi Dana, your close runs nine days.", subjectBefore: null, subjectAfter: null, distance: 0.7 },
        { at: at(0), before: "Same text.", after: "Same text!", subjectBefore: null, subjectAfter: null, distance: 0.05 },
      ],
      toneOff: [{ at: at(0), text: "Hope this finds you well!" }],
    };
    const out = fmtVoice(ws);
    expect(out).toContain('- Opens with "Hi" and the first name ("Hi Dana,").');
    expect(out).toContain("- Uses contractions");
    expect(out).not.toContain("no greeting");
    expect(out).toContain("I drafted: Dana, I wanted to reach out.\nThey sent: Hi Dana, your close runs nine days.");
    // A tiny edit isn't an example worth the tokens.
    expect(out).not.toContain("Same text");
    expect(out).toContain("Hope this finds you well!");
  });
});
