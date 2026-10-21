import { z } from "zod";
import { findPeople, peopleDataErrorResponse } from "@/lib/people/directory";
import { errorResponse, readJSON } from "@/lib/server/http";

const Body = z.object({
  domain: z.string().trim().toLowerCase().min(3).max(253),
  titles: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
});

/** Free: who works at a company, by title, with masked surnames. */
export async function POST(request: Request) {
  try {
    const { domain, titles } = Body.parse(await readJSON(request));
    return Response.json(await findPeople(domain, titles));
  } catch (err) {
    return peopleDataErrorResponse(err) ?? errorResponse(err);
  }
}
