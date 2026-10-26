import { connection } from "next/server";
import { ensureStarted } from "@/lib/server/startup";
import { ensureDailySnapshot } from "@/lib/store/backup";
import { publicWorkspace, readWorkspace } from "@/lib/store/workspace";

export async function GET() {
  await connection();
  // Normally done already: the launcher asks for it at start. Covers a server started another way.
  void ensureStarted();
  // The day's backup, the first time Inroad opens each day. Never in the way of loading the workspace.
  try {
    ensureDailySnapshot();
  } catch (err) {
    console.warn("[backup] Daily backup failed:", err instanceof Error ? err.message : err);
  }
  return Response.json(publicWorkspace(readWorkspace()), { headers: { "Cache-Control": "no-store" } });
}
