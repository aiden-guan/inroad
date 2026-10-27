import { errorResponse, readJSON } from "@/lib/server/http";
import { startRun } from "@/lib/runs/registry";
import { getWorkflow } from "@/lib/workflows";
import { TargetSchema } from "@/lib/ai/connections";
import type { ModelTarget } from "@/lib/ai/routing-types";

/** Starts a workflow. The run continues even if this request (or the tab) goes away. */
export async function POST(request: Request) {
  try {
    const body = await readJSON<{ workflow?: string; args?: unknown; route?: ModelTarget }>(request);
    const def = body.workflow ? getWorkflow(body.workflow) : undefined;
    if (!def) return Response.json({ error: `Unknown workflow: ${body.workflow}` }, { status: 404 });
    const route = body.route === undefined ? undefined : TargetSchema.parse(body.route);
    const run = await startRun(def, body.args ?? {}, { route });
    return Response.json({ run });
  } catch (err) {
    return errorResponse(err);
  }
}
