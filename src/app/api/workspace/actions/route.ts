import { applyAction, type Action } from "@/lib/domain/actions";
import { afterActions } from "@/lib/hub/after-actions";
import { errorResponse, readJSON } from "@/lib/server/http";
import { mutateWorkspace, publicWorkspace } from "@/lib/store/workspace";
import { sweepStudioFiles } from "@/lib/studio/files";

const FREES_FILES = new Set<Action["type"]>(["studio.visual.remove", "studio.image.remove", "studio.piece.remove"]);

/** Applies founder actions atomically, in order. Returns the new workspace. */
export async function POST(request: Request) {
  try {
    const body = await readJSON<{ actions?: Action[] }>(request);
    const actions = Array.isArray(body.actions) ? body.actions : [];
    if (!actions.length) return Response.json({ error: "No actions." }, { status: 400 });
    const { ws } = await mutateWorkspace((draft) => {
      for (const action of actions) applyAction(draft, action);
    });
    void afterActions(actions, ws);
    if (actions.some((a) => FREES_FILES.has(a.type))) sweepStudioFiles(ws);
    return Response.json(publicWorkspace(ws));
  } catch (err) {
    return errorResponse(err);
  }
}
