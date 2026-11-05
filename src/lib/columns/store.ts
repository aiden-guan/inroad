import "server-only";
import { FileDB, singletonDB } from "@/lib/store/file-db";
import { applyColumnsOps } from "./ops";
import { emptyColumns, type ColumnCell, type ColumnsData, type ColumnsOp } from "./types";
import { questionKey } from "./values";

/**
 * Research columns, their answers and saved views live in `<data>/columns.json`, apart from the workspace:
 * answers carry quotes and URLs for every company, and the workspace goes to the browser on every change.
 * It belongs to the workspace like threads.json does: backups carry it, the sample seeds it, a reset clears it.
 */

export const COLUMNS_FILE = "columns.json";

function migrate(raw: unknown): ColumnsData {
  const r = (raw ?? {}) as Partial<ColumnsData>;
  return {
    columns: Array.isArray(r.columns) ? r.columns : [],
    hidden: Array.isArray(r.hidden) ? r.hidden : [],
    cells: r.cells && typeof r.cells === "object" ? r.cells : {},
    views: Array.isArray(r.views) ? r.views : [],
  };
}

const db = () => singletonDB<ColumnsData>(COLUMNS_FILE, () => new FileDB<ColumnsData>(COLUMNS_FILE, emptyColumns, migrate));

export function readColumns(): ColumnsData {
  return db().read();
}

export async function applyOps(ops: ColumnsOp[]): Promise<ColumnsData> {
  const { state } = await db().update((draft) => {
    applyColumnsOps(draft, ops);
  });
  return state;
}

/**
 * Saves one answer, unless the column was deleted or its question changed since `key` was taken (the answer
 * would then answer a different question). Returns whether it was saved.
 */
export async function putCell(cell: ColumnCell, key: string): Promise<boolean> {
  const { value } = await db().update((draft) => {
    const col = draft.columns.find((c) => c.id === cell.columnId);
    if (!col || questionKey(col) !== key) return false;
    (draft.cells[col.id] ??= {})[cell.domain] = cell;
    return true;
  });
  return value;
}

/** Tests only. */
export async function replaceColumns(data: ColumnsData): Promise<void> {
  await db().replace(data);
}
