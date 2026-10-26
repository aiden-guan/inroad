import { connection } from "next/server";
import { searchConnections, taggingStart } from "@/lib/network/relationships";
import { errorResponse } from "@/lib/server/http";

/**
 * The founder's connections for tagging, found in code on this machine: ?q= searches names, companies and
 * titles (a handful back); no query returns who's tagged and who probably knows the product. Only the
 * matching few leave connections.json, never the whole file.
 */
export async function GET(request: Request) {
  await connection();
  try {
    const q = new URL(request.url).searchParams.get("q")?.trim().slice(0, 80) ?? "";
    return Response.json(q ? { results: searchConnections(q) } : taggingStart(), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
