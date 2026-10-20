import { restHandler } from "@/lib/api-keys/rest";

/** REST mirror of the `submit_draft` MCP tool. See /api/v1/openapi.json. */
export const POST = restHandler("submit_draft");
