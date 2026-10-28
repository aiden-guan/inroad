"use client";

import { ArrowRight, Search, X } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { focusAnchor, navigateToHash, useLocationHash } from "@/lib/client/location-hash";
import { todayISO } from "@/lib/domain/ids";
import { SETTINGS_GROUPS, SETTINGS_PAGES, searchSettings, settingsPageFor } from "./catalog";
import { DataSection } from "./data";
import { AiSection, CompanySection, GeneralSection, ImagesSection, SearchSection, SourcesSection } from "./general";
import { SendingSection } from "./sending";
import { UsageSection } from "./usage";
import { useSettingsStatus } from "./use-settings";
import { YouSection } from "./you";

const nowMs = () => Date.now();

/** Each topic has its own panel. Existing hashes open the panel that owns the setting. */
export function SettingsView() {
  const { ws, loading, error, dispatch, refresh } = useWorkspace();
  const settings = useSettingsStatus();
  const [now] = useState(nowMs);
  const [today] = useState(todayISO);
  const [query, setQuery] = useState("");
  const hash = useLocationHash();
  const current = settingsPageFor(hash);
  const results = searchSettings(query);
  const searching = !!query.trim();
  const ready = !!ws;

  useEffect(() => {
    if (!ready || searching || !hash) return;
    const frame = requestAnimationFrame(() => focusAnchor(hash, SETTINGS_PAGES.some((page) => page.id === hash)));
    return () => cancelAnimationFrame(frame);
  }, [hash, ready, searching]);

  function follow(event: MouseEvent<HTMLAnchorElement>, id: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    setQuery("");
    navigateToHash(id, SETTINGS_PAGES.some((page) => page.id === id));
  }

  if (!ws) {
    if (loading) return <SettingsSkeleton />;
    return <EmptyState title="Couldn't open settings" body={error ?? "Something went wrong loading your workspace."} action={<Button variant="primary" onClick={() => void refresh()}>Try again</Button>} />;
  }

  const panels = {
    general: <GeneralSection settings={settings} />,
    you: <YouSection ws={ws} dispatch={dispatch} />,
    company: <CompanySection />,
    sending: <SendingSection ws={ws} dispatch={dispatch} refresh={refresh} now={now} today={today} />,
    ai: <AiSection settings={settings} />,
    search: <SearchSection settings={settings} />,
    images: <ImagesSection settings={settings} />,
    sources: <SourcesSection settings={settings} />,
    usage: <UsageSection ws={ws} dispatch={dispatch} now={now} />,
    data: <DataSection ws={ws} refresh={refresh} dataDir={settings.status?.dataDir ?? null} dataDirInApp={settings.status?.dataDirInApp} today={today} />,
  };

  return (
    <div className="@container/page">
      <div className="mx-auto w-full max-w-[1100px] px-6 pb-24 pt-8 md:px-10 md:pt-12">
        <header className="mb-8">
          <h1 className="font-serif text-[32px] leading-[36px] tracking-[-0.02em] text-fg [font-variation-settings:'opsz'_72]">Settings</h1>
          <p className="mt-2 text-[14px] leading-[21px] text-fg-2">Your workspace, preferences and connected services.</p>
        </header>

        <div className="@min-[880px]/page:grid @min-[880px]/page:grid-cols-[200px_minmax(0,720px)] @min-[880px]/page:gap-10">
          <aside className="sticky top-12 z-30 mb-8 bg-bg py-3 md:top-0 @min-[880px]/page:static @min-[880px]/page:mb-0 @min-[880px]/page:py-0">
            <div className="sticky top-8">
              <div className="relative mb-5">
                <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-fg-3" />
                <Input type="search" aria-label="Search settings" placeholder="Search settings…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }} className="h-9 pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden" />
                {query && <button type="button" aria-label="Clear settings search" onClick={() => setQuery("")} className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-sm text-fg-3 hover:bg-bg-subtle hover:text-fg"><X aria-hidden className="size-3.5" /></button>}
              </div>

              <nav aria-label="Settings sections" className="hidden space-y-5 @min-[880px]/page:block">
                {SETTINGS_GROUPS.map((group) => (
                  <div key={group}>
                    <p className="mb-1.5 px-2.5 text-[11px] font-medium text-fg-3">{group}</p>
                    <ul className="space-y-0.5">
                      {SETTINGS_PAGES.filter((page) => page.group === group).map((page) => (
                        <li key={page.id}>
                          <a href={`#${page.id}`} onClick={(event) => follow(event, page.id)} aria-current={!searching && page.id === current ? "page" : undefined} className={cn("flex min-h-9 items-center rounded-sm px-2.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]", !searching && page.id === current ? "bg-surface font-medium text-fg shadow-xs ring-1 ring-border" : "text-fg-2 hover:bg-bg-subtle hover:text-fg")}>{page.label}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </nav>

              <div className="@min-[880px]/page:hidden">
                <label htmlFor="settings-section" className="mb-1.5 block text-[12px] font-medium text-fg-2">Settings section</label>
                <select id="settings-section" value={current} onChange={(event) => { setQuery(""); navigateToHash(event.target.value, true); }} className="h-10 w-full rounded-sm bg-surface px-3 text-[13px] text-fg ring-1 ring-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
                  {SETTINGS_GROUPS.map((group) => <optgroup key={group} label={group}>{SETTINGS_PAGES.filter((page) => page.group === group).map((page) => <option key={page.id} value={page.id}>{page.label}</option>)}</optgroup>)}
                </select>
              </div>
            </div>
          </aside>

          <div className="min-w-0">
            {searching && (
              <section aria-labelledby="settings-search-title">
                <header className="mb-6 border-b border-border pb-3">
                  <h2 id="settings-search-title" className="font-serif text-[26px] leading-8 text-fg">Search results</h2>
                  <p role="status" className="mt-1 text-[13px] text-fg-3">{results.length} {results.length === 1 ? "setting" : "settings"} matching “{query.trim()}”</p>
                </header>
                {results.length ? (
                  <ul className="divide-y divide-border">
                    {results.map((item) => {
                      const page = SETTINGS_PAGES.find((page) => page.id === item.page)!;
                      return <li key={item.id}><a href={`#${item.id}`} onClick={(event) => follow(event, item.id)} className="group flex items-center gap-4 rounded-sm px-3 py-4 transition-colors hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"><div className="min-w-0 flex-1"><p className="text-[11px] text-fg-3">{page.group} / {page.label}</p><p className="mt-1 text-[14px] font-medium text-fg">{item.label}</p><p className="mt-1 text-[13px] leading-5 text-fg-2">{item.description}</p></div><ArrowRight aria-hidden className="size-4 shrink-0 text-fg-3 group-hover:text-fg" /></a></li>;
                    })}
                  </ul>
                ) : <EmptyState title="No settings found" body="Try a setting name or a term like model, email, theme or backup." action={<Button onClick={() => setQuery("")}>Clear search</Button>} />}
              </section>
            )}
            {/* Keep editors mounted so switching topics preserves unfinished input. */}
            {SETTINGS_PAGES.map((page) => <div key={page.id} hidden={searching || current !== page.id}>{panels[page.id]}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SettingsSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 pt-8 [animation:fade-in_200ms_var(--ease-out)_150ms_both] md:px-10 md:pt-12" aria-busy="true" aria-label="Loading settings">
      <Skeleton className="h-9 w-36" /><Skeleton className="mt-3 h-4 w-72 max-w-full" />
      <div className="mt-8 grid gap-8 md:grid-cols-[200px_1fr]">
        <div className="space-y-3"><Skeleton className="h-9 w-full" />{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-6 w-32" />)}</div>
        <div><Skeleton className="h-8 w-32" /><Skeleton className="mt-6 h-24 w-full rounded-lg" /><Skeleton className="mt-8 h-32 w-full rounded-lg" /></div>
      </div>
    </div>
  );
}
