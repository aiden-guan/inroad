import "server-only";
import { automationTask } from "@/lib/automation/tasks";
import { z } from "zod";
import { activeProvider } from "@/lib/ai/client";
import { defineTool, runAgent } from "@/lib/ai/engine";
import { AgentError } from "@/lib/ai/errors";
import { committedSpend } from "@/lib/runs/registry";
import { reserveSearchRequests } from "./budget";
import { monthKey } from "@/lib/domain/ids";
import { mutateWorkspace, readWorkspace } from "@/lib/store/workspace";
import { recordOperation, readAutomation, updateAutomation } from "@/lib/automation/store";
import { activeSearch, searchChoice, searchWeb } from "./search";
import { canonicalUrl, cleanDomains, planQueries, rankResults, querySuffix, type SearchHit } from "./quality";

export const ResearchInput = z.object({
  query: z.string().trim().min(2).max(1200),
  includeDomains: z.array(z.string().max(253)).max(10).default([]),
  excludeDomains: z.array(z.string().max(253)).max(10).default([]),
  since: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.number().int().min(1).max(30).default(15),
  fresh: z.boolean().default(false),
});
export type ResearchInput = z.infer<typeof ResearchInput>;
export interface ResearchResponse {
  query: string;
  queries: string[];
  provider: string;
  results: SearchHit[];
  warnings: string[];
  receiptId: string;
  durationMs: number;
}
const nativeState = globalThis as unknown as { __inroadNativeResearchHold?: number };

async function nativeSearch(input: ResearchInput, signal?: AbortSignal): Promise<{ results: SearchHit[]; queries: string[] }> {
  const ws = readWorkspace();
  const started = Date.now();
  const release = reserveSearchRequests(2);
  if (typeof release === "string") throw new Error(release);
  const hold = nativeState.__inroadNativeResearchHold ?? 0;
  if (ws.caps.monthlyBudgetUsd > 0 && committedSpend() + hold + 0.2 > ws.caps.monthlyBudgetUsd) {
    release();
    throw new Error("There isn't enough AI budget for another search. Check Settings → Usage.");
  }
  nativeState.__inroadNativeResearchHold = hold + 0.2;
  const sources = new Set<string>();
  let billed = 0,
    requests = 0;
  let failure: string | undefined;
  const queries: string[] = [];
  try {
    const schema = z.object({
      results: z.array(z.object({ title: z.string().max(500), url: z.string().max(2000), description: z.string().max(1200) })).max(20),
    });
    const tool = defineTool({
      name: "submit_research",
      description: "Return only pages actually returned by web search, with short factual snippets. Never invent a company, URL or claim.",
      schema,
      terminal: true,
    });
    const result = await runAgent<z.infer<typeof schema>>({
      nativeSearch: true,
      tier: "operator",
      effort: "low",
      webSearch: 2,
      webFetch: 0,
      maxTokens: 4500,
      requireTerminal: true,
      tools: [tool],
      signal,
      system: [
        "Search the web for the user's exact research brief. Return relevant primary sources where possible. A source being found does not prove the company meets an ICP. Do not contact anyone or modify any external system.",
      ],
      messages: [{ role: "user", content: JSON.stringify(input) }],
      emit: (event) => {
        if (event.type === "search") queries.push(event.query);
        if (event.type === "sources")
          for (const source of event.sources) {
            const url = canonicalUrl(source.url);
            if (url) sources.add(url);
          }
      },
    });
    billed = result.costUsd;
    requests = result.usage.webSearches;
    return { results: (result.result?.results ?? []).filter((r) => sources.has(canonicalUrl(r.url) ?? "")), queries };
  } catch (error) {
    failure = error instanceof AgentError ? error.message : "Claude web search failed.";
    if (error instanceof AgentError) {
      billed = error.costUsd ?? 0;
      requests = error.usage?.webSearches ?? 0;
    }
    throw error;
  } finally {
    try {
      await recordOperation({
        kind: "search",
        provider: "Claude web search",
        query: input.query,
        resultCount: sources.size,
        requests,
        durationMs: Date.now() - started,
        cached: false,
        costUsd: billed,
        ...(failure ? { error: failure } : {}),
      });
      await mutateWorkspace((state) => {
        const key = monthKey();
        state.usage[key] ??= { costUsd: 0, runs: 0, byWorkflow: {}, freeSignals: 0 };
        state.usage[key].costUsd += billed;
        state.usage[key].runs++;
        state.usage[key].byWorkflow.discovery = (state.usage[key].byWorkflow.discovery ?? 0) + billed;
      });
    } finally {
      release(requests);
      nativeState.__inroadNativeResearchHold = Math.max(0, (nativeState.__inroadNativeResearchHold ?? 0) - 0.2);
    }
  }
}

