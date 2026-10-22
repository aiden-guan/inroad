import { z } from "zod";
import { addKnownUsers } from "@/lib/customers/add-known";
import { errorResponse, readJSON } from "@/lib/server/http";

const Body = z.object({
  users: z
    .array(z.object({ name: z.string().min(1).max(80), domain: z.string().max(253).optional(), person: z.string().max(80).optional() }))
    .min(1)
    .max(10),
  kind: z.enum(["design_partner", "past_user"]),
});

/** The founder's own users and design partners, added as customers in one click. */
export async function POST(request: Request) {
  try {
    const body = Body.parse(await readJSON(request));
    return Response.json(await addKnownUsers(body));
  } catch (err) {
    return errorResponse(err);
  }
}
