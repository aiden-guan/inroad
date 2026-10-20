import { restHandler } from "@/lib/api-keys/rest";

/** REST mirror of the `score_accounts` MCP tool. See /api/v1/openapi.json. */
export const POST = restHandler("score_accounts");
