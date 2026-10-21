import { connection } from "next/server";
import { restHandler } from "@/lib/api-keys/rest";

/** REST mirror of the `find_warm_paths` MCP tool (GET ?domain=). See /api/v1/openapi.json. */
const handler = restHandler("find_warm_paths");

export async function GET(request: Request) {
  await connection();
  return handler(request);
}
