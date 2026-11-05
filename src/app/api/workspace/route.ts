import { connection } from "next/server";
import { errorResponse, jsonText } from "@/lib/server/http";
import { ensureStarted } from "@/lib/server/startup";
import { ensureDailySnapshot } from "@/lib/store/backup";
import { publicWorkspaceJSON } from "@/lib/store/workspace";

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
  try {
    // Serialized once per save, not once per load (every window focus and finished run reloads it).
    return jsonText(publicWorkspaceJSON(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    // A workspace.json that can't be read: say why in JSON, not an HTML error page the client can't parse.
    return errorResponse(err);
  }
}
