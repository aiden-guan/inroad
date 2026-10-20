import { errorResponse, readJSON } from "@/lib/server/http";
import { startRun } from "@/lib/runs/registry";
import { getWorkflow } from "@/lib/workflows";

/** Starts a workflow. The run continues even if this request (or the tab) goes away. */
export async function POST(request: Request) {
  try {
    const body = await readJSON<{ workflow?: string; args?: unknown }>(request);
    const def = body.workflow ? getWorkflow(body.workflow) : undefined;
    if (!def) return Response.json({ error: `Unknown workflow: ${body.workflow}` }, { status: 404 });
    const run = await startRun(def, body.args ?? {});
    return Response.json({ run });
  } catch (err) {
    return errorResponse(err);
  }
}
