import { readFile } from "node:fs/promises";
import path from "node:path";
import { connection } from "next/server";

/**
 * MapLibre's tile worker, served same-origin. Bundlers rewrite the module URL MapLibre derives its
 * worker from, so the map points here instead (see lead-map.tsx). Read from the installed package,
 * so it always matches the library version.
 */
export async function GET() {
  await connection();
  try {
    const file = path.join(process.cwd(), "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs");
    const body = await readFile(file, "utf8");
    return new Response(body, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=86400" } });
  } catch {
    return new Response("// map worker unavailable", { status: 404, headers: { "content-type": "text/javascript" } });
  }
}
