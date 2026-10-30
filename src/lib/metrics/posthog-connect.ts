import "server-only";
import { randomBytes } from "node:crypto";
import { fail, ok, type Result } from "@/lib/connectors/types";
import { readWorkspace } from "@/lib/store/workspace";
import { POSTHOG_AUTH, POSTHOG_SCOPES, discoverPosthogProjects, pkce, posthogToken, registerPosthog, type PostHogOAuth, type PostHogProject } from "./posthog-auth";
import type { PostHogConnection } from "./connect-types";
import { connectMetrics } from "./sync";

type Flow = {
  id: string; expires: number; status: PostHogConnection["status"]; error?: string;
  verifier?: string; clientId?: string; redirectUri?: string; key?: string; oauth?: PostHogOAuth; projects?: PostHogProject[];
};
const global = globalThis as typeof globalThis & { __posthogFlows?: Map<string, Flow>; __posthogClients?: Map<string, string> };
const flows = global.__posthogFlows ??= new Map<string, Flow>();
const clients = global.__posthogClients ??= new Map<string, string>();
const TTL = 15 * 60_000;

function get(id: string) {
  for (const [key, flow] of flows) if (flow.expires <= Date.now()) flows.delete(key);
  return flows.get(id);
}
function create(): Flow {
  get("");
  // A single-user local app needs at most a few simultaneous sign-in windows.
  if (flows.size >= 10) flows.delete(flows.keys().next().value!);
  const flow: Flow = { id: randomBytes(32).toString("base64url"), expires: Date.now() + TTL, status: "waiting" };
  flows.set(flow.id, flow);
  return flow;
}
export function posthogConnection(id: string): PostHogConnection | null {
  const flow = get(id);
  if (!flow) return null;
  return { flowId: flow.id, status: flow.status, ...(flow.status === "choose" ? { projects: flow.projects } : {}), ...(flow.error ? { error: flow.error } : {}) };
}
export function cancelPosthogConnection(id?: string) {
  if (id) flows.delete(id); else flows.clear();
}
function failed(flow: Flow, message: string): PostHogConnection {
  flow.status = "error";
  flow.error = message;
  delete flow.key; delete flow.oauth; delete flow.verifier;
  return posthogConnection(flow.id) ?? { flowId: flow.id, status: "error", error: message };
}

export async function startPosthog(origin: string): Promise<Result<PostHogConnection>> {
  if (readWorkspace().sample) return fail("validation", "Leave the sample workspace before connecting a real provider.");
  const local = new URL(origin);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(local.hostname) || !["http:", "https:"].includes(local.protocol)) return fail("validation", "Open Inroad on localhost to connect PostHog.");
  const redirectUri = `${local.origin}/connect/posthog/callback`;
  let clientId = clients.get(redirectUri);
  if (!clientId) {
    const registered = await registerPosthog(redirectUri);
    if (!registered.ok) return registered;
    clientId = registered.value;
    clients.set(redirectUri, clientId);
  }
  const proof = pkce();
  const flow = create();
  Object.assign(flow, { clientId, redirectUri, verifier: proof.verifier });
  const url = new URL(`${POSTHOG_AUTH}/oauth/authorize/`);
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: POSTHOG_SCOPES, state: flow.id, code_challenge: proof.challenge, code_challenge_method: "S256" }).toString();
  return ok({ ...posthogConnection(flow.id)!, url: url.href });
}

async function connectProject(flow: Flow, project: PostHogProject): Promise<PostHogConnection> {
  if (!flow.key || get(flow.id) !== flow) return failed(flow, "Sign-in expired. Connect again.");
  flow.status = "connecting";
  const result = await connectMetrics("posthog", flow.key, { region: project.region, projectId: project.id, projectName: project.name, activityEvent: "", identifiedOnly: true }, { oauth: flow.oauth, stillActive: () => get(flow.id) === flow });
  if (!result.ok) return failed(flow, result.error.message);
  flow.status = "done";
  delete flow.key; delete flow.oauth; delete flow.verifier;
  return posthogConnection(flow.id) ?? { flowId: flow.id, status: "error", error: "Connection canceled." };
}
async function discover(flow: Flow): Promise<PostHogConnection> {
  const projects = await discoverPosthogProjects(flow.key!);
  if (get(flow.id) !== flow) return { flowId: flow.id, status: "error", error: "Connection canceled." };
  if (!projects.ok) return failed(flow, projects.error.message);
  flow.projects = projects.value;
  if (projects.value.length === 1) return connectProject(flow, projects.value[0]);
  flow.status = "choose";
  return posthogConnection(flow.id)!;
}

export async function finishPosthog(state: string, code?: string, denied = false): Promise<PostHogConnection | null> {
  const flow = get(state);
  // One-time state also prevents concurrent/replayed callbacks from exchanging a code again.
  if (!flow || flow.status !== "waiting" || !flow.verifier || !flow.clientId || !flow.redirectUri) return null;
  if (denied || !code) return failed(flow, "Sign-in was canceled. You can try again whenever you're ready.");
  flow.status = "connecting";
  try {
    const token = await posthogToken({ grant_type: "authorization_code", client_id: flow.clientId, redirect_uri: flow.redirectUri, code_verifier: flow.verifier, code });
    delete flow.verifier;
    if (!token.ok) return failed(flow, token.error.message);
    if (get(flow.id) !== flow) return null;
    flow.key = token.value.key; flow.oauth = token.value.oauth;
    return await discover(flow);
  } catch { return failed(flow, "Couldn't finish connecting to PostHog. Try again."); }
}

export async function posthogWithKey(key: string): Promise<Result<PostHogConnection>> {
  if (readWorkspace().sample) return fail("validation", "Leave the sample workspace before connecting a real provider.");
  if (!key.startsWith("phx_")) return fail("validation", "Use a personal API key (phx_…), or choose Connect PostHog.");
  const flow = create();
  flow.key = key; flow.status = "connecting";
  return ok(await discover(flow));
}
export async function selectPosthogProject(id: string, projectId: string, region: string): Promise<Result<PostHogConnection>> {
  const flow = get(id);
  if (!flow || flow.status !== "choose") return fail("validation", "This sign-in expired. Connect again.");
  const project = flow.projects?.find((p) => p.id === projectId && p.region === region);
  if (!project) return fail("validation", "Choose one of the projects in this connection.");
  return ok(await connectProject(flow, project));
}
