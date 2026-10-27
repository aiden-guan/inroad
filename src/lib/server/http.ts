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

/**
 * What Next.js passes on of a request body when there's a proxy (src/proxy.ts): it buffers the body so
 * both can read it, keeps the first 10 MB (experimental.proxyClientMaxBodySize) and silently drops the
 * rest, so a bigger upload reaches the route cut short and fails to parse as if it were the wrong file.
 */
export const BODY_LIMIT_BYTES = 10 * 1024 * 1024;
export const TOO_BIG = "That's more than Inroad can take in one go (10 MB).";

/** A public API's body exceeded its byte budget, including when sent without Content-Length. */
export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large.");
  }
}

/** Reads at most maxBytes, cancelling oversized streams before buffering the rest. */
export async function readTextBody(request: Request, maxBytes: number): Promise<string> {
  if (Number(request.headers.get("content-length")) > maxBytes) {
    void request.body?.cancel().catch(() => undefined);
    throw new BodyTooLargeError();
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new BodyTooLargeError();
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

/** True when fewer bytes arrived than the client said it sent: the body was cut at BODY_LIMIT_BYTES. */
export function bodyCutShort(request: Request, received: number): boolean {
  const declared = Number(request.headers.get("content-length") ?? "");
  return Number.isFinite(declared) && declared > received;
}

export async function readJSON<T = unknown>(request: Request): Promise<T> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new ActionError("Request body must be JSON.");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    if (bodyCutShort(request, new TextEncoder().encode(text).byteLength)) throw new ActionError(TOO_BIG);
    throw new ActionError("Request body must be JSON.");
  }
}
