import { connection } from "next/server";
import { z } from "zod";
import { isConsumer } from "@/lib/consumer/market";
import { nowISO } from "@/lib/domain/ids";
import { attach, detach, intentEvidence, intentSignal, REFUSAL_TEXT, refusal, trackItem, trackRadar } from "@/lib/intent/attach";
import { creditQuery, dismissItem, restoreItems } from "@/lib/intent/feed";
import { intentMockBase } from "@/lib/intent/http";
import { intentProfile, planIntentQueries } from "@/lib/intent/profile";
import { matchAccount } from "@/lib/intent/resolve";
import { intentSources } from "@/lib/intent/sources";
import { emptyIntent, type IntentItem } from "@/lib/intent/types";
import { activeSearch } from "@/lib/search/search";
import { hasGithubToken } from "@/lib/signals/github";
import { errorResponse, readJSON } from "@/lib/server/http";
import { mutateWorkspace, readWorkspace } from "@/lib/store/workspace";

/**
 * GET /api/intent: what a scan would do, before it runs. The sources and their limits, the queries the playbook
 * gives (and the ones the founder's "Not relevant" retired), and whether a scan can start. Zero tokens, no network.
 */
export async function GET() {
  await connection();
  try {
    const ws = readWorkspace();
    const profile = intentProfile(ws);
    const plan = profile ? planIntentQueries(profile, ws.intent?.feedback ?? {}, { reddit: !!activeSearch() }) : { queries: [], retired: [] };
    const mock = !!intentMockBase();
    const canScan = !profile
      ? { ok: false, reason: "Your playbook isn't written yet, so there's nothing to listen for." }
      : ws.sample && !mock
        ? { ok: false, reason: "The sample shows example posts. Scanning starts once you set up your own company." }
        : !plan.queries.length
          ? { ok: false, reason: "Every query is retired. Bring one back below." }
          : { ok: true };
    return Response.json(
      {
        sources: intentSources(isConsumer(ws)),
        queries: plan.queries,
        retired: plan.retired,
        canScan,
        mock,
        githubToken: hasGithubToken(),
        search: activeSearch()?.name ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

const Match = z.object({ kind: z.enum(["pain", "competitor", "category"]), label: z.string().max(200) });
/** An item the client hands back for undo: the same shape the server wrote, size-capped. */
const Item = z.object({
  id: z.string().regex(/^int_[a-z0-9]{1,16}$/),
  key: z.string().max(200),
  thread: z.string().max(200),
  source: z.enum(["hn", "stackexchange", "github", "reddit", "bluesky"]),
  site: z.string().max(120).optional(),
  url: z.string().url().max(2000),
  title: z.string().max(240),
  quote: z.string().max(320),
  author: z.string().max(120),
  authorUrl: z.string().url().max(2000).optional(),
  postedAt: z.string().max(40).optional(),
  kind: z.enum(["ask", "problem", "compare"]),
  relevance: z.union([z.literal(2), z.literal(3)]),
  why: z.string().max(200),
  byCode: z.boolean().optional(),
  matched: z.array(Match).max(4),
  company: z
    .object({ name: z.string().max(120), domain: z.string().max(253).optional(), basis: z.enum(["profile", "profile_email", "profile_site", "said_in_post"]), evidence: z.string().max(240) })
    .optional(),
  query: z.string().max(300),
  queryKey: z.string().max(320),
  foundAt: z.string().max(40),
  trackedDomain: z.string().max(253).optional(),
  replyAssetId: z.string().max(40).optional(),
});

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("dismiss"), id: z.string().max(40) }),
  z.object({ action: z.literal("undo_dismiss"), items: z.array(Item).min(1).max(20) }),
  z.object({ action: z.literal("track"), id: z.string().max(40) }),
  z.object({ action: z.literal("track_radar"), domain: z.string().max(253) }),
  z.object({ action: z.literal("reply"), id: z.string().max(40), assetId: z.string().regex(/^ast_[a-z0-9_]{1,36}$/i) }),
  z.object({ action: z.literal("retry_query"), key: z.string().max(320) }),
]);

/**
 * POST /api/intent: the founder's decisions on the feed. "Not relevant" suppresses the thread, teaches the query
 * builder and takes its signal off the account; "Track company" puts the post on the account as evidence and a
 * dated signal; a reply draft counts as a kept post for its query. Nothing is sent or posted anywhere.
 */
export async function POST(request: Request) {
  try {
    const body = Body.parse(await readJSON(request));
    const at = nowISO();
    const { value } = await mutateWorkspace((ws) => {
      const state = ws.intent ?? emptyIntent();
      const find = (id: string) => {
        const item = state.items.find((i) => i.id === id);
        if (!item) throw new Error("That post is no longer in the feed.");
        return item;
      };
      switch (body.action) {
        case "dismiss": {
          const { state: next, removed } = dismissItem(state, body.id, at);
          for (const i of removed) if (i.trackedDomain) detach(ws, i.trackedDomain, i.id);
          ws.intent = next;
          return { removed };
        }
        case "undo_dismiss": {
          const items = body.items as IntentItem[];
          ws.intent = restoreItems(state, items);
          // A post that was on an account goes back on it, unless the account is gone or now refused.
          for (const i of items) if (i.trackedDomain && ws.accounts[i.trackedDomain] && !refusal(ws, i.trackedDomain)) attach(ws, i.trackedDomain, intentEvidence(i, at), intentSignal(ws, i));
          return { restored: items.length };
        }
        case "track": {
          const item = find(body.id);
          if (isConsumer(ws)) throw new Error("Consumer mode has no company list to track this in.");
          const domain = item.company?.domain ? (matchAccount(ws.accounts, { domain: item.company.domain }) ?? item.company.domain) : undefined;
          const refused = refusal(ws, domain);
          if (refused) throw new Error(REFUSAL_TEXT[refused]);
          const { domain: d, created } = trackItem(ws, { ...item, company: { ...item.company!, domain } }, at);
          ws.intent = creditQuery({ ...state, items: state.items.map((i) => (i.id === item.id ? { ...i, trackedDomain: d } : i)) }, item.queryKey);
          return { domain: d, created };
        }
        case "track_radar": {
          const company = state.radar?.companies.find((c) => c.domain === body.domain);
          if (!company) throw new Error("That company is no longer on the radar. Read the repositories again.");
          const refused = refusal(ws, company.domain);
          if (refused) throw new Error(REFUSAL_TEXT[refused]);
          const known = matchAccount(ws.accounts, { domain: company.domain });
          const { domain, created } = trackRadar(ws, known ? { ...company, domain: known } : company, at);
          return { domain, created };
        }
        case "reply": {
          const item = find(body.id);
          const next = item.replyAssetId ? state : creditQuery(state, item.queryKey);
          ws.intent = { ...next, items: next.items.map((i) => (i.id === item.id ? { ...i, replyAssetId: body.assetId } : i)) };
          return { assetId: body.assetId };
        }
        case "retry_query": {
          const feedback = { ...state.feedback };
          delete feedback[body.key];
          ws.intent = { ...state, feedback };
          return { key: body.key };
        }
      }
    });
    return Response.json(value, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, 400);
  }
}
