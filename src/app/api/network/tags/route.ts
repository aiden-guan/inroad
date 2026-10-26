import { z } from "zod";
import { setRelationshipTags } from "@/lib/network/relationships";
import { errorResponse, readJSON } from "@/lib/server/http";

const Body = z.object({
  connectionId: z.string().max(64).optional(),
  personId: z.string().max(64).optional(),
  tags: z.array(z.string().max(32)).max(8),
});

/** One person's relationship tags (design partner, past user, ex-colleague, investor, connector). Replaces what was there. */
export async function POST(request: Request) {
  try {
    const body = Body.parse(await readJSON(request));
    return Response.json(await setRelationshipTags(body));
  } catch (err) {
    return errorResponse(err);
  }
}
