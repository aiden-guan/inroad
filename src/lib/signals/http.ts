import "server-only";
import dns from "node:dns";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { Agent, fetch, type Response } from "undici";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

/**
 * What Inroad calls itself to public APIs (SEC, GitHub, Algolia, iTunes). Their usage policies ask
 * automated tools to say what they are instead of posing as a browser.
 */
export const API_UA = "Inroad/0.1 (local-first research tool)";

// Loopback, private, link-local, CGNAT, benchmark, multicast/reserved, and the IPv6 ranges that
// embed or translate IPv4 (NAT64, 6to4, IPv4-compatible). BlockList also matches IPv4-mapped
// IPv6 (::ffff:7f00:1) against the IPv4 subnets, which hand-written prefix checks get wrong.
const BLOCK = new net.BlockList();
for (const [prefix, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
] as const) BLOCK.addSubnet(prefix, bits, "ipv4");
BLOCK.addAddress("::", "ipv6");
BLOCK.addAddress("::1", "ipv6");
for (const [prefix, bits] of [["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["64:ff9b::", 96], ["2002::", 16], ["::", 96]] as const) {
  BLOCK.addSubnet(prefix, bits, "ipv6");
}

export function isPrivateIp(ip: string): boolean {
  return BLOCK.check(ip, net.isIPv4(ip) ? "ipv4" : "ipv6");
}

/**
 * The address the socket actually connects to is checked again here. Without it, a host that
 * resolves to a public IP for the pre-check and to 127.0.0.1 a moment later (DNS rebinding) would
 * get through. IP literals skip lookup; the pre-check covers them, and they can't change.
 */
const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const blocked = !addresses.length || addresses.some((a) => isPrivateIp(a.address));
    if (blocked) return callback(Object.assign(new Error(`${hostname} resolves to a private address`), { code: "EADDRNOTAVAIL" }), []);
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
};

const dispatcher = new Agent({ connect: { lookup: guardedLookup } });

/**
 * Research URLs can come from outside (agents, webhooks, imports), so never let them reach this
 * machine or the local network (SSRF). Checked on every redirect hop, after DNS resolution, and
 * again at connect time by `guardedLookup`.
 */
export async function isPublicUrl(raw: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "80" && url.port !== "443") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || /\.(localhost|local|internal|lan|home|corp|example|test|invalid)$/.test(host)) return false;
  if (net.isIP(host)) return !isPrivateIp(host);
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

interface Fetched {
  url: string;
  status: number;
  contentType: string;
  headers: Pick<Response["headers"], "get">;
  bytes: Buffer;
  /** The body was longer than `maxBytes` and was cut there. */
  truncated: boolean;
}

interface GuardedOptions {
  timeoutMs: number;
  maxBytes: number;
  accept: string;
  /** Extra request headers (an API's User-Agent, a token). */
  headers?: Record<string, string>;
  /** Hand back 4xx/5xx answers too, so a caller can tell a rate limit from a failure. */
  allowErrors?: boolean;
  signal?: AbortSignal;
}

/** The guarded fetch behind fetchText and fetchBytes: public addresses only, on every hop, with a size cap. */
async function fetchGuarded(url: string, { timeoutMs, maxBytes, accept, headers, allowErrors, signal }: GuardedOptions): Promise<Fetched | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = url;
    let extraHeaders = headers;
    let res: Response | null = null;
    for (let hop = 0; hop < 6; hop++) {
      if (!(await isPublicUrl(current))) return null;
      // undici's own fetch (not Next's patched global one, so no data cache) with the guarded dispatcher.
      res = await fetch(current, {
        headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "en-US,en;q=0.9", ...extraHeaders },
        redirect: "manual",
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
        dispatcher,
      });
      const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!location) break;
      await res.body?.cancel();
      const next = new URL(location, current);
      // A public redirect is still another trust boundary: never forward an API token or custom
      // authentication header to a different origin (including an HTTPS → HTTP downgrade).
      if (next.origin !== new URL(current).origin) extraHeaders = undefined;
      current = next.toString();
      res = null;
    }
    if (!res || (!res.ok && !allowErrors)) return null;
    if (!res.body) return allowErrors ? { url: current, status: res.status, contentType: res.headers.get("content-type") ?? "", headers: res.headers, bytes: Buffer.alloc(0), truncated: false } : null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      chunks.push(value);
      if (size > maxBytes) {
        truncated = true;
        await reader.cancel();
        break;
      }
    }
    return { url: current, status: res.status, contentType: res.headers.get("content-type") ?? "", headers: res.headers, bytes: Buffer.concat(chunks), truncated };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Plain HTTP fetch with a timeout and size cap. Returns null on any failure — signals are best-effort.
 * `responseHeaders` names headers to hand back (lowercase), e.g. an API's rate-limit counters.
 */
export async function fetchText(
  url: string,
  {
    timeoutMs = 10_000,
    maxBytes = 1_500_000,
    accept = "text/html,application/xhtml+xml",
    headers,
    allowErrors,
    responseHeaders,
    signal,
  }: { timeoutMs?: number; maxBytes?: number; accept?: string; headers?: Record<string, string>; allowErrors?: boolean; responseHeaders?: string[]; signal?: AbortSignal } = {},
): Promise<{ url: string; status: number; body: string; headers?: Record<string, string> } | null> {
  const res = await fetchGuarded(url, { timeoutMs, maxBytes, accept, headers, allowErrors, signal });
  if (!res) return null;
  const out: { url: string; status: number; body: string; headers?: Record<string, string> } = { url: res.url, status: res.status, body: new TextDecoder().decode(res.bytes) };
  if (responseHeaders?.length) {
    out.headers = {};
    for (const h of responseHeaders) {
      const v = res.headers.get(h);
      if (v !== null) out.headers[h] = v;
    }
  }
  return out;
}

/** A small binary file (an icon), whole or not at all: anything over `maxBytes` is null, never a cut-off file. */
export async function fetchBytes(
  url: string,
  { timeoutMs = 8_000, maxBytes = 200_000, accept = "image/*" } = {},
): Promise<{ url: string; contentType: string; bytes: Buffer } | null> {
  const res = await fetchGuarded(url, { timeoutMs, maxBytes, accept });
  return res && !res.truncated ? { url: res.url, contentType: res.contentType, bytes: res.bytes } : null;
}

export async function fetchJSON<T>(url: string, timeoutMs = 10_000, opts: { headers?: Record<string, string>; maxBytes?: number } = {}): Promise<T | null> {
  const res = await fetchText(url, { timeoutMs, accept: "application/json", maxBytes: opts.maxBytes ?? 5_000_000, headers: opts.headers });
  if (!res) return null;
  try {
    return JSON.parse(res.body) as T;
  } catch {
    return null;
  }
}

/** Normalizes "Acme.com", "https://www.acme.com/about" → "acme.com". */
export function toDomain(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}
