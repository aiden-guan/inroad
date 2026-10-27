import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/update/route";
import { POST as saveSettings } from "@/app/api/settings/route";
import { listBackups } from "@/lib/store/backup";
import { writeSettings } from "@/lib/store/settings";
import { emptyWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { resetUpdateCheck } from "./updates";

// Outside Next there's no request scope for connection() to wait on.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));

/**
 * GET and POST /api/update against a stand-in launcher: the same loopback address and token scripts/serve.mjs
 * hands the server. What's checked: the status the app is shown, that GitHub is asked only when it's due or
 * asked for, that an update starts only after a backup, and the launcher's refusals reach the founder as said.
 */

const TOKEN = "t".repeat(48);
let launcher: http.Server;
let calls: string[];
let bodies: unknown[];
let reply: { check: unknown; update?: unknown; updateStatus?: number; updateBody?: unknown };

const HEAD = "796721b0000000000000000000000000000000ab";
const behind = (n: number, over: Record<string, unknown> = {}) => ({
  kind: "git",
  branch: "main",
  upstream: "origin/main",
  head: HEAD,
  behind: n,
  ahead: 0,
  dirty: [],
  changes: Array.from({ length: n }, (_, i) => ({ sha: `${i}`.repeat(40), subject: `Change ${i + 1}`, date: "2026-10-25T10:00:00Z" })),
  fetched: true,
  fetchError: null,
  blocked: null,
  ...over,
});
const idle = { phase: "idle", step: null, startedAt: null, finishedAt: null, result: null, log: [] };

beforeEach(async () => {
  calls = [];
  bodies = [];
  reply = { check: behind(0) };
  launcher = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return res.writeHead(401).end("{}");
    calls.push(`${req.method} ${req.url}`);
    res.setHeader("content-type", "application/json");
    if (req.url === "/update") {
      let text = "";
      req.on("data", (c) => (text += c));
      req.on("end", () => {
        bodies.push(JSON.parse(text || "{}"));
        res.writeHead(reply.updateStatus ?? 202).end(JSON.stringify(reply.updateBody ?? { started: true, changes: 2 }));
      });
      return;
    }
    res.end(JSON.stringify({ mode: "start", check: reply.check, update: reply.update ?? idle }));
  });
  await new Promise<void>((r) => launcher.listen(0, "127.0.0.1", r));
  vi.stubEnv("INROAD_LAUNCHER_URL", `http://127.0.0.1:${(launcher.address() as AddressInfo).port}`);
  vi.stubEnv("INROAD_LAUNCHER_TOKEN", TOKEN);
  resetUpdateCheck();
  writeSettings({ updateCheck: undefined });
});

afterEach(async () => {
  await new Promise((r) => launcher.close(r));
});

const get = async (query = "") => (await GET(new Request(`http://localhost/api/update${query}`))).json();

