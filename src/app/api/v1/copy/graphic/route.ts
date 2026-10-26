import { restHandler } from "@/lib/api-keys/rest";

/** REST mirror of the `check_graphic` MCP tool. See /api/v1/openapi.json. */
export const POST = restHandler("check_graphic");
