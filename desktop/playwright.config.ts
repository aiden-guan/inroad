import { defineConfig } from "@playwright/test";

/** The Mac app's shell (desktop/test). `npm run desktop:test`; on Linux it needs a display (xvfb-run). */
export default defineConfig({
  testDir: "test",
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: process.env.CI ? [["list"]] : "list",
});
