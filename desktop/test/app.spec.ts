import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";

/**
 * The Mac app's shell, driven for real: it starts its own server, shows Inroad in a window, keeps the window on
 * Inroad (links that leave open in the browser), keeps its port between launches, and stops the server on quit.
 *
 * Runs the repository's shell (`npm run desktop:test`, after `npm run desktop:server`), or a packaged app when
 * INROAD_DESKTOP_APP names its executable (CI: Inroad.app/Contents/MacOS/Inroad).
 */

const root = path.resolve(__dirname, "..", "..");
const packaged = process.env.INROAD_DESKTOP_APP;
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "inroad-desktop-"));

async function launch(): Promise<ElectronApplication> {
  // Root in a container needs --no-sandbox; a Mac never does.
  const args = [...(packaged ? [] : [path.join(root, "desktop", "app")]), ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])];
  return electron.launch({
    ...(packaged ? { executablePath: packaged } : {}),
    args,
    env: { ...process.env, INROAD_DESKTOP_USER_DATA: userData, INROAD_KEYCHAIN: "off" },
    timeout: 120_000,
  });
}

const portFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });

test.afterAll(() => fs.rmSync(userData, { recursive: true, force: true }));

test("opens Inroad in its own window, on its own server, with its data in the app's folder", async () => {
  const app = await launch();
  const page = await app.firstWindow();
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/welcome$/, { timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "Let’s find your first customers." })).toBeVisible();
  expect(await page.title()).toMatch(/Inroad/);

  const state = JSON.parse(fs.readFileSync(path.join(userData, "desktop.json"), "utf8"));
  expect(new URL(page.url()).port).toBe(String(state.port));
  expect(fs.existsSync(path.join(userData, "Workspace"))).toBe(true);
  expect(fs.readFileSync(path.join(userData, "Logs", "server.log"), "utf8")).toMatch(/Starting Inroad/);

  // The page is a plain web page: no Node.js in it.
  expect(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe("undefined");
  await app.close();
});

test("sends links that leave Inroad to the browser, and never navigates the window away", async () => {
  const app = await launch();
  const page = await app.firstWindow();
  await expect(page).toHaveURL(/\/welcome$/, { timeout: 120_000 });
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as unknown as { __opened: string[] }).__opened = opened;
    shell.openExternal = async (url: string) => void opened.push(url);
  });
  const opened = () => app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened);
  // What the window really shows, from Electron (Playwright's own URL goes blank after a navigation the app cancels).
  const shown = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.getURL()));

  await page.evaluate(() => window.open("https://example.com/new-tab", "_blank"));
  await expect.poll(opened).toContain("https://example.com/new-tab");
  await page.evaluate(() => {
    location.href = "https://example.com/same-tab";
  });
  await expect.poll(opened).toContain("https://example.com/same-tab");
  expect(await shown()).toEqual([expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/welcome$/)]);

  // Inroad's own pages stay in the window.
  await page.evaluate(() => window.open("/settings", "_blank"));
  await expect.poll(shown).toEqual([expect.stringMatching(/\/settings$/)]);
  expect(app.windows()).toHaveLength(1);
  await app.close();
});

test("keeps its port between launches, and stops its server on quit", async () => {
  const first = await launch();
  const page = await first.firstWindow();
  await expect(page).toHaveURL(/\/welcome$/, { timeout: 120_000 });
  const port = Number(new URL(page.url()).port);
  await first.close();
  await expect.poll(() => portFree(port), { timeout: 20_000 }).toBe(true);

  const second = await launch();
  const again = await second.firstWindow();
  await expect(again).toHaveURL(/\/welcome$/, { timeout: 120_000 });
  expect(Number(new URL(again.url()).port)).toBe(port);
  await second.close();
});
