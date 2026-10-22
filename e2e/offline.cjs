/**
 * Preloaded into `next dev` by playwright.config.ts (NODE_OPTIONS --require). Every hostname except
 * localhost fails to resolve, so the end-to-end run reads no real website, job board or news feed and
 * sees what a machine with no network sees, wherever it runs (CI runners have a network). The mock
 * Anthropic API is reached by IP, which needs no lookup. Loaded before any app code, so whatever
 * captures `lookup` later captures this one.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS preload, loaded with --require */
const dns = require("node:dns");
const net = require("node:net");
const { syncBuiltinESMExports } = require("node:module");

const allowed = (host) => net.isIP(host) !== 0 || host === "localhost" || host.endsWith(".localhost");

function offline(host) {
  return Object.assign(new Error(`getaddrinfo ENOTFOUND ${host} (the e2e run is offline)`), { code: "ENOTFOUND", syscall: "getaddrinfo", hostname: host });
}

const lookup = dns.lookup;
dns.lookup = function offlineLookup(host, options, callback) {
  if (allowed(String(host))) return lookup.apply(this, arguments);
  process.nextTick(typeof options === "function" ? options : callback, offline(host));
};

const promises = dns.promises;
const lookupAsync = promises.lookup;
promises.lookup = (host, options) => (allowed(String(host)) ? lookupAsync.call(promises, host, options) : Promise.reject(offline(host)));

syncBuiltinESMExports();
