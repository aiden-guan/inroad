import { connection } from "next/server";
import { restHandler } from "@/lib/api-keys/rest";

/** REST mirror of the `get_growth` and `log_growth_week` MCP tools. See /api/v1/openapi.json. */
const read = restHandler("get_growth");

export async function GET(request: Request) {
  await connection();
  return read(request);
}

export const POST = restHandler("log_growth_week");
