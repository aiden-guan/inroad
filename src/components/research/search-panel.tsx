"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Textarea } from "@/components/ui/field";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { useRuns } from "@/components/providers/runs-provider";
import { relativeTime } from "@/lib/client/format";
import { marketOf } from "@/lib/consumer/market";
import { normalizeHandle, partnerCopy, partnerFromUrl, partnerKey } from "@/lib/consumer/partners";
import { newId, nowISO } from "@/lib/domain/ids";
import type { Partner } from "@/lib/domain/types";
import type { ResearchResponse } from "@/lib/search/research";
import type { PageEvidence } from "@/lib/search/pages";
import { localPost, type AutomationController } from "./use-automation";

const NON_COMPANY =
  /(^|\.)(linkedin\.com|youtube\.com|facebook\.com|reddit\.com|techcrunch\.com|crunchbase\.com|ycombinator\.com|medium\.com|substack\.com|github\.com|greenhouse\.io|lever\.co|ashbyhq\.com|google\.com|bing\.com)$/;

/** What the search is for: companies and their evidence for a business; where users gather and talk for a consumer company. */
const SEARCH = {
  b2b: {
    label: "What companies or evidence are you looking for?",
    placeholder: "Usage-based SaaS companies hiring their first finance leader",
    tiles: [
      { title: "Companies worth a look", body: "Find and qualify companies against your playbook. Each one is checked before it's added." },
      { title: "Why now, with a date", body: "New leaders, funding and hiring, each with its source and publication date." },
      { title: "What competitors claim", body: "Their customer stories and launches, to see where you win." },
    ],
  },
  consumer: {
    label: "Where do your users gather, and what are they saying?",
    placeholder: "Subreddits and creators where new runners ask for training advice",
    tiles: [
      { title: "Where they gather", body: "Communities and creators your users already follow." },
      { title: "What they say", body: "Reviews, app store comments and complaints in their own words." },
      { title: "What competitors launch", body: "Their launches and campaigns, with dates." },
    ],
  },
} as const;

/** A search result's title without the platform's suffix ("r/running - Reddit" → "r/running"). */
function partnerName(title: string): string {
  return title.replace(/\s*[-|–·:]\s*(reddit|youtube|tiktok|instagram|linkedin|substack|medium|x|twitter|facebook|discord|apple podcasts|spotify)\s*$/i, "").trim().slice(0, 80);
}

