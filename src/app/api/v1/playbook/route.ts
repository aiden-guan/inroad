import { connection } from "next/server";
import { restHandler } from "@/lib/api-keys/rest";

/** REST mirror of the `get_playbook` MCP tool. See /api/v1/openapi.json. */
const handler = restHandler("get_playbook");

export async function GET(request: Request) {
  await connection();
  return handler(request);
}
