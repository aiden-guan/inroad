import "server-only";
import { ZodError } from "zod";
import { ActionError } from "@/lib/domain/actions";
import { AgentError } from "@/lib/ai/errors";

/** JSON error response with a message the UI can show as-is. */
export function errorResponse(err: unknown, fallbackStatus = 500): Response {
  if (err instanceof ZodError) {
    return Response.json({ error: `Invalid request: ${err.issues.map((i) => `${i.path.join(".") || "body"} ${i.message}`).join("; ")}` }, { status: 400 });
  }
  if (err instanceof ActionError) return Response.json({ error: err.message }, { status: 400 });
  if (err instanceof AgentError) {
    const status = err.code === "no_key" ? 412 : err.code === "rate_limit" ? 429 : 400;
    return Response.json({ error: err.message, code: err.code }, { status });
  }
  console.error("[api]", err);
  return Response.json({ error: err instanceof Error ? err.message : "Something went wrong." }, { status: fallbackStatus });
}

export async function readJSON<T = unknown>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ActionError("Request body must be JSON.");
  }
}
