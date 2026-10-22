import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * End to end against the mock Anthropic API (scripts/mock-anthropic.mjs): `npm run e2e`.
 * Starts the mock and `next dev` on their own ports with a fresh data folder, so it never touches
 * `.data/` and never spends a token, and with outbound DNS off (e2e/offline.cjs), so it reads the
 * same nothing from the web on every machine. Chromium comes from PLAYWRIGHT_BROWSERS_PATH when it's
 * set (a preinstalled browser), else from `npx playwright install chromium`.
 */

const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3301);
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? 4301);
const mockUrl = `http://127.0.0.1:${MOCK_PORT}`;

// A fresh workspace every run: E2E_DATA_DIR (emptied first) or a new temp folder.
const dataDir = process.env.E2E_DATA_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "inroad-e2e-"));
if (process.env.E2E_DATA_DIR && !process.env.E2E_REUSE) fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });

const offline = path.join(__dirname, "e2e", "offline.cjs");
const nodeOptions = [process.env.NODE_OPTIONS, `--require "${offline}"`].filter(Boolean).join(" ");

const preinstalled = process.env.PLAYWRIGHT_BROWSERS_PATH ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, "chromium") : null;
const executablePath = process.env.E2E_CHROMIUM ?? (preinstalled && fs.existsSync(preinstalled) ? preinstalled : undefined);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    // localhost, not 127.0.0.1: the dev server only serves its dev assets to the host it was started for.
    baseURL: `http://localhost:${APP_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: "desktop", testMatch: "first-run.spec.ts", use: { ...devices["Desktop Chrome"] } },
    // The narrowest phone the UI is built for, on the workspace the desktop run built.
    { name: "phone", testMatch: "phone.spec.ts", dependencies: ["desktop"], use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true } },
    // Last: it swaps the workspace for the sample and back (through a backup).
    { name: "sample", testMatch: "sample.spec.ts", dependencies: ["phone"], use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: "node scripts/mock-anthropic.mjs",
      url: `${mockUrl}/__mock/requests`,
      env: { MOCK_PORT: String(MOCK_PORT), MOCK_DELAY: "10" },
      reuseExistingServer: false,
      stdout: "ignore",
    },
    {
      // The launcher, as `npm run dev` runs it: loopback only, with the socket stamp the app requires.
      command: `node scripts/serve.mjs dev -p ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}/welcome`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        ANTHROPIC_BASE_URL: mockUrl,
        ANTHROPIC_API_KEY: "mock",
        FIRECRAWL_API_URL: mockUrl,
        GTM_DATA_DIR: dataDir,
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_OPTIONS: nodeOptions,
      },
    },
  ],
});
