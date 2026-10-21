import { connection } from "next/server";
import { searchLocation } from "@/lib/geo/geocode";
import { errorResponse } from "@/lib/server/http";

/** The location picker: a city from the built-in list, or a place or venue address from OpenStreetMap. */
export async function GET(request: Request) {
  await connection();
  try {
    const q = new URL(request.url).searchParams.get("q")?.trim().slice(0, 160) ?? "";
    if (q.length < 2) return Response.json({ results: [] });
    return Response.json({ results: await searchLocation(q) });
  } catch (err) {
    return errorResponse(err);
  }
}
