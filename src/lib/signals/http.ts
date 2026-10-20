import "server-only";
import { lookup } from "node:dns/promises";
import net from "node:net";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

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

function isPrivateIp(ip: string): boolean {
  return BLOCK.check(ip, net.isIPv4(ip) ? "ipv4" : "ipv6");
}

/**
 * Research URLs can come from outside (agents, webhooks, imports), so never let them reach this
 * machine or the local network (SSRF). Checked on every redirect hop, after DNS resolution.
 */
async function isPublicUrl(raw: string): Promise<boolean> {
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

/** Plain HTTP fetch with a timeout and size cap. Returns null on any failure — signals are best-effort. */
export async function fetchText(
  url: string,
  { timeoutMs = 10_000, maxBytes = 1_500_000, accept = "text/html,application/xhtml+xml" } = {},
): Promise<{ url: string; status: number; body: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = url;
    let res: Response | null = null;
    for (let hop = 0; hop < 6; hop++) {
      if (!(await isPublicUrl(current))) return null;
      res = await fetch(current, {
        headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "en-US,en;q=0.9" },
        redirect: "manual",
        signal: controller.signal,
        cache: "no-store",
      });
      const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!location) break;
      current = new URL(location, current).toString();
      res = null;
    }
    if (!res || !res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      chunks.push(value);
      if (size > maxBytes) {
        await reader.cancel();
        break;
      }
    }
    const body = new TextDecoder().decode(Buffer.concat(chunks));
    return { url: current, status: res.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJSON<T>(url: string, timeoutMs = 10_000): Promise<T | null> {
  const res = await fetchText(url, { timeoutMs, accept: "application/json", maxBytes: 5_000_000 });
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
