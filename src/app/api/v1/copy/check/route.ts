import { restHandler } from "@/lib/api-keys/rest";

/** REST mirror of the `check_copy` MCP tool. See /api/v1/openapi.json. */
export const POST = restHandler("check_copy");
