import { z } from "zod";
import { rotateSecret } from "@/lib/hub/secrets";
import { errorResponse, readJSON } from "@/lib/server/http";

const Body = z.object({ which: z.enum(["inbound", "signing"]) });

/** Rotates the inbound URL token or the outbound signing secret. Old values stop working at once. */
export async function POST(request: Request) {
  try {
    const { which } = Body.parse(await readJSON(request));
    const secret = rotateSecret(which);
    return Response.json({ ok: true, which, secret });
  } catch (err) {
    return errorResponse(err);
  }
}
