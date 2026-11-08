import { z } from "zod";
import { previewResearch, refreshResearch, researchHistory, startResearch } from "@/lib/monid/research";
import { ResearchInput } from "@/lib/monid/types";
import { errorResponse, readJSON } from "@/lib/server/http";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), input: ResearchInput }),
  z.object({ action: z.literal("run"), input: ResearchInput, requestId: z.uuid(), maxCost: z.number().positive().max(5), price: z.record(z.string(), z.unknown()) }),
  z.object({ action: z.literal("refresh"), id: z.uuid() }),
]);

export async function GET() {
  try { return Response.json({ reports: researchHistory() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const body = Body.parse(await readJSON(request));
    const result = body.action === "preview" ? await previewResearch(body.input) : body.action === "run" ? await startResearch(body.input, body.requestId, body.maxCost, body.price) : await refreshResearch(body.id);
    return result.ok
      ? Response.json({ value: result.value }, { headers: { "Cache-Control": "no-store" } })
      : Response.json({ error: result.error.message, code: result.error.code }, { status: 400 });
  } catch (error) { return errorResponse(error); }
}
