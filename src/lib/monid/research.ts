import "server-only";
import { z } from "zod";
import { request } from "@/lib/connectors/http";
import { fail, ok, type Result } from "@/lib/connectors/types";
import { FileDB, singletonDB } from "@/lib/store/file-db";
import { getSecret, readWorkspace } from "@/lib/store/workspace";
import { CITATION_PLATFORMS, ResearchInput, type CreatorResult, type MonidPrice, type MonidReport } from "./types";

const db = () => singletonDB("monid-research.json", () => new FileDB<{ reports: MonidReport[] }>("monid-research.json", () => ({ reports: [] })));
const money = z.object({ value: z.number().finite().nonnegative(), currency: z.literal("USD") });
const Price = z.object({ type: z.string(), amount: money.optional(), flatFee: money.optional() }).passthrough();
const count = z.number().int().nonnegative().safe();
const Run = z.object({
  runId: z.string().regex(/^[A-Za-z0-9_-]+$/).max(100),
  status: z.enum(["READY", "RUNNING", "STOPPING", "COMPLETED", "FAILED", "BLOCKED", "STOPPED", "TIMED_OUT"]),
  provider: z.string(), endpoint: z.string(), output: z.unknown().optional(),
  providerResponse: z.object({ httpStatus: z.number().int().optional() }).optional(),
  cost: money.optional(), billing: z.object({ reportedCost: z.object({ currency: z.literal("USD"), value: count, unit: z.enum(["MICRO_DOLLAR", "CENT", "DOLLAR"]) }) }).optional(),
  controls: z.array(z.object({ controlType: z.string() }).passthrough()).optional(),
});

function connection() {
  const ws = readWorkspace();
  const state = ws.integrations.monid;
  const key = getSecret("monid", "key");
  if (ws.sample || !state?.enabled || !key || typeof state.config.workspaceId !== "string") return null;
  return { key, workspaceId: state.config.workspaceId };
}
const endpointFor = (input: ResearchInput) => input.kind === "creators"
  ? { provider: "apify", endpoint: "/apidojo/tiktok-scraper" }
  : { provider: "ahrefs", endpoint: "/site-explorer/ai-responses-count" };

export function researchHistory(): MonidReport[] {
  const cfg = connection();
  return cfg ? db().read().reports.filter((r) => r.workspaceId === cfg.workspaceId) : [];
}

/** Always inspect the current schema and price before submitting either fixed research workflow. */
export async function previewResearch(raw: unknown): Promise<Result<{ price: MonidPrice }>> {
  const input = ResearchInput.parse(raw);
  const cfg = connection();
  if (!cfg) return fail("auth", "Connect Monid in your real workspace first.");
  const response = await request({ tool: "Monid", method: "POST", url: "https://api.monid.ai/v1/inspect", headers: { authorization: `Bearer ${cfg.key}` }, body: endpointFor(input), secrets: [cfg.key], retries: 1 });
  if (!response.ok) return response;
  const parsed = z.object({ provider: z.string(), endpoint: z.string(), price: Price, input: z.object({ body: z.object({ properties: z.record(z.string(), z.unknown()) }).optional(), queryParams: z.object({ properties: z.record(z.string(), z.unknown()) }).optional() }) }).safeParse(response.value);
  const expected = endpointFor(input);
  if (!parsed.success || parsed.data.provider !== expected.provider || parsed.data.endpoint !== expected.endpoint) return fail("upstream", "Monid didn't return usable endpoint details. No paid run was started.");
  const fields = input.kind === "creators" ? parsed.data.input.body?.properties : parsed.data.input.queryParams?.properties;
  const required = input.kind === "creators" ? ["keywords", "maxItems", "location"] : ["target", "select", "mode", "country", "protocol", "date", "output"];
  if (!fields || required.some((key) => !(key in fields))) return fail("upstream", "This Monid tool's input fields have changed. No paid run was started; update the adapter before retrying.");
  return ok({ price: parsed.data.price });
}

