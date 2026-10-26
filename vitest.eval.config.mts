import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The draft-quality evals (npm run eval:critic, npm run eval:classify). Unlike the test suite they may call the real
// API, so there's no setup file stripping credentials; each eval runs only when a key is set (or EVAL_MOCK=1).
const src = fileURLToPath(new URL("./src/", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: src },
      { find: /^server-only$/, replacement: fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)) },
    ],
  },
  test: {
    environment: "node",
    include: ["scripts/eval-*.ts"],
    testTimeout: 20 * 60_000,
    hookTimeout: 60_000,
    // The report is the point: print it.
    reporters: ["verbose"],
  },
});
