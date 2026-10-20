import { connection } from "next/server";
import { baseUrl } from "@/lib/api-keys/auth";
import { TOOLS } from "@/lib/api-keys/tools";

/** A map for humans and tools poking at the base URL. */
export async function GET(request: Request) {
  await connection();
  const base = baseUrl(request);
  return Response.json({
    name: "Inroad API",
    auth: "Authorization: Bearer <agent key> (or X-API-Key). Create keys in Inroad → Integrations → AI agents.",
    openapi: `${base}/api/v1/openapi.json`,
    mcp: `${base}/api/mcp`,
    endpoints: TOOLS.map((t) => ({ tool: t.name, method: t.rest.method, url: `${base}/api/v1${t.rest.path}`, scope: t.scope })),
  });
}
