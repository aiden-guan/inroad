#!/usr/bin/env node
/**
 * Starts Inroad: `npm run dev`, `npm start` and `npm run dev:mock` all come through here.
 *
 *   node scripts/serve.mjs dev            # next dev on http://localhost:3000
 *   node scripts/serve.mjs start          # next start (after `npm run build`)
 *   node scripts/serve.mjs dev --mock     # against the mock Anthropic API, with its own data folder
 *   node scripts/serve.mjs dev -p 3301    # any other next option passes through
 *
 * - Listens on 127.0.0.1 only, so other devices on the network can't connect at all. INROAD_HOST (or -H)
 *   changes that, for a VM or a container; the app still refuses every page and internal API from
 *   anywhere but this computer.
 * - Preloads scripts/peer-guard.cjs, which stamps each request with its socket's real address. Without
 *   it the app can't tell this computer from a caller who claims to be it, so it refuses everything.
 * - Once Next answers, asks it to run its startup work (POST /api/startup): tighten data-file permissions
 *   and bring a named tunnel back, so hook and MCP URLs work again even if nobody opens the app.
 * - `--mock` points Anthropic and Firecrawl at the mock (`npm run mock:anthropic`, MOCK_PORT or 4010),
 *   keeps its data in .data-mock (GTM_DATA_DIR to change) and serves on 3100.
 *
 * Plain Node, no shell syntax, so it runs the same in cmd, PowerShell, bash and zsh.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchPlan } from "./launch-plan.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

const plan = launchPlan(process.argv.slice(2), process.env, path.join(here, "peer-guard.cjs"));
if (plan.error) {
  console.error(plan.error);
  process.exit(2);
}
const { port, local } = plan;

if (plan.exposed) {
  console.warn(
    `[inroad] Listening on ${plan.host}, so other devices on your network can connect. They still get "only available on the computer it runs on" for every page and internal API.`,
  );
}

const next = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [next, ...plan.args], { stdio: "inherit", env: plan.env });

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

// Startup work, as soon as the server answers (dev compiles on the first request, so allow a while).
(async () => {
  for (let i = 0; i < 240 && child.exitCode === null; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(`http://${local}:${port}/api/startup`, { method: "POST" });
      if (res.ok || res.status === 403) return;
    } catch {
      // not listening yet
    }
  }
})();

child.on("exit", (code, signal) => process.exit(code ?? (signal ? 128 + ({ SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }[signal] ?? 0) : 0)));
