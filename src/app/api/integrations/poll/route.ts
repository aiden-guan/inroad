import { z } from "zod";
import { pollConnectors } from "@/lib/hub/poll";
import { pollMetrics } from "@/lib/metrics/sync";
import { pollSearchMetrics } from "@/lib/metrics/search-sync";
import { syncWaitlist } from "@/lib/waitlist/sync";
import { errorResponse, readJSON } from "@/lib/server/http";

const Body = z.object({ force: z.boolean().optional() });

/**
 * Reads replies, bounces and CRM changes from connected tools that no webhook can reach. The
 * client calls it on a timer while the app is open; each connector keeps its own cadence, so most
 * calls do nothing. Zero tokens.
 */
export async function POST(request: Request) {
  try {
    const raw = await readJSON(request).catch(() => ({}));
    const body = Body.parse(raw ?? {});
    const [connectors, metrics, search, waitlist] = await Promise.all([pollConnectors({ force: body.force }), pollMetrics(), pollSearchMetrics(), syncWaitlist(false)]);
    const results = [...connectors, ...metrics, ...search, ...(waitlist ? [waitlist] : [])];
    return Response.json({ results, changed: results.some((r) => r.changed) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
