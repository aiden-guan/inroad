import { beforeEach, describe, expect, it } from "vitest";
import { buildBundle } from "@/lib/store/backup";
import { emptyWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { resetToEmptyWorkspace, restoreWorkspace } from "@/lib/sample/store";
import { sampleWorkspace } from "@/lib/sample";
import { forgetInFiles } from "@/lib/people/forget-files";
import { readSettings, writeSettings } from "@/lib/store/settings";
import { todayISO } from "@/lib/domain/ids";
import { ConnectionInput, saveConnection } from "./connections";
import { saveMonitor } from "./monitors";
import { readAutomation, resetAutomation, updateAutomation } from "./store";
beforeEach(async () => {
  await resetAutomation();
  const ws = emptyWorkspace();
  ws.onboarding.status = "hired";
  await replaceWorkspace(ws);
});
describe("automation persistence", () => {
  it("backs up and restores configurations while keeping keys and daily request counters on this machine", async () => {
    await saveConnection(
      ConnectionInput.parse({
        name: "Legacy API",
        kind: "openapi",
        endpoint: "https://api.company.org",
        key: "machine-secret-key",
        spec: { openapi: "3.0.3", paths: { "/records": { get: { operationId: "read_records" } } } },
      }),
    );
    await saveMonitor({ name: "News", kind: "topic", query: "company funding", enabled: false });
    writeSettings({ researchRequests: { [todayISO()]: 7 } });
    const bundle = buildBundle("export");
    expect(bundle.files["automation.json"]).toBeDefined();
    expect(JSON.stringify(bundle)).not.toContain("machine-secret-key");
    await resetToEmptyWorkspace();
    expect(readAutomation().connections).toHaveLength(0);
    await restoreWorkspace(bundle);
    expect(readAutomation().connections[0].name).toBe("Legacy API");
    expect(readAutomation().monitors[0].name).toBe("News");
    expect(readSettings().researchRequests?.[todayISO()]).toBe(7);
  });
  it("removes forgotten people's research sessions, receipts, and monitors", async () => {
    const ws = sampleWorkspace(new Date());
    await replaceWorkspace(ws);
    const person = Object.values(ws.people)[0];
    await saveMonitor({ name: `Watch ${person.name}`, kind: "topic", query: `${person.name} company news` });
    await updateAutomation((data) => {
      data.receipts.push({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        kind: "search",
        provider: "Test",
        query: person.name,
        durationMs: 1,
        resultCount: 1,
        cached: false,
        costUsd: 0,
      });
      data.sessions.push({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        query: person.name,
        includeDomains: [],
        excludeDomains: [],
        provider: "Test",
        results: [],
        queries: [person.name],
        warnings: [],
        receiptId: crypto.randomUUID(),
        durationMs: 1,
      });
    });
    await forgetInFiles({ person, company: ws.accounts[person.accountDomain].name, runIds: [] });
    expect(readAutomation().monitors).toHaveLength(0);
    expect(readAutomation().sessions).toHaveLength(0);
    expect(readAutomation().receipts).toHaveLength(0);
  });
});
