import { connection } from "next/server";
import { restHandler } from "@/lib/api-keys/rest";

/** REST mirror of the `get_next_actions` MCP tool. See /api/v1/openapi.json. */
const handler = restHandler("get_next_actions");

export async function GET(request: Request) {
  await connection();
  return handler(request);
}
