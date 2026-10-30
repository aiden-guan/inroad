import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyWorkspace, getSecret, readWorkspace, replaceWorkspace, setSecrets } from "@/lib/store/workspace";
import { cancelPosthogConnection, finishPosthog, posthogConnection, posthogWithKey, selectPosthogProject, startPosthog } from "./posthog-connect";
import { discoverPosthogProjects, posthogToken } from "./posthog-auth";
import { disconnectMetrics, syncMetrics, updateMetricSettings } from "./sync";
import { GET as callback } from "@/app/connect/posthog/callback/route";

const fetcher = vi.fn<typeof fetch>();
const reply = (body: unknown, status = 200) => fetcher.mockResolvedValueOnce(Response.json(body, { status }));
const token = (n = 1) => ({ access_token: `pha_access_fixture_${n}`, refresh_token: `phr_refresh_fixture_${n}`, expires_in: 3600, scope: "project:read query:read" });
const metrics = () => reply({ results: [[12, 40, 80]] });
const projects = (many = false) => { reply({ results: [{ id: 17, name: "My app" }, ...(many ? [{ id: 24, name: "Other app" }] : [])], next: null }); reply({}, 401); };
let port = 5100;
async function start() {
  reply({ client_id: "inroad_public_native" });
  const result = await startPosthog(`http://127.0.0.1:${++port}`);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("No flow");
  return result.value;
}
async function connect(many = false) {
  const flow = await start();
  reply(token()); projects(many); if (!many) metrics();
  return { flow, result: await finishPosthog(flow.flowId, "one-time-code") };
}

beforeEach(async () => {
  cancelPosthogConnection();
  await replaceWorkspace(emptyWorkspace());
  setSecrets("posthog", { apiKey: null, oauthRefreshToken: null, oauthClientId: null, oauthExpiresAt: null });
  fetcher.mockReset(); vi.stubGlobal("fetch", fetcher);
});

