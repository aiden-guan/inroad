import "server-only";
import type { SearchHit } from "@/lib/search/quality";
import { activeSearch } from "@/lib/search/search";
import { readWorkspace } from "@/lib/store/workspace";
import { dedupeCandidates, prefilter } from "./feed";
import { intentProfile, planIntentQueries } from "./profile";
import { fetchSources } from "./sources";
import { emptyIntent } from "./types";

/**
 * The saved "People asking for it" monitor: the same queries and free sources as a scan, in code only. New posts that
 * mention the playbook become a change to review; nothing is sent to a model until the founder opens Intent and
 * scans. Returns the shape a topic monitor reads (src/lib/automation/monitors.ts).
 */
export async function intentCandidates(signal?: AbortSignal): Promise<{ results: SearchHit[]; warnings: string[] }> {
  const ws = readWorkspace();
  const profile = intentProfile(ws);
  if (!profile) return { results: [], warnings: ["Write your playbook first: the intent monitor listens for its words."] };
  const state = ws.intent ?? emptyIntent();
  const plan = planIntentQueries(profile, state.feedback, { reddit: !!activeSearch() });
  const fetched = await fetchSources(plan.queries, { windowDays: 7, now: Date.now(), signal });
  const { keep } = prefilter(dedupeCandidates(fetched.candidates), {
    profile,
    now: Date.now(),
    windowDays: 7,
    dismissed: new Set(state.dismissed.map((d) => d.thread)),
    known: new Set(state.items.map((i) => i.key)),
    max: 20,
  });
  const results = keep.map((c) => ({ url: c.url, title: c.title, description: c.text.slice(0, 280), ...(c.postedAt ? { publishedAt: c.postedAt } : {}) }));
  const failed = !fetched.candidates.length && Object.values(fetched.requests).every((r) => !r?.made && !r?.cached);
  // "Some sources" warnings don't fail the check; a check where nothing answered does.
  return { results, warnings: failed ? ["None of the sources answered. The monitor will try again."] : fetched.warnings.map((w) => `Some sources: ${w}`) };
}
