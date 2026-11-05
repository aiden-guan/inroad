import { describe, expect, it } from "vitest";
import type { ResearchColumn, ViewState } from "@/lib/columns/types";
import { cleanState, defaultState, filterCount, nudge, sameState, suggestName } from "./table-state";

const col = (id: string, question = `Question ${id}?`): ResearchColumn => ({ id, question, type: "yes_no", createdAt: "2026-11-01T10:00:00.000Z" });
const state = (patch: Partial<ViewState> = {}): ViewState => ({
  filters: { tiers: [], signals: [], statuses: [], sources: [], answers: {} },
  sort: { key: "priority", dir: "desc" },
  columns: [],
  ...patch,
});

describe("the table's view state", () => {
  it("shows every column on the default view except the hidden ones, in order", () => {
    expect(defaultState({ columns: [col("col_aaaa"), col("col_bbbb"), col("col_cccc")], hidden: ["col_bbbb"] }).columns).toEqual(["col_aaaa", "col_cccc"]);
    expect(defaultState(null).columns).toEqual([]);
  });

  it("compares filters as sets, so ticking in a different order isn't a change", () => {
    const a = state({ filters: { tiers: ["A", "B"], signals: [], statuses: [], sources: [], answers: { col_aaaa: ["yes", "unknown"], col_bbbb: [] } } });
    const b = state({ filters: { tiers: ["B", "A"], signals: [], statuses: [], sources: [], answers: { col_aaaa: ["unknown", "yes"] } } });
    expect(sameState(a, b)).toBe(true);
    expect(sameState(a, state())).toBe(false);
  });

  it("counts moving a column, or sorting another way, as a change to the view", () => {
    expect(sameState(state({ columns: ["col_aaaa", "col_bbbb"] }), state({ columns: ["col_bbbb", "col_aaaa"] }))).toBe(false);
    expect(sameState(state(), state({ sort: { key: "priority", dir: "asc" } }))).toBe(false);
  });

  it("counts every ticked filter", () => {
    expect(filterCount(state({ filters: { tiers: ["A"], signals: ["funding", "hiring"], statuses: [], sources: [], answers: { col_aaaa: ["yes"] } } }).filters)).toBe(4);
  });

  it("forgets filters, sorts and columns for columns that were deleted", () => {
    const s = state({ columns: ["col_aaaa", "col_gone"], sort: { key: "col:col_gone", dir: "desc" }, filters: { tiers: [], signals: [], statuses: [], sources: [], answers: { col_gone: ["yes"], col_aaaa: ["no"] } } });
    expect(cleanState(s, [col("col_aaaa")])).toEqual(state({ columns: ["col_aaaa"], filters: { tiers: [], signals: [], statuses: [], sources: [], answers: { col_aaaa: ["no"] } } }));
  });

  it("suggests a name from the filters", () => {
    const s = state({ filters: { tiers: ["B", "A"], signals: [], statuses: [], sources: [], answers: { col_aaaa: ["yes"] } } });
    expect(suggestName(s, [col("col_aaaa", "Do they bill on usage?")])).toBe("Tier A, B · Do they bill on usage: Yes");
    expect(suggestName(state(), [])).toBe("My view");
  });

  it("moves a column one place, and not past either end", () => {
    expect(nudge(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(nudge(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
  });
});
