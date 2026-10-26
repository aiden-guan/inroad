import { z } from "zod";
import { ActionError } from "@/lib/domain/actions";
import { holdsRealWork, leaveSampleWorkspace, loadSampleWorkspace } from "@/lib/sample/store";
import { errorResponse } from "@/lib/server/http";
import { publicWorkspace } from "@/lib/store/workspace";

const Body = z.object({
  /** Required when the current workspace holds the founder's own work, which the sample replaces. */
  replace: z.boolean().optional(),
});

async function optionalJSON(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ActionError("Request body must be JSON.");
  }
}

/** Replaces the workspace with the Ledgerline sample (and writes its connections.json). Returns the new workspace. */
export async function POST(request: Request) {
  try {
    const { replace } = Body.parse(await optionalJSON(request));
    if (!replace && holdsRealWork()) {
      return Response.json(
        { error: "Loading the sample replaces your workspace. Send { \"replace\": true } to confirm.", code: "would_replace" },
        { status: 409 },
      );
    }
    const ws = await loadSampleWorkspace();
    return Response.json(publicWorkspace(ws), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Leaves the sample: the founder's own workspace comes back if the sample replaced it, else an empty one. */
export async function DELETE() {
  try {
    const { ws, restored } = await leaveSampleWorkspace();
    return Response.json({ workspace: publicWorkspace(ws), restored }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
