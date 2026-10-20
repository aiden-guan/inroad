import { connection } from "next/server";
import { restHandler } from "@/lib/api-keys/rest";

/** REST mirror of the `get_account` (GET ?domain=) and `add_accounts` (POST) MCP tools. See /api/v1/openapi.json. */
const getAccount = restHandler("get_account");

export async function GET(request: Request) {
  await connection();
  return getAccount(request);
}

export const POST = restHandler("add_accounts");
