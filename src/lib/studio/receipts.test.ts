import { describe, expect, it } from "vitest";
import { sampleWorkspace } from "@/lib/sample";
import { CLAIM } from "@/lib/sample/ids";
import { NOW, makeWorkspace } from "@/test/factories";
import { FORMAT_IDS, FORMATS, formatsFor } from "./formats";
import { openQuestions } from "./intake";
import { MOVES, movesFor } from "./moves";
import { formatBlocked, lintOption, receiptsFor, sourcedText } from "./receipts";

const sample = sampleWorkspace(NOW);

describe("receipts", () => {
  it("collects only what the founder approved, wrote or said", () => {
    const r = receiptsFor(sample);
    const ids = r.map((x) => x.id);
    expect(ids).toContain(CLAIM.designPartner);
    expect(ids).not.toContain(CLAIM.catchRate); // not approved
    expect(r.find((x) => x.id === CLAIM.designPartner)?.nameable).toBe(false); // anonymized_only
    expect(r.some((x) => x.kind === "customer_words" && x.text === "tie out usage")).toBe(true);
    expect(r.some((x) => x.kind === "material" && x.label === "Demo moment")).toBe(true);
    expect(r.some((x) => x.kind === "alternative")).toBe(true);
  });

  it("never treats an unproven value theme as a source for numbers", () => {
    const ws = structuredClone(sample);
    ws.foundation!.positioning.valueThemes[0] = { ...ws.foundation!.positioning.valueThemes[0], outcome: "Close 9x faster", needsProof: true };
    expect(sourcedText(receiptsFor(ws))).not.toContain("9x");
  });

  it("gives customer words stable ids across reads", () => {
    const a = receiptsFor(sample).filter((x) => x.kind === "customer_words").map((x) => x.id);
    const b = receiptsFor(structuredClone(sample)).filter((x) => x.kind === "customer_words").map((x) => x.id);
    expect(a).toEqual(b);
  });
});

describe("the sample's Studio", () => {
  it("passes lint on every sample option, for the same reasons a real one would", () => {
    for (const piece of Object.values(sample.studio.pieces)) {
      for (const option of piece.options) {
        expect(option.lint.violations.filter((v) => v.severity === "error"), option.id).toEqual([]);
        expect(lintOption(sample, piece, option).passed).toBe(true);
      }
    }
  });
});

describe("moves", () => {
  const receipts = receiptsFor(sample);
  const choose = (over: Partial<Parameters<typeof movesFor>[0]> = {}) =>
    movesFor({ format: "one_liner", audience: "b2b", occasion: "evergreen", receipts, competitors: 0, bold: false, ...over });

  it("offers moves the receipts can support and says what's missing for the rest", () => {
    const list = choose();
    const byId = new Map(list.map((c) => [c.move.id, c]));
    expect(byId.get("one_number")?.missing).toBeUndefined(); // the design-partner claim has numbers
    expect(byId.get("x_alternative")?.missing).toMatch(/competitor/);
    expect(choose({ competitors: 1 }).find((c) => c.move.id === "x_alternative")?.missing).toBeUndefined();
  });

  it("keeps bold moves off unless the founder turns them on", () => {
    expect(choose().some((c) => c.move.id === "taboo_literal")).toBe(false);
    expect(choose({ bold: true }).some((c) => c.move.id === "taboo_literal")).toBe(true);
  });

  it("respects audience and occasion", () => {
    expect(choose({ audience: "b2c" }).some((c) => c.move.id === "two_buyers")).toBe(false);
    expect(choose({ format: "linkedin_post", occasion: "funding" }).some((c) => c.move.id === "for_you_news")).toBe(true);
    expect(choose({ format: "linkedin_post", occasion: "lesson" }).some((c) => c.move.id === "for_you_news")).toBe(false);
  });

  it("only cites sources for its examples, and every move names when it backfires", () => {
    for (const m of MOVES) {
      expect(m.backfires.length, m.id).toBeGreaterThan(10);
      for (const e of m.examples) expect(e.source, `${m.id}: ${e.text}`).toMatch(/^https:\/\//);
    }
  });
});

describe("intake", () => {
  it("asks only what the founder hasn't told us yet", () => {
    const fresh = openQuestions(makeWorkspace()).map((q) => q.kind);
    expect(fresh[0]).toBe("enemy");
    expect(fresh).toContain("limit");
    // The sample has a story, a demo, a belief, POVs, a metric claim and customer words.
    expect(openQuestions(sample).map((q) => q.kind)).toEqual(["enemy", "limit"]);
  });
});

describe("formats", () => {
  it("gives every part a limit and every platform limit a source", () => {
    for (const id of FORMAT_IDS) {
      const f = FORMATS[id];
      expect(f.parts.length, id).toBeGreaterThan(0);
      for (const p of f.parts) {
        expect(p.limits.length, `${id}.${p.key}`).toBeGreaterThan(0);
        for (const l of p.limits) if (l.kind !== "house") expect(l.source, `${id}.${p.key}`).toMatch(/^https:\/\//);
      }
    }
  });

  it("orders the picker by audience without hiding anything", () => {
    expect(formatsFor("developer")[0].audiences[0]).toBe("developer");
    expect(formatsFor("b2c")).toHaveLength(FORMAT_IDS.length);
  });

  it("blocks a customer story until there's a real result", () => {
    expect(formatBlocked(makeWorkspace(), "customer_story")).toMatch(/real result/);
    expect(formatBlocked(sample, "customer_story")).toBeNull();
  });
});
