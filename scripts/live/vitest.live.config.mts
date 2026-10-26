import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The live smoke (npm run smoke:live): the tape-backed workflow tests, run once against the real API
 * through the spend-capped proxy in global-setup.ts. One file at a time, generous timeouts. Never in CI.
 * Resolution and setup match vitest.config.mts.
 */

process.env.TZ = "America/Los_Angeles";

const root = fileURLToPath(new URL("../../", import.meta.url));
const src = fileURLToPath(new URL("../../src/", import.meta.url));

export default defineConfig({
  root,
  resolve: {
    alias: [
      { find: /^@\//, replacement: src },
      { find: /^server-only$/, replacement: fileURLToPath(new URL("../../node_modules/server-only/empty.js", import.meta.url)) },
    ],
  },
  test: {
    environment: "node",
    include: ["src/lib/workflows/{foundation,discovery,dossier,compose,ask}.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    globalSetup: ["scripts/live/global-setup.ts"],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 120_000,
    env: { INROAD_TAPES: "live" },
  },
});
