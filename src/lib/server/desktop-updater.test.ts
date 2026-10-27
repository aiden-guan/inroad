import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Mac app's updater (desktop/app/updater.cjs) without a Mac: GitHub's API and the download are stand-ins,
 * and so are the macOS tools (ditto, codesign), so what's checked is the logic: which release counts, that a
 * download must match its checksum, that nothing installs without a backup, and that the swap script puts
 * the new app in place (or the old one back) and opens it.
 */

const require = createRequire(import.meta.url);
const updater = require("../../../desktop/app/updater.cjs") as typeof import("../../../desktop/app/updater.cjs");
const { createUpdater, isNewer, readRelease, sumFor, SWAP_SCRIPT } = updater;

let dir: string;
let state: Record<string, unknown>;

const ZIP = Buffer.from("pretend this is Inroad-0.2.0-mac-arm64.zip");
const SHA = crypto.createHash("sha256").update(ZIP).digest("hex");

function release(over: Record<string, unknown> = {}, asset: Record<string, unknown> = {}) {
  return {
    tag_name: "v0.2.0",
    draft: false,
    prerelease: false,
    body: "## What's new\n- Updates in one click",
    html_url: "https://github.com/aiden-guan/inroad/releases/tag/v0.2.0",
    published_at: "2026-10-26T10:00:00Z",
    assets: [{ name: "Inroad-0.2.0-mac-arm64.zip", browser_download_url: "https://dl/zip", size: ZIP.length, digest: `sha256:${SHA}`, ...asset }],
    ...over,
  };
}

/** GitHub: the latest release, the zip, and SHA256SUMS.txt. */
function github(latest: unknown, { zip = ZIP, sums }: { zip?: Buffer; sums?: string } = {}) {
  return vi.fn(async (url: string) => {
    if (url.endsWith("/releases/latest")) return latest === 404 ? new Response("{}", { status: 404 }) : Response.json(latest);
    if (url === "https://dl/zip") return new Response(new Uint8Array(zip), { headers: { "content-length": String(zip.length) } });
    if (url === "https://dl/sums" && sums) return new Response(sums);
    return new Response("nope", { status: 404 });
  });
}

function ops(over: Partial<Record<"cannotReplace" | "extract" | "verify" | "swap", unknown>> = {}) {
  return {
    cannotReplace: vi.fn(() => null),
    extract: vi.fn(async (_zip: string, to: string) => {
      fs.mkdirSync(path.join(to, "Inroad.app"), { recursive: true });
      return path.join(to, "Inroad.app");
    }),
    verify: vi.fn(async () => {}),
    swap: vi.fn(),
    ...over,
  };
}

