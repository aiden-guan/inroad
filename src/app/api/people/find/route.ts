import { z } from "zod";
import { findPeople, findPeopleNear, peopleDataErrorResponse } from "@/lib/people/directory";
import { errorResponse, readJSON } from "@/lib/server/http";

const Body = z
  .object({
    domain: z.string().trim().toLowerCase().min(3).max(253).optional(),
    /** "New York, NY": people around a place instead of at a company. */
    near: z.string().trim().min(2).max(120).optional(),
    titles: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
  })
  .refine((b) => !!b.domain !== !!b.near, "Send a domain or a place, not both.");

/** Free: who works at a company (or near a place), by title, with masked surnames. */
export async function POST(request: Request) {
  try {
    const { domain, near, titles } = Body.parse(await readJSON(request));
    return Response.json(domain ? await findPeople(domain, titles) : await findPeopleNear(near!, titles));
  } catch (err) {
    return peopleDataErrorResponse(err) ?? errorResponse(err);
  }
}
