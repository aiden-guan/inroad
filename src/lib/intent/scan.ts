import "server-only";
import { defineTool } from "@/lib/ai/engine";
import { AgentError } from "@/lib/ai/errors";
import { recordOperation } from "@/lib/automation/store";
import type { Workspace } from "@/lib/domain/types";
import { normalizeDomain } from "@/lib/hub/records";
import { TTL, cached } from "@/lib/signals/cache";
import { githubPerson } from "@/lib/signals/github";
import { activeSearch } from "@/lib/search/search";
import type { WorkflowContext } from "@/lib/workflows/types";
import { attach, intentEvidence, intentSignal, refusal } from "./attach";
import { dedupeCandidates, itemId, mergeItems, prefilter, type Scored } from "./feed";
import { codeVerdict, JUDGE_BATCH, JUDGE_MAX, JUDGE_RULES, judgeContext, judgeMessage, JudgeOutput, toItem, type Judgement } from "./judge";
import { intentProfile, planIntentQueries, type IntentProfile } from "./profile";
import { aboutCompany, matchAccount, nameFromDomain } from "./resolve";
import { fetchSources, hnAbout } from "./sources";
import { emptyIntent, INTENT_LIMITS, SOURCE_LABEL, type IntentItem, type IntentScan, type IntentState } from "./types";

/**
 * One "Asking for it" scan: queries built in code from the playbook, the free sources fetched and deduped in code,
 * one batched pass of the fast model over what's left (each verdict cached per post), then code checks the verdicts,
 * places authors at companies only from their own profiles, and writes the feed. Posts by people at accounts already
 * in Companies become signals on those accounts.
 */

export const WINDOW_DAYS = 30;
const PROFILE_LOOKUPS = 12;

const submitIntent = defineTool({ name: "submit_intent", description: "Submit one verdict per post. Call exactly once.", terminal: true, schema: JudgeOutput });

const judgeKey = (profile: IntentProfile, key: string) => `intent:judge:${profile.hash}:${key}`;

/** Cached verdict, or null. A miss never writes (null isn't cached). */
const peekJudgement = (profile: IntentProfile, key: string) => cached<Judgement | null>(judgeKey(profile, key), 4 * TTL.week, async () => null).catch(() => null);
const saveJudgement = (profile: IntentProfile, key: string, j: Judgement) => cached<Judgement>(judgeKey(profile, key), 4 * TTL.week, async () => j).catch(() => j);

export interface ScanResult {
  added: number;
  kept: number;
  judged: number;
  costUsd: number;
  attached: string[];
}

type Ctx = WorkflowContext<{ mode: "asks" | "radar"; repos?: string[]; windowDays?: number }>;

