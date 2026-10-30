import { z } from "zod";
import { readJSON } from "@/lib/server/http";
import { mutateWorkspace } from "@/lib/store/workspace";
import { updateInitiative } from "@/lib/gtm/initiatives";
import { initiativeFailure } from "@/lib/gtm/http";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    z.string().regex(/^gtm_[a-zA-Z0-9_-]+$/).max(100).parse(id);
    const body = await readJSON(request);
    await mutateWorkspace((ws) => { updateInitiative(ws, id, body); });
    return Response.json({ ok: true });
  } catch (error) { return initiativeFailure(error); }
}
