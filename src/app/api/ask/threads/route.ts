import { connection } from "next/server";
import type { EntityKind } from "@/lib/domain/types";
import { errorResponse } from "@/lib/server/http";
import { listThreads } from "@/lib/store/threads";

/** Recent Ask threads, newest first. `?context=account:northwind.com` limits them to one record; `none` to the command bar. */
export async function GET(request: Request) {
  await connection();
  try {
    const params = new URL(request.url).searchParams;
    const raw = params.get("context");
    const split = raw ? raw.indexOf(":") : -1;
    const context = raw === "none" ? null : raw && split > 0 ? { kind: raw.slice(0, split) as EntityKind, id: raw.slice(split + 1) } : undefined;
    const limit = Math.min(50, Math.max(1, Number(params.get("limit")) || 20));
    return Response.json({ threads: listThreads({ context, limit }) });
  } catch (err) {
    return errorResponse(err);
  }
}
