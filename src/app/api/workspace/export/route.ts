import { connection } from "next/server";
import { todayISO } from "@/lib/domain/ids";
import { errorResponse } from "@/lib/server/http";
import { buildBundle } from "@/lib/store/backup";

/**
 * Settings → Data → Download backup: every workspace file in one JSON bundle, restorable here or on
 * another computer. Never the Anthropic key, connector secrets or agent keys (they belong to this machine).
 */
export async function GET() {
  await connection();
  try {
    const bundle = buildBundle("export");
    return new Response(JSON.stringify(bundle, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="inroad-backup-${todayISO()}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
