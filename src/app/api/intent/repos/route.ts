import { connection } from "next/server";
import { intentMockBase } from "@/lib/intent/http";
import { repoSuggestions } from "@/lib/intent/radar";
import { sampleRepoSuggestions } from "@/lib/sample/intent";
import { errorResponse } from "@/lib/server/http";
import { readWorkspace } from "@/lib/store/workspace";

/**
 * GET /api/intent/repos: repositories worth putting on the developer radar, from the competitors in the playbook.
 * Free: a few GitHub lookups, cached for a week. The sample answers with its own fictional repos.
 */
export async function GET() {
  await connection();
  try {
    const ws = readWorkspace();
    if (ws.sample && !intentMockBase()) return Response.json({ suggestions: sampleRepoSuggestions() }, { headers: { "Cache-Control": "no-store" } });
    return Response.json({ suggestions: await repoSuggestions(ws) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
