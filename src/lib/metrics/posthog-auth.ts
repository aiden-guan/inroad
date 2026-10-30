import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { request } from "@/lib/connectors/http";
import { fail, ok, type Result } from "@/lib/connectors/types";

export const POSTHOG_AUTH = "https://oauth.posthog.com";
export const POSTHOG_SCOPES = "project:read query:read";
export interface PostHogOAuth {
  clientId: string;
  refreshToken: string;
  expiresAt: string;
}
export interface PostHogProject { id: string; name: string; region: "us" | "eu" }

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

const Token = z.object({
  access_token: z.string().startsWith("pha_"),
  refresh_token: z.string().startsWith("phr_").optional(),
  expires_in: z.number().positive().finite(),
  scope: z.string().optional(),
});

export async function posthogToken(params: Record<string, string>, previousRefresh?: string): Promise<Result<{ key: string; oauth: PostHogOAuth }>> {
  const response = await request({
    tool: "PostHog", url: `${POSTHOG_AUTH}/oauth/token/`, method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString(),
    secrets: Object.values(params), retries: 0,
  });
  if (!response.ok) return fail("auth", "PostHog couldn't finish signing in. Connect again to retry.");
  const token = Token.safeParse(response.value);
  if (!token.success || (!token.data.refresh_token && !previousRefresh)) return fail("auth", "PostHog didn't return a complete connection. Connect again to retry.");
  if (token.data.scope && !POSTHOG_SCOPES.split(" ").every((scope) => token.data.scope!.split(" ").includes(scope))) return fail("forbidden", "Approve read access to your projects and analytics to connect PostHog.");
  return ok({ key: token.data.access_token, oauth: { clientId: params.client_id, refreshToken: token.data.refresh_token ?? previousRefresh!, expiresAt: String(Date.now() + token.data.expires_in * 1000) } });
}

export async function registerPosthog(redirectUri: string): Promise<Result<string>> {
  const response = await request({
    tool: "PostHog", url: `${POSTHOG_AUTH}/oauth/register/`, method: "POST", createsRecord: true,
    body: { client_name: "Inroad", client_uri: "https://github.com/aiden-guan/inroad", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", application_type: "native", scope: POSTHOG_SCOPES }, retries: 1,
  });
  if (!response.ok) return fail(response.error.code, "Couldn't open PostHog sign-in. Try again, or connect with an API key.");
  const parsed = z.object({ client_id: z.string().min(1) }).safeParse(response.value);
  return parsed.success ? ok(parsed.data.client_id) : fail("upstream", "PostHog couldn't prepare sign-in. Try again in a moment.");
}

const Projects = z.object({ results: z.array(z.object({ id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]), name: z.string().max(300) })), next: z.string().nullable().optional() });

/** The region is discovered from the provider, never requested from the founder. Hosts are fixed. */
export async function discoverPosthogProjects(key: string): Promise<Result<PostHogProject[]>> {
  const regions = await Promise.all((["us", "eu"] as const).map(async (region) => {
    const projects: PostHogProject[] = [];
    const base = `https://${region}.posthog.com`;
    let url = `${base}/api/projects/?limit=100`;
    const seen = new Set<string>();
    for (let page = 0; page < 100; page++) {
      if (seen.has(url)) return fail("upstream", "PostHog repeated a page of projects. Try connecting again.");
      seen.add(url);
      const result = await request({ tool: "PostHog", url, headers: { authorization: `Bearer ${key}` }, secrets: [key], retries: 0 });
      if (!result.ok) return result;
      const parsed = Projects.safeParse(result.value);
      if (!parsed.success) return fail("upstream", "PostHog couldn't list your projects. Try connecting again.");
      for (const p of parsed.data.results) projects.push({ id: String(p.id), name: p.name || "Untitled project", region });
      if (!parsed.data.next) return ok(projects);
      const next = new URL(parsed.data.next, base);
      if (next.origin !== base || next.pathname !== "/api/projects/") return fail("upstream", "PostHog returned an unexpected project page.");
      url = next.href;
    }
    return fail("upstream", "PostHog returned too many projects. Use a key limited to the projects you need.");
  }));
  const projects = regions.flatMap((r) => r.ok ? r.value : []);
  if (projects.length) return ok(projects);
  if (regions.some((r) => !r.ok && r.error.code === "forbidden")) return fail("forbidden", "This key needs Projects: Read and Query: Read. Create a read-only key, or use Connect PostHog instead.");
  if (regions.every((r) => r.ok)) return fail("not_found", "No PostHog projects were available for this connection.");
  return fail("auth", "Couldn't find your PostHog projects. Check the key, or use Connect PostHog instead.");
}

export async function revokePosthog(refreshToken: string, clientId: string) {
  await request({ tool: "PostHog", url: `${POSTHOG_AUTH}/oauth/revoke/`, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: refreshToken, token_type_hint: "refresh_token", client_id: clientId }).toString(), secrets: [refreshToken], retries: 0 });
}
