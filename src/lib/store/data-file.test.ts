import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { POST as startup } from "@/app/api/startup/route";
import { updateConnections } from "@/lib/network/store";
import { resetStarted } from "@/lib/server/startup";
import { cached } from "@/lib/signals/cache";
import { DIR_MODE, FILE_MODE, readDataFile, secureDataDir, writeDataFile } from "./data-file";
import { DATA_DIR, dataDirInsideApp, writeSettings } from "./settings";
import { mutateWorkspace, setSecrets } from "./workspace";

/**
 * Data files hold prospects' contact details and the founder's keys, so every one of them is
 * readable by this user only, whatever the umask. POSIX modes; Windows ignores them.
 */

const modeOf = (p: string) => fs.statSync(p).mode & 0o777;
const posix = process.platform !== "win32";

describe.runIf(posix)("owner-only data files", () => {
  it("writes every kind of data file 0600 in a 0700 folder", async () => {
    const nested = path.join(DATA_DIR, "nested", "deeper");
    writeDataFile(path.join(nested, "x.json"), { a: 1 });
    expect(modeOf(path.join(nested, "x.json"))).toBe(FILE_MODE);
    expect(modeOf(nested)).toBe(DIR_MODE);
    expect(modeOf(path.join(DATA_DIR, "nested"))).toBe(DIR_MODE);

    await mutateWorkspace((ws) => {
      ws.founder.name = "Priya";
    });
    writeSettings({ newsSource: "off" });
    setSecrets("slack", { key: "https://hooks.slack.com/services/T/B/x" });
    await updateConnections((rows) => {
      rows.push({ id: "con_1", firstName: "Dana", lastName: "Reyes", url: "https://www.linkedin.com/in/dana", company: "Northwind", position: "VP Ops", companyNorm: "northwind" });
    });
    await cached("perm-test", 60_000, async () => ({ ok: true }));
    const cacheFile = fs.readdirSync(path.join(DATA_DIR, "cache")).find((f) => f.startsWith("perm-test"))!;

    for (const f of ["workspace.json", "settings.json", "secrets.json", "connections.json", path.join("cache", cacheFile)]) {
      expect(modeOf(path.join(DATA_DIR, f)), f).toBe(FILE_MODE);
    }
    expect(modeOf(path.join(DATA_DIR, "cache"))).toBe(DIR_MODE);
  });

  it("keeps the copy of a corrupt file owner-only too", () => {
    const file = path.join(DATA_DIR, "broken.json");
    fs.writeFileSync(file, "{ nope", { mode: 0o644 });
    expect(() => readDataFile(file, () => ({}))).toThrow(/could not be read/);
    const copy = fs.readdirSync(DATA_DIR).find((f) => f.startsWith("broken.json.corrupt-"))!;
    expect(modeOf(path.join(DATA_DIR, copy))).toBe(FILE_MODE);
  });

  it("tightens files and folders an older version left readable to others", () => {
    const dir = fs.mkdtempSync(path.join(DATA_DIR, "old-"));
    fs.chmodSync(dir, 0o755);
    fs.writeFileSync(path.join(dir, "workspace.json"), "{}", { mode: 0o644 });
    fs.mkdirSync(path.join(dir, "cache"), { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "cache", "page.json"), "{}", { mode: 0o664 });
    fs.writeFileSync(path.join(dir, "keys.json"), "{}", { mode: 0o600 });
    // A symlink pointing outside the folder is never followed or changed.
    const outside = path.join(DATA_DIR, "outside.txt");
    fs.writeFileSync(outside, "x", { mode: 0o644 });
    fs.symlinkSync(outside, path.join(dir, "link.txt"));

    expect(secureDataDir(dir)).toEqual({ changed: 4, foreign: 0 });
    expect(modeOf(dir)).toBe(DIR_MODE);
    expect(modeOf(path.join(dir, "workspace.json"))).toBe(FILE_MODE);
    expect(modeOf(path.join(dir, "cache"))).toBe(DIR_MODE);
    expect(modeOf(path.join(dir, "cache", "page.json"))).toBe(FILE_MODE);
    expect(modeOf(outside)).toBe(0o644);
    // Nothing left to change the second time.
    expect(secureDataDir(dir).changed).toBe(0);
    expect(secureDataDir(path.join(DATA_DIR, "missing")).changed).toBe(0);
  });

  it("touches only its own files when the folder is shared: a script keeps its execute bit", () => {
    const dir = fs.mkdtempSync(path.join(DATA_DIR, "shared-"));
    fs.chmodSync(dir, 0o755);
    fs.mkdirSync(path.join(dir, "tools", "bin"), { recursive: true, mode: 0o755 });
    fs.writeFileSync(path.join(dir, "tools", "bin", "run.sh"), "#!/bin/sh\n", { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "readme.txt"), "hi", { mode: 0o644 });
    fs.writeFileSync(path.join(dir, "workspace.json"), "{}", { mode: 0o644 });
    fs.writeFileSync(path.join(dir, "workspace.json.corrupt-123"), "{", { mode: 0o644 });
    fs.mkdirSync(path.join(dir, "backups"), { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "backups", "x.json.gz"), "", { mode: 0o644 });

    expect(secureDataDir(dir)).toEqual({ changed: 4, foreign: 2 });
    expect(modeOf(path.join(dir, "tools", "bin", "run.sh"))).toBe(0o755);
    expect(modeOf(path.join(dir, "tools"))).toBe(0o755);
    expect(modeOf(path.join(dir, "readme.txt"))).toBe(0o644);
    expect(modeOf(dir)).toBe(0o755);
    for (const own of ["workspace.json", "workspace.json.corrupt-123", path.join("backups", "x.json.gz")]) expect(modeOf(path.join(dir, own)), own).toBe(FILE_MODE);
    expect(modeOf(path.join(dir, "backups"))).toBe(DIR_MODE);
  });

  it("tightens the data folder once per server, when the launcher reports the server is up", async () => {
    resetStarted();
    const file = path.join(DATA_DIR, "hub.json");
    fs.writeFileSync(file, "{}", { mode: 0o644 });
    fs.chmodSync(file, 0o644);
    expect((await startup()).status).toBe(200);
    expect(modeOf(file)).toBe(FILE_MODE);
    // Once per server: a second call doesn't walk the folder again.
    fs.chmodSync(file, 0o644);
    await startup();
    expect(modeOf(file)).toBe(0o644);
  });
});

describe("where the data folder is", () => {
  it("says when it's inside the folder Inroad runs from, where re-cloning deletes it", () => {
    const app = path.resolve("inroad");
    expect(dataDirInsideApp(path.join(app, ".data"), app)).toBe(true);
    expect(dataDirInsideApp(app, app)).toBe(true);
    expect(dataDirInsideApp(path.join(app, "..data"), app)).toBe(true);
    expect(dataDirInsideApp(path.join(app, "..", "inroad-data"), app)).toBe(false);
    expect(dataDirInsideApp(path.resolve("elsewhere", "Inroad"), app)).toBe(false);
    // The test suite's own data folder is a temp folder, set with GTM_DATA_DIR.
    expect(dataDirInsideApp()).toBe(false);
  });
});