async function runResearch(input: ResearchInput, signal?: AbortSignal): Promise<ResearchResponse> {
  const started = Date.now();
  if (input.since && (!Number.isFinite(Date.parse(input.since)) || new Date(input.since).toISOString().slice(0, 10) !== input.since))
    throw new Error("Choose a valid publication date.");
  if (input.includeDomains.some((d) => !cleanDomains([d]).length) || input.excludeDomains.some((d) => !cleanDomains([d]).length))
    throw new Error("Use domains such as example.com, without paths or wildcards.");
  const provider = activeSearch();
  const warnings: string[] = [];
  const suffix = querySuffix(input);
  const space = 128 - (suffix ? suffix.length + 1 : 0);
  if (provider?.id === "deepseek" && space < 12)
    throw new Error("These filters leave too little query space for DeepSeek. Reduce the domain filters or use another search provider.");
  let queries = planQueries(input.query, provider?.id === "deepseek" ? space : 400);
  let rows: SearchHit[] = [];
  let name = provider?.name ?? "Claude web search";
  if (provider) {
    for (const query of queries) {
      signal?.throwIfAborted();
      const result = await searchWeb(provider, query, 20, { ...input, purpose: input.query, signal });
      if (result.ok) rows.push(...result.value);
      else warnings.push(result.error.message);
    }
    if (warnings.length === queries.length) throw new Error(warnings.join(" "));
  } else if (activeProvider()?.kind === "anthropic" && ["auto", "off"].includes(searchChoice())) {
    name = "Claude web search";
    const native = await nativeSearch(input, signal);
    rows = native.results;
    queries = native.queries;
  } else throw new Error("Choose a search provider in Settings → General → Web search, or connect Claude for native search.");
  const results = rankResults(rows, input.query, input, input.limit);
  if (input.since && results.some((r) => !r.publishedAt)) warnings.push("Some sources don't publish a date. Their freshness is unverified.");
  if (!results.length) warnings.push("No results matched these filters. Try fewer criteria, a broader date range, or a more specific product category.");
  const receipt = await recordOperation({
    kind: "research",
    provider: name,
    query: input.query,
    resultCount: results.length,
    durationMs: Date.now() - started,
    cached: false,
    costUsd: null,
    sourceUrls: results.map((r) => r.url),
  });
  const response = {
    query: input.query,
    queries,
    provider: name,
    results,
    warnings: [...new Set(warnings)],
    receiptId: receipt.id,
    durationMs: Date.now() - started,
  };
  await updateAutomation((data) => {
    data.sessions.unshift({
      ...response,
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      includeDomains: input.includeDomains,
      excludeDomains: input.excludeDomains,
      ...(input.since ? { since: input.since } : {}),
    });
    data.sessions = data.sessions.slice(0, 20);
  });
  return response;
}
export async function attributeAccount(receiptId: string, domain: string) {
  await updateAutomation((data) => {
    const receipt = data.receipts.find((r) => r.id === receiptId);
    if (!receipt) throw new Error("That research session has expired. Search again to attach its provenance.");
    receipt.accountDomains = [...new Set([...(receipt.accountDomains ?? []), domain])];
  });
}
export function researchMetrics() {
  const data = readAutomation(),
    ws = readWorkspace();
  const groups = new Map<
    string,
    {
      provider: string;
      requests: number;
      failures: number;
      cached: number;
      durationMs: number;
      knownCostUsd: number;
      unknownCost: number;
      domains: Set<string>;
    }
  >();
  for (const receipt of data.receipts) {
    const row = groups.get(receipt.provider) ?? {
      provider: receipt.provider,
      requests: 0,
      failures: 0,
      cached: 0,
      durationMs: 0,
      knownCostUsd: 0,
      unknownCost: 0,
      domains: new Set<string>(),
    };
    if (receipt.kind === "search" || receipt.kind === "fetch") {
      row.requests += receipt.requests ?? 1;
      row.cached += Number(receipt.cached);
      row.failures += Number(!!receipt.error && (receipt.requests ?? 1) > 0);
      row.durationMs += receipt.cached ? 0 : receipt.durationMs;
      if (receipt.costUsd === null) row.unknownCost++;
      else row.knownCostUsd += receipt.costUsd;
    }
    for (const domain of receipt.accountDomains ?? []) row.domains.add(domain);
    groups.set(receipt.provider, row);
  }
  return [...groups.values()].map(({ domains, durationMs, ...row }) => {
    for (const account of Object.values(ws.accounts)) if (account.sourceDetail?.startsWith(`${row.provider} ·`)) domains.add(account.domain);
    const deals = Object.values(ws.deals).filter((d) => domains.has(d.accountDomain));
    const activities = ws.activities.filter((a) => a.accountDomain && domains.has(a.accountDomain));
    return {
      ...row,
      meanDurationMs: row.requests ? Math.round(durationMs / row.requests) : 0,
      acceptedAccounts: domains.size,
      meetings: Object.values(ws.meetings).filter((m) => deals.some((d) => d.id === m.dealId)).length,
      replies: activities.filter((a) => a.kind === "reply_received").length,
      won: deals.filter((d) => d.stage === "won").length,
      knownCostPerAccount: domains.size && !row.unknownCost ? row.knownCostUsd / domains.size : null,
    };
  });
}

export const researchWeb = (input: ResearchInput, signal?: AbortSignal) => automationTask(signal, (active) => runResearch(input, active));
