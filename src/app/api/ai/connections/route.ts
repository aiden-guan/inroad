import { z } from "zod";
import { errorResponse, readJSON } from "@/lib/server/http";
import { removeConnection, routingStatus, saveConnection, saveRouting } from "@/lib/ai/connections";

export async function GET() {
  try { return Response.json(routingStatus()); } catch (e) { return errorResponse(e); }
}

export async function POST(request: Request) {
  try {
    const body = z.discriminatedUnion("action", [
      z.object({ action: z.literal("save"), connection: z.unknown() }).strict(),
      z.object({ action: z.literal("routing"), routing: z.unknown() }).strict(),
      z.object({ action: z.literal("remove"), id: z.string().uuid() }).strict(),
    ]).parse(await readJSON(request));
    const result = body.action === "save" ? await saveConnection(body.connection) : body.action === "routing" ? saveRouting(body.routing) : removeConnection(body.id);
    return Response.json(result);
  } catch (e) { return errorResponse(e, 400); }
}
