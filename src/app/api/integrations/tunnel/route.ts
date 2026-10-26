import { connection } from "next/server";
import { z } from "zod";
import { readHub } from "@/lib/hub/store";
import { errorResponse, readJSON } from "@/lib/server/http";
import { isLocalRequest } from "@/lib/server/local-request";
import { reconcileTunnel, saveNamedTunnel, startTunnel, stopTunnel, tunnelStatus } from "@/lib/server/tunnel";

const Body = z.union([
  z.object({ on: z.boolean() }),
  // Set up (or, with null, forget) a named tunnel: the token Cloudflare shows and the hostname routed to it.
  z.object({ named: z.object({ token: z.string().max(4000), url: z.string().max(300) }).nullable() }),
]);

/** The port this app answers on, from the founder's own request (never a forwarded host). */
function localPort(request: Request): number {
  const own = new URL(request.url);
  const seen = readHub().appUrl;
  const port = own.port || (seen ? new URL(seen).port : "") || "3000";
  return Number(port);
}

/** GET: is cloudflared installed, is the tunnel up, and at which address. */
export async function GET(request: Request) {
  await connection();
  try {
    if (!isLocalRequest(request)) return Response.json({ error: "Only available on the computer running Inroad." }, { status: 403 });
    await reconcileTunnel();
    return Response.json(tunnelStatus(), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST { on }: starts or stops the tunnel (the named one when it's set up, else a quick one). Starting
 * waits until it's reachable. POST { named }: saves or forgets the named tunnel's token and address.
 */
export async function POST(request: Request) {
  try {
    if (!isLocalRequest(request)) return Response.json({ error: "Only available on the computer running Inroad." }, { status: 403 });
    const body = Body.parse(await readJSON(request));
    if ("named" in body) return Response.json(await saveNamedTunnel(body.named), { headers: { "cache-control": "no-store" } });
    const status = body.on ? await startTunnel(localPort(request)) : await stopTunnel({ byFounder: true });
    return Response.json(status, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
