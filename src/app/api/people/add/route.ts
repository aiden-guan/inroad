import { z } from "zod";
import { addPerson, peopleDataErrorResponse } from "@/lib/people/directory";
import { errorResponse, readJSON } from "@/lib/server/http";
import { publicWorkspace, readWorkspace } from "@/lib/store/workspace";

const Body = z.object({
  domain: z.string().trim().toLowerCase().min(3).max(253),
  id: z.string().trim().min(1).max(64),
});

/** Paid on a match: reveals a search hit (name, LinkedIn, work email) and files it on the company. */
export async function POST(request: Request) {
  try {
    const { domain, id } = Body.parse(await readJSON(request));
    const out = await addPerson(domain, id);
    return Response.json({ ...out, workspace: publicWorkspace(readWorkspace()) });
  } catch (err) {
    return peopleDataErrorResponse(err) ?? errorResponse(err);
  }
}
