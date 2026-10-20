import "server-only";
import { rateLimit, verifyToken, type ApiKey } from "./store";

/**
 * Request plumbing shared by /api/mcp and /api/v1: bearer (or X-API-Key) auth, per-key rate
 * limits, and the origin the app is reachable at (for review links).
 */

export function tokenFrom(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  if (m) return m[1];
  return request.headers.get("x-api-key")?.trim() || null;
}

export type AuthResult = { ok: true; key: ApiKey } | { ok: false; status: 401 | 429; message: string; retryAfter?: number };

export function authorize(request: Request): AuthResult {
  const token = tokenFrom(request);
  if (!token) return { ok: false, status: 401, message: "Missing API key. Send Authorization: Bearer <your Inroad agent key>." };
  const key = verifyToken(token);
  if (!key) return { ok: false, status: 401, message: "That agent key isn't valid or was revoked. Create a new one in Inroad → Integrations → AI agents." };
  const wait = rateLimit(key.id);
  if (wait) return { ok: false, status: 429, message: `Too many requests for this key. Retry in ${wait}s.`, retryAfter: wait };
  return { ok: true, key };
}

/** The address callers used to reach us (a tunnel's public URL when there is one). */
export function baseUrl(request: Request): string {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? request.headers.get("host") ?? url.host;
  return `${proto || url.protocol.replace(":", "")}://${host}`;
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|::1|0\.0\.0\.0)(:\d+)?$|\.localhost(:\d+)?$/i;

/**
 * Where the founder opens Inroad, for review links in tool results. Pages only load on this computer,
 * so a call through a tunnel still gets a localhost link (the tunnel name would answer 403).
 */
export function appOrigin(request: Request): string {
  const b = baseUrl(request);
  return LOCAL_HOST.test(new URL(b).host) ? b : `http://localhost:${process.env.PORT ?? 3000}`;
}
const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+|localhost)$/i;

/**
 * Key management is for the founder at this machine only. Through a tunnel the Host header is the
 * public name and the proxy adds the caller's address, so creating or revoking keys from the
 * internet is refused. (Forwarded-host headers are ignored: a caller can set those.)
 */
export function isLocalRequest(request: Request): boolean {
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (!LOCAL_HOST.test(host.trim())) return false;
  if (request.headers.get("cf-connecting-ip") || request.headers.get("cf-ray") || request.headers.get("ngrok-trace-id")) return false;
  const chain = [request.headers.get("x-forwarded-for"), request.headers.get("x-real-ip")]
    .filter(Boolean)
    .flatMap((v) => v!.split(","))
    .map((v) => v.trim())
    .filter(Boolean);
  return chain.every((ip) => LOOPBACK.test(ip));
}

export const LOCAL_ONLY = "Agent keys can only be managed from Inroad on this computer (localhost).";
