import { z } from "zod";
import { activeSearch, searchWeb } from "@/lib/search/search";
import { errorResponse, readJSON } from "@/lib/server/http";

const Body = z.object({ query: z.string().trim().min(1).max(128) });

/** Local-only, like the rest of Settings. Testing makes one request to the saved search provider. */
export async function POST(request: Request) {
  try {
    const { query } = Body.parse(await readJSON(request));
    const provider = activeSearch();
    if (!provider) return Response.json({ error: "Save a search provider and its key first." }, { status: 400 });
    const result = await searchWeb(provider, query, 3);
    if (!result.ok) return Response.json({ error: result.error.message }, { status: 400 });
    return Response.json({ provider: provider.name, results: result.value }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
