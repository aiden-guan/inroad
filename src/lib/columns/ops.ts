import { LIMITS, type ColumnsData, type ColumnsOp, type SavedView } from "./types";

/**
 * The one reducer for research columns and saved views. The browser applies it optimistically and the server
 * applies it again to the file (src/app/api/columns), so both always agree. Mutates `data` in place.
 * Client-safe; shapes are validated on the server (./schema.ts) before they get here.
 */

export class ColumnsOpError extends Error {}

const clampIndex = (i: number | undefined, length: number) => (i === undefined || !Number.isFinite(i) ? length : Math.max(0, Math.min(length, Math.floor(i))));

/** A view only refers to columns that exist, and only filters or sorts by them. */
export function cleanView(view: SavedView, data: Pick<ColumnsData, "columns">): SavedView {
  const ids = new Set(data.columns.map((c) => c.id));
  const answers = Object.fromEntries(Object.entries(view.filters.answers ?? {}).filter(([id, keys]) => ids.has(id) && keys.length > 0));
  const sortCol = view.sort.key.startsWith("col:") ? view.sort.key.slice(4) : null;
  return {
    ...view,
    columns: [...new Set(view.columns.filter((id) => ids.has(id)))],
    filters: { ...view.filters, answers },
    sort: sortCol && !ids.has(sortCol) ? { key: "priority", dir: "desc" } : view.sort,
  };
}

export function applyColumnsOp(data: ColumnsData, op: ColumnsOp): void {
  switch (op.type) {
    case "column.add": {
      if (data.columns.some((c) => c.id === op.column.id)) return; // a retried request
      if (data.columns.length >= LIMITS.columns) throw new ColumnsOpError(`You can have up to ${LIMITS.columns} columns. Delete one first.`);
      data.columns.splice(clampIndex(op.index, data.columns.length), 0, { ...op.column });
      return;
    }
    case "column.update": {
      const col = data.columns.find((c) => c.id === op.id);
      if (!col) throw new ColumnsOpError("That column was deleted.");
      const typeChanged = op.patch.type !== undefined && op.patch.type !== col.type;
      Object.assign(col, op.patch, { updatedAt: op.at });
      if (col.type !== "pick_one") delete col.options;
      if (!col.instructions) delete col.instructions;
      // Answers to the old question no longer answer this one.
      delete data.cells[col.id];
      for (const v of data.views) {
        if (v.filters.answers?.[col.id]) delete v.filters.answers[col.id];
        if (typeChanged && v.sort.key === `col:${col.id}`) v.sort = { key: v.sort.key, dir: col.type === "pick_one" || col.type === "text" ? "asc" : "desc" };
      }
      return;
    }
    case "column.delete": {
      data.columns = data.columns.filter((c) => c.id !== op.id);
      delete data.cells[op.id];
      data.hidden = data.hidden.filter((id) => id !== op.id);
      data.views = data.views.map((v) => cleanView(v, data));
      return;
    }
    case "column.restore": {
      if (data.columns.some((c) => c.id === op.column.id)) return;
      data.columns.splice(clampIndex(op.index, data.columns.length), 0, { ...op.column });
      data.cells[op.column.id] = { ...op.cells };
      if (op.hidden && !data.hidden.includes(op.column.id)) data.hidden.push(op.column.id);
      for (const place of op.views) {
        const v = data.views.find((x) => x.id === place.id);
        if (v && !v.columns.includes(op.column.id)) v.columns.splice(clampIndex(place.index, v.columns.length), 0, op.column.id);
      }
      return;
    }
    case "column.move": {
      const from = data.columns.findIndex((c) => c.id === op.id);
      if (from === -1) throw new ColumnsOpError("That column was deleted.");
      const [col] = data.columns.splice(from, 1);
      data.columns.splice(clampIndex(op.to, data.columns.length), 0, col);
      return;
    }
    case "column.hide": {
      if (!data.columns.some((c) => c.id === op.id)) throw new ColumnsOpError("That column was deleted.");
      data.hidden = data.hidden.filter((id) => id !== op.id);
      if (op.hidden) data.hidden.push(op.id);
      return;
    }
    case "cells.clear": {
      const cells = data.cells[op.columnId];
      if (!cells) return;
      if (!op.domains) delete data.cells[op.columnId];
      else for (const d of op.domains) delete cells[d];
      return;
    }
    case "view.save": {
      const view = cleanView(op.view, data);
      const i = data.views.findIndex((v) => v.id === view.id);
      if (i !== -1) data.views[i] = view;
      else {
        if (data.views.length >= LIMITS.views) throw new ColumnsOpError(`You can save up to ${LIMITS.views} views. Delete one first.`);
        data.views.push(view);
      }
      return;
    }
    case "view.delete": {
      data.views = data.views.filter((v) => v.id !== op.id);
      return;
    }
    case "view.restore": {
      if (data.views.some((v) => v.id === op.view.id)) return;
      data.views.splice(clampIndex(op.index, data.views.length), 0, cleanView(op.view, data));
      return;
    }
  }
}

export function applyColumnsOps(data: ColumnsData, ops: ColumnsOp[]): ColumnsData {
  for (const op of ops) applyColumnsOp(data, op);
  return data;
}
