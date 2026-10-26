import { NextResponse, type NextRequest } from "next/server";
import { isLocalRequest, peerGuarded, UNGUARDED } from "@/lib/server/local-request";

/**
 * Inroad runs on the founder's machine, so the browser is the attack surface:
 *  - Any website the founder visits can fire cross-site POSTs at localhost (e.g. add an outbound
 *    webhook to exfiltrate data, or swap the API key). State-changing requests must come from
 *    Inroad's own origin.
 *  - DNS rebinding can point an attacker's hostname at 127.0.0.1. The app and its internal API
 *    only answer requests addressed to a local host.
 *  - A tunnel (for Meta Muse, Zapier, inbound webhooks) exposes the port publicly. Only the
 *    endpoints that authenticate every request themselves (MCP, REST v1 with bearer keys,
 *    inbound webhooks with a secret in the path) are reachable through it.
 *  - X-Forwarded-Host is client-controlled, so locality is decided by the real Host header and
 *    the absence of tunnel/forwarding headers (see isLocalRequest), never by a forwarded host.
 *  - Another device on the same network can write any header it likes, so a request is local only
 *    when its socket is: the launcher (scripts/serve.mjs) stamps the real address on every request.
 *    Started without it, the app refuses everything but the agent endpoints and says how to fix it.
 */

const AGENT_ROUTES = /^\/api\/(mcp$|v1(\/|$)|hooks\/)/;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

let warned = false;
function warnUnguarded() {
  if (warned) return;
  warned = true;
  console.warn(`[inroad] ${UNGUARDED}`);
}

function hostOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = (request.headers.get("host") ?? "").trim();
  const isLocal = isLocalRequest(request);

  // Agent endpoints authenticate every call with a bearer key or path secret; they may be public.
  if (AGENT_ROUTES.test(pathname)) return NextResponse.next();

  if (!peerGuarded()) {
    warnUnguarded();
    return pathname.startsWith("/api/")
      ? NextResponse.json({ error: UNGUARDED }, { status: 403 })
      : new NextResponse(UNGUARDED, { status: 403, headers: { "content-type": "text/plain" } });
  }

  if (!isLocal) {
    return pathname.startsWith("/api/")
      ? NextResponse.json({ error: "This endpoint is only available on the computer running Inroad." }, { status: 403 })
      : new NextResponse("Inroad is only available on the computer it runs on.", { status: 403, headers: { "content-type": "text/plain" } });
  }

  // Another site can't read the API either: an <img> or a fetch from a page the founder has open would
  // otherwise tell it what's here (a near-instant /api/favicon answer means that company is on the list)
  // and make Inroad fetch for it. Inroad's own pages are same-origin; a URL typed in the address bar is "none".
  if (pathname.startsWith("/api/") && SAFE_METHODS.has(request.method)) {
    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite === "cross-site" || fetchSite === "same-site") {
      return NextResponse.json({ error: "Other sites can't read your workspace." }, { status: 403 });
    }
  }

  if (pathname.startsWith("/api/") && !SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    const sameOrigin = origin ? hostOf(origin) === host : fetchSite === null || fetchSite === "same-origin" || fetchSite === "none";
    if (!sameOrigin || fetchSite === "cross-site") {
      return NextResponse.json({ error: "Cross-site requests can't change your workspace." }, { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
