import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getWorkspace } from "@/app/api/workspace/route";
import { GET as exportRoute } from "@/app/api/workspace/export/route";
import { POST as restoreRoute } from "@/app/api/workspace/restore/route";
import { uploadBody } from "@/components/settings/backup-model";
import { BODY_LIMIT_BYTES } from "@/lib/server/http";
import { mutateNetwork, readConnections, readNetwork, updateConnections } from "@/lib/network/store";
import { runSteps } from "@/lib/runs/registry";
import { loadSampleWorkspace, resetToEmptyWorkspace, restoreWorkspace } from "@/lib/sample/store";
import { makeAccount, makeDeal, makePerson } from "@/test/factories";
import {
  BACKUP_DIR,
  BackupError,
  buildBundle,
  ensureDailySnapshot,
  listBackups,
  parseBackup,
  readSnapshot,
  resetDailyCheck,
  snapshot,
  type BackupBundle,
} from "./backup";
import { DATA_DIR, writeSettings } from "./settings";
import { getThread, withThread } from "./threads";
import { emptyWorkspace, readWorkspace, replaceWorkspace, setSecrets } from "./workspace";

/**
 * Backups end to end in this file's temp data folder: what a bundle holds (every workspace file, never a
 * key), the automatic snapshots and how many are kept, and restoring from a snapshot, a downloaded file
 * and an older workspace-only export.
 */

// Route handlers call connection(), which needs Next's request scope; here it's a no-op.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => undefined }));

const at = (iso: string) => new Date(iso);

/** A founder's real workspace: a company, a deal, an Ask thread, LinkedIn connections and an import. */
async function realWork(name = "Acme") {
  await replaceWorkspace({
    ...emptyWorkspace(),
    onboarding: { status: "hired" },
    founder: { name: "Priya" },
    company: { name, domain: `${name.toLowerCase()}.com` } as never,
    accounts: { "northwind.com": makeAccount("northwind.com") },
    people: { per_dana: makePerson("per_dana", "northwind.com") },
    deals: { deal_1: makeDeal("deal_1", "northwind.com") },
  });
  await withThread("thr_1", () => ({ title: "Who should I call?", createdAt: "2026-10-20T10:00:00.000Z", updatedAt: "2026-10-20T10:00:00.000Z" }), () => undefined);
  await updateConnections((rows) => {
    rows.splice(0, rows.length, { id: "con_1", firstName: "Dana", lastName: "Reyes", url: "https://www.linkedin.com/in/dana", company: "Northwind", position: "VP Ops", companyNorm: "northwind" });
  });
  await mutateNetwork((n) => {
    n.imports = [{ id: "imp_1", at: "2026-10-19T10:00:00.000Z" } as never];
  });
}

beforeEach(() => {
  fs.rmSync(BACKUP_DIR(), { recursive: true, force: true });
  resetDailyCheck();
});

describe("what a backup holds", () => {
  it("has every workspace file and none of this machine's keys", async () => {
    await realWork();
    writeSettings({ anthropicApiKey: "sk-ant-secret-key", newsSource: "off" });
    setSecrets("slack", { key: "https://hooks.slack.com/services/T/B/secret" });
    fs.writeFileSync(path.join(DATA_DIR, "keys.json"), JSON.stringify({ keys: [{ hash: "abc" }] }));

    const bundle = buildBundle("export");
    expect(bundle.format).toBe("inroad-backup");
    expect(Object.keys(bundle.files).sort()).toEqual(["connections.json", "network.json", "threads.json", "workspace.json"]);
    expect(bundle.summary).toEqual({ company: "Acme", companies: 1, people: 1, deals: 1, sample: false });
    const text = JSON.stringify(bundle);
    expect(text).not.toContain("sk-ant-secret-key");
    expect(text).not.toContain("hooks.slack.com");
    expect(text).not.toContain('"hash"');
  });

  it("downloads as an attachment from Settings", async () => {
    await realWork();
    const res = await exportRoute();
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="inroad-backup-\d{4}-\d{2}-\d{2}\.json"$/);
    const bundle = (await res.json()) as BackupBundle;
    expect(bundle.files["connections.json"]).toHaveLength(1);
    expect(Object.keys((bundle.files["threads.json"] as { threads: object }).threads)).toEqual(["thr_1"]);
  });
});