/** Research → Search: the web search workbench (sources, dates, queries), unchanged in behavior. */
export function SearchPanel({ automation, consumer, onMonitor }: { automation: AutomationController; consumer: boolean; onMonitor: (query: string) => void }) {
  const params = useSearchParams();
  const { ws, refresh, dispatch } = useWorkspace();
  const { start } = useRuns();
  const router = useRouter();
  const words = SEARCH[consumer ? "consumer" : "b2b"];
  const partners = partnerCopy(ws ? marketOf(ws) : "b2b");
  const [query, setQuery] = useState(params.get("query") ?? "");
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [since, setSince] = useState("");
  const [result, setResult] = useState<ResearchResponse | null>(null);
  const [page, setPage] = useState<PageEvidence | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const pageController = useRef<AbortController | null>(null);
  const pageAnchor = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (page) pageAnchor.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [page]);
  useEffect(
    () => () => {
      controller.current?.abort();
      pageController.current?.abort();
    },
    [],
  );

  async function search(fresh = false) {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setError(null);
    setResult(null);
    pageController.current?.abort();
    setReading(null);
    setPage(null);
    try {
      const response = await localPost<ResearchResponse>(
        "/api/research/search",
        {
          query,
          includeDomains: include
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          excludeDomains: exclude
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          ...(since ? { since } : {}),
          fresh,
        },
        active.signal,
      );
      if (!active.signal.aborted) {
        setResult(response);
        void automation.reload();
      }
    } catch (error) {
      if (!active.signal.aborted) setError(error instanceof Error ? error.message : "Search failed.");
    } finally {
      if (controller.current === active) setBusy(false);
    }
  }
  async function read(url: string, mode: "auto" | "browser" = "auto") {
    pageController.current?.abort();
    const active = new AbortController();
    pageController.current = active;
    setReading(url);
    setError(null);
    setPage(null);
    try {
      const response = await localPost<PageEvidence>("/api/research/page", { url, mode }, active.signal);
      if (!active.signal.aborted) setPage(response);
    } catch (error) {
      if (!active.signal.aborted) setError(error instanceof Error ? error.message : "Couldn't read that page.");
    } finally {
      if (pageController.current === active) setReading(null);
    }
  }
  async function track(url: string, name: string, description: string, research = false) {
    if (!result) return;
    setAction(url);
    setError(null);
    try {
      const response = await localPost<{ domain: string }>("/api/research/track", { receiptId: result.receiptId, url, name: name.slice(0, 120), description });
      await refresh();
      await automation.reload();
      if (research) await start("dossier", { domain: response.domain });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Couldn't add that website.");
    } finally {
      setAction(null);
    }
  }
  /** A result where people follow or gather goes on the Creators (or Partners) list, as a shortlisted name. */
  async function addPartner(url: string, title: string, description: string) {
    const found = partnerFromUrl(url);
    const candidate = { name: partnerName(title) || title.slice(0, 80), handle: found?.handle ? normalizeHandle(found.handle) : undefined, url, platform: found?.platform ?? "web" };
    const existing = Object.values(ws?.partners ?? {}).find((p) => partnerKey(p) === partnerKey(candidate));
    if (existing) {
      router.push(`/partners?p=${encodeURIComponent(existing.id)}`);
      return;
    }
    const at = nowISO();
    const partner: Partner = {
      id: newId("ptn"),
      kind: found?.kind ?? "creator",
      ...candidate,
      fit: (description || title).trim().slice(0, 160),
      sourceUrl: url,
      source: "founder",
      stage: "shortlist",
      stageHistory: [{ stage: "shortlist", at }],
      createdAt: at,
      updatedAt: at,
    };
    if (await dispatch({ type: "partner.upsert", partner })) {
      toast(`Added ${partner.name} to your ${partners.list}.`, { action: { label: "Open", onClick: () => router.push(`/partners?p=${encodeURIComponent(partner.id)}`) } });
    }
  }
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
        className="space-y-4 rounded-xl bg-surface p-5 shadow-xs ring-1 ring-inset ring-border"
      >
        <label htmlFor="research-query" className="block text-[14px] font-medium text-fg">
          {words.label}
        </label>
        <Textarea id="research-query" value={query} maxLength={1200} onChange={(e) => setQuery(e.target.value)} rows={3} placeholder={words.placeholder} />
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-[12px] text-fg-2">
            Only these sites
            <Input aria-label="Include domains" value={include} onChange={(e) => setInclude(e.target.value)} placeholder="example.com, another.com" />
          </label>
          <label className="text-[12px] text-fg-2">
            Leave out these sites
            <Input aria-label="Exclude domains" value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="pinterest.com" />
          </label>
          <label className="text-[12px] text-fg-2">
            Published since
            <Input aria-label="Published since" type="date" value={since} onChange={(e) => setSince(e.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy || query.trim().length < 2} loading={busy}>
            Search the web
          </Button>
          {busy && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                controller.current?.abort();
                setBusy(false);
              }}
            >
              Stop search
            </Button>
          )}
          {consumer ? (
            <Button type="button" variant="secondary" disabled={busy || !query.trim() || query.trim().length > 300} onClick={() => void start("partners", { mode: "find", count: 8, brief: query.trim(), source: "founder" })}>
              {partners.find}
            </Button>
          ) : (
            <Button type="button" variant="secondary" disabled={busy || !query.trim() || query.trim().length > 300} onClick={() => void start("discovery", { count: 10, brief: query.trim(), source: "manual" })}>
              Find and qualify companies
            </Button>
          )}
          <Link href="/settings#web-search" className="ml-auto text-[12px] text-fg-3 underline underline-offset-2">
            Search providers and limits
          </Link>
        </div>
        <p className="text-[12px] leading-5 text-fg-3">
          {consumer
            ? "Web search returns sources to inspect. Finding creators and communities searches where your segments gather and keeps only links it can show you. Use a brief of 300 characters or fewer."
            : "Web search returns sources to inspect. Find and qualify checks candidates against your playbook and verifies their websites before adding them. Use a brief of 300 characters or fewer for qualification."}
        </p>
      </form>
      {error && (
        <div role="alert" className="mt-4">
          <FieldError>{error}</FieldError>
        </div>
      )}
      {result && (
        <div className="mt-6 space-y-4" aria-busy={busy}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-[13px] text-fg-2">
              {result.results.length} source{result.results.length === 1 ? "" : "s"} · {result.provider} · {(result.durationMs / 1000).toFixed(1)}s
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void search(true)}>
                Refresh sources
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onMonitor(query)}>
                Monitor this search
              </Button>
            </div>
          </div>
          <details className="text-[12px] text-fg-3">
            <summary className="cursor-pointer">Queries used for “{result.query}”</summary>
            <ul className="mt-2 space-y-1">
              {result.queries.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </details>
          {result.warnings.map((warning) => (
            <p key={warning} className="text-[12px] leading-5 text-fg-3">
              {warning}
            </p>
          ))}
          <div className="grid gap-3">
            {result.results.map((hit) => {
              const domain = new URL(hit.url).hostname.replace(/^www\./, "");
              const known = ws?.accounts[domain];
              // Consumer companies collect people and places, not companies; a business adds media links as partners.
              const asPartner = consumer || !!partnerFromUrl(hit.url);
              return (
                <article key={hit.url} className="rounded-lg bg-surface p-4 ring-1 ring-inset ring-border">
                  <p className="break-all text-[11px] text-fg-3">
                    {domain} · {hit.publishedAt ? new Date(hit.publishedAt).toLocaleDateString() : "Publication date unknown"}
                  </p>
                  <a href={hit.url} target="_blank" rel="noreferrer" className="mt-1 block text-[15px] font-medium text-fg [overflow-wrap:anywhere] hover:underline">
                    {hit.title}
                  </a>
                  <p className="mt-2 text-[13px] leading-6 text-fg-2 [overflow-wrap:anywhere]">{hit.description || "No snippet was returned. Read the source to verify its contents."}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" loading={reading === hit.url} disabled={!!reading || busy} onClick={() => void read(hit.url)}>
                      Read source
                    </Button>
                    {asPartner && (
                      <Button size="sm" variant="ghost" onClick={() => void addPartner(hit.url, hit.title, hit.description)}>
                        Add to {partners.list}
                      </Button>
                    )}
                    {consumer ? null : known ? (
                      <Link className="self-center text-[12px] text-fg-2 underline" href={`/companies?c=${encodeURIComponent(domain)}`}>
                        Open saved company
                      </Link>
                    ) : (
                      !NON_COMPANY.test(domain) && (
                        <>
                          <Button size="sm" variant="ghost" disabled={!!action} loading={action === hit.url} onClick={() => void track(hit.url, hit.title, hit.description)}>
                            Track website
                          </Button>
                          <Button size="sm" variant="ghost" disabled={!!action} onClick={() => void track(hit.url, hit.title, hit.description, true)}>
                            Add and research
                          </Button>
                        </>
                      )
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
      {page && (
        <aside ref={pageAnchor} className="mt-6 rounded-xl bg-surface p-5 ring-1 ring-inset ring-border">
          <div className="flex flex-wrap justify-between gap-2">
            <h2 className="text-[16px] font-medium [overflow-wrap:anywhere]">{page.title}</h2>
            <Button size="sm" variant="ghost" onClick={() => setPage(null)}>
              Close source
            </Button>
          </div>
          <a href={page.url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-[12px] text-fg-3 underline">
            {page.url}
          </a>
          <p className="mt-2 text-[12px] text-fg-3">
            Retrieved {new Date(page.retrievedAt).toLocaleString()} through {page.provider}.
          </p>
          {page.warnings.map((w) => (
            <p key={w} className="mt-2 text-[12px] text-fg-3">
              {w}
            </p>
          ))}
          <p className="mt-4 max-h-[500px] overflow-auto whitespace-pre-wrap text-[13px] leading-6 text-fg-2">{page.text}</p>
          {page.method === "http" && (
            <Button size="sm" variant="ghost" disabled={!!reading || busy} onClick={() => void read(page.url, "browser")}>
              Render with optional browser
            </Button>
          )}
        </aside>
      )}
      {!!automation.data?.sessions.length && (
        <section className="mt-8 space-y-2">
          <h2 className="text-[15px] font-medium">Recent research</h2>
          {automation.data.sessions.slice(0, 8).map((session) => (
            <button
              key={session.id}
              type="button"
              className="block w-full rounded-lg p-3 text-left text-[13px] text-fg ring-1 ring-inset ring-border transition-colors hover:bg-bg-subtle"
              onClick={() => {
                controller.current?.abort();
                setBusy(false);
                setResult(session);
                setQuery(session.query);
                setInclude(session.includeDomains.join(", "));
                setExclude(session.excludeDomains.join(", "));
                setSince(session.since ?? "");
                setError(null);
              }}
            >
              <span className="[overflow-wrap:anywhere]">{session.query}</span>
              <span className="mt-1 block text-[11.5px] text-fg-3">
                {session.results.length} sources · {session.provider} · {relativeTime(session.at)}
              </span>
            </button>
          ))}
        </section>
      )}
      {!result && !busy && (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {words.tiles.map((tile) => (
            <div key={tile.title} className="rounded-lg bg-bg-subtle p-4">
              <p className="text-[13px] font-medium text-fg">{tile.title}</p>
              <p className="mt-1 text-[12.5px] leading-[18px] text-fg-2">{tile.body}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
