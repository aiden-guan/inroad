import { ResearchInput, researchWeb } from "@/lib/search/research";
import { errorResponse, readJSON } from "@/lib/server/http";
export async function POST(request: Request) {
  try {
    return Response.json(await researchWeb(ResearchInput.parse(await readJSON(request)), request.signal), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, 400);
  }
}