/** Only public creator/post fields are retained; no emails, phone numbers or raw profiles. */
export function creatorResults(raw: unknown): CreatorResult[] | null {
  const parsed = z.array(z.object({
    channel: z.object({ username: z.string().min(1), name: z.string().nullable().optional(), followers: count.nullable().optional() }),
    postPage: z.string().optional(), title: z.string().nullable().optional(), views: count.optional(), likes: count.optional(),
  })).safeParse(raw);
  if (!parsed.success) return null;
  const creators = new Map<string, CreatorResult>();
  for (const row of parsed.data) {
    const handle = row.channel.username.replace(/^@/, "");
    if (!/^[\w.]{1,64}$/.test(handle)) return null;
    const post = row.postPage && /^https:\/\/(?:www\.)?tiktok\.com\//.test(row.postPage) ? row.postPage : undefined;
    const creator: CreatorResult = { handle, profileUrl: `https://www.tiktok.com/@${encodeURIComponent(handle)}`, name: row.channel.name?.slice(0, 160), postUrl: post, caption: row.title?.slice(0, 500), followers: row.channel.followers ?? undefined, views: row.views, likes: row.likes };
    if (!creators.has(handle) || (row.views ?? 0) > (creators.get(handle)?.views ?? 0)) creators.set(handle, creator);
  }
  return [...creators.values()].slice(0, 25);
}

async function saveRun(report: MonidReport, raw: unknown): Promise<Result<MonidReport>> {
  const parsed = Run.safeParse(raw);
  const target = endpointFor(report.input);
  if (!parsed.success || parsed.data.provider !== target.provider || parsed.data.endpoint !== target.endpoint || (report.runId && parsed.data.runId !== report.runId)) return fail("upstream", "Monid returned an unexpected run. Check your Monid run history before trying again.");
  const run = parsed.data;
  const next: MonidReport = { ...report, runId: run.runId, status: run.status };
  if (run.cost) next.costUsd = run.cost.value;
  if (run.billing) { const billed = run.billing.reportedCost; next.costUsd = billed.value / ({ MICRO_DOLLAR: 1e6, CENT: 100, DOLLAR: 1 }[billed.unit]); }
  if (run.status === "BLOCKED") next.error = `Monid blocked this run: ${run.controls?.map((c) => c.controlType).join(", ") || "workspace budget, run cap or wallet balance"}. Review the control in Monid before starting another run.`;
  else if (["FAILED", "STOPPED", "TIMED_OUT"].includes(run.status)) next.error = `Monid run ${run.status.toLowerCase().replaceAll("_", " ")}. Check its run history before starting another run.`;
  else if (run.status === "COMPLETED") {
    const status = run.providerResponse?.httpStatus;
    if (!status || status < 200 || status >= 300) next.error = `The provider returned ${status ?? "an unknown status"}. A completed Monid run does not guarantee successful results.`;
    else if (report.input.kind === "creators") {
      const creators = creatorResults(run.output);
      if (!creators) next.error = "The creator response format wasn't recognized. The run completed; review it in Monid instead of rerunning it.";
      else next.creators = creators;
    } else {
      const counts = z.object({ ai_responses_count: z.object(Object.fromEntries(CITATION_PLATFORMS.map((p) => [p, z.object({ citations: count, pages: count })]))) }).safeParse(run.output);
      if (!counts.success) next.error = "The citation response was incomplete. The run completed; review it in Monid instead of rerunning it.";
      else next.citations = CITATION_PLATFORMS.map((platform) => ({ platform, ...(counts.data.ai_responses_count[platform] as { citations: number; pages: number }) }));
    }
  }
  const saved = await db().update((draft) => {
    const index = draft.reports.findIndex((r) => r.id === next.id);
    const current = draft.reports[index];
    if (current && ["COMPLETED", "FAILED", "BLOCKED", "STOPPED", "TIMED_OUT"].includes(current.status)) return current;
    if (index >= 0) draft.reports[index] = next;
    return next;
  });
  return ok(saved.value);
}

