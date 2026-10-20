import { resetToEmptyWorkspace } from "@/lib/sample/store";
import { errorResponse } from "@/lib/server/http";
import { publicWorkspace } from "@/lib/store/workspace";

/**
 * Starts over with an empty workspace. Keeps settings.json and secrets.json (the API key and connector
 * keys belong to this machine, not to the workspace). Returns the new workspace.
 */
export async function POST() {
  try {
    const ws = await resetToEmptyWorkspace();
    return Response.json(publicWorkspace(ws), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
