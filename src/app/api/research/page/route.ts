import { z } from "zod";
import { readResearchPage } from "@/lib/search/pages";
import { errorResponse, readJSON } from "@/lib/server/http";
const Body = z.object({ url: z.string().max(2000), mode: z.enum(["auto", "http", "browser"]).default("auto") });
export async function POST(request: Request) {
  try {
    const input = Body.parse(await readJSON(request));
    return Response.json(await readResearchPage(input.url, { mode: input.mode, signal: request.signal }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, 400);
  }
}
