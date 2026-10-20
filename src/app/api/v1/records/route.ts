import { connection } from "next/server";
import { restHandler } from "@/lib/api-keys/rest";

/** REST mirror of the `search_records` MCP tool. See /api/v1/openapi.json. */
const handler = restHandler("search_records");

export async function GET(request: Request) {
  await connection();
  return handler(request);
}
