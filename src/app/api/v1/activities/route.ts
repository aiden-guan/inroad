import { restHandler } from "@/lib/api-keys/rest";

/** REST mirror of the `log_activity` MCP tool. See /api/v1/openapi.json. */
export const POST = restHandler("log_activity");
