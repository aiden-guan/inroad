/**
 * Inroad for Mac updates itself, in one click.
 *
 * Every 6 hours while it runs (and from Inroad → Check for Updates…), it asks GitHub for the latest release.
 * A newer one downloads in the background: the .zip for this Mac's chip, checked against the SHA-256 GitHub
 * publishes for it (or the release's SHA256SUMS.txt), unpacked, and checked again by macOS (codesign: a valid
 * signature, by the same developer as this copy when this copy is signed, and the version it claims). Then the
 * app says "Restart to update": the workspace is backed up, Inroad quits, a small script swaps the new app in
 * where this one is and opens it. If the swap fails, the old app is put back and opened instead.
 *
 * Squirrel.Mac (Electron's own updater) only installs into apps signed with a Developer ID; this works for
 * those and for the ad hoc builds made without one, with the same checks either way.
 *
 * Plain CommonJS with its effects passed in (fetch, the macOS tools, the clock), so the logic is tested
 * without a Mac (src/lib/server/desktop-updater.test.ts).
 */
/* eslint-disable @typescript-eslint/no-require-imports -- Electron loads its main process as CommonJS */
const { execFile, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const FEED = "https://api.github.com/repos/aiden-guan/inroad";
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_MS = 15_000;

/* ───────────── Versions and releases ───────────── */

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v ?? "").trim());
  return m ? { parts: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null, text: `${m[1]}.${m[2]}.${m[3]}${m[4] ? `-${m[4]}` : ""}` } : null;
}

/** Is version a newer than b? A pre-release comes before its release (0.2.0-beta.1 < 0.2.0). */
function isNewer(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x.parts[i] !== y.parts[i]) return x.parts[i] > y.parts[i];
  if (x.pre === y.pre) return false;
  if (!x.pre) return true;
  if (!y.pre) return false;
  return x.pre.localeCompare(y.pre, "en", { numeric: true }) > 0;
}

/** The file the Mac app workflow attaches for each chip (desktop/electron-builder.yml, mac.artifactName). */
const zipName = (version, arch) => `Inroad-${version}-mac-${arch}.zip`;

/**
 * What a release from GitHub's API offers this Mac, or why it offers nothing.
 * @returns {{ kind: "newer"; version: string; notes: string; url: string; publishedAt: string | null; zip: { name: string; url: string; size: number; sha256: string | null }; sums: string | null } | { kind: "current" } | { kind: "none"; error: string }}
 */
function readRelease(release, { current, arch }) {
  if (!release || typeof release !== "object" || release.draft || release.prerelease) return { kind: "current" };
  const version = parseVersion(release.tag_name);
  if (!version) return { kind: "current" };
  if (!isNewer(version.text, current)) return { kind: "current" };
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const zip = assets.find((a) => a?.name === zipName(version.text, arch));
  if (!zip?.browser_download_url) return { kind: "none", error: `Inroad ${version.text} is out, but it has no download for this Mac (${arch}) yet.` };
  const digest = typeof zip.digest === "string" && /^sha256:[0-9a-f]{64}$/i.test(zip.digest) ? zip.digest.slice(7).toLowerCase() : null;
  const sums = assets.find((a) => a?.name === "SHA256SUMS.txt")?.browser_download_url ?? null;
  return {
    kind: "newer",
    version: version.text,
    notes: typeof release.body === "string" ? release.body.slice(0, 20_000) : "",
    url: typeof release.html_url === "string" ? release.html_url : `${FEED.replace("api.github.com/repos", "github.com")}/releases`,
    publishedAt: release.published_at ?? null,
    zip: { name: zip.name, url: zip.browser_download_url, size: Number(zip.size) || 0, sha256: digest },
    sums,
  };
}

/** `sha256sum` output: "<hex>  <name>" per line. */
function sumFor(text, name) {
  for (const line of String(text).split("\n")) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m && m[2].trim() === name) return m[1].toLowerCase();
  }
  return null;
}

