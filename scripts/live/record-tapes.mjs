#!/usr/bin/env node
/**
 * Re-records the workflow tests' Anthropic tapes (src/test/fixtures/anthropic/*.json) from the mock.
 * Run it after changing a workflow's prompts or tools, or the mock's playbooks, then commit the tapes.
 *
 *   npm run tapes:record              # every workflow test
 *   npm run tapes:record -- dossier   # only files matching "dossier"
 */
import { spawnSync } from "node:child_process";

const filters = process.argv.slice(2);
const args = ["vitest", "run", ...(filters.length ? filters.map((f) => `src/lib/workflows/${f}`) : ["src/lib/workflows"])];
const r = spawnSync("npx", args, { stdio: "inherit", env: { ...process.env, INROAD_TAPES: "record" }, shell: process.platform === "win32" });
process.exit(r.status ?? 1);