export async function runIntentScan(ctx: Ctx): Promise<ScanResult> {
  const started = Date.now();
  const ws = ctx.read();
  const profile = intentProfile(ws);
  if (!profile) throw new AgentError("Your playbook isn't written yet, so I don't know what to listen for. Finish the first read of your site first.", "bad_request");
  const state: IntentState = ws.intent ?? emptyIntent();
  const windowDays = ctx.args.windowDays ?? WINDOW_DAYS;
  const plan = planIntentQueries(profile, state.feedback, { reddit: !!activeSearch() });
  if (!plan.queries.length) throw new AgentError("Every query is retired. Bring one back under How this works, or add the buyer's words to your playbook.", "bad_request");

  ctx.emit({ type: "status", text: `Searching ${new Set(plan.queries.map((q) => SOURCE_LABEL[q.source])).size} sources with ${plan.queries.length} queries from your playbook` });
  const fetched = await fetchSources(plan.queries, {
    windowDays,
    now: Date.now(),
    signal: ctx.signal,
    onQuery: (q) => ctx.emit({ type: "search", query: `${SOURCE_LABEL[q.source]}${q.site ? ` (${q.site})` : ""}: ${q.query}` }),
  });
  ctx.signal.throwIfAborted();
  const free = (["hn", "stackexchange", "github"] as const).reduce((n, s) => n + (fetched.requests[s]?.made ?? 0), 0);
  if (free) ctx.noteFreeSignals(free);
  const paid = fetched.requests.reddit?.made ?? 0;
  if (paid) ctx.noteExternalSearch?.(paid);

  const unique = dedupeCandidates(fetched.candidates);
  const dismissed = new Set(state.dismissed.map((d) => d.thread));
  const known = new Set(state.items.map((i) => i.key));
  const { keep } = prefilter(unique, { profile, now: Date.now(), windowDays, dismissed, known, max: JUDGE_MAX });
  ctx.emit({ type: "action", text: `${fetched.candidates.length} posts found, ${unique.length} after duplicates, ${keep.length} mention your playbook` });

  // Verdicts: the cache first, then the fast model in batches, then the code rules if no AI is set up.
  const verdicts = new Map<string, { j: Judgement; byCode?: boolean }>();
  let reused = 0;
  for (const c of keep) {
    const hit = await peekJudgement(profile, c.key);
    if (hit) {
      verdicts.set(c.key, { j: hit });
      reused++;
    }
  }
  const todo = keep.filter((c) => !verdicts.has(c.key));
  let costUsd = 0;
  let judged = 0;
  const tokens = { input: 0, output: 0 };
  const warnings = [...fetched.warnings];
  let blocked: string | undefined;
  const batches: Scored[][] = [];
  for (let i = 0; i < todo.length; i += JUDGE_BATCH) batches.push(todo.slice(i, i + JUDGE_BATCH));
  if (batches.length) ctx.emit({ type: "status", text: `Reading ${todo.length} posts with the fast model` });
  const judge = async (batch: Scored[]) => {
    if (blocked) return;
    try {
      const r = await ctx.agent<JudgeOutput>({
        tier: "fast",
        effort: "low",
        maxTokens: 3500,
        cacheTtl: "1h",
        requireTerminal: true,
        optionalResult: true,
        system: [JUDGE_RULES, judgeContext(profile)],
        messages: [{ role: "user", content: judgeMessage(batch) }],
        tools: [submitIntent],
      });
      costUsd += r.costUsd;
      tokens.input += r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens;
      tokens.output += r.usage.outputTokens;
      for (const v of r.result?.posts ?? []) {
        const c = batch[v.i];
        if (!c || verdicts.has(c.key)) continue;
        const j: Judgement = { label: v.label, relevance: v.relevance, matched: v.matched, quote: v.quote, why: v.why, company: v.company };
        verdicts.set(c.key, { j });
        judged++;
        await saveJudgement(profile, c.key, j);
      }
    } catch (err) {
      if (err instanceof AgentError && err.code === "stopped") throw err;
      if (err instanceof AgentError && ["no_key", "auth", "rate_limit", "no_credit", "model_unavailable"].includes(err.code)) {
        blocked = err.message;
        return;
      }
      warnings.push("One batch of posts couldn't be read by the model; they'll be tried again next scan.");
      console.warn("[intent] judge batch failed:", err instanceof Error ? err.message : err);
    }
  };
  // The first batch writes the prompt cache; the rest read it in parallel.
  if (batches.length) await judge(batches[0]);
  await Promise.all(batches.slice(1).map(judge));
  if (blocked) {
    warnings.push(`The model wasn't available (${blocked.replace(/\.$/, "")}). Posts were sorted by the code rules only.`);
    for (const c of todo) {
      if (verdicts.has(c.key)) continue;
      const j = codeVerdict(c);
      if (j) verdicts.set(c.key, { j, byCode: true });
    }
  }

  const now = new Date().toISOString();
  const competitorDomains = new Set((ws.foundation?.competitors ?? []).map((c) => c.domain?.toLowerCase()).filter(Boolean) as string[]);
  let items: IntentItem[] = [];
  for (const c of keep) {
    const v = verdicts.get(c.key);
    if (!v) continue;
    const item = toItem(c, v.j, profile, { now, lexMatched: c.lexMatched, id: itemId(c.key), byCode: v.byCode });
    if (item) items.push(item);
  }

  // Where the authors work: their own profiles only, a dozen lookups at most per source.
  items = await placeAuthors(ws, items);
  // A competitor's or the founder's own people posting aren't buyers.
  const own = profile.ownDomain;
  items = items.filter((i) => {
    const d = i.company?.domain;
    return !d || (!competitorDomains.has(d) && !(own && (d === own || d.endsWith(`.${own}`))));
  });

  const attached: string[] = [];
  const scan: IntentScan = {
    at: now,
    durationMs: Date.now() - started,
    windowDays,
    queries: plan.queries,
    requests: fetched.requests,
    skipped: [
      ...fetched.skipped,
      ...(profile.consumer ? [{ source: "github" as const, reason: "Left out for consumer companies." }] : []),
      ...(activeSearch() ? [] : [{ source: "reddit" as const, reason: "Needs a web search provider in Settings." }]),
      { source: "bluesky", reason: "Bluesky's public search now needs a signed-in account." },
    ],
    fetched: fetched.candidates.length,
    candidates: keep.length,
    judged,
    reused,
    kept: items.length,
    added: 0,
    costUsd,
    tokens,
    warnings: [...new Set(warnings)].slice(0, 8),
    runId: ctx.runId,
  };
  const written = await ctx.mutate((draft) => {
    const current = draft.intent ?? emptyIntent();
    // Posts by people at accounts the founder already has become signals there (never at a disqualified or
    // do-not-contact company, never the founder's own).
    for (const item of items) {
      const domain = item.company?.domain ? matchAccount(draft.accounts, { domain: item.company.domain }) : undefined;
      if (!domain || refusal(draft, domain)) continue;
      item.trackedDomain = domain;
      if (attach(draft, domain, intentEvidence(item, now, ctx.runId), intentSignal(draft, item))) attached.push(domain);
    }
    const merged = mergeItems(current.items, items, INTENT_LIMITS.items);
    scan.added = merged.added.length;
    draft.intent = { ...current, items: merged.items, scans: [scan, ...current.scans].slice(0, INTENT_LIMITS.scans) };
    return merged.added;
  });

  for (const [source, r] of Object.entries(fetched.requests)) {
    if (source === "reddit" || !r) continue;
    await recordOperation({
      kind: "fetch",
      provider: SOURCE_LABEL[source as keyof typeof SOURCE_LABEL],
      query: `Intent scan: ${plan.queries.filter((q) => q.source === source).length} queries`,
      durationMs: Date.now() - started,
      resultCount: fetched.candidates.filter((c) => c.source === source).length,
      requests: r.made,
      cached: r.made === 0,
      costUsd: 0,
      ...(r.failed && !r.made ? { error: "No answer" } : {}),
    }).catch(() => undefined);
  }

  if (written.length) ctx.emit({ type: "sources", sources: written.slice(0, 30).map((i) => ({ url: i.url, host: SOURCE_LABEL[i.source], title: i.title })) });
  for (const d of [...new Set(attached)].slice(0, 5)) ctx.emit({ type: "action", text: `${ctx.read().accounts[d]?.name ?? d}: added a public post as a signal` });
  ctx.emit({
    type: "status",
    text: written.length ? `${written.length} new ${written.length === 1 ? "post" : "posts"} worth a look` : items.length ? "Nothing new since the last scan" : "Nobody asked in the places I searched",
  });
  return { added: written.length, kept: items.length, judged, costUsd, attached: [...new Set(attached)] };
}

