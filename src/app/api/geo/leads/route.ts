import { connection } from "next/server";
import { geocodeLater, placeNow } from "@/lib/geo/geocode";
import { leadPoints } from "@/lib/geo/leads";
import { errorResponse } from "@/lib/server/http";
import { readWorkspace } from "@/lib/store/workspace";

/**
 * Every lead with a place, ready for the map. Known cities resolve instantly; anything else is queued
 * for OpenStreetMap (one a second, cached) and `pending` tells the map to ask again shortly.
 */
export async function GET() {
  await connection();
  try {
    const { points, unresolved } = leadPoints(readWorkspace(), placeNow);
    const pending = geocodeLater(unresolved);
    return Response.json({ points, pending }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
