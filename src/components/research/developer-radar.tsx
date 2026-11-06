"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Building2, GitFork, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Favicon } from "@/components/ui/favicon";
import { EmptyState, Segmented } from "@/components/ui/misc";
import { WorkLog } from "@/components/ui/work-log";
import { cn } from "@/lib/client/cn";
import { relativeTime } from "@/lib/client/format";
import type { Workspace } from "@/lib/domain/types";
import { parseRepoInput, radarFindingId, radarSummary } from "@/lib/intent/radar-model";
import { matchAccount } from "@/lib/intent/resolve";
import { ACTIVITY_LABEL, type RadarCompany, type RadarSuggestion } from "@/lib/intent/types";
import { intentAction, isActive, useIntentRun, useUrlParams } from "./use-intent";

const BASIS = { company_org: "GitHub org on their profile", company_site: "their profile's company and site", email: "the email on their profile" } as const;
const stars = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/**
 * Developer radar: engineers forking, filing issues on, commenting on or discussing the repositories in the founder's
 * space, placed at companies only when their own GitHub profile says where they work. GitHub stopped showing who
 * starred a repository in July 2026, so stars are weekly counts.
 */
export function DeveloperRadar({ ws, view, githubToken, canScan, reason }: { ws: Workspace; view: "companies" | "people"; githubToken: boolean; canScan: boolean; reason?: string }) {
  const { refresh } = useWorkspace();
  const { start } = useRuns();
  const router = useRouter();
  const setParams = useUrlParams();
  const run = useIntentRun("radar");
  const running = isActive(run);
  const radar = ws.intent?.radar;
  const [text, setText] = useState(() => (radar?.repos ?? []).map((r) => r.full).join("\n"));
  const [suggestions, setSuggestions] = useState<RadarSuggestion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const repos = parseRepoInput(text);

  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/intent/repos", { cache: "no-store", signal: abort.signal })
      .then((r) => (r.ok ? r.json() : { suggestions: [] }))
      .then((b) => !abort.signal.aborted && setSuggestions(b.suggestions ?? []))
      .catch(() => !abort.signal.aborted && setSuggestions([]));
    return () => abort.abort();
  }, []);

  const known = useMemo(() => (radar?.companies ?? []).filter((c) => matchAccount(ws.accounts, { domain: c.domain })).length, [radar, ws.accounts]);

  async function read() {
    if (!repos.length) return;
    await start("intent", { mode: "radar", repos }, { notify: false });
  }

  async function track(c: RadarCompany) {
    setBusy(c.domain);
    try {
      const r = await intentAction<{ domain: string; created: boolean }>({ action: "track_radar", domain: c.domain });
      await refresh();
      toast(r.created ? `Tracking ${c.name}. Its GitHub activity is on the company as evidence.` : `Added the GitHub activity to ${c.name}.`, {
        action: { label: "Open", onClick: () => router.push(`/companies?c=${encodeURIComponent(r.domain)}`) },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't track that company.");
    } finally {
      setBusy(null);
    }
  }

  const add = (full: string) => setText((t) => [...parseRepoInput(t), full].slice(0, 5).join("\n"));
  const offered = (suggestions ?? []).filter((s) => !repos.some((r) => r.toLowerCase() === s.full.toLowerCase()));

  const form = (
    <section className="rounded-xl bg-surface p-4 shadow-xs ring-1 ring-inset ring-border sm:p-5">
      <label htmlFor="radar-repos" className="block text-[14px] font-medium text-fg">
        Repositories to watch
      </label>
      <p className="mt-1 text-[12.5px] leading-[18px] text-fg-3">Your competitors&apos; and the libraries your buyers use. Up to five, as owner/name or a GitHub link.</p>
      <Textarea id="radar-repos" value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="getlago/lago" className="mt-2.5 min-h-16 font-mono text-[12.5px]" />
      {offered.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {offered.map((s) => (
            <button
              key={s.full}
              type="button"
              onClick={() => add(s.full)}
              title={s.why}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-bg-subtle px-2 py-1 text-[12px] text-fg-2 ring-1 ring-inset ring-border transition-colors hover:bg-surface hover:text-fg"
            >
              <Plus aria-hidden className="size-3 shrink-0" />
              <span className="truncate font-mono">{s.full}</span>
              <span className="shrink-0 text-fg-3">{stars(s.stars)}★</span>
              {s.verified ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Check it</Badge>}
            </button>
          ))}
        </div>
      )}
      {suggestions && offered.length > 0 && <p className="mt-1.5 text-[12px] text-fg-3">Suggested from the competitors in your playbook. Verified means the GitHub org lists the competitor&apos;s website.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button size="sm" variant="primary" icon={<GitFork className="size-3.5" />} disabled={!repos.length || running || !canScan} loading={running} onClick={() => void read()}>
          Read activity
        </Button>
        <span className="text-[12px] text-fg-3">
          {!canScan && reason
            ? reason
            : githubToken
              ? "Free. About 4 requests a repo plus one per profile, within your token's 5,000 an hour."
              : "Free. About 4 requests a repo plus one per profile; GitHub allows 60 an hour without a token."}
          {!githubToken && canScan && (
            <>
              {" "}
              <Link href="/settings#public-data" className="text-fg-2 underline underline-offset-2">
                Add a token
              </Link>
            </>
          )}
        </span>
      </div>
    </section>
  );

  return (
    <div className="space-y-5">
      {form}
      {run && (running || run.error) && <WorkLog run={run} />}
      {!radar ? (
        !running && (
          <EmptyState
            title="See who is building with the tools in your space"
            body="I read the newest forks, issues, pull requests and comments on each repository, then place each person at a company when their public GitHub profile says where they work. Nobody is guessed."
          />
        )
      ) : (
        <>
          <div className="space-y-2">
            <p className="text-[14px] leading-[22px] text-fg">{radarSummary(radar, known)}</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-fg-3">
              {radar.repos.map((r) => (
                <li key={r.full} className="min-w-0">
                  <a href={r.url} target="_blank" rel="noreferrer" className="font-mono text-fg-2 hover:underline">
                    {r.full}
                  </a>
                  {r.error ? <span className="text-danger"> · {r.error}</span> : null}
                  {r.stars !== undefined && !r.error ? ` · ${stars(r.stars)}★` : ""}
                  {r.starsLast30 !== undefined && !r.error ? ` · +${r.starsLast30} stars in ${radar.windowDays} days` : ""}
                </li>
              ))}
            </ul>
            <p className="text-[12px] leading-[17px] text-fg-3">
              Read {relativeTime(radar.at, now)} · {radar.requests} GitHub requests · {radar.totals.profilesRead} profiles · no AI. GitHub shows who starred a repository only to its
              maintainers now, so stars are counts.
              {radar.warnings.map((w) => ` ${w}`).join("")}
            </p>
          </div>

          <Segmented
            layoutId="radar-view"
            value={view}
            onChange={(v) => setParams({ radar: v === "companies" ? null : v })}
            options={[
              { value: "companies", label: "Companies", count: radar.companies.length },
              { value: "people", label: "People", count: radar.people.length },
            ]}
          />

          {view === "companies" ? (
            radar.companies.length ? (
              <ul className="grid gap-3">
                {radar.companies.map((c) => {
                  const domain = matchAccount(ws.accounts, { domain: c.domain });
                  const acc = domain ? ws.accounts[domain] : undefined;
                  const onAccount = !!acc?.signals.some((s) => s.id === `sig_${radarFindingId(domain!)}`);
                  return (
                    <li key={c.domain} className="rounded-xl bg-surface p-4 shadow-xs ring-1 ring-inset ring-border sm:p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Favicon domain={c.domain} name={acc?.name ?? c.name} size={20} />
                        <span className="min-w-0 truncate text-[15px] font-medium text-fg">{acc?.name ?? c.name}</span>
                        <span className="font-mono text-[12px] text-fg-3">{c.domain}</span>
                        {acc ? <Badge tone="neutral">In Companies</Badge> : <Badge tone="agent">New</Badge>}
                      </div>
                      <p className="mt-2 text-[13px] leading-[20px] text-fg-2">{c.line}</p>
                      {c.quote && (
                        <a href={c.quote.url} target="_blank" rel="noreferrer" className="group mt-2.5 block border-l-2 border-accent/50 pl-3">
                          <span className="font-serif text-[14.5px] leading-[22px] text-fg-2 [overflow-wrap:anywhere] group-hover:text-fg">“{c.quote.text}”</span>
                          <span className="mt-0.5 block text-[12px] text-fg-3">
                            {c.quote.login} · {ACTIVITY_LABEL[c.quote.kind].one} on {c.quote.repo} · {relativeTime(c.quote.at, now)}
                          </span>
                        </a>
                      )}
                      <p className="mt-2.5 flex flex-wrap gap-x-2 gap-y-1 text-[12px] text-fg-3">
                        {c.logins.map((l) => (
                          <a key={l} href={`https://github.com/${l}`} target="_blank" rel="noreferrer" className="font-mono hover:text-fg hover:underline">
                            @{l}
                          </a>
                        ))}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {onAccount ? (
                          <Link href={`/companies?c=${encodeURIComponent(domain!)}`} className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-fg-2 hover:bg-bg-subtle hover:text-fg">
                            <Building2 aria-hidden className="size-3.5" /> On {acc!.name}
                          </Link>
                        ) : (
                          <Button size="sm" variant="secondary" icon={<Building2 className="size-3.5" />} loading={busy === c.domain} onClick={() => void track(c)}>
                            {acc ? `Add to ${acc.name}` : "Track company"}
                          </Button>
                        )}
                        {acc && !onAccount && (
                          <Link href={`/companies?c=${encodeURIComponent(domain!)}`} className="text-[12.5px] text-fg-3 hover:text-fg">
                            Open company
                          </Link>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="rounded-xl bg-bg-subtle/60 px-5 py-8 text-center text-[13px] text-fg-2">
                Nobody active on these repositories says where they work on their profile. They&apos;re under People.
              </p>
            )
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl bg-surface shadow-xs ring-1 ring-inset ring-border">
              {radar.people.map((p) => (
                <li key={p.login} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
                  <div className="min-w-0 sm:w-56 sm:shrink-0">
                    <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 font-mono text-[13px] text-fg hover:underline">
                      <span className="truncate">@{p.login}</span>
                      <ArrowUpRight aria-hidden className="size-3 shrink-0 text-fg-3" />
                    </a>
                    {p.name && <p className="truncate text-[12px] text-fg-2">{p.name}</p>}
                    <p className={cn("truncate text-[12px]", p.domain ? "text-fg-2" : "text-fg-3")} title={p.basis ? `From ${BASIS[p.basis]}` : undefined}>
                      {p.domain ? `${p.domain} · ${BASIS[p.basis!]}` : p.company ? `“${p.company}” · not placed` : "Company unknown"}
                    </p>
                  </div>
                  <ul className="min-w-0 flex-1 space-y-1">
                    {p.activity.map((a) => (
                      <li key={a.url} className="text-[12.5px] leading-[18px] text-fg-2 [overflow-wrap:anywhere]">
                        <a href={a.url} target="_blank" rel="noreferrer" className="hover:text-fg hover:underline">
                          {ACTIVITY_LABEL[a.kind].verb.replace(/^./, (ch) => ch.toUpperCase())} {a.repo}
                        </a>
                        <span className="text-fg-3"> · {relativeTime(a.at, now)}</span>
                        {a.title && <span className="block text-fg-3">{a.title}</span>}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
