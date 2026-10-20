import { connection } from "next/server";
import { baseUrl } from "@/lib/api-keys/auth";
import { openApiSpec } from "@/lib/api-keys/rest";

/** OpenAPI 3.1 for the REST mirror. Public (it describes the API, it doesn't expose data), so n8n, Zapier and ChatGPT can import it by URL. */
export async function GET(request: Request) {
  await connection();
  return Response.json(openApiSpec(baseUrl(request)), { headers: { "cache-control": "no-store" } });
}