function make(fetch: ReturnType<typeof github>, o: ReturnType<typeof ops> = ops(), extra: Record<string, unknown> = {}) {
  return createUpdater({
    current: "0.1.0",
    arch: "arm64",
    appPath: "/Applications/Inroad.app",
    dir: path.join(dir, "Updates"),
    enabled: null,
    fetch: fetch as unknown as typeof globalThis.fetch,
    ops: o as never,
    readState: () => state,
    writeState: (patch: Record<string, unknown>) => {
      state = { ...state, ...patch };
    },
    beforeInstall: vi.fn(async () => true),
    quit: vi.fn(),
    ...extra,
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "inroad-desktop-update-"));
  state = {};
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("versions and releases", () => {
  it("orders versions the way people read them", () => {
    expect(isNewer("0.2.0", "0.1.0")).toBe(true);
    expect(isNewer("0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("v1.0.0", "0.99.0")).toBe(true);
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.2.0", "0.2.0-beta.2")).toBe(true);
    expect(isNewer("0.2.0-beta.10", "0.2.0-beta.9")).toBe(true);
    expect(isNewer("nonsense", "0.1.0")).toBe(false);
  });

  it("offers only a newer, published release with a download for this chip", () => {
    expect(readRelease(release(), { current: "0.1.0", arch: "arm64" })).toMatchObject({ kind: "newer", version: "0.2.0", zip: { sha256: SHA } });
    expect(readRelease(release(), { current: "0.2.0", arch: "arm64" })).toEqual({ kind: "current" });
    expect(readRelease(release({ prerelease: true }), { current: "0.1.0", arch: "arm64" })).toEqual({ kind: "current" });
    expect(readRelease(release({ draft: true }), { current: "0.1.0", arch: "arm64" })).toEqual({ kind: "current" });
    expect(readRelease(release(), { current: "0.1.0", arch: "x64" })).toMatchObject({ kind: "none", error: expect.stringContaining("no download for this Mac (x64)") });
  });

  it("reads a checksum from SHA256SUMS.txt when GitHub has no digest", () => {
    expect(sumFor(`${"a".repeat(64)}  Inroad-0.2.0-arm64.dmg\n${SHA}  Inroad-0.2.0-mac-arm64.zip\n`, "Inroad-0.2.0-mac-arm64.zip")).toBe(SHA);
    expect(sumFor("garbage", "Inroad-0.2.0-mac-arm64.zip")).toBeNull();
  });
});

describe("checking and downloading", () => {
  it("downloads a newer version by itself, checks it, and offers a restart", async () => {
    const o = ops();
    const u = make(github(release()), o);
    const s = await u.check();
    expect(s).toMatchObject({ phase: "ready", latest: { label: "0.2.0", notes: expect.stringContaining("Updates in one click") }, progress: 1, error: null });
    expect(o.extract).toHaveBeenCalledOnce();
    expect(o.verify).toHaveBeenCalledWith(expect.stringMatching(/Inroad\.app$/), { version: "0.2.0", currentApp: "/Applications/Inroad.app" });
    expect((state.updates as { checkedAt?: string }).checkedAt).toEqual(expect.any(String));
  });

  it("says it's up to date when nothing newer is out (or there's no release yet)", async () => {
    expect(await make(github(release({ tag_name: "v0.1.0" }))).check()).toMatchObject({ phase: "up-to-date", latest: null });
    expect(await make(github(404)).check()).toMatchObject({ phase: "up-to-date" });
  });

  it("throws away a download that doesn't match its checksum", async () => {
    const o = ops();
    const s = await make(github(release(), { zip: Buffer.from("tampered") }), o).check();
    expect(s).toMatchObject({ phase: "available", error: expect.stringContaining("didn't match its checksum") });
    expect(o.extract).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(dir, "Updates"))).toBe(false);
  });

  it("uses SHA256SUMS.txt when there's no digest, and refuses when there's neither", async () => {
    const sums = `${SHA}  Inroad-0.2.0-mac-arm64.zip\n`;
    const withSums = release({ assets: [{ name: "Inroad-0.2.0-mac-arm64.zip", browser_download_url: "https://dl/zip", size: ZIP.length }, { name: "SHA256SUMS.txt", browser_download_url: "https://dl/sums" }] });
    expect(await make(github(withSums, { sums })).check()).toMatchObject({ phase: "ready" });
    const neither = release({}, { digest: undefined });
    expect(await make(github(neither)).check()).toMatchObject({ phase: "available", error: expect.stringContaining("no checksum") });
  });

  it("doesn't install a download macOS rejects", async () => {
    const o = ops({ verify: vi.fn(async () => Promise.reject(new Error("macOS says the new version's signature isn't valid, so it wasn't installed."))) });
    expect(await make(github(release()), o).check()).toMatchObject({ phase: "available", error: expect.stringContaining("signature isn't valid") });
  });

  it("only tells a copy that can't replace itself what's out, with why", async () => {
    const o = ops({ cannotReplace: vi.fn(() => "Inroad is running from the disk image.") });
    const fetch = github(release());
    expect(await make(fetch, o).check()).toMatchObject({ phase: "available", blocked: "Inroad is running from the disk image." });
    expect(fetch).not.toHaveBeenCalledWith("https://dl/zip", expect.anything());
    expect(await make(github(release()), ops(), { enabled: "This is a development run." }).check()).toMatchObject({ phase: "available", blocked: "This is a development run." });
  });

  it("keeps quiet about a network failure beyond saying it'll try again", async () => {
    const fetch = vi.fn(async () => Promise.reject(new TypeError("fetch failed")));
    expect(await make(fetch as never).check()).toMatchObject({ phase: "idle", error: "Couldn't reach GitHub to check for updates. Inroad will try again later." });
  });
});

describe("installing", () => {
  it("backs up, remembers what it's installing, swaps and quits", async () => {
    const o = ops();
    const beforeInstall = vi.fn(async () => true);
    const quit = vi.fn();
    const u = make(github(release()), o, { beforeInstall, quit });
    await u.check();
    expect(await u.install()).toEqual({ ok: true });
    expect(beforeInstall).toHaveBeenCalledOnce();
    expect(o.swap).toHaveBeenCalledWith(expect.objectContaining({ target: "/Applications/Inroad.app", staged: expect.stringMatching(/Inroad\.app$/) }));
    expect(quit).toHaveBeenCalledOnce();
    expect((state.updates as { installing?: { to: string } }).installing).toMatchObject({ from: "0.1.0", to: "0.2.0", backedUp: true });
  });

  it("doesn't update when the backup fails", async () => {
    const o = ops();
    const u = make(github(release()), o, { beforeInstall: vi.fn(async () => Promise.reject(new Error("The disk is full."))) });
    await u.check();
    expect(await u.install()).toEqual({ ok: false, error: expect.stringMatching(/^I couldn't back up your workspace first, so I didn't update\. The disk is full\./) });
    expect(o.swap).not.toHaveBeenCalled();
  });

  it("says how it went the next time it opens", () => {
    state = { updates: { installing: { from: "0.1.0", to: "0.2.0", at: "2026-10-26T10:00:00.000Z" } } };
    expect(make(github(404), ops(), { current: "0.2.0" }).get().last).toEqual({ ok: true, at: "2026-10-26T10:00:00.000Z", to: "0.2.0", backedUp: false });
    state = { updates: { installing: { from: "0.1.0", to: "0.2.0", at: "2026-10-26T10:00:00.000Z" } } };
    expect(make(github(404)).get().last).toMatchObject({ ok: false, error: expect.stringContaining("still on 0.1.0") });
    expect((state.updates as { installing?: unknown }).installing).toBeUndefined();
  });
});

describe("the swap script", () => {
  const sh = (args: string[]) => spawnSync("/bin/sh", ["-c", SWAP_SCRIPT, "swap", ...args], { encoding: "utf8", timeout: 20_000 });

  function app(where: string, version: string) {
    fs.mkdirSync(path.join(where, "Contents"), { recursive: true });
    fs.writeFileSync(path.join(where, "Contents", "version"), version);
  }

  /** An opener that writes down what it was asked to open, in place of /usr/bin/open. */
  function opener() {
    const file = path.join(dir, "opened");
    const script = path.join(dir, "open.sh");
    fs.writeFileSync(script, `#!/bin/sh\necho "$1" > "${file}"\n`, { mode: 0o755 });
    return { script, opened: () => fs.readFileSync(file, "utf8").trim() };
  }

  it("waits for Inroad to quit, swaps the new app in and opens it", () => {
    const target = path.join(dir, "Applications", "Inroad.app");
    const staged = path.join(dir, "Updates", "new", "Inroad.app");
    app(target, "0.1.0");
    app(staged, "0.2.0");
    const o = opener();
    const exited = spawnSync("/bin/sh", ["-c", "echo $$"], { encoding: "utf8" }).stdout.trim();
    const r = sh([exited, target, staged, path.join(dir, "Applications", ".Inroad-previous.app"), o.script]);
    expect(r.status).toBe(0);
    expect(fs.readFileSync(path.join(target, "Contents", "version"), "utf8")).toBe("0.2.0");
    expect(fs.existsSync(staged)).toBe(false);
    expect(fs.existsSync(path.join(dir, "Applications", ".Inroad-previous.app"))).toBe(false);
    expect(o.opened()).toBe(target);
  });

  it("puts the old app back and opens it when the new one can't be moved in", () => {
    const target = path.join(dir, "Applications", "Inroad.app");
    app(target, "0.1.0");
    const o = opener();
    const r = sh(["999999", target, path.join(dir, "missing", "Inroad.app"), path.join(dir, "Applications", ".Inroad-previous.app"), o.script]);
    expect(r.status).toBe(0);
    expect(fs.readFileSync(path.join(target, "Contents", "version"), "utf8")).toBe("0.1.0");
    expect(o.opened()).toBe(target);
  });
});
