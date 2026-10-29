import { connection } from "next/server";
import { restHandler } from "@/lib/api-keys/rest";

/** REST mirror of the `list_plays` MCP tool (GET ?play_id=&limit=). See /api/v1/openapi.json. */
const handler = restHandler("list_plays");

export async function GET(request: Request) {
  await connection();
  return handler(request);
}
