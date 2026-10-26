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
 * - Quitting stops the server; a server that dies is said in plain words, with its log.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- Electron loads its main process as CommonJS */
const { app, BrowserWindow, Menu, dialog, nativeTheme, session, shell, utilityProcess } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

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
let quitting = false;
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
  server.once("exit", (code) => {
    log.write(`[${new Date().toISOString()}] Server exited (${code})\n`);
    server = null;
    if (!quitting) void serverDied(code);
  });
  // 127.0.0.1, not localhost: on a Mac localhost can resolve to ::1 first, where nothing listens.
  const url = `http://${HOST}:${port}`;
  await waitForServer(url, 90_000);
  serverUrl = url;
}

async function serverDied(code) {
  const { response } = await dialog.showMessageBox({
    type: "error",
    message: "Inroad stopped working.",
    detail: `Its server quit unexpectedly (code ${code}). Your work is saved in ${dataDir}. Restart Inroad to pick up where you left off; the log may say why.`,
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
              { type: "separator" },
              { label: "Settings…", accelerator: "Cmd+,", click: () => goTo("/settings") },
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
        { label: "Open Data Folder", click: () => void shell.openPath(dataDir) },
        { label: "Show Server Log", click: () => shell.showItemInFolder(path.join(logDir, "server.log")) },
        { type: "separator" },
        { label: "Inroad on GitHub", click: () => void shell.openExternal(REPO_URL) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
    stopServer();
  });
}