/* ───────────── The swap ───────────── */

/**
 * Run detached once Inroad quits: waits for it to exit (a minute at most), moves it aside, moves the new
 * app into its place and opens it. A failed move puts the old app back, so there's always an Inroad to open.
 * Arguments: pid, the installed app, the new app, where the old one waits during the swap, the opener.
 */
const SWAP_SCRIPT = `#!/bin/sh
pid="$1"; target="$2"; staged="$3"; previous="$4"; opener="$5"
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i + 1))
  [ "$i" -gt 600 ] && exit 1
  sleep 0.1
done
rm -rf "$previous"
if mv "$target" "$previous"; then
  if mv "$staged" "$target"; then
    xattr -dr com.apple.quarantine "$target" 2>/dev/null
    rm -rf "$previous"
  else
    rm -rf "$target"
    mv "$previous" "$target"
  fi
fi
exec "$opener" "$target"
`;

function execText(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
  });
}

/** "ABCDE12345", or null for an ad hoc or unsigned app. */
async function teamOf(appPath) {
  const r = await execText("/usr/bin/codesign", ["-dv", "--verbose=2", appPath]);
  const m = /^TeamIdentifier=(.+)$/m.exec(r.stderr);
  return m && m[1].trim() !== "not set" ? m[1].trim() : null;
}

/** The macOS side: unpack, verify, replace. */
const macOps = {
  /** Is the app somewhere it can be replaced? A reason in plain words when not. */
  cannotReplace(target) {
    if (!target.endsWith(".app")) return "This copy of Inroad isn't an app bundle, so it can't replace itself.";
    if (target.includes("/AppTranslocation/") || target.startsWith("/Volumes/")) {
      return "Inroad is running from the disk image or the Downloads folder, where macOS won't let it change itself. Move it to Applications (Inroad offers when it opens), then updates install in one click.";
    }
    try {
      fs.accessSync(path.dirname(target), fs.constants.W_OK);
      fs.accessSync(target, fs.constants.W_OK);
    } catch {
      return `Your Mac account can't change apps in ${path.dirname(target)}, so updates can't install by themselves. Ask whoever manages this Mac, or download the new version and replace the app.`;
    }
    return null;
  },
  async extract(zip, dir) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    // ditto keeps the bundle's symlinks and signature intact, as Finder does.
    const r = await execText("/usr/bin/ditto", ["-x", "-k", zip, dir]);
    if (r.code !== 0) throw new Error("The download couldn't be unpacked.");
    const appName = fs.readdirSync(dir).find((n) => n.endsWith(".app"));
    if (!appName) throw new Error("The download has no app in it.");
    return path.join(dir, appName);
  },
  async verify(newApp, { version, currentApp }) {
    const sig = await execText("/usr/bin/codesign", ["--verify", "--deep", "--strict", newApp]);
    if (sig.code !== 0) throw new Error("macOS says the new version's signature isn't valid, so it wasn't installed.");
    const team = await teamOf(currentApp);
    if (team && (await teamOf(newApp)) !== team) throw new Error("The new version isn't signed by the same developer as this one, so it wasn't installed.");
    const v = await execText("/usr/bin/plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", path.join(newApp, "Contents", "Info.plist")]);
    if (v.stdout.trim() !== version) throw new Error(`The download says it's version ${v.stdout.trim() || "unknown"}, not ${version}, so it wasn't installed.`);
  },
  swap({ pid, target, staged, scriptPath }) {
    fs.writeFileSync(scriptPath, SWAP_SCRIPT, { mode: 0o700 });
    const previous = path.join(path.dirname(target), `.${path.basename(target, ".app")}-previous.app`);
    const proc = spawn("/bin/sh", [scriptPath, String(pid), target, staged, previous, "/usr/bin/open"], { detached: true, stdio: "ignore" });
    proc.unref();
  },
};

/* ───────────── The updater ───────────── */

