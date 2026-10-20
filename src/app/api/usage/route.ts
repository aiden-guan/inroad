import { connection } from "next/server";
import { ROUTING, usageReport } from "@/components/settings/usage-model";
import { readWorkspace } from "@/lib/store/workspace";

/**
 * This month's AI spend, budget, spend by workflow and model, free lookups, cache share and recent
 * receipts. Read-only, computed in code. Other tools and agents plugged into Inroad can poll it to
 * respect the founder's budget before asking for work.
 */
export async function GET(request: Request) {
  await connection();
  const limit = Math.min(200, Math.max(0, Number(new URL(request.url).searchParams.get("runs") ?? 20) || 0));
  const report = usageReport(readWorkspace());
  return Response.json(
    {
      ...report,
      recent: report.recent.slice(0, limit),
      routing: ROUTING,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
