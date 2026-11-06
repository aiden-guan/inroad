"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { EmptyState, Segmented } from "@/components/ui/misc";
import { questionBrief } from "@/components/playbook/model";
import type { Workspace } from "@/lib/domain/types";
import { FRESHNESS, filterItems, matchOptions, sourceCounts, withinWindow, type FeedFilters, type Freshness } from "@/lib/intent/feed";
import { SOURCE_LABEL, type IntentItem, type IntentSourceId } from "@/lib/intent/types";
import { IntentCard, replyAssetId } from "./intent-card";
import { inOverlay, intentAction, isTyping, useUrlParams } from "./use-intent";

const WHEN_LABEL: Record<Freshness, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days", all: "All" };

/** The "Asking for it" feed: filters in the URL, one card per post, keyboard-first (J/K, R, T, X, O). */
export function IntentFeed({ ws, consumer, onScan, canScan }: { ws: Workspace; consumer: boolean; onScan: () => void; canScan: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const setParams = useUrlParams();
  const { refresh } = useWorkspace();
  const { start, runs } = useRuns();
  const [now] = useState(() => Date.now());
  const items = useMemo(() => ws.intent?.items ?? [], [ws.intent?.items]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<{ id: string; what: "track" | "dismiss" | "draft" } | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);

  const when: Freshness = (FRESHNESS as string[]).includes(params.get("when") ?? "") ? (params.get("when") as Freshness) : "30d";
  const source: FeedFilters["source"] = (Object.keys(SOURCE_LABEL) as string[]).includes(params.get("source") ?? "") ? (params.get("source") as IntentSourceId) : "all";
  const match = params.get("match") ?? "all";
  const sort: FeedFilters["sort"] = params.get("sort") === "recent" ? "recent" : "relevance";
  const filters = useMemo<FeedFilters>(() => ({ when, source, match, sort }), [when, source, match, sort]);
  const visible = useMemo(() => filterItems(items.filter((i) => !hidden.has(i.id)), filters, now), [items, hidden, filters, now]);
  const counts = useMemo(() => sourceCounts(items, filters.when, now), [items, filters.when, now]);
  const matches = useMemo(() => matchOptions(items, filters.when, now), [items, filters.when, now]);
  const undated = items.filter((i) => !i.postedAt).length;
  const replyRuns = useMemo(() => {
    const out = new Map<string, (typeof runs)[string]>();
    for (const r of Object.values(runs).sort((a, b) => a.startedAt - b.startedAt)) if (r.workflow === "asset" && r.ref?.id?.startsWith("asset:ast_int_")) out.set(r.ref.id.slice(6), r);
    return out;
  }, [runs]);

  async function dismiss(item: IntentItem) {
    setBusy({ id: item.id, what: "dismiss" });
    setHidden((h) => new Set(h).add(item.id));
    try {
      const { removed } = await intentAction<{ removed: IntentItem[] }>({ action: "dismiss", id: item.id });
      await refresh();
      toast(removed.length > 1 ? `Hidden ${removed.length} posts from that thread. I'll search a little less like that.` : "Hidden. I'll search a little less like that.", {
        action: {
          label: "Undo",
          onClick: () =>
            void intentAction({ action: "undo_dismiss", items: removed })
              .then(() => refresh())
              .then(() => setHidden((h) => new Set([...h].filter((id) => !removed.some((r) => r.id === id)))))
              .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't undo that.")),
        },
      });
    } catch (e) {
      setHidden((h) => new Set([...h].filter((id) => id !== item.id)));
      toast.error(e instanceof Error ? e.message : "Couldn't hide that post.");
    } finally {
      setBusy(null);
    }
  }

  async function track(item: IntentItem) {
    setBusy({ id: item.id, what: "track" });
    try {
      const r = await intentAction<{ domain: string; created: boolean }>({ action: "track", id: item.id });
      await refresh();
      toast(r.created ? `Tracking ${item.company?.name ?? r.domain}, with this post as its why now.` : `Added the post to ${item.company?.name ?? r.domain} as a signal.`, {
        action: { label: "Open", onClick: () => router.push(`/companies?c=${encodeURIComponent(r.domain)}`) },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't track that company.");
    } finally {
      setBusy(null);
    }
  }

  async function draft(item: IntentItem) {
    const assetId = item.replyAssetId ?? replyAssetId(item);
    setBusy({ id: item.id, what: "draft" });
    try {
      const run = await start(
        "asset",
        { kind: "community_answer", title: item.title.slice(0, 120), brief: questionBrief({ title: item.title, text: item.quote, url: item.url }), assetId },
        { notify: false },
      );
      if (run) await intentAction({ action: "reply", id: item.id, assetId });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the reply.");
    } finally {
      setBusy(null);
    }
  }

  // Keyboard: J/K move, R reply, T track, X not relevant, O (or Enter) opens the thread. Re-bound each render, so it
  // always acts on the rows on screen.
  useEffect(() => {
    let lastG = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || inOverlay(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "g") {
        lastG = e.timeStamp;
        return;
      }
      if (lastG && e.timeStamp - lastG < 1200) {
        lastG = 0;
        return;
      }
      const rows = visible;
      const at = cursor;
      if (!rows.length) return;
      const idx = rows.findIndex((r) => r.id === at);
      if (k === "j" || k === "k" || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = k === "j" || e.key === "ArrowDown" ? 1 : -1;
        const next = rows[Math.max(0, Math.min(rows.length - 1, (idx < 0 ? (d > 0 ? -1 : rows.length) : idx) + d))];
        setCursor(next.id);
        const ae = document.activeElement as HTMLElement | null;
        if (ae && ae !== document.body) ae.blur();
        document.getElementById(`intent-${next.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && t !== document.body && t.closest?.("a,button,summary,[role=button],[role=tab],[role=menuitem]")) return;
      if (idx < 0) return;
      const row = rows[idx];
      if (k === "o" || e.key === "Enter") {
        e.preventDefault();
        window.open(row.url, "_blank", "noopener,noreferrer");
      } else if (k === "r") {
        e.preventDefault();
        void draft(row);
      } else if (k === "t" && row.company?.domain && !row.trackedDomain && !consumer) {
        e.preventDefault();
        void track(row);
      } else if (k === "x") {
        e.preventDefault();
        const next = rows[idx + 1] ?? rows[idx - 1];
        setCursor(next?.id ?? null);
        void dismiss(row);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!items.length) {
    return (
      <EmptyState
        title={consumer ? "Find people asking for what you make" : "Find people asking for what you sell"}
        body={`I search Hacker News, Stack Exchange${consumer ? "" : ", GitHub issues"} and Reddit (through your search provider) for the problems in your playbook. A fast model keeps the posts where someone has the problem now. A scan uses about 15 free requests and well under a cent of AI.`}
        action={
          <Button variant="agent" onClick={onScan} disabled={!canScan}>
            Scan now
          </Button>
        }
      />
    );
  }

  const totalInWindow = items.filter((i) => withinWindow(i, filters.when, now)).length;
  const widen = FRESHNESS.find((w) => FRESHNESS.indexOf(w) > FRESHNESS.indexOf(filters.when) && items.some((i) => withinWindow(i, w, now)));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          layoutId="intent-when"
          value={filters.when}
          onChange={(v) => setParams({ when: v === "30d" ? null : v })}
          options={FRESHNESS.map((w) => ({ value: w, label: WHEN_LABEL[w], count: items.filter((i) => withinWindow(i, w, now)).length || undefined }))}
        />
        <label className="sr-only" htmlFor="intent-source">
          Source
        </label>
        <Select id="intent-source" value={filters.source} onChange={(e) => setParams({ source: e.target.value === "all" ? null : e.target.value })} className="h-9 max-w-full text-[12.5px]">
          <option value="all">All sources</option>
          {(Object.keys(SOURCE_LABEL) as IntentSourceId[])
            .filter((s) => counts[s])
            .map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]} ({counts[s]})
              </option>
            ))}
        </Select>
        <label className="sr-only" htmlFor="intent-match">
          Matched
        </label>
        <Select id="intent-match" value={filters.match} onChange={(e) => setParams({ match: e.target.value === "all" ? null : e.target.value })} className="h-9 max-w-[min(100%,22rem)] text-[12.5px]">
          <option value="all">Every pain and competitor</option>
          {matches.map((m) => (
            <option key={m.key} value={m.key}>
              {m.match.kind === "competitor" ? "Competitor" : m.match.kind === "category" ? "Category" : "Pain"}: {m.match.label.length > 48 ? `${m.match.label.slice(0, 47)}…` : m.match.label} ({m.count})
            </option>
          ))}
        </Select>
        <span className="flex-1" />
        <Segmented
          layoutId="intent-sort"
          value={filters.sort}
          onChange={(v) => setParams({ sort: v === "relevance" ? null : v })}
          options={[
            { value: "relevance", label: "Most relevant" },
            { value: "recent", label: "Newest" },
          ]}
        />
      </div>

      <p className="mt-3 hidden items-center gap-1.5 text-[12px] text-fg-3 md:pointer-fine:flex">
        <Kbd>J</Kbd>
        <Kbd>K</Kbd> move · <Kbd>R</Kbd> draft a reply · <Kbd>T</Kbd> track · <Kbd>X</Kbd> not relevant · <Kbd>O</Kbd> open the thread
      </p>

      {visible.length ? (
        <div className="mt-4 grid gap-3" role="feed" aria-label="Posts asking for what you sell" aria-busy={!!busy}>
          {visible.map((item) => (
            <IntentCard
              key={item.id}
              item={item}
              ws={ws}
              consumer={consumer}
              now={now}
              selected={cursor === item.id}
              replyRun={replyRuns.get(item.replyAssetId ?? replyAssetId(item))}
              busy={busy?.id === item.id ? busy.what : null}
              onSelect={() => setCursor(item.id)}
              onDraft={() => void draft(item)}
              onTrack={() => void track(item)}
              onDismiss={() => void dismiss(item)}
            />
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-xl bg-bg-subtle/60 px-5 py-8 text-center text-[13px] leading-[20px] text-fg-2">
          {totalInWindow ? "Nothing matches these filters." : `Nobody posted in the last ${WHEN_LABEL[filters.when].toLowerCase()}.`}
          {widen && (
            <Button size="sm" variant="secondary" className="ml-3" onClick={() => setParams({ when: widen === "30d" ? null : widen, source: null, match: null })}>
              Show {WHEN_LABEL[widen].toLowerCase()}
            </Button>
          )}
        </div>
      )}
      {filters.when !== "all" && undated > 0 && (
        <p className="mt-3 text-[12px] text-fg-3">
          {undated === 1 ? "1 post has" : `${undated} posts have`} no date, so {undated === 1 ? "it shows" : "they show"} only under All.
        </p>
      )}
    </div>
  );
}
