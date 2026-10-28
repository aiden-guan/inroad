import { connection } from "next/server";
import { errorResponse } from "@/lib/server/http";
import { claudePlanStatus, connectClaudePlan, disconnectClaudePlan } from "@/lib/studio/claude-plan";

/** Local-only, same-origin connection management is enforced by proxy.ts. */
export async function GET() {
  await connection();
  try { return Response.json(await claudePlanStatus()); } catch (error) { return errorResponse(error); }
}
export async function POST() {
  await connection();
  try { return Response.json(await connectClaudePlan()); } catch (error) { return errorResponse(error); }
}
export async function DELETE() {
  await connection();
  try { await disconnectClaudePlan(); return Response.json({ available: true, connected: false }); } catch (error) { return errorResponse(error); }
}
