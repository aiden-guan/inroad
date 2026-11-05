import { describe, expect, it } from "vitest";
import { cleanView } from "@/lib/columns/ops";
import { answerKey, questionKey } from "@/lib/columns/values";
import { NOW } from "@/test/factories";
import { SAMPLE_COLUMN, sampleColumns } from "./columns";
import { sampleWorkspace } from "./index";

/** Ledgerline's research columns: every answer belongs to a sample company and carries a source, or is honestly Unknown. */
describe("the sample's research columns", () => {
  const ws = sampleWorkspace(NOW);
  const data = sampleColumns(NOW);

  it("answers only for companies in the sample, each with a source on a real URL, or Unknown with a reason", () => {
    for (const col of data.columns) {
      const cells = Object.values(data.cells[col.id] ?? {});
      expect(cells.length).toBeGreaterThan(0);
      for (const c of cells) {
        expect(ws.accounts[c.domain], c.domain).toBeDefined();
        expect(c.columnId).toBe(col.id);
        if (c.value === null) {
          expect(c.confidence).toBeNull();
          expect(c.note).toBeTruthy();
        } else {
          expect(c.sources.length).toBeGreaterThan(0);
          for (const s of c.sources) expect(s.url).toMatch(/^https:\/\//);
        }
      }
    }
  });

  it("has every prospect answered for “Do they bill on usage?”, with at least one Unknown", () => {
    const prospects = Object.values(ws.accounts).filter((a) => a.status === "new" || a.status === "tracked" || a.status === "disqualified");
    const cells = data.cells[SAMPLE_COLUMN.usage];
    for (const a of prospects) expect(cells[a.domain], a.domain).toBeDefined();
    expect(Object.values(cells).some((c) => c.value === null)).toBe(true);
  });

  it("has a saved view that refers to real columns and shows some companies", () => {
    const view = data.views[0];
    expect(cleanView(view, data)).toEqual(view);
    const shown = Object.keys(ws.accounts).filter((d) =>
      Object.entries(view.filters.answers).every(([id, keys]) => keys.includes(answerKey(data.columns.find((c) => c.id === id)!, data.cells[id]?.[d]))),
    );
    expect(shown.length).toBeGreaterThan(1);
  });

  it("asks two different questions", () => {
    expect(new Set(data.columns.map(questionKey)).size).toBe(data.columns.length);
  });
});
