import { startRun } from "@/lib/runs/registry";
import { errorResponse, readJSON } from "@/lib/server/http";
import compose from "@/lib/workflows/compose";

/**
 * POST /api/compose — starts the compose workflow (W5) and returns the run right away.
 * Body: { domain, personId?, angleId?, mode?: "cold"|"follow_up"|"linkedin"|"warm_intro"|"reply",
 *         replyText?, receivedAt?, connectorId?, packageId?, alternate?, referredBy? }
 * Stream progress from /api/runs/{id}/stream; the result is { drafts, packageId, alternateIndex?, suppress? }.
 * Same as POST /api/runs { workflow: "compose", args }, kept as a stable entry point for other tools.
 */
export async function POST(request: Request) {
  try {
    const args = await readJSON(request);
    const run = await startRun(compose, args);
    return Response.json({ run });
  } catch (err) {
    return errorResponse(err);
  }
}
