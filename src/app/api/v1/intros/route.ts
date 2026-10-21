import { connection } from "next/server";
import { restHandler } from "@/lib/api-keys/rest";

/** REST mirror of the `list_intros` MCP tool (GET ?include_closed=true). See /api/v1/openapi.json. */
const handler = restHandler("list_intros");

export async function GET(request: Request) {
  await connection();
  return handler(request);
}