export async function startResearch(raw: unknown, id: string, maxCost: number, expectedPrice: unknown): Promise<Result<MonidReport>> {
  const input = ResearchInput.parse(raw);
  z.uuid().parse(id);
  z.number().positive().max(5).parse(maxCost);
  const cfg = connection();
  if (!cfg) return fail("auth", "Connect Monid in your real workspace first.");
  const previous = db().read().reports.find((r) => r.id === id);
  if (previous) return previous.workspaceId === cfg.workspaceId ? ok(previous) : fail("validation", "Choose a new request ID.");
  const preview = await previewResearch(input);
  if (!preview.ok) return preview;
  if (JSON.stringify(preview.value.price) !== JSON.stringify(expectedPrice)) return fail("validation", "Monid's price changed. Preview the current price before running this research.");
  const current = connection();
  if (!current || current.key !== cfg.key || current.workspaceId !== cfg.workspaceId) return fail("auth", "Your Monid connection changed. Preview again with the current account.");
  const report: MonidReport = { id, workspaceId: cfg.workspaceId, input, createdAt: new Date().toISOString(), reportDate: new Date().toISOString().slice(0, 10), status: "SUBMITTING", price: preview.value.price };
  const reservation = await db().update((draft) => {
    if (draft.reports.some((r) => r.id === id)) return false;
    draft.reports.unshift(report);
    // Never evict an in-flight run; bounded terminal history is enough for matched comparisons.
    const terminal = draft.reports.filter((r) => !["SUBMITTING", "READY", "RUNNING", "STOPPING", "UNKNOWN"].includes(r.status));
    const kept = new Set(terminal.slice(0, 100).map((r) => r.id));
    draft.reports = draft.reports.filter((r) => !terminal.includes(r) || kept.has(r.id));
    return true;
  });
  if (!reservation.value) return ok(db().read().reports.find((r) => r.id === id)!);
  const inputFields = input.kind === "creators"
    ? { body: { keywords: [input.query], maxItems: input.limit, location: input.country } }
    : { queryParams: { target: input.domain, mode: "subdomains", protocol: "both", country: input.country.toLowerCase(), date: report.reportDate, select: CITATION_PLATFORMS.join(","), output: "json" } };
  const response = await submitRun(cfg.key, { ...endpointFor(input), input: inputFields, maxCost });
  if (!response.ok) {
    const uncertain = response.error.code === "network" || response.error.code === "upstream";
    const failed: MonidReport = { ...report, status: uncertain ? "UNKNOWN" : "FAILED", error: uncertain ? "The run outcome is unknown. Check Monid's run history before submitting again; it may have started and incurred a charge." : response.error.code === "plan" ? "The Monid wallet needs funds. Check your balance in Monid." : response.error.message };
    await db().update((draft) => { draft.reports[draft.reports.findIndex((r) => r.id === id)] = failed; });
    return ok(failed);
  }
  const saved = await saveRun(report, response.value);
  if (!saved.ok) {
    await db().update((draft) => { const entry = draft.reports.find((r) => r.id === id)!; entry.status = "UNKNOWN"; entry.error = saved.error.message; });
  }
  return saved;
}

/** Non-2xx responses can still contain a completed, billable run. Never retry this POST. */
async function submitRun(key: string, body: unknown): Promise<Result<unknown>> {
  try {
    const response = await fetch("https://api.monid.ai/v1/run", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body), redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(25_000) });
    const value: unknown = await response.json().catch(() => null);
    if (Run.safeParse(value).success || response.ok) return ok(value);
    if (response.status === 401 || response.status === 403) return fail("auth", "Monid rejected this key or its runs:create permission. Reconnect with a workspace key.");
    if (response.status === 402) return fail("plan", "Your Monid wallet needs funds.");
    if (response.status === 429) return fail("rate_limited", "Monid is rate-limiting new runs. No automatic retry was made.");
    if (response.status >= 500 || response.status >= 300 && response.status < 400) return fail("upstream", "Monid returned an unexpected response. Check its run history before trying again.");
    return fail("validation", "Monid rejected the input or its estimated cost exceeded your threshold. Preview again or check Monid for details.");
  } catch { return fail("network", "Monid's response was not received. Check its run history before trying again."); }
}

export async function refreshResearch(id: string): Promise<Result<MonidReport>> {
  const cfg = connection();
  const report = researchHistory().find((r) => r.id === id);
  if (!cfg || !report) return fail("not_found", "That research run isn't available in the connected Monid workspace.");
  if (!report.runId || !["READY", "RUNNING", "STOPPING"].includes(report.status)) return ok(report);
  const response = await request({ tool: "Monid", url: `https://api.monid.ai/v1/runs/${encodeURIComponent(report.runId)}`, headers: { authorization: `Bearer ${cfg.key}` }, secrets: [cfg.key], retries: 1 });
  return response.ok ? saveRun(report, response.value) : response;
}