/**
 * @param {{
 *   current: string; arch: string; appPath: string; dir: string; enabled: string | null;
 *   fetch: typeof fetch; ops?: typeof macOps; feed?: string;
 *   readState: () => any; writeState: (patch: any) => void; log?: (line: string) => void;
 *   onChange?: (status: any) => void; beforeInstall?: () => Promise<boolean>; quit?: () => void; now?: () => number;
 * }} o  `enabled` is null when this copy can update itself, else why not (a development run, not a Mac).
 */
function createUpdater(o) {
  const ops = o.ops ?? macOps;
  const feed = o.feed ?? FEED;
  const log = o.log ?? (() => {});
  const now = o.now ?? Date.now;
  const saved = o.readState().updates ?? {};
  /** @type {null | ReturnType<typeof readRelease> & { kind: "newer" }} */
  let release = null;
  let staged = null;
  let timer = null;
  let running = null;
  const status = {
    channel: "desktop",
    phase: "idle",
    current: o.current,
    latest: null,
    progress: null,
    checkedAt: saved.checkedAt ?? null,
    blocked: o.enabled,
    error: null,
    last: null,
    autoCheck: saved.autoCheck !== false,
  };

  // After an update: say how it went once, and clear what the last version left behind.
  if (saved.installing) {
    status.last =
      saved.installing.to === o.current
        ? { ok: true, at: saved.installing.at, to: o.current, backedUp: saved.installing.backedUp === true }
        : { ok: false, at: saved.installing.at, backedUp: saved.installing.backedUp === true, error: `The update to ${saved.installing.to} didn't install, so you're still on ${o.current}. Your work is untouched; Inroad will try again.` };
    o.writeState({ updates: { ...saved, installing: undefined } });
  }
  fs.rmSync(o.dir, { recursive: true, force: true });

  const set = (patch) => {
    Object.assign(status, patch);
    o.onChange?.({ ...status });
  };
  const remember = (patch) => o.writeState({ updates: { ...(o.readState().updates ?? {}), ...patch } });

  async function getJSON(url) {
    const res = await o.fetch(url, { headers: { accept: "application/vnd.github+json", "user-agent": `Inroad/${o.current}` } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    return res.json();
  }

  async function download(r) {
    set({ phase: "downloading", progress: 0, error: null });
    let sha = r.zip.sha256;
    if (!sha && r.sums) {
      const res = await o.fetch(r.sums, { headers: { "user-agent": `Inroad/${o.current}` } });
      if (res.ok) sha = sumFor(await res.text(), r.zip.name);
    }
    if (!sha) throw new Error(`Inroad ${r.version} has no checksum to check the download against, so it wasn't downloaded. Download it from GitHub instead.`);

    fs.rmSync(o.dir, { recursive: true, force: true });
    fs.mkdirSync(o.dir, { recursive: true, mode: 0o700 });
    const file = path.join(o.dir, r.zip.name);
    const res = await o.fetch(r.zip.url, { headers: { "user-agent": `Inroad/${o.current}` } });
    if (!res.ok || !res.body) throw new Error(`The download didn't start (GitHub answered ${res.status}).`);
    const total = Number(res.headers.get("content-length")) || r.zip.size;
    const hash = crypto.createHash("sha256");
    const out = fs.createWriteStream(`${file}.partial`, { mode: 0o600 });
    let got = 0;
    let shown = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        got += value.byteLength;
        if (!out.write(value)) await new Promise((resolve) => out.once("drain", resolve));
        const p = total ? Math.min(0.99, got / total) : null;
        if (p !== null && p - shown >= 0.01) {
          shown = p;
          set({ progress: p });
        }
      }
    } finally {
      await new Promise((resolve) => out.end(resolve));
    }
    if (hash.digest("hex") !== sha) {
      fs.rmSync(o.dir, { recursive: true, force: true });
      throw new Error("The download didn't match its checksum, so it wasn't installed. Inroad will try again later.");
    }
    fs.renameSync(`${file}.partial`, file);
    const app = await ops.extract(file, path.join(o.dir, "new"));
    await ops.verify(app, { version: r.version, currentApp: o.appPath });
    fs.rmSync(file, { force: true });
    staged = app;
    log(`Inroad ${r.version} downloaded and verified.`);
    set({ phase: "ready", progress: 1 });
  }

  /** Asks GitHub now; a newer version downloads by itself. One check at a time. */
  function check() {
    running ??= (async () => {
      if (status.phase === "updating") return;
      // Already waiting for a restart: it stays ready unless a newer release replaces it.
      set({ phase: status.phase === "ready" ? "ready" : "checking", error: null });
      try {
        const r = readRelease(await getJSON(`${feed}/releases/latest`), { current: o.current, arch: o.arch });
        const checkedAt = new Date(now()).toISOString();
        remember({ checkedAt });
        if (r.kind === "none") return set({ phase: "up-to-date", checkedAt, error: r.error });
        if (r.kind === "current") {
          release = null;
          return set({ phase: "up-to-date", checkedAt, latest: null });
        }
        const latest = { label: r.version, notes: r.notes, url: r.url };
        if (staged && release?.version === r.version) return set({ phase: "ready", checkedAt, latest });
        release = r;
        staged = null;
        set({ phase: "available", checkedAt, latest });
        if (o.enabled) return set({ blocked: o.enabled });
        const why = ops.cannotReplace(o.appPath);
        if (why) return set({ blocked: why });
        await download(r);
      } catch (err) {
        log(`Update check failed: ${err instanceof Error ? err.message : String(err)}`);
        const message = err instanceof Error && /^(The |Inroad |macOS )/.test(err.message) ? err.message : "Couldn't reach GitHub to check for updates. Inroad will try again later.";
        set({ phase: release ? "available" : status.checkedAt ? "up-to-date" : "idle", progress: null, error: message });
      }
    })().finally(() => {
      running = null;
    });
    return running.then(() => ({ ...status }));
  }

  /** "Restart to update": back up, quit, swap, reopen. */
  async function install() {
    if (status.phase !== "ready" || !staged || !release) return { ok: false, error: "There's no update ready to install yet." };
    const why = ops.cannotReplace(o.appPath);
    if (why) return { ok: false, error: why };
    let backedUp = false;
    try {
      backedUp = (await o.beforeInstall?.()) === true;
    } catch (err) {
      return { ok: false, error: `I couldn't back up your workspace first, so I didn't update. ${err instanceof Error ? err.message : ""}`.trim() };
    }
    set({ phase: "updating" });
    remember({ installing: { from: o.current, to: release.version, at: new Date(now()).toISOString(), backedUp } });
    ops.swap({ pid: process.pid, target: o.appPath, staged, scriptPath: path.join(o.dir, "swap.sh") });
    log(`Restarting into Inroad ${release.version}.`);
    o.quit?.();
    return { ok: true };
  }

  function setAutoCheck(on) {
    remember({ autoCheck: !!on });
    set({ autoCheck: !!on });
    schedule();
    return { ...status };
  }

  function schedule(first = false) {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!status.autoCheck) return;
    const since = status.checkedAt ? now() - new Date(status.checkedAt).getTime() : Infinity;
    const wait = first ? Math.max(FIRST_CHECK_MS, CHECK_EVERY_MS - since) : CHECK_EVERY_MS;
    timer = setTimeout(() => void check().finally(() => schedule()), Math.min(wait, CHECK_EVERY_MS));
    timer.unref?.();
  }

  return {
    get: () => ({ ...status }),
    check,
    install,
    setAutoCheck,
    start: () => schedule(true),
    stop: () => timer && clearTimeout(timer),
  };
}

module.exports = { createUpdater, isNewer, parseVersion, readRelease, sumFor, zipName, SWAP_SCRIPT, FEED };
