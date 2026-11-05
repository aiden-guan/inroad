import { describe, expect, it } from "vitest";
import { applyColumnsOp, applyColumnsOps, ColumnsOpError } from "./ops";
import { emptyColumns, LIMITS, type ColumnCell, type ColumnsData, type ResearchColumn, type SavedView } from "./types";

const col = (id: string, patch: Partial<ResearchColumn> = {}): ResearchColumn => ({ id, question: `Question ${id}?`, type: "yes_no", createdAt: "2026-11-01T10:00:00.000Z", ...patch });
const cell = (columnId: string, domain: string, value: ColumnCell["value"] = true): ColumnCell => ({ columnId, domain, value, confidence: "high", sources: [], at: "2026-11-02T10:00:00.000Z", method: "model" });
const view = (id: string, patch: Partial<SavedView> = {}): SavedView => ({
  id,
  name: `View ${id}`,
  filters: { tiers: [], signals: [], statuses: [], sources: [], answers: {} },
  sort: { key: "priority", dir: "desc" },
  columns: [],
  createdAt: "2026-11-01T10:00:00.000Z",
  ...patch,
});

function withTwo(): ColumnsData {
  return applyColumnsOps(emptyColumns(), [
    { type: "column.add", column: col("col_aaaa") },
    { type: "column.add", column: col("col_bbbb") },
  ]);
}

describe("the research column reducer", () => {
  it("adds columns in order, at an index when given, and ignores a retried add", () => {
    const d = withTwo();
    applyColumnsOp(d, { type: "column.add", column: col("col_cccc"), index: 0 });
    applyColumnsOp(d, { type: "column.add", column: col("col_cccc") });
    expect(d.columns.map((c) => c.id)).toEqual(["col_cccc", "col_aaaa", "col_bbbb"]);
  });

  it("caps the number of columns with a message the founder can act on", () => {
    const d = emptyColumns();
    for (let i = 0; i < LIMITS.columns; i++) applyColumnsOp(d, { type: "column.add", column: col(`col_${String(i).padStart(4, "0")}`) });
    expect(() => applyColumnsOp(d, { type: "column.add", column: col("col_over") })).toThrow(ColumnsOpError);
  });

  it("clears a column's answers and its filters in views when the question changes", () => {
    const d = withTwo();
    d.cells.col_aaaa = { "a.example": cell("col_aaaa", "a.example") };
    d.views = [view("view_one1", { columns: ["col_aaaa"], filters: { tiers: [], signals: [], statuses: [], sources: [], answers: { col_aaaa: ["yes"] } } })];
    applyColumnsOp(d, { type: "column.update", id: "col_aaaa", patch: { question: "Do they sell to banks?" }, at: "2026-11-03T10:00:00.000Z" });
    expect(d.columns[0]).toMatchObject({ question: "Do they sell to banks?", updatedAt: "2026-11-03T10:00:00.000Z" });
    expect(d.cells.col_aaaa).toBeUndefined();
    expect(d.views[0].filters.answers).toEqual({});
    expect(d.views[0].columns).toEqual(["col_aaaa"]);
  });

  it("drops options when a pick-one column becomes another type", () => {
    const d = applyColumnsOps(emptyColumns(), [{ type: "column.add", column: col("col_pick", { type: "pick_one", options: ["A", "B"] }) }]);
    applyColumnsOp(d, { type: "column.update", id: "col_pick", patch: { type: "text" }, at: "2026-11-03T10:00:00.000Z" });
    expect(d.columns[0].options).toBeUndefined();
  });

  it("deletes a column with its answers, its hidden flag and every view's reference, and restores all of it on undo", () => {
    const d = withTwo();
    d.cells.col_aaaa = { "a.example": cell("col_aaaa", "a.example") };
    d.hidden = ["col_aaaa"];
    d.views = [view("view_one1", { columns: ["col_bbbb", "col_aaaa"], sort: { key: "col:col_aaaa", dir: "desc" }, filters: { tiers: ["A"], signals: [], statuses: [], sources: [], answers: { col_aaaa: ["yes"] } } })];
    const snapshot = { column: d.columns[0], index: 0, cells: d.cells.col_aaaa, hidden: true, views: [{ id: "view_one1", index: 1 }] };

    applyColumnsOp(d, { type: "column.delete", id: "col_aaaa" });
    expect(d.columns.map((c) => c.id)).toEqual(["col_bbbb"]);
    expect(d.cells.col_aaaa).toBeUndefined();
    expect(d.hidden).toEqual([]);
    expect(d.views[0]).toMatchObject({ columns: ["col_bbbb"], sort: { key: "priority", dir: "desc" }, filters: { tiers: ["A"], answers: {} } });

    applyColumnsOp(d, { type: "column.restore", ...snapshot });
    expect(d.columns.map((c) => c.id)).toEqual(["col_aaaa", "col_bbbb"]);
    expect(d.cells.col_aaaa["a.example"].value).toBe(true);
    expect(d.hidden).toEqual(["col_aaaa"]);
    expect(d.views[0].columns).toEqual(["col_bbbb", "col_aaaa"]);
  });

  it("moves and hides columns on the default view", () => {
    const d = withTwo();
    applyColumnsOp(d, { type: "column.move", id: "col_bbbb", to: 0 });
    expect(d.columns.map((c) => c.id)).toEqual(["col_bbbb", "col_aaaa"]);
    applyColumnsOp(d, { type: "column.hide", id: "col_aaaa", hidden: true });
    applyColumnsOp(d, { type: "column.hide", id: "col_aaaa", hidden: true });
    expect(d.hidden).toEqual(["col_aaaa"]);
    applyColumnsOp(d, { type: "column.hide", id: "col_aaaa", hidden: false });
    expect(d.hidden).toEqual([]);
    expect(() => applyColumnsOp(d, { type: "column.move", id: "col_gone", to: 0 })).toThrow("deleted");
  });

  it("clears some answers or all of them", () => {
    const d = withTwo();
    d.cells.col_aaaa = { "a.example": cell("col_aaaa", "a.example"), "b.example": cell("col_aaaa", "b.example") };
    applyColumnsOp(d, { type: "cells.clear", columnId: "col_aaaa", domains: ["a.example"] });
    expect(Object.keys(d.cells.col_aaaa)).toEqual(["b.example"]);
    applyColumnsOp(d, { type: "cells.clear", columnId: "col_aaaa" });
    expect(d.cells.col_aaaa).toBeUndefined();
  });

  it("saves, updates, deletes and restores views, keeping only columns that exist", () => {
    const d = withTwo();
    applyColumnsOp(d, { type: "view.save", view: view("view_one1", { columns: ["col_aaaa", "col_gone", "col_aaaa"] }) });
    expect(d.views[0].columns).toEqual(["col_aaaa"]);
    applyColumnsOp(d, { type: "view.save", view: view("view_one1", { name: "Renamed" }) });
    expect(d.views).toHaveLength(1);
    expect(d.views[0].name).toBe("Renamed");
    const saved = d.views[0];
    applyColumnsOp(d, { type: "view.delete", id: "view_one1" });
    expect(d.views).toEqual([]);
    applyColumnsOp(d, { type: "view.restore", view: saved, index: 0 });
    expect(d.views[0].name).toBe("Renamed");
  });
});