describe("GET /api/update", () => {
  it("lists what an update brings, and asks GitHub only when it's due", async () => {
    reply.check = behind(2);
    expect(await get()).toMatchObject({
      channel: "source",
      phase: "available",
      current: expect.stringMatching(/ · 796721b$/),
      latest: { label: "2 new changes", total: 2, changes: [{ subject: "Change 1", sha: "0000000" }, { subject: "Change 2" }] },
      blocked: null,
      autoCheck: true,
    });
    expect(calls).toEqual(["GET /check?fetch=1"]);
    await get();
    expect(calls).toEqual(["GET /check?fetch=1", "GET /check"]);
    await get("?check=1");
    expect(calls.at(-1)).toBe("GET /check?fetch=1");
  });

  it("never asks GitHub by itself when automatic checks are off", async () => {
    writeSettings({ updateCheck: "off" });
    expect(await get()).toMatchObject({ phase: "idle", autoCheck: false });
    expect(calls).toEqual(["GET /check"]);
    writeSettings({ updateCheck: undefined });
    vi.stubEnv("INROAD_UPDATE_CHECK", "off");
    expect(await get()).toMatchObject({ autoCheck: false });
    expect(calls).toEqual(["GET /check", "GET /check"]);
  });

  it("says why a copy can't update in one click", async () => {
    reply.check = behind(1, { blocked: "dirty", dirty: ["package.json"] });
    expect(await get()).toMatchObject({ phase: "available", blocked: expect.stringMatching(/changed on this computer/) });
    reply.check = { kind: "none", reason: "This copy of Inroad isn't a git checkout, so it can't update itself." };
    resetUpdateCheck();
    expect(await get()).toMatchObject({ phase: "unavailable", blocked: expect.stringMatching(/isn't a git checkout/) });
  });

  it("reports the update that just ran, once the server is back", async () => {
    reply.update = { ...idle, phase: "done", finishedAt: "2026-10-26T12:00:00.000Z", result: { ok: true, from: "a", to: "b2c3d4e5f6", changes: 2 } };
    expect(await get()).toMatchObject({ phase: "up-to-date", last: { ok: true, at: "2026-10-26T12:00:00.000Z", to: "b2c3d4e", backedUp: false } });
    reply.update = { ...idle, phase: "failed", finishedAt: "2026-10-26T12:05:00.000Z", result: { ok: false, error: "The update stopped while building.", rolledBack: true } };
    expect(await get()).toMatchObject({ last: { ok: false, error: "The update stopped while building.", rolledBack: true } });
  });

  it("says how to update by hand when Inroad was started without its launcher", async () => {
    vi.stubEnv("INROAD_LAUNCHER_URL", "");
    expect(await get()).toMatchObject({ phase: "unavailable", blocked: expect.stringMatching(/started without its launcher/) });
  });

  it("turns automatic checks off and on from Settings", async () => {
    const res = await saveSettings(new Request("http://localhost/api/settings", { method: "POST", body: JSON.stringify({ updateCheck: "off" }) }));
    expect(await res.json()).toMatchObject({ updateCheck: "off" });
  });
});

describe("POST /api/update", () => {
  it("backs up the workspace, then has the launcher update", async () => {
    await replaceWorkspace({ ...emptyWorkspace(), onboarding: { status: "hired" }, company: { name: "Acme", domain: "acme.com" } as never });
    const before = listBackups().filter((b) => b.reason === "before_update").length;
    const res = await POST(new Request("http://localhost/api/update", { method: "POST" }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, changes: 2, backedUp: true });
    expect(listBackups().filter((b) => b.reason === "before_update")).toHaveLength(before + 1);
    expect(calls).toEqual(["POST /update"]);
    expect(bodies).toEqual([{ backedUp: true }]);
  });

  it("says when there was nothing to back up (the sample, an empty workspace)", async () => {
    await replaceWorkspace(emptyWorkspace());
    const res = await POST(new Request("http://localhost/api/update", { method: "POST" }));
    expect(await res.json()).toEqual({ ok: true, changes: 2, backedUp: false });
    expect(bodies).toEqual([{ backedUp: false }]);
  });

  it("passes the launcher's refusal on as it said it", async () => {
    reply.updateStatus = 409;
    reply.updateBody = { error: "Inroad is already up to date." };
    const res = await POST(new Request("http://localhost/api/update", { method: "POST" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Inroad is already up to date." });
  });

  it("takes the backup alone for the Mac app", async () => {
    await replaceWorkspace({ ...emptyWorkspace(), onboarding: { status: "hired" }, company: { name: "Acme", domain: "acme.com" } as never });
    const res = await POST(new Request("http://localhost/api/update", { method: "POST", body: JSON.stringify({ action: "backup" }) }));
    expect(await res.json()).toMatchObject({ ok: true, backup: { reason: "before_update" } });
    expect(calls).toEqual([]);
    const newest = listBackups()[0];
    expect(fs.existsSync(path.join(process.env.GTM_DATA_DIR!, "backups", newest.name))).toBe(true);
  });
});
