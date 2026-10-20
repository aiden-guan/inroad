import { restHandler } from "@/lib/api-keys/rest";

/** REST mirror of the `complete_action` MCP tool. See /api/v1/openapi.json. */
export const POST = restHandler("complete_action");
