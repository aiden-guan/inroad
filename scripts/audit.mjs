#!/usr/bin/env node
/**
 * CI's dependency audit: `node scripts/audit.mjs`.
 *
 * Fails on any moderate or worse advisory, like `npm audit --audit-level=moderate`, except the ones listed in
 * EXEMPT below. An exemption covers development tooling only: the same advisory in the production tree
 * (`npm audit --omit=dev`) still fails, and so does an exemption past its expiry date, so each one gets looked
 * at again instead of staying forever.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Advisories accepted for now, each with why and until when. */
export const EXEMPT = [
  {
    id: "GHSA-g3hv-75wg-m249",
    why:
      "minimatch < 11.0.1 (denial of service via globparts amplification) reaches only dev and build tools: " +
      "ESLint and its plugins, electron-builder, glob/rimraf. They match the repository's own patterns, not " +
      "untrusted input. The only fix is minimatch 11, whose named exports break the ESLint 9 plugins that call " +
      "require('minimatch') as a function; nothing that ships depends on minimatch.",
    until: "2026-12-31",
  },
];

const SEVERE = new Set(["moderate", "high", "critical"]);

/** Every advisory in an `npm audit --json` report at moderate or worse: [{ id, title, severity }]. */
export function advisories(report) {
  const found = new Map();
  for (const vuln of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== "object" || !SEVERE.has(via.severity)) continue;
      const id = /GHSA-[\w-]+/.exec(via.url ?? "")?.[0] ?? `npm-${via.source}`;
      found.set(id, { id, title: via.title, severity: via.severity });
    }
  }
  return [...found.values()];
}

/** Why the audit fails, one line per reason; empty when it passes. `today` is YYYY-MM-DD. */
export function auditFailures(full, production, exempt, today) {
  const live = new Map(exempt.filter((e) => e.until >= today).map((e) => [e.id, e]));
  const failures = [];
  for (const e of exempt) if (e.until < today) failures.push(`${e.id}: exemption expired on ${e.until}; look at it again`);
  for (const a of advisories(production)) failures.push(`${a.id} (${a.severity}) in production dependencies: ${a.title}`);
  for (const a of advisories(full)) if (!live.has(a.id)) failures.push(`${a.id} (${a.severity}): ${a.title}`);
  return [...new Set(failures)];
}

function audit(root, args) {
  // npm audit exits 1 when it finds anything; the JSON on stdout is the answer either way.
  const run = spawnSync("npm", ["audit", "--json", ...args], { cwd: root, encoding: "utf8", shell: process.platform === "win32" });
  try {
    return JSON.parse(run.stdout);
  } catch {
    throw new Error(`npm audit ${args.join(" ")} gave no report:\n${run.stderr}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const today = new Date().toISOString().slice(0, 10);
  const failures = auditFailures(audit(root, []), audit(root, ["--omit=dev"]), EXEMPT, today);
  for (const e of EXEMPT.filter((x) => x.until >= today)) console.log(`Exempt until ${e.until}: ${e.id}. ${e.why}`);
  if (failures.length) {
    console.error(`Dependency audit failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log("Dependency audit passed.");
}
