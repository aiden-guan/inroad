/**
 * Is this request from the founder's own machine? Dependency-free so the proxy can use it.
 *
 * Decided by the socket, never by a header a caller wrote. Next.js doesn't hand the socket to the proxy
 * or route handlers, and it keeps a caller's own X-Forwarded-For, so `Host: localhost` plus
 * `X-Forwarded-For: 127.0.0.1` from another device on the same Wi-Fi would otherwise look local.
 * scripts/serve.mjs (npm run dev, npm start) listens on 127.0.0.1 and preloads scripts/peer-guard.cjs,
 * which stamps every request with its socket's real address in `x-inroad-peer`, overwriting anything
 * sent under that name. Started any other way (a bare `next dev` listens on every interface), the real
 * address is unknown and nothing counts as local.
 *
 * On top of a loopback socket: the Host header must be local (DNS rebinding points an attacker's name at
 * 127.0.0.1 but keeps its own Host), and any sign of a tunnel or reverse proxy (Cloudflare, ngrok,
 * RFC 7239 Forwarded, a non-local forwarded host, a non-loopback forwarded client) makes it remote. A
 * tunnel's connector runs on this machine, so its socket is loopback; these headers are how it shows.
 */

export const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|::1|0\.0\.0\.0)(:\d+)?$|\.localhost(:\d+)?$/i;
export const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+|localhost)$/i;

/** Set by scripts/peer-guard.cjs on every request: the address its socket comes from. */
export const PEER_HEADER = "x-inroad-peer";

/** Shown when the server wasn't started by scripts/serve.mjs, so the socket address is unknown. */
export const UNGUARDED =
  "Inroad was started without its launcher, so it can't tell this computer from another device on your network. Stop it and run npm run dev (or npm start).";

/** True when scripts/peer-guard.cjs is loaded in this server, so every request carries its real address. */
export function peerGuarded(): boolean {
  return process.env.INROAD_PEER_GUARD === "1";
}

function entries(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function isLocalRequest(request: Request): boolean {
  const h = request.headers;
  const host = (h.get("host") ?? new URL(request.url).host).trim();
  if (!LOCAL_HOST.test(host)) return false;
  if (h.get("cf-connecting-ip") || h.get("cf-ray") || h.get("forwarded")) return false;
  for (const name of h.keys()) if (name.startsWith("ngrok-")) return false;
  if (!entries(h.get("x-forwarded-host")).every((v) => LOCAL_HOST.test(v))) return false;
  if (![...entries(h.get("x-forwarded-for")), ...entries(h.get("x-real-ip"))].every((ip) => LOOPBACK.test(ip))) return false;
  // The one thing a caller can't write: where the connection actually comes from.
  const peer = h.get(PEER_HEADER)?.trim();
  return peerGuarded() && !!peer && LOOPBACK.test(peer);
}
