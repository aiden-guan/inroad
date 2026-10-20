import { handleMcpPost, mcpMethodNotAllowed } from "@/lib/api-keys/mcp";

/**
 * Inroad's MCP server (Streamable HTTP, stateless). Meta Muse, Claude Code, Claude Desktop, Cursor
 * and any MCP client connect here with `Authorization: Bearer <agent key>`. See src/lib/api-keys.
 */
export async function POST(request: Request) {
  return handleMcpPost(request);
}

export async function GET() {
  return mcpMethodNotAllowed();
}

export async function DELETE() {
  return mcpMethodNotAllowed();
}
