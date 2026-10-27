import "server-only";
import { FileDB, singletonDB } from "@/lib/store/file-db";
import type { AutomationData, OperationReceipt } from "./types";

const initial = (): AutomationData => ({ version: 1, connections: [], monitors: [], observations: [], receipts: [], imports: [], sessions: [] });
const db = () =>
  singletonDB(
    "automation.json",
    () =>
      new FileDB<AutomationData>("automation.json", initial, (raw) => {
        if (!raw || typeof raw !== "object" || (raw as AutomationData).version !== 1) throw new Error("Unsupported automation data version");
        const data = raw as AutomationData;
        for (const key of ["connections", "monitors", "observations", "receipts", "imports"] as const)
          if (!Array.isArray(data[key])) throw new Error(`Invalid automation ${key}`);
        data.sessions = Array.isArray(data.sessions) ? data.sessions : [];
        return data;
      }),
  );
export const readAutomation = () => db().read();
export const updateAutomation = <R>(fn: (draft: AutomationData) => R) => db().update(fn);
export const resetAutomation = () => db().replace(initial());
export async function recordOperation(receipt: Omit<OperationReceipt, "id" | "at">) {
  const row: OperationReceipt = { ...receipt, id: crypto.randomUUID(), at: new Date().toISOString() };
  await updateAutomation((data) => {
    data.receipts.unshift(row);
    data.receipts = data.receipts.filter((r) => Date.parse(r.at) > Date.now() - 90 * 86400_000).slice(0, 2000);
  });
  return row;
}
