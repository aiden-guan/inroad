/**
 * Inroad for Mac: the Electron shell.
 *
 * The app is the same Inroad that `npm start` runs: a Next.js server on this computer plus the web UI. Here the
 * server (Next's standalone build, packaged under Resources/server) runs in an Electron utility process on a
 * loopback port, and a window shows it. Nothing listens beyond 127.0.0.1, and the server's own locality check
 * (scripts/peer-guard.cjs, loaded by server/entry.cjs) still refuses anything that isn't this computer.
 *
 * - Data lives in ~/Library/Application Support/Inroad/Workspace (GTM_DATA_DIR); AI keys go to the Keychain.
 * - One port per install, kept between launches, so the page's own storage (theme, folded panels) stays put.
 * - Links that leave the app open in the default browser; the window never navigates away from Inroad.
 * - Quitting stops the server. A server that quits after running a while is started again quietly, once in ten
 *   minutes; otherwise it's said in plain words, with its log.
 * - Updates itself from GitHub's releases in one click (updater.cjs); the page sees them through preload.cjs.
 * - Offers to move itself to Applications when opened from somewhere else, and can open at login.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- Electron loads its main process as CommonJS */
const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, net: electronNet, session, shell, utilityProcess } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { createUpdater } = require("./updater.cjs");

const PRODUCT = "Inroad";
const HOST = "127.0.0.1";
const DEFAULT_PORT = 3737;
const REPO_URL = "https://github.com/aiden-guan/inroad";

// Its own userData folder name, so dev runs from the repo and the installed app share nothing by accident.
app.setName(PRODUCT);
if (!app.isPackaged && !process.env.INROAD_DESKTOP_USER_DATA) app.setPath("userData", path.join(app.getPath("appData"), `${PRODUCT} (dev)`));
if (process.env.INROAD_DESKTOP_USER_DATA) app.setPath("userData", process.env.INROAD_DESKTOP_USER_DATA);

const userData = app.getPath("userData");
const dataDir = path.join(userData, "Workspace");
const logDir = path.join(userData, "Logs");
const stateFile = path.join(userData, "desktop.json");
const serverDir = app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(__dirname, "..", "dist-server");

/** @type {import("electron").UtilityProcess | null} */
let server = null;
/** Set once the server answers; until then windows show the loading page. */
let serverUrl = "";
let serverUpAt = 0;
let lastQuietRestart = 0;
let quitting = false;
/** @type {ReturnType<typeof createUpdater> | null} */
let updater = null;
/** @type {BrowserWindow | null} */
let win = null;

/* ───────────── Small persisted state: the port and the window's place ───────────── */

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return {};
  }
}

function writeState(patch) {
  try {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ ...readState(), ...patch }, null, 2), { mode: 0o600 });
  } catch {
    // Losing the window size is not worth a dialog.
  }
}

/** Free on loopback? */
function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, HOST, () => probe.close(() => resolve(true)));
  });
}

/** The port this install used last time, else 3737, else any free one (remembered for next time). */
async function pickPort() {
  const saved = Number(readState().port);
  for (const candidate of [saved, DEFAULT_PORT].filter((p) => Number.isInteger(p) && p > 1024 && p < 65536)) {
    if (await portFree(candidate)) return candidate;
  }
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, HOST, () => {
      const { port: p } = probe.address();
      probe.close(() => resolve(p));
    });
  });
  return port;
}

/* ───────────── The server ───────────── */

function logStream() {
  fs.mkdirSync(logDir, { recursive: true });
  return fs.createWriteStream(path.join(logDir, "server.log"), { flags: "a", mode: 0o600 });
}

function waitForServer(url, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(`${url}/welcome`, { timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) return resolve();
        retry();
      });
      req.on("error", retry);
      req.on("timeout", () => req.destroy());
    };
    const retry = () => {
      if (!server) return reject(new Error("The server stopped while starting."));
      if (Date.now() - started > timeoutMs) return reject(new Error("The server didn't start in time."));
      setTimeout(attempt, 250);
    };
    attempt();
  });
}