describe("PostHog browser connection", () => {
  it("registers a public native client and requests only project/query reads with PKCE", async () => {
    const flow = await start();
    const registration = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(registration).toMatchObject({ token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] });
    expect(registration.redirect_uris[0]).toMatch(/^http:\/\/127.0.0.1:\d+\/connect\/posthog\/callback$/);
    const url = new URL(flow.url!);
    expect(url.origin).toBe("https://oauth.posthog.com");
    expect(url.searchParams.get("scope")).toBe("project:read query:read");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toHaveLength(43);
    expect(JSON.stringify(posthogConnection(flow.flowId))).not.toMatch(/verifier|clientId|refreshToken|apiKey/);
  });

  it("connects the only project without asking for a region, project ID or key", async () => {
    const { flow, result } = await connect();
    expect(result?.status).toBe("done");
    expect(readWorkspace().integrations.posthog?.config).toMatchObject({ projectId: "17", projectName: "My app", region: "us", activityEvent: "", identifiedOnly: true, authMode: "oauth" });
    expect(readWorkspace().businessMetrics?.posthog?.accountLabel).toBe("My app · US");
    expect(getSecret("posthog", "apiKey")).toBe(token().access_token);
    expect(getSecret("posthog", "oauthRefreshToken")).toBe(token().refresh_token);
    expect(JSON.stringify(readWorkspace()) + JSON.stringify(result)).not.toMatch(/pha_access|phr_refresh|code_verifier/);
    const exchanged = new URLSearchParams(String(fetcher.mock.calls[1][1]?.body));
    const challenge = createHash("sha256").update(exchanged.get("code_verifier")!).digest("base64url");
    expect(challenge).toBe(new URL(flow.url!).searchParams.get("code_challenge"));
    expect(exchanged.get("client_secret")).toBeNull();
    expect(await finishPosthog(flow.flowId, "replayed-code")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("asks only for a project name when there are several and validates the choice", async () => {
    const { flow, result } = await connect(true);
    expect(result?.status).toBe("choose");
    expect(result?.projects?.map((p) => p.name)).toEqual(["My app", "Other app"]);
    expect(readWorkspace().integrations.posthog).toBeUndefined();
    expect((await selectPosthogProject(flow.flowId, "999", "us")).ok).toBe(false);
    metrics();
    const selected = await selectPosthogProject(flow.flowId, "24", "us");
    expect(selected.ok && selected.value.status).toBe("done");
    expect(readWorkspace().integrations.posthog?.config.projectName).toBe("Other app");
  });

  it("rejects expired, canceled, unknown and replayed callbacks without exchanging a token", async () => {
    const flow = await start();
    expect(await finishPosthog("forged-state", "code")).toBeNull();
    cancelPosthogConnection(flow.flowId);
    expect(await finishPosthog(flow.flowId, "code")).toBeNull();
    const next = await start();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16 * 60_000);
    expect(await finishPosthog(next.flowId, "code")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("handles denied access without altering the current workspace or echoing provider content", async () => {
    const flow = await start();
    const before = structuredClone(readWorkspace());
    const response = await callback(new Request(`http://127.0.0.1:3737/connect/posthog/callback?state=${flow.flowId}&error=${encodeURIComponent('<script>bad</script>')}`));
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("<script>");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(readWorkspace()).toEqual(before);
    expect(getSecret("posthog", "apiKey")).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("cannot save a connection canceled while the first metrics query is running", async () => {
    const flow = await start(); reply(token()); projects();
    let resolve!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>((r) => { resolve = r; }));
    const finishing = finishPosthog(flow.flowId, "code");
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    cancelPosthogConnection(flow.flowId);
    resolve(Response.json({ results: [[1, 2, 3]] }));
    expect((await finishing)?.status).toBe("error");
    expect(readWorkspace().integrations.posthog).toBeUndefined();
    expect(getSecret("posthog", "apiKey")).toBeUndefined();
  });

  it("refreshes expiring tokens automatically and saves rotated refresh tokens outside the workspace", async () => {
    await connect();
    setSecrets("posthog", { oauthExpiresAt: "0" });
    reply(token(2)); metrics();
    expect((await syncMetrics("posthog"))?.ok).toBe(true);
    expect(getSecret("posthog", "oauthRefreshToken")).toBe(token(2).refresh_token);
    const body = new URLSearchParams(String(fetcher.mock.calls[5][1]?.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe(token(1).refresh_token);
    expect(JSON.stringify(readWorkspace())).not.toMatch(/phr_refresh|pha_access/);
  });

  it("renews a revoked access token once, even if its expiry time hasn't passed", async () => {
    await connect();
    reply({}, 401); reply(token(2)); metrics();
    expect((await syncMetrics("posthog"))?.ok).toBe(true);
    expect(getSecret("posthog", "apiKey")).toBe(token(2).access_token);
  });

  it("preserves the last successful snapshot if renewing access fails", async () => {
    await connect();
    const before = structuredClone(readWorkspace().businessMetrics);
    setSecrets("posthog", { oauthExpiresAt: "0" }); reply({}, 400);
    expect((await syncMetrics("posthog"))?.ok).toBe(false);
    expect(readWorkspace().businessMetrics).toEqual(before);
  });

  it("changes optional preferences with saved credentials, preserving the connection date", async () => {
    await connect();
    const at = readWorkspace().integrations.posthog?.connectedAt;
    metrics();
    expect((await updateMetricSettings("posthog", { activityEvent: "app_opened", identifiedOnly: false })).ok).toBe(true);
    expect(readWorkspace().integrations.posthog?.config.activityEvent).toBe("app_opened");
    expect(readWorkspace().integrations.posthog?.connectedAt).toBe(at);
    expect(getSecret("posthog", "apiKey")).toBe(token().access_token);
  });

  it("removes and revokes the OAuth grant on disconnect", async () => {
    await connect(); reply({});
    await disconnectMetrics("posthog");
    expect(getSecret("posthog", "apiKey")).toBeUndefined();
    expect(getSecret("posthog", "oauthRefreshToken")).toBeUndefined();
    expect(readWorkspace().integrations.posthog?.enabled).toBe(false);
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe("https://oauth.posthog.com/oauth/revoke/");
  });

  it("supports existing personal keys with automatic project discovery", async () => {
    projects(); metrics();
    const result = await posthogWithKey("phx_existing_key");
    expect(result.ok && result.value.status).toBe("done");
    expect(readWorkspace().integrations.posthog?.config.authMode).toBe("key");
    expect(getSecret("posthog", "oauthRefreshToken")).toBeUndefined();
  });

  it("never follows project pagination to another host with a credential", async () => {
    reply({ results: [], next: "https://evil.example.com/api/projects/" }); reply({}, 401);
    expect((await discoverPosthogProjects("phx_existing_key")).ok).toBe(false);
    expect(fetcher.mock.calls.every(([url]) => new URL(String(url)).hostname.endsWith(".posthog.com"))).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails a token without the minimum read scopes", async () => {
    reply({ ...token(), scope: "project:read" });
    expect((await posthogToken({ client_id: "public_client", code: "code" })).ok).toBe(false);
  });

  it("does not request credentials or register clients in sample workspaces or for remote callbacks", async () => {
    expect((await startPosthog("https://evil.example.com")).ok).toBe(false);
    await replaceWorkspace({ ...emptyWorkspace(), sample: true });
    expect((await startPosthog("http://127.0.0.1:3737")).ok).toBe(false);
    expect((await posthogWithKey("phx_existing_key")).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
