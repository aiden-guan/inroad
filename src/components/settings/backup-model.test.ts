import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sampleWorkspace } from "@/lib/sample";
import { NOW } from "@/test/factories";
import { backupWhen, describeSummary, fileSize, summarizeFile, uploadBody } from "./backup-model";

describe("backup labels", () => {
  const now = new Date(2026, 9, 20, 15, 0);

  it("names the day the way people say it, in local time", () => {
    expect(backupWhen(new Date(2026, 9, 20, 9, 5).toISOString(), now)).toBe("Today, 9:05 AM");
    expect(backupWhen(new Date(2026, 9, 19, 18, 12).toISOString(), now)).toBe("Yesterday, 6:12 PM");
    expect(backupWhen(new Date(2026, 9, 14, 9, 5).toISOString(), now)).toBe("Oct 14, 9:05 AM");
    expect(backupWhen(new Date(2025, 11, 30, 9, 5).toISOString(), now)).toBe("Dec 30, 2025, 9:05 AM");
  });

  it("sizes files in round units", () => {
    expect(fileSize(512)).toBe("512 B");
    expect(fileSize(1500)).toBe("1 KB");
    expect(fileSize(48 * 1024)).toBe("48 KB");
    expect(fileSize(1.25 * 1024 * 1024)).toBe("1.3 MB");
  });

  it("says what a backup holds", () => {
    expect(describeSummary({ company: "Acme", companies: 12, people: 1, deals: 0, sample: false })).toBe("Acme: 12 companies, 1 person, 0 deals");
    expect(describeSummary({ company: "Ledgerline", companies: 1, people: 3, deals: 1, sample: true })).toBe("the sample workspace: 1 company, 3 people, 1 deal");
  });
});

describe("reading a chosen file in the browser", () => {
  const ws = sampleWorkspace(NOW);

  it("reads a backup bundle and an older workspace-only export", () => {
    const bundle = summarizeFile(JSON.stringify({ format: "inroad-backup", version: 1, createdAt: "2026-10-20T16:00:00.000Z", files: { "workspace.json": ws } }));
    expect(bundle).toMatchObject({ createdAt: "2026-10-20T16:00:00.000Z", workspaceOnly: false, summary: { company: ws.company?.name, sample: true } });
    expect(bundle?.summary.companies).toBe(Object.keys(ws.accounts).length);

    const old = summarizeFile(JSON.stringify(ws));
    expect(old?.workspaceOnly).toBe(true);
    expect(old?.summary.deals).toBe(Object.keys(ws.deals).length);
  });

  it("gzips a chosen file for the upload, and sends one that's already gzipped as it is", async () => {
    const text = JSON.stringify({ format: "inroad-backup", version: 1, files: { "workspace.json": ws } });
    const up = await uploadBody(new Blob([text]));
    const bytes = new Uint8Array(await up.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    expect(up.size).toBeLessThan(text.length / 3);
    expect(gunzipSync(bytes).toString("utf8")).toBe(text);

    const gz = new Blob([gzipSync(text)]);
    expect(await uploadBody(gz)).toBe(gz);
  });

  it("leaves anything else to the server", () => {
    expect(summarizeFile("not json")).toBeNull();
    expect(summarizeFile("[]")).toBeNull();
    expect(summarizeFile(JSON.stringify({ format: "inroad-backup", files: {} }))).toBeNull();
  });
});
