import { z } from "zod";
import { calendarDigest, ignoreCompany } from "@/lib/calendar/sync";
import { errorResponse, readJSON } from "@/lib/server/http";
import { publicWorkspace, readWorkspace } from "@/lib/store/workspace";

const Body = z.object({ domain: z.string().trim().min(3).max(253), undo: z.boolean().optional() });

/** Not a sales meeting: stop asking about this company's domain (or, with undo, ask again). */
export async function POST(request: Request) {
  try {
    const { domain, undo } = Body.parse(await readJSON(request));
    const r = await ignoreCompany(domain, undo);
    if (!r.ok) return Response.json({ error: r.message }, { status: 400 });
    return Response.json({ ok: true, digest: calendarDigest(), workspace: publicWorkspace(readWorkspace()) });
  } catch (err) {
    return errorResponse(err);
  }
}
