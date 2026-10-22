import { ensureStarted } from "@/lib/server/startup";

/**
 * POST /api/startup: the launcher (scripts/serve.mjs) calls this once Next answers, so the startup work
 * (tightening data-file permissions, bringing a named tunnel back) runs even if nobody opens the app.
 * Local only, like every internal route. Safe to call again: the work runs once per server.
 */
export async function POST() {
  await ensureStarted();
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