describe("automatic snapshots", () => {
  it("takes one a day, the first time the workspace loads, and skips the sample and an empty workspace", async () => {
    await replaceWorkspace(emptyWorkspace());
    expect(ensureDailySnapshot(at("2026-10-20T16:00:00.000Z"))).toBeNull();

    await realWork();
    resetDailyCheck();
    const first = ensureDailySnapshot(at("2026-10-20T16:00:00.000Z"));
    expect(first?.reason).toBe("daily");
    resetDailyCheck();
    expect(ensureDailySnapshot(at("2026-10-20T23:00:00.000Z"))).toBeNull();
    expect(ensureDailySnapshot(at("2026-10-21T16:00:00.000Z"))?.reason).toBe("daily");
    expect(listBackups().map((b) => b.reason)).toEqual(["daily", "daily"]);

    // The workspace route takes today's, once.
    vi.useFakeTimers({ toFake: ["Date"], now: at("2026-10-23T18:00:00.000Z") });
    try {
      resetDailyCheck();
      await getWorkspace();
      await getWorkspace();
      expect(listBackups().length).toBe(3);
    } finally {
      vi.useRealTimers();
    }

    await loadSampleWorkspace();
    resetDailyCheck();
    expect(ensureDailySnapshot(at("2026-10-25T16:00:00.000Z"))).toBeNull();
  });

  it("writes a gzipped bundle readable only by this user", async () => {
    await realWork();
    const entry = snapshot("daily", at("2026-10-20T16:00:00.000Z"));
    expect(entry.name).toBe("2026-10-20T16-00-00-000Z-daily.json.gz");
    const file = path.join(BACKUP_DIR(), entry.name);
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.statSync(BACKUP_DIR()).mode & 0o777).toBe(0o700);
    }
    const bundle = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")) as BackupBundle;
    expect(bundle.summary.company).toBe("Acme");
    expect(listBackups()).toEqual([{ name: entry.name, at: "2026-10-20T16:00:00.000Z", reason: "daily", bytes: entry.bytes }]);
  });

  it("keeps the last 14 daily snapshots and the last 10 taken before a change", async () => {
    await realWork();
    for (let d = 1; d <= 20; d++) snapshot("daily", at(`2026-09-${String(d).padStart(2, "0")}T16:00:00.000Z`));
    for (let d = 1; d <= 12; d++) snapshot("before_reset", at(`2026-08-${String(d).padStart(2, "0")}T16:00:00.000Z`));
    const all = listBackups();
    expect(all.filter((b) => b.reason === "daily")).toHaveLength(14);
    expect(all.filter((b) => b.reason === "before_reset")).toHaveLength(10);
    expect(all[0].at).toBe("2026-09-20T16:00:00.000Z");
    expect(all.filter((b) => b.reason === "daily").at(-1)?.at).toBe("2026-09-07T16:00:00.000Z");
  });

  it("backs up real work before a reset or the sample replaces it, and nothing when leaving the sample", async () => {
    await realWork();
    await resetToEmptyWorkspace();
    expect(listBackups().map((b) => b.reason)).toEqual(["before_reset"]);
    expect(readSnapshot(listBackups()[0].name).summary.company).toBe("Acme");

    await realWork("Beta");
    await loadSampleWorkspace();
    expect(listBackups().map((b) => b.reason).sort()).toEqual(["before_reset", "before_sample"]);

    // The sample is made up: leaving it saves nothing.
    await resetToEmptyWorkspace();
    expect(listBackups()).toHaveLength(2);
  });

  it("refuses to reset when it can't save the backup first", async () => {
    await realWork();
    fs.writeFileSync(BACKUP_DIR(), "not a folder");
    try {
      await expect(resetToEmptyWorkspace()).rejects.toThrow(/couldn't save a backup first, so nothing was changed/);
      expect(readWorkspace().company?.name).toBe("Acme");
      expect(readConnections()).toHaveLength(1);
    } finally {
      fs.rmSync(BACKUP_DIR(), { force: true });
    }
  });
});

