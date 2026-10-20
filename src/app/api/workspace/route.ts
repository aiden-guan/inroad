import { connection } from "next/server";
import { publicWorkspace, readWorkspace } from "@/lib/store/workspace";

export async function GET() {
  await connection();
  return Response.json(publicWorkspace(readWorkspace()), { headers: { "Cache-Control": "no-store" } });
}