async function startServer() {
  const entry = path.join(serverDir, "entry.cjs");
  if (!fs.existsSync(entry)) throw new Error(`The app's server is missing (${entry}). Run npm run desktop:server, then try again.`);
  const port = await pickPort();
  writeState({ port });
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const log = logStream();
  log.write(`\n[${new Date().toISOString()}] Starting Inroad ${app.getVersion()} on ${HOST}:${port}\n`);
  // The launching shell's NODE_OPTIONS are for Node, not this server (and Electron rejects some of them).
  const inherited = { ...process.env };
  delete inherited.NODE_OPTIONS;
  server = utilityProcess.fork(entry, [], {
    cwd: serverDir,
    serviceName: `${PRODUCT} server`,
    stdio: "pipe",
    env: {
      ...inherited,
      NODE_ENV: "production",
      HOSTNAME: HOST,
      PORT: String(port),
      INROAD_HOST: HOST,
      GTM_DATA_DIR: dataDir,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  server.stdout?.on("data", (chunk) => log.write(chunk));
  server.stderr?.on("data", (chunk) => log.write(chunk));
  const proc = server;
  proc.once("exit", (code) => {
    log.write(`[${new Date().toISOString()}] Server exited (${code})\n`);
    if (server === proc) server = null;
    if (quitting || !serverUrl) return;
    // A server that ran for a while and then quit comes back by itself, once in ten minutes; the window waits on it.
    const now = Date.now();
    if (now - serverUpAt > 60_000 && now - lastQuietRestart > 10 * 60_000) {
      lastQuietRestart = now;
      void restartQuietly();
    } else void serverDied(code);
  });
  // 127.0.0.1, not localhost: on a Mac localhost can resolve to ::1 first, where nothing listens.
  const url = `http://${HOST}:${port}`;
  await waitForServer(url, 90_000);
  serverUrl = url;
  serverUpAt = Date.now();
}

/** The server quit: show the loading page, start it again, and put the window back where it was. */
async function restartQuietly() {
  const was = win?.webContents.getURL() ?? "";
  const pathname = sameOrigin(was) ? new URL(was).pathname + new URL(was).search + new URL(was).hash : "/";
  serverUrl = "";
  await win?.loadFile(loadingPage()).catch(() => {});
  try {
    await startServer();
    await show(`${serverUrl}${pathname}`);
  } catch {
    void serverDied(null);
  }
}

async function serverDied(code) {
  const { response } = await dialog.showMessageBox({
    type: "error",
    message: "Inroad stopped working.",
    detail: `Its server quit unexpectedly${code === null ? "" : ` (code ${code})`}. Your work is saved in ${dataDir}. Restart Inroad to pick up where you left off; the log may say why.`,
    buttons: ["Restart", "Show Log", "Quit"],
    defaultId: 0,
  });
  if (response === 1) shell.showItemInFolder(path.join(logDir, "server.log"));
  if (response === 0) {
    app.relaunch();
  }
  app.quit();
}

function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  s.kill();
}

/* ───────────── The window ───────────── */

const sameOrigin = (url) => {
  try {
    return new URL(url).origin === new URL(serverUrl).origin;
  } catch {
    return false;
  }
};

/** Loads a page; a failed load leaves Chromium's error page up rather than an unhandled rejection. */
function show(url) {
  return win?.loadURL(url).catch(() => {});
}

/** Only web and mail links leave the app, and only to the default browser or mail client. */
function openOutside(url) {
  if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
}

function loadingPage() {
  return path.join(__dirname, "loading.html");
}

async function createWindow() {
  const saved = readState().bounds;
  win = new BrowserWindow({
    title: PRODUCT,
    width: saved?.width ?? 1280,
    height: saved?.height ?? 840,
    ...(saved?.x !== undefined && saved?.y !== undefined ? { x: saved.x, y: saved.y } : {}),
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#121110" : "#faf9f6",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  win.once("ready-to-show", () => win?.show());
  win.on("close", () => {
    if (win && !win.isMinimized() && !win.isFullScreen()) writeState({ bounds: win.getBounds() });
  });
  win.on("closed", () => {
    win = null;
  });

  const contents = win.webContents;
  // New windows: Inroad's own pages open in this window, everything else in the browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url)) void show(url);
    else openOutside(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (sameOrigin(url) || url.startsWith("file:")) return;
    event.preventDefault();
    openOutside(url);
  });
  contents.on("will-redirect", (event, url) => {
    if (sameOrigin(url)) return;
    event.preventDefault();
    openOutside(url);
  });

  await win.loadFile(loadingPage());
  if (serverUrl) await show(serverUrl);
}

/* ───────────── Menus ───────────── */

function goTo(pathname) {
  if (!serverUrl) return;
  if (!win) void createWindow().then(() => show(`${serverUrl}${pathname}`));
  else {
    void show(`${serverUrl}${pathname}`);
    win.show();
  }
}

/** "Check for Updates…": checks now and says what it found, in a dialog (the page shows it too). */
async function checkForUpdatesFromMenu() {
  if (!updater) return;
  const s = await updater.check();
  if (s.phase === "ready") return promptRestart(s);
  const detail = s.error ?? s.blocked ?? (s.phase === "downloading" ? "It's downloading now; Inroad says when it's ready." : s.phase === "available" ? `Inroad ${s.latest?.label} is out.` : `You have the latest version, ${s.current}.`);
  const message = s.phase === "up-to-date" && !s.error ? "Inroad is up to date." : s.latest ? `Inroad ${s.latest.label} is available.` : "Couldn't check for updates.";
  const buttons = s.latest?.url ? ["OK", "See What's New"] : ["OK"];
  const { response } = await dialog.showMessageBox({ type: "info", message, detail, buttons, defaultId: 0 });
  if (response === 1 && s.latest?.url) void shell.openExternal(s.latest.url);
}

async function promptRestart(s) {
  const { response } = await dialog.showMessageBox({
    type: "info",
    message: `Inroad ${s.latest?.label} is ready.`,
    detail: "Restarting takes a few seconds. Your workspace is backed up first, and everything stays where it is.",
    buttons: ["Restart to Update", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0 || !updater) return;
  const r = await updater.install();
  if (!r.ok) await dialog.showMessageBox({ type: "warning", message: "Inroad didn't update.", detail: r.error ?? "" });
}

/** Opening Inroad when you log in, so hooks, the public URL and agents keep reaching it. Only for the installed app. */
function loginItemMenu() {
  if (!app.isPackaged || process.platform !== "darwin") return [];
  return [{ label: "Open at Login", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }) }];
}

function updateMenuItem() {
  const s = updater?.get();
  if (s?.phase === "ready") return { label: `Restart to Update to ${s.latest?.label}…`, click: () => void promptRestart(s) };
  return { label: "Check for Updates…", enabled: !!updater && s?.phase !== "checking" && s?.phase !== "downloading", click: () => void checkForUpdatesFromMenu() };
}

function buildMenu() {
  const mac = process.platform === "darwin";
  /** @type {import("electron").MenuItemConstructorOptions[]} */
  const template = [
    ...(mac
      ? [
          {
            label: PRODUCT,
            submenu: [
              { role: "about" },
              updateMenuItem(),
              { type: "separator" },
              { label: "Settings…", accelerator: "Cmd+,", click: () => goTo("/settings") },
              ...loginItemMenu(),
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }]),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        ...(mac ? [] : [updateMenuItem(), { type: "separator" }]),
        { label: "Open Data Folder", click: () => void shell.openPath(dataDir) },
        { label: "Show Server Log", click: () => shell.showItemInFolder(path.join(logDir, "server.log")) },
        { type: "separator" },
        { label: "Inroad on GitHub", click: () => void shell.openExternal(REPO_URL) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ───────────── Updates ───────────── */

/** Only Inroad's own pages may ask the shell anything. */
function fromInroad(event) {
  const url = event.senderFrame?.url ?? "";
  return sameOrigin(url);
}

/** The backup the server takes before an update (POST /api/update { action: "backup" }). True when it took one. */
function backupBeforeUpdate() {
  return new Promise((resolve, reject) => {
    if (!serverUrl) return reject(new Error("Inroad's server isn't running."));
    const body = JSON.stringify({ action: "backup" });
    const req = http.request(`${serverUrl}/api/update`, { method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) }, timeout: 60_000 }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            return resolve(JSON.parse(text).backup != null);
          } catch {
            return resolve(false);
          }
        }
        let error = `the server answered ${res.statusCode}`;
        try {
          error = JSON.parse(text).error ?? error;
        } catch {
          // not JSON
        }
        reject(new Error(error));
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("the server didn't answer")));
    req.end(body);
  });
}

let menuPhase = "idle";

function startUpdater() {
  // Installs only into the downloaded Mac app; a run from the repository (or a test) can still check.
  const enabled = !app.isPackaged ? "This is a development run of Inroad, so it checks for updates but doesn't install them." : process.platform !== "darwin" ? "Updates install on a Mac." : null;
  const appPath = path.resolve(process.execPath, "..", "..", "..");
  const log = logStream();
  updater = createUpdater({
    current: app.getVersion(),
    arch: process.arch,
    appPath,
    dir: path.join(userData, "Updates"),
    enabled,
    // Chromium's network stack: the Mac's own proxy settings apply, as in Safari.
    fetch: (url, init) => electronNet.fetch(url, init),
    feed: process.env.INROAD_UPDATE_FEED || undefined,
    readState,
    writeState,
    log: (line) => log.write(`[${new Date().toISOString()}] ${line}\n`),
    onChange: (status) => {
      win?.webContents.send("updates:status", status);
      // The menu names the phase ("Restart to Update…"), not the progress.
      if (status.phase !== menuPhase) {
        menuPhase = status.phase;
        buildMenu();
      }
    },
    beforeInstall: backupBeforeUpdate,
    quit: () => app.quit(),
  });
  ipcMain.handle("updates:get", (event) => (fromInroad(event) ? updater?.get() : null));
  ipcMain.handle("updates:check", (event) => (fromInroad(event) ? updater?.check() : null));
  ipcMain.handle("updates:install", (event) => (fromInroad(event) ? updater?.install() : { ok: false, error: "Not allowed." }));
  ipcMain.handle("updates:auto-check", (event, on) => (fromInroad(event) ? updater?.setAutoCheck(on === true) : null));
  updater.start();
}

/**
 * Opened from the disk image or Downloads: offer to move to Applications, where it opens like any app and
 * can replace itself when it updates. True when it's moving (the app relaunches from there).
 * INROAD_SKIP_MOVE_PROMPT=1 skips it for the shell's own tests, which open the app where it was built.
 */
async function offerMoveToApplications() {
  if (!app.isPackaged || process.platform !== "darwin" || app.isInApplicationsFolder() || readState().moveDeclined || process.env.INROAD_SKIP_MOVE_PROMPT === "1") return false;
  const { response, checkboxChecked } = await dialog.showMessageBox({
    type: "question",
    message: "Move Inroad to your Applications folder?",
    detail: "From there it opens like any other app and updates itself in one click. Your work isn't affected.",
    buttons: ["Move to Applications", "Not Now"],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: "Don't ask again",
  });
  if (response !== 0) {
    if (checkboxChecked) writeState({ moveDeclined: true });
    return false;
  }
  try {
    return app.moveToApplicationsFolder();
  } catch (err) {
    await dialog.showMessageBox({ type: "warning", message: "Inroad couldn't move itself.", detail: `${err instanceof Error ? err.message : String(err)}\n\nDrag Inroad into Applications in Finder instead.` });
    return false;
  }
}

/* ───────────── Lifecycle ───────────── */

if (!app.requestSingleInstanceLock()) {
  // Already running: that instance shows its window (second-instance below).
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) void createWindow();
    else {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    app.setAboutPanelOptions({ applicationName: PRODUCT, applicationVersion: app.getVersion(), copyright: "Your AI Head of GTM", website: REPO_URL });
    // The app asks for nothing a page might want (camera, microphone, location, notifications).
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    if (await offerMoveToApplications()) return;
    startUpdater();
    buildMenu();
    const shown = createWindow();
    try {
      await startServer();
      await shown;
      await show(serverUrl);
    } catch (err) {
      await dialog.showMessageBox({
        type: "error",
        message: "Inroad couldn't start.",
        detail: `${err instanceof Error ? err.message : String(err)}\n\nThe log is in ${logDir}.`,
      });
      quitting = true;
      stopServer();
      app.quit();
    }
  });

  // On a Mac the app stays open with no windows, like any Mac app; the Dock icon brings the window back.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (!win && serverUrl) void createWindow();
  });
  app.on("before-quit", () => {
    quitting = true;
    updater?.stop();
    stopServer();
  });
}
