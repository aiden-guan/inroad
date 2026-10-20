import "server-only";
import { fail, ok, type ConnectorError, type Result } from "./types";

/**
 * One HTTP runner for every connector:
 * - timeout per attempt, never follows redirects;
 * - retries 429/5xx/network errors with backoff, honoring Retry-After (seconds or HTTP date);
 *   a create retries only on 429, because a timeout or gateway error may come after the write;
 * - never retries 400/401/403/404/409/422;
 * - turns vendor errors into one plain sentence with every secret redacted.
 */

export interface RequestOptions {
  /** Shown in error messages: "HubSpot rejected the key." */
  tool: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
  /** Strings to scrub from any message (API keys, webhook URLs). */
  secrets?: string[];
  /** A non-idempotent create: retrying after a timeout or 5xx could make a duplicate. */
  createsRecord?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function backoff(attempt: number): number {
  return Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.min(10_000, Math.max(0, secs * 1000));
  const at = Date.parse(h);
  return Number.isNaN(at) ? undefined : Math.min(10_000, Math.max(0, at - Date.now()));
}

export function redact(text: string, secrets: string[] = []): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("•••");
  return out
    .replace(/(api_key=)[^&\s"']+/gi, "$1•••")
    .replace(/hooks\.slack\.com\/services\/[^\s"']+/g, "hooks.slack.com/services/•••")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, "$1•••");
}

function parse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Pulls the human part out of the many vendor error shapes. */
function vendorMessage(body: unknown): string {
  if (typeof body === "string") return body.trim().slice(0, 200);
  if (!body || typeof body !== "object") return "";
  const b = body as Record<string, unknown>;
  const pick = (v: unknown): string => (typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { message?: unknown }).message === "string" ? (v as { message: string }).message : "");
  const errors = Array.isArray(b.errors) ? b.errors : [];
  return (pick(b.message) || pick(b.error) || pick(errors[0]) || pick(b.detail) || pick(b.code) || "").trim().slice(0, 200);
}

function describe(tool: string, status: number, body: unknown, secrets: string[]): ConnectorError {
  const detail = redact(vendorMessage(body), secrets);
  const tail = detail ? `: ${detail.replace(/\.$/, "")}.` : ".";
  if (status === 401) return { code: "auth", status, message: `${tool} rejected the key. Check that you copied all of it, then paste it again.` };
  if (status === 402) return { code: "plan", status, message: `${tool} needs a paid plan for API access.` };
  if (status === 403) return { code: "forbidden", status, message: `${tool} accepted the key, but it's missing a permission${tail} Add the scopes listed above.` };
  if (status === 404) return { code: "not_found", status, message: `${tool} couldn't find that${tail}` };
  if (status === 409) return { code: "conflict", status, message: `${tool} says it already exists${tail}` };
  if (status === 429) return { code: "rate_limited", status, message: `${tool} is rate-limiting requests. Try again in a minute.` };
  if (status >= 500) return { code: "upstream", status, message: `${tool} had a problem on its side (${status}). Try again in a minute.` };
  if (status >= 300 && status < 400) return { code: "upstream", status, message: `${tool} redirected the request (${status}), which usually means the address is wrong.` };
  return { code: "validation", status, message: `${tool} rejected the request${tail}` };
}

export async function request<T = unknown>(o: RequestOptions): Promise<Result<T>> {
  const retries = o.retries ?? 2;
  const timeoutMs = o.timeoutMs ?? 15_000;
  const secrets = o.secrets ?? [];
  const hasBody = o.body !== undefined;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(o.url, {
        method: o.method ?? (hasBody ? "POST" : "GET"),
        headers: {
          accept: "application/json",
          ...(hasBody ? { "content-type": "application/json" } : {}),
          "user-agent": "Inroad/1.0 (+local)",
          ...o.headers,
        },
        body: hasBody ? (typeof o.body === "string" ? o.body : JSON.stringify(o.body)) : undefined,
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (attempt < retries && !o.createsRecord) {
        await sleep(backoff(attempt));
        continue;
      }
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      const wait = `${o.tool} didn't answer within ${Math.round(timeoutMs / 1000)}s.`;
      return fail(
        "network",
        timedOut
          ? o.createsRecord
            ? `${wait} Check ${o.tool} before trying again; it may have saved it.`
            : `${wait} Try again in a minute.`
          : `Couldn't reach ${o.tool}. Check your internet connection.`,
      );
    }
    const text = await res.text().catch(() => "");
    if (res.ok) return ok(parse(text) as T);
    const retryable = res.status === 429 || (!o.createsRecord && (res.status === 502 || res.status === 503 || res.status === 504));
    if (retryable && attempt < retries) {
      await sleep(retryAfterMs(res) ?? backoff(attempt));
      continue;
    }
    return { ok: false, error: describe(o.tool, res.status, parse(text), secrets) };
  }
}

/** Splits "Jane van der Berg" into first and last name. */
export function splitName(name: string | undefined): { first: string; last: string } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}
