import "server-only";
import { AgentError } from "@/lib/ai/errors";
import { readSettings } from "@/lib/store/settings";
import { imageInfo } from "./files";
import { DEFAULT_IMAGE_MODEL, openaiSize } from "./visuals";

/**
 * OpenAI's Images API, for the painted layer of a graphic (photos and illustrations). Plain REST:
 * Inroad calls Claude through the Anthropic SDK and only needs this one OpenAI endpoint. The key is
 * the founder's own and the cost is billed to their OpenAI account.
 * Reference: https://developers.openai.com/api/reference/resources/images/methods/generate
 * GPT Image models always return base64; OpenAI may require organization verification first
 * (https://developers.openai.com/api/docs/guides/image-generation).
 */

export function openaiKey(): string | undefined {
  return readSettings().openaiApiKey || process.env.OPENAI_API_KEY || undefined;
}

export function imageModel(): string {
  return readSettings().imageModel || DEFAULT_IMAGE_MODEL;
}

function base(): string {
  return (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
}

/** A cheap validity check (list models). Network trouble returns "unknown" so it doesn't block saving a plausible key. */
export async function checkOpenAIKey(key: string): Promise<"ok" | "rejected" | "unknown"> {
  try {
    const res = await fetch(`${base()}/models`, { headers: { Authorization: `Bearer ${key}` }, redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (res.status === 401) return "rejected";
    return res.ok ? "ok" : "unknown";
  } catch {
    return "unknown";
  }
}

export interface GeneratedImage {
  png: Buffer;
  width: number;
  height: number;
  model: string;
  size: string;
  quality: string;
}

export async function generateImage(opts: { prompt: string; w: number; h: number; quality?: "low" | "medium" | "high"; signal?: AbortSignal }): Promise<GeneratedImage> {
  const key = openaiKey();
  if (!key) throw new AgentError("Add an OpenAI key in Settings to paint images, or copy the prompt into ChatGPT.", "no_key");
  const model = imageModel();
  const size = openaiSize(opts.w, opts.h, model);
  const quality = opts.quality ?? "high";
  const signal = AbortSignal.any([AbortSignal.timeout(180_000), ...(opts.signal ? [opts.signal] : [])]);
  let res: Response;
  try {
    res = await fetch(`${base()}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: opts.prompt, size, quality, n: 1, output_format: "png" }),
      redirect: "error",
      signal,
    });
  } catch (err) {
    if (opts.signal?.aborted) throw new AgentError("Stopped.", "stopped");
    throw new AgentError(`Couldn't reach OpenAI${err instanceof Error && err.name === "TimeoutError" ? " (it took over 3 minutes)" : ""}. Try again.`, "network");
  }
  const body = (await res.json().catch(() => null)) as { data?: { b64_json?: string }[]; error?: { message?: string; code?: string } } | null;
  if (!res.ok) {
    const msg = body?.error?.message ?? "";
    if (res.status === 401) throw new AgentError("OpenAI rejected the key. Check it in Settings.", "auth");
    if (res.status === 403) throw new AgentError(`OpenAI declined: ${msg || "your organization may need to be verified to use GPT Image models"}. Verification is in the OpenAI console and can take about 30 minutes to apply.`, "auth");
    if (res.status === 429) throw new AgentError("OpenAI's rate limit or quota was hit. Try again later or check your OpenAI billing.", "rate_limit");
    if (body?.error?.code === "moderation_blocked" || /safety|moderation|content policy/i.test(msg)) {
      throw new AgentError("OpenAI's safety system declined this image. Change the visual direction and try again.", "refusal");
    }
    throw new AgentError(`OpenAI couldn't make the image: ${msg || res.statusText}`, res.status >= 500 ? "overloaded" : "bad_request");
  }
  const b64 = body?.data?.[0]?.b64_json;
  const png = b64 ? Buffer.from(b64, "base64") : null;
  const info = png ? imageInfo(png) : null;
  if (!png || !info) throw new AgentError("OpenAI returned no image. Try again.", "unknown");
  return { png, width: info.width, height: info.height, model, size, quality };
}