/** GitHub authors from their GitHub profile, Hacker News authors from their "about" field; others stay unplaced. */
async function placeAuthors(ws: Workspace, items: IntentItem[]): Promise<IntentItem[]> {
  let gh = 0;
  let hn = 0;
  const out: IntentItem[] = [];
  for (const item of items) {
    let company = item.company;
    if (!company?.domain && item.author) {
      if (item.source === "github" && gh < PROFILE_LOOKUPS) {
        gh++;
        const p = await githubPerson(item.author).catch(() => null);
        if (p?.domain) {
          company = {
            name: p.company?.replace(/^@/, "") || nameFromDomain(p.domain),
            domain: p.domain,
            basis: p.domainBasis === "email" ? "profile_email" : "profile",
            evidence: p.domainBasis === "email" ? `GitHub profile lists an email at ${p.domain}` : `GitHub profile: company “${(p.company ?? p.domain).slice(0, 60)}”`,
          };
        }
      } else if (item.source === "hn" && hn < PROFILE_LOOKUPS) {
        hn++;
        const { about } = await hnAbout(item.author);
        company = aboutCompany(about) ?? company;
      }
    }
    // A name the author gave in the post is placed only by an exact match to a company already in the workspace.
    if (company && !company.domain) {
      const domain = matchAccount(ws.accounts, { name: company.name });
      if (domain) company = { ...company, domain };
    }
    if (company?.domain) company = { ...company, domain: normalizeDomain(company.domain) ?? company.domain };
    out.push(company ? { ...item, company } : item);
  }
  return out;
}
