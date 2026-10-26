#!/usr/bin/env node
/**
 * Live smoke: runs the workflow tests once against the real Anthropic API (foundation with the first
 * discovery, discovery with its search fallback, two dossiers, a cold draft with the critic, a reply,
 * and a two-turn Ask thread) and checks what the offline suite can't: compat mode never triggers,
 * every run that needs a submit tool ends with one, no response is cut off at max_tokens, the second
 * Ask turn reads the cache, and every receipt costs what the responses' usage says.
 *
 * A hard spend cap (default $3, about $1–1.50 in practice) is enforced by a proxy that refuses any
 * request whose worst case would cross it. Not part of CI.
 *
 *   INROAD_LIVE=1 ANTHROPIC_API_KEY=sk-ant-… npm run smoke:live
 *   INROAD_LIVE=1 … npm run smoke:live -- --record     # also save the responses as tapes (fixtures/anthropic/live)
 *   INROAD_LIVE=1 … npm run smoke:live -- --cap 1.5    # a tighter cap, in USD
 *   npm run smoke:live -- --mock                       # the same run against the mock, free (checks the script)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const mock = flag("mock");
if (!mock && process.env.INROAD_LIVE !== "1") {
  console.error("This spends real money on the Anthropic API. Set INROAD_LIVE=1 to confirm (or pass --mock to try it free).");
  process.exit(2);
}
if (!mock && !process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY to the key to test with.");
  process.exit(2);
}
const cap = value("cap") ?? process.env.INROAD_SMOKE_CAP_USD ?? "3";
if (!(Number(cap) > 0)) {
  console.error(`--cap must be a dollar amount, got "${cap}".`);
  process.exit(2);
}

const env = {
  ...process.env,
  INROAD_SMOKE_CAP_USD: cap,
  INROAD_RECORD: flag("record") ? "1" : (process.env.INROAD_RECORD ?? ""),
  // The main process imports app modules for pricing; keep it away from the founder's .data/.
  GTM_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "inroad-smoke-")),
  ...(mock ? { INROAD_SMOKE_UPSTREAM: "mock" } : {}),
};
const r = spawnSync("npx", ["vitest", "run", "--config", "scripts/live/vitest.live.config.mts"], { stdio: "inherit", env, shell: process.platform === "win32" });
fs.rmSync(env.GTM_DATA_DIR, { recursive: true, force: true });
process.exit(r.status ?? 1);
