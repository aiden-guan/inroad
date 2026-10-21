import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Local-date logic (today, week starts, "due on") must not depend on the machine running the tests.
// A zone with DST catches day-math bugs that UTC hides. Set here so every worker process inherits it.
process.env.TZ = "America/Los_Angeles";

const src = fileURLToPath(new URL("./src/", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: src },
      // Next resolves server-only to an empty module on the server; anywhere else it throws on import.
      { find: /^server-only$/, replacement: fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)) },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