describe("restore", () => {
  it("brings back every file from a snapshot, after backing up what's there", async () => {
    await realWork();
    const kept = snapshot("before_reset", at("2026-10-20T16:00:00.000Z"));
    await loadSampleWorkspace();
    expect(readWorkspace().sample).toBe(true);
    await realWork("Later");
    await updateConnections((rows) => {
      rows.push({ id: "con_2", firstName: "Lena", lastName: "Ito", url: "https://www.linkedin.com/in/lena", company: "Rowan", position: "CFO", companyNorm: "rowan" });
    });

    const { ws, backup, files } = await restoreWorkspace(readSnapshot(kept.name));
    expect(ws.company?.name).toBe("Acme");
    expect(readWorkspace().sample).toBeUndefined();
    expect(readConnections().map((c) => c.id)).toEqual(["con_1"]);
    expect(getThread("thr_1")?.title).toBe("Who should I call?");
    expect(readNetwork().imports.map((i) => i.id)).toEqual(["imp_1"]);
    expect(files).toEqual(expect.arrayContaining(["workspace.json", "connections.json", "threads.json", "network.json"]));
    // What was there before is itself a backup now.
    expect(backup?.reason).toBe("before_restore");
    expect(readSnapshot(backup!.name).summary.company).toBe("Later");
  });

  it("removes files the backup didn't have, and keeps the run steps it did", async () => {
    await replaceWorkspace({ ...emptyWorkspace(), onboarding: { status: "hired" }, company: { name: "Solo", domain: "solo.com" } as never });
    fs.rmSync(path.join(DATA_DIR, "connections.json"), { force: true });
    fs.rmSync(path.join(DATA_DIR, "threads.json"), { force: true });
    const bundle = buildBundle("export");
    bundle.files["runs.json"] = { run_1: [{ type: "read", text: "Read acme.com", at: 1 }] };
    await realWork();

    await restoreWorkspace(bundle);
    expect(readWorkspace().company?.name).toBe("Solo");
    expect(readConnections()).toEqual([]);
    expect(getThread("thr_1")).toBeUndefined();
    expect(runSteps("run_1")).toEqual([{ type: "read", text: "Read acme.com", at: 1 }]);
  });

  it("restores a downloaded file through the route, plain or gzipped", async () => {
    await realWork();
    const file = await (await exportRoute()).text();
    await resetToEmptyWorkspace();

    const res = await restoreRoute(new Request("http://localhost:3000/api/workspace/restore", { method: "POST", body: file }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { workspace: { company: { name: string } }; restored: { files: string[]; legacy: boolean } };
    expect(body.workspace.company.name).toBe("Acme");
    expect(body.restored.legacy).toBe(false);
    expect(readConnections()).toHaveLength(1);

    await resetToEmptyWorkspace();
    const gz = await restoreRoute(new Request("http://localhost:3000/api/workspace/restore", { method: "POST", body: zlib.gzipSync(file) }));
    expect(gz.status).toBe(200);
    expect(readWorkspace().company?.name).toBe("Acme");
  });

  it("restores a local snapshot by name through the route, and refuses names outside the folder", async () => {
    await realWork();
    const kept = snapshot("daily", at("2026-10-20T16:00:00.000Z"));
    await resetToEmptyWorkspace();
    const res = await restoreRoute(new Request(`http://localhost:3000/api/workspace/restore?backup=${encodeURIComponent(kept.name)}`, { method: "POST" }));
    expect(res.status).toBe(200);
    expect(readWorkspace().company?.name).toBe("Acme");

    for (const bad of ["../settings.json", "../../etc/passwd", "2026-10-20T16-00-00-000Z-daily.json.gz/../../x", "nope.json.gz"]) {
      expect(() => readSnapshot(bad)).toThrow(BackupError);
    }
  });

  it("treats an older workspace-only export as the workspace alone", async () => {
    await realWork();
    const old = JSON.stringify(readWorkspace());
    await realWork("Newer");
    await updateConnections((rows) => {
      rows.push({ id: "con_9", firstName: "Kim", lastName: "Lu", url: "https://www.linkedin.com/in/kim", company: "Kite", position: "COO", companyNorm: "kite" });
    });

    const bundle = parseBackup(old);
    expect(bundle.legacy).toBe(true);
    const { files } = await restoreWorkspace(bundle);
    expect(files).toEqual(["workspace.json"]);
    expect(readWorkspace().company?.name).toBe("Acme");
    // LinkedIn connections and threads weren't in that file, so they stay.
    expect(readConnections().map((c) => c.id)).toEqual(["con_1", "con_9"]);
  });

  it("says plainly when a file isn't a backup it can restore", () => {
    expect(() => parseBackup("not json")).toThrow("That isn't an Inroad backup.");
    expect(() => parseBackup(JSON.stringify({ hello: "world" }))).toThrow("That isn't an Inroad backup.");
    expect(() => parseBackup(JSON.stringify({ format: "inroad-backup", version: 2, files: {} }))).toThrow(/newer version of Inroad/);
    expect(() => parseBackup(JSON.stringify({ format: "inroad-backup", version: 1, files: {} }))).toThrow(/no workspace in it/);
    expect(() => parseBackup(new Uint8Array([0x1f, 0x8b, 1, 2, 3]))).toThrow(/couldn't be unzipped/);
  });

  it("restores a backup bigger than the 10 MB an upload can carry, gzipped in the browser first", async () => {
    await realWork();
    const bundle = JSON.parse(await (await exportRoute()).text()) as BackupBundle;
    // Months of run history: 150 runs of 300 steps is what runs.json keeps at most.
    const steps: Record<string, unknown[]> = {};
    for (let r = 0; r < 150; r++) {
      steps[`run_${r}`] = Array.from({ length: 300 }, (_, i) => ({
        at: new Date(1_760_000_000_000 + r * 3_600_000 + i * 1000).toISOString(),
        type: "read",
        text: `Read the careers page: ${(r * 31 + i * 7) % 97} open roles, ${i % 5} in sales`,
        url: `https://company-${r}-${i}.com/careers`,
        host: `company-${r}-${i}.com`,
      }));
    }
    bundle.files["runs.json"] = steps;
    const file = new Blob([JSON.stringify(bundle, null, 2)]);
    expect(file.size).toBeGreaterThan(BODY_LIMIT_BYTES);
    await resetToEmptyWorkspace();

    const body = await uploadBody(file);
    expect(body.size).toBeLessThan(BODY_LIMIT_BYTES);
    const res = await restoreRoute(new Request("http://localhost:3000/api/workspace/restore", { method: "POST", body }));
    expect(res.status).toBe(200);
    expect(readWorkspace().company?.name).toBe("Acme");
    expect(runSteps("run_149")).toHaveLength(300);
  });

  it("says a file cut short at the upload limit is too big, not that it isn't a backup", async () => {
    await realWork();
    const file = await (await exportRoute()).text();
    // What reaches the route when Next's proxy kept only the first part: fewer bytes than the length says.
    const cut = new Request("http://localhost:3000/api/workspace/restore", { method: "POST", body: file.slice(0, 200), headers: { "content-length": String(file.length) } });
    const res = await restoreRoute(cut);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toMatch(/over 10 MB even compressed/);
    expect(readWorkspace().company?.name).toBe("Acme");

    const huge = new Request("http://localhost:3000/api/workspace/restore", { method: "POST", body: "{}", headers: { "content-length": String(BODY_LIMIT_BYTES + 1) } });
    expect((await restoreRoute(huge)).status).toBe(413);
  });

  it("answers a bad upload with a sentence, not a stack", async () => {
    const res = await restoreRoute(new Request("http://localhost:3000/api/workspace/restore", { method: "POST", body: "{}" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/isn't an Inroad backup/);
    const empty = await restoreRoute(new Request("http://localhost:3000/api/workspace/restore", { method: "POST" }));
    expect(((await empty.json()) as { error: string }).error).toBe("Choose a backup file first.");
  });
});
