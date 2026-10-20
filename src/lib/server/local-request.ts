/**
 * Is this request from the founder's own machine? Dependency-free so the proxy can use it.
 *
 * Only the real Host header counts: X-Forwarded-Host is client-controlled (a DNS-rebinding page
 * can set it, and tunnels pass it through), so a non-local forwarded host makes the request
 * remote rather than local. Any sign of a tunnel or reverse proxy (Cloudflare, ngrok, RFC 7239
 * Forwarded, a non-loopback client address) also makes it remote.
 */

export const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|::1|0\.0\.0\.0)(:\d+)?$|\.localhost(:\d+)?$/i;
export const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+|localhost)$/i;

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
  return [...entries(h.get("x-forwarded-for")), ...entries(h.get("x-real-ip"))].every((ip) => LOOPBACK.test(ip));
}
