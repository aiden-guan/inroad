import { beforeEach, describe, expect, it } from "vitest";
import { applyListImport, undoImport } from "@/lib/network/import";
import { autoMap, presetById, detectPreset } from "@/lib/network/presets";
import { emptyWorkspace, readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { MappedImportInput, commitMappedImport, previewMappedImport, suggestFields } from "./imports";
import { readAutomation, resetAutomation } from "./store";

beforeEach(async () => {
  await replaceWorkspace(emptyWorkspace());
  await resetAutomation();
});
describe("mapped imports", () => {
  it("previews nested records, respects source opt-outs, saves a reusable mapping and preserves opt-outs after undo", async () => {
    const input = MappedImportInput.parse({
      name: "Legacy CRM",
      resultPath: "data.records",
      data: {
        data: {
          records: [
            { company: { domain: "good.org", name: "Good Co" }, person: { email: "ana@good.org", name: "Ana" }, unsubscribed: false },
            { company: { domain: "quiet.org", name: "Quiet Co" }, person: { email: "ben@quiet.org", name: "Ben" }, unsubscribed: true },
          ],
        },
      },
      fields: { domain: "company.domain", company: "company.name", email: "person.email", name: "person.name", optOut: "unsubscribed" },
      remember: true,
    });
    const preview = previewMappedImport(input);
    expect(preview).toMatchObject({ newAccounts: 1, newPeople: 1, total: 2 });
    expect(preview.skipped).toEqual([{ line: 2, reason: "suppressed" }]);
    expect(readWorkspace().accounts).toEqual({});
    await expect(commitMappedImport(input)).rejects.toThrow(/Preview/);
    const batch = await commitMappedImport({ ...input, previewToken: preview.previewToken });
    expect(readWorkspace().accounts["good.org"].name).toBe("Good Co");
    expect(readWorkspace().accounts["quiet.org"]).toBeUndefined();
    expect(readWorkspace().suppression).toEqual([expect.objectContaining({ email: "ben@quiet.org", reason: "unsubscribe" })]);
    expect(readAutomation().imports[0].name).toBe("Legacy CRM");
    await undoImport(batch.id);
    expect(readWorkspace().accounts["good.org"]).toBeUndefined();
    expect(readWorkspace().suppression.some((r) => r.email === "ben@quiet.org")).toBe(true);
  });

  it("fills gaps without overwriting existing records and replans against new opt-outs at commit time", async () => {
    const headers = ["Website", "Company"];
    await applyListImport({
      fileName: "first.csv",
      text: "Website,Company\nold.org,Original\n",
      preset: "generic",
      mapping: autoMap(headers, presetById("generic")),
    });
    const input = MappedImportInput.parse({
      data: [
        { domain: "old.org", name: "Replacement" },
        { domain: "new.org", name: "New" },
      ],
      fields: { domain: "domain", company: "name" },
    });
    const preview = previewMappedImport(input);
    expect(preview).toMatchObject({ existingAccounts: 1, newAccounts: 1 });
    await commitMappedImport({ ...input, previewToken: preview.previewToken });
    expect(readWorkspace().accounts["old.org"].name).toBe("Original");
  });

  it("detects legacy presets and suggests nested fields without evaluating expressions", () => {
    expect(detectPreset(["Account ID", "Contact ID", "Account Website", "Has Opted Out Of Email"]).id).toBe("salesforce");
    expect(detectPreset(["Organization Name", "Organization Website", "Person Email", "Person ID"]).id).toBe("pipedrive");
    const suggested = suggestFields({ rows: [{ company: { website: "good.org" }, contact: { email: "a@good.org" } }] }, "rows");
    expect(suggested.fields).toMatchObject({ domain: "company.website", email: "contact.email" });
  });
});
