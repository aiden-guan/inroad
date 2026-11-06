import { connection } from "next/server";
import { connectedPosthogProjects } from "@/lib/metrics/sync";
import { errorResponse } from "@/lib/server/http";

export async function GET() {
  await connection();
  try {
    const result = await connectedPosthogProjects();
    return result.ok
      ? Response.json({ projects: result.value }, { headers: { "Cache-Control": "no-store" } })
      : Response.json({ error: result.error.message }, { status: 400 });
  } catch (error) { return errorResponse(error); }
}
