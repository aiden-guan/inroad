import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { applyListImport } from "@/lib/network/import";
import { FIELDS, PRESETS, autoMap, type Mapping, type PresetId } from "@/lib/network/presets";
import { planImport, readListRows } from "@/lib/network/plan";
import { readWorkspace } from "@/lib/store/workspace";
import { atPath, fieldPaths, mapRows } from "./mapping";
import { updateAutomation } from "./store";

export const MappedImportInput = z.object({
  data: z.unknown(),
  resultPath: z.string().max(200).default(""),
  fields: z.partialRecord(z.enum([...FIELDS.map((f) => f.key), "optOut"]), z.string().max(200)).default({}),
  name: z.string().trim().min(1).max(100).default("Connected tool"),
  preset: z.enum(PRESETS.map((p) => p.id)).default("generic"),
  remember: z.boolean().default(false),
  previewToken: z.string().optional(),
});
export type MappedImportInput = z.infer<typeof MappedImportInput>;
function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}
function prepare(input: MappedImportInput) {
  const firstData = input.data;
  const fields = input.fields as Record<string, string>;
  if (!fields.domain && !fields.email) throw new Error("Map a company domain or work email before previewing.");
  const rows = mapRows(firstData, input.resultPath, fields);
  const keys = Object.keys(fields).filter((key) => fields[key]);
  const mapping = Object.fromEntries(FIELDS.map((f) => [f.key, keys.includes(f.key) ? keys.indexOf(f.key) : null])) as Mapping;
  const cells = rows.map((row) => keys.map((key) => (typeof row[key] === "object" ? "" : String(row[key] ?? ""))));
  const text = [keys.map(csvCell).join(","), ...cells.map((row) => row.map(csvCell).join(","))].join("\n");
  const token = createHash("sha256")
    .update(JSON.stringify([text, mapping, input.preset]))
    .digest("hex");
  const plan = planImport(readWorkspace(), readListRows(cells, mapping, keys));
  return { rows, mapping, text, token, plan };
}
export function suggestFields(data: unknown, resultPath = "") {
  const rows = mapRows(data, resultPath, {});
  void rows;
  // Paths are relative to one row, including fields nested inside company/person objects.
  const root = resultPath ? mapRows(data, resultPath, { root: "$" }).map((r) => r.root) : Array.isArray(data) ? data : [data];
  const paths = fieldPaths(root[0]).filter((path) => !/\[/.test(path) && (atPath(root[0], path) === null || typeof atPath(root[0], path) !== "object"));
  const headers = paths.map((path) => {
    const leaf = path.split(".").at(-1)!;
    if (leaf === "name" && /company|organization|account/i.test(path)) return "company";
    if (leaf === "name" && /person|contact/i.test(path)) return "fullname";
    return leaf;
  });
  const mapped = autoMap(headers, PRESETS.find((p) => p.id === "generic")!);
  return {
    paths,
    fields: {
      ...Object.fromEntries(FIELDS.map((f) => [f.key, mapped[f.key] !== null ? paths[mapped[f.key]!] : ""])),
      optOut:
        paths.find((path) =>
          /^(unsubscribed|optout|donotcontact|hasoptedoutofemail)$/.test(
            path
              .split(".")
              .at(-1)!
              .toLowerCase()
              .replace(/[^a-z]/g, ""),
          ),
        ) ?? "",
    },
  };
}
export function previewMappedImport(input: MappedImportInput) {
  const { token, plan, rows } = prepare(input);
  return {
    previewToken: token,
    total: plan.total,
    newAccounts: plan.newAccounts.length,
    existingAccounts: plan.existingAccounts.length,
    newPeople: plan.newPeople,
    existingPeople: plan.existingPeople,
    skipped: plan.skipped,
    sample: rows.slice(0, 5),
    fields: input.fields,
  };
}
export async function commitMappedImport(input: MappedImportInput) {
  const prepared = prepare(input);
  if (input.previewToken !== prepared.token) throw new Error("Preview these records and their mapping before importing.");
  const batch = await applyListImport({ fileName: `${input.name}.csv`, text: prepared.text, preset: input.preset as PresetId, mapping: prepared.mapping });
  if (input.remember)
    await updateAutomation((data) => {
      data.imports = [
        ...data.imports.filter((p) => p.name !== input.name),
        { id: crypto.randomUUID(), name: input.name, resultPath: input.resultPath, fields: input.fields as Record<string, string> },
      ].slice(-30);
    });
  return batch;
}
