import { connection } from "next/server";
import { z } from "zod";
import { readHub } from "@/lib/hub/store";
import { errorResponse, readJSON } from "@/lib/server/http";
import { isLocalRequest } from "@/lib/server/local-request";
import { reconcileTunnel, startTunnel, stopTunnel, tunnelStatus } from "@/lib/server/tunnel";

const Body = z.object({ on: z.boolean() });

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

/** POST { on }: starts or stops the quick tunnel. Starting waits until Cloudflare hands out the address. */
export async function POST(request: Request) {
  try {
    if (!isLocalRequest(request)) return Response.json({ error: "Only available on the computer running Inroad." }, { status: 403 });
    const { on } = Body.parse(await readJSON(request));
    const status = on ? await startTunnel(localPort(request)) : await stopTunnel();
    return Response.json(status, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
