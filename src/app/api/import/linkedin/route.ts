import { z } from "zod";
import { importConnections } from "@/lib/network/import";
import { summarizeBatch, type ImportResponse } from "@/lib/network/types";
import { startRun } from "@/lib/runs/registry";
import { errorResponse, readJSON } from "@/lib/server/http";
import { getWorkflow } from "@/lib/workflows";

const Body = z.object({
  fileName: z.string().max(200),
  text: z.string().min(1).max(8_000_000),
  /** false when the caller starts the `network` run itself (ImportFlow does, to stream its log). */
  screen: z.boolean().optional(),
});

/**
 * LinkedIn Connections.csv: stored locally (connections.json), diffed against the last import for
 * job changes, then screened by the `network` workflow. Names and emails never go to Claude.
 */
export async function POST(request: Request) {
  try {
    const body = Body.parse(await readJSON(request));
    const batch = await importConnections(body);
    const res: ImportResponse = { batch: summarizeBatch(batch) };
    if (body.screen === false) return Response.json(res);
    try {
      res.run = await startRun(getWorkflow("network")!, { reason: "import", importId: batch.id });
    } catch (err) {
      // The import stands even when screening can't start (budget used up, no key).
      res.run = null;
      res.runError = err instanceof Error ? err.message : "Screening couldn't start.";
    }
    return Response.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
