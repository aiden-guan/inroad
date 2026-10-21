import { z } from "zod";
import { findWorkEmail, peopleDataErrorResponse } from "@/lib/people/directory";
import { errorResponse, readJSON } from "@/lib/server/http";
import { publicWorkspace, readWorkspace } from "@/lib/store/workspace";

const Body = z.object({ personId: z.string().trim().min(1).max(64) });

/** Paid only when found: a work email for someone already on file. */
export async function POST(request: Request) {
  try {
    const { personId } = Body.parse(await readJSON(request));
    const out = await findWorkEmail(personId);
    return Response.json({ ...out, workspace: publicWorkspace(readWorkspace()) });
  } catch (err) {
    return peopleDataErrorResponse(err) ?? errorResponse(err);
  }
}
