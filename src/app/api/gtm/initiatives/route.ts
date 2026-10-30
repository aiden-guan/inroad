import { readJSON } from "@/lib/server/http";
import { mutateWorkspace } from "@/lib/store/workspace";
import { createInitiative } from "@/lib/gtm/initiatives";
import { initiativeFailure } from "@/lib/gtm/http";
export async function POST(request: Request) {
  try {
    const body = await readJSON(request);
    let id = "";
    await mutateWorkspace((ws) => { id = createInitiative(ws, body).id; });
    return Response.json({ ok: true, id }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return initiativeFailure(error); }
}
