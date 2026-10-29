"use client";

import { LoadingSignal } from "@/components/ui/loading";
import { NotebookPen } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAsk } from "@/components/providers/ask-provider";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { todayISO } from "@/lib/domain/ids";
import { PlaybookContext, type AssetRunArgs, type PlaybookContextValue } from "./context";
import { PlaybookDocument } from "./document";
import { ASSET_KINDS, isContentKind, parts, type AssetKind } from "./model";

function isKind(k: string | null): k is AssetKind {
  return !!k && k in ASSET_KINDS;
}

function hashAsset(): string | null {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(/^#asset:(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Playbook: what the agent believes about the business, editable in place.
 * URL: `#who|why|how|voice|journal` (or any subsection id), `?asset=<id>` opens an asset,
 * `?new=<kind>&deal=<dealId>` opens the new-asset panel (e.g. a pilot proposal from a debrief);
 * `?new=creator_brief&partner=<id>` opens it for one creator.
 */
export function PlaybookView() {
  const { ws, loading, error, dispatch, refresh } = useWorkspace();
  const { runs, start } = useRuns();
  const { openAsk } = useAsk();
  const params = useSearchParams();
  const [today] = useState(todayISO);
  // `?asset=<id>`, or `#asset:<id>` (what `hrefFor` builds from an asset run's ref).
  const [openAsset, setOpenAsset] = useState<string | null>(() => params.get("asset") ?? hashAsset());
  const [composer, setComposer] = useState<PlaybookContextValue["composer"]>(() => {
    const kind = params.get("new");
    return isKind(kind) ? { kind, dealId: params.get("deal") ?? undefined, partnerId: params.get("partner") ?? undefined } : null;
  });

  // Arriving from a link: bring the target into view once, as soon as the document exists.
  const ready = !!ws?.foundation;
  const arrived = useRef(false);
  useEffect(() => {
    if (!ready || arrived.current) return;
    arrived.current = true;
    const asset = params.get("asset") ?? hashAsset();
    const kind = params.get("new");
    const target = asset ? `asset-${asset}` : isKind(kind) ? (isContentKind(kind) ? "content" : "assets") : window.location.hash.slice(1);
    if (!target) return;
    // A frame cancelled before it ran (Strict Mode's second mount, arriving from ⌘K with the workspace loaded) tries again.
    let ran = false;
    const frame = requestAnimationFrame(() => {
      ran = true;
      document.getElementById(target)?.scrollIntoView({ block: "start" });
    });
    return () => {
      cancelAnimationFrame(frame);
      if (!ran) arrived.current = false;
    };
  }, [ready, params]);

  const assetRuns = useMemo(() => Object.values(runs).filter((r) => r.workflow === "asset").sort((a, b) => b.startedAt - a.startedAt), [runs]);

  const draftAsset = useCallback(
    async (args: AssetRunArgs) => {
      const run = await start("asset", args, {
        onResult: (result) => {
          const id = (result as { assetId?: string } | null)?.assetId;
          if (id) setOpenAsset(id);
        },
      });
      return !!run;
    },
    [start],
  );

  if (!ws) {
    if (loading) return <PlaybookSkeleton />;
    return (
      <EmptyState
        title="Couldn't open your playbook"
        body={error ?? "Something went wrong loading your workspace."}
        action={
          <Button variant="primary" onClick={() => void refresh()}>
            Try again
          </Button>
        }
      />
    );
  }

  if (!ws.foundation) {
    return (
      <div className="mx-auto max-w-[720px] px-6 pt-16 md:px-10">
        <EmptyState
          icon={<NotebookPen className="size-6" />}
          title="Your playbook starts with your website"
          body="I read your site, ask you two questions and write a first bet: who to sell to, why they'd buy, and what to say. It takes about a minute, and everything stays editable."
          action={
            <Link
              href="/welcome"
              className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-[14px] font-medium text-accent-fg shadow-btn transition-[background-color,transform] duration-150 ease-out-quad hover:bg-accent-hover active:scale-[0.97]"
            >
              Start with your website
            </Link>
          }
        />
      </div>
    );
  }

  const value: PlaybookContextValue = {
    ws,
    f: ws.foundation,
    p: parts(ws.foundation),
    today,
    dispatch,
    set: (path, v) => void dispatch({ type: "foundation.set", path, value: v }),
    assetRuns,
    draftAsset,
    openAsk: (section) => openAsk({ context: { kind: "playbook", id: section } }),
    openAsset,
    setOpenAsset,
    composer,
    setComposer,
  };

  return (
    <PlaybookContext.Provider value={value}>
      <PlaybookDocument />
    </PlaybookContext.Provider>
  );
}

/** Matches the document's layout; fades in after 150ms so fast loads never flash it. */
export function PlaybookSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1240px] px-6 pt-8 [animation:fade-in_200ms_var(--ease-out)_150ms_both] md:px-10 md:pt-12" aria-busy="true" aria-label="Loading your playbook">
      <div className="lg:grid lg:grid-cols-[156px_minmax(0,720px)] lg:justify-center lg:gap-x-12">
        <div className="hidden space-y-2 lg:block">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-6 w-28" />
          ))}
        </div>
        <div className="mx-auto w-full max-w-[720px]">
      <LoadingSignal label="Opening your playbook" className="mb-7" />
          <Skeleton className="h-9 w-40" />
          <Skeleton className="mt-3 h-4 w-[70%]" />
          <Skeleton className="mt-12 h-20 w-full rounded-lg" />
          <Skeleton className="mt-14 h-8 w-24" />
          <div className="mt-6 space-y-2.5">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-[92%]" />
            <Skeleton className="h-6 w-[60%]" />
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
