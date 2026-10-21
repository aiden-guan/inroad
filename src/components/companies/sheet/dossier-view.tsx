"use client";

import { motion } from "motion/react";
import { ArrowUpRight, ChevronDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ComposeButton } from "@/components/compose/composer";
import type { RunState } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { AiBadge, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SourceChip } from "@/components/ui/source";
import { Receipt } from "@/components/ui/work-log";
import { cn } from "@/lib/client/cn";
import { age, hostOf, shortDate } from "@/lib/client/format";
import { daysBetween } from "@/lib/domain/ids";
import { listItem } from "@/lib/motion";
import type { Account, Angle, Dossier, Signal, SignalType } from "@/lib/domain/types";
import { WaysIn } from "@/components/intros/ways-in";
import { usePeopleData } from "@/components/people/use-people-data";
import { PeopleSection } from "./people";
import { Cited, ROLE_LABEL, Section, StrengthDots, useEvidence, useFlagWrong, useHasFlagged, useToday } from "./shared";

const SIGNAL_LABEL: Record<SignalType, string> = {
  champion_job_change: "Champion moved",
  first_hire: "First hire",
  jd_names_pain: "Job post names the pain",
  new_leader: "New leader",
  funding: "Funding",
  stack_change: "Stack change",
  launch: "Launch",
  compliance_deadline: "Compliance deadline",
  persona_post: "They posted",
  community_request: "Asked publicly",
  public_pain: "Public pain",
  filing: "Filing",
  hiring: "Hiring",
  sensitive: "Sensitive",
};

const MOVE_COPY: Record<Dossier["recommendation"]["move"], string> = {
  warm_intro: "Go in warm",
  linkedin_first: "Start on LinkedIn",
  cold_email: "Write a cold email",
  reply_in_thread: "Answer them in the thread",
  watch: "Watch, don't write yet",
  disqualify: "Let this one go",
};

/** Before any research: what code found for free, and the one action that matters. */
export function EnrichmentView({ account, onResearch, researching, lastRun }: { account: Account; onResearch: () => void; researching: boolean; lastRun?: RunState }) {
  const e = account.enrichment;
  return (
    <div className="space-y-8">
      <div className="rounded-lg bg-surface px-5 py-6 ring-1 ring-border">
        <p className="font-serif text-[24px] leading-[30px] tracking-[-0.01em] text-fg">I haven&apos;t researched {account.name} yet.</p>
        <p className="mt-2 max-w-[56ch] text-[14px] leading-[21px] text-fg-2">
          I&apos;ll read their site, open roles, recent news and Hacker News for free, then write a one-screen dossier: why now, who to talk to, and the angle, every fact
          with its source. Usually $0.05–0.15.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant="agent" size="lg" loading={researching} onClick={onResearch} icon={<Search className="size-4" />}>
            {researching ? `Researching ${account.name}` : `Research ${account.name}`}
          </Button>
          {lastRun?.status === "error" && <span className="text-[13px] text-danger">{lastRun.error?.message ?? "The last attempt failed."} Try again.</span>}
        </div>
      </div>

      <WaysIn account={account} />

      <EarlyPeople account={account} />

      {e && (
        <>
          {(e.title || e.description) && (
            <Section label="From their site">
              <p className="text-[14px] leading-[21px] text-fg-2">{e.description || e.title}</p>
            </Section>
          )}
          {e.rolesByTeam.length > 0 && (
            <Section label={`Open roles · ${e.openRoles}`}>
              <ul className="divide-y divide-border rounded-md ring-1 ring-border">
                {e.rolesByTeam.slice(0, 6).map((t) => (
                  <li key={t.team} className="flex items-baseline gap-3 px-3 py-2 text-[13px]">
                    <span className="w-32 shrink-0 truncate font-medium text-fg">{t.team}</span>
                    <span className="font-mono text-[12px] tnum text-fg-3">{t.count}</span>
                    <span className="min-w-0 flex-1 truncate text-fg-2">{t.titles.join(" · ")}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {e.tech.length > 0 && (
            <Section label="Tools they use">
              <div className="flex flex-wrap gap-1.5">
                {e.tech.map((t) => (
                  <Badge key={t} tone="outline">
                    {t}
                  </Badge>
                ))}
              </div>
            </Section>
          )}
          {e.news.length > 0 && (
            <Section label="Recent news">
              <ul className="space-y-2">
                {e.news.slice(0, 5).map((n) => (
                  <li key={n.url} className="flex items-baseline gap-2 text-[13px]">
                    <span className="w-14 shrink-0 font-mono text-[11.5px] text-fg-3">{n.publishedAt ? age(n.publishedAt) : "—"}</span>
                    <a href={n.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 text-fg hover:underline">
                      {n.title}
                    </a>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

/** The dossier: the agent's reading face, every sentence with its receipt. */
export function DossierView({ account, lastRun, onRefresh, refreshing }: { account: Account; lastRun?: RunState; onRefresh: () => void; refreshing: boolean }) {
  const { ws } = useWorkspace();
  const d = account.dossier!;
  const today = useToday();
  const ev = useEvidence();
  const flagged = useHasFlagged();
  const stale = d.staleAfter < today;
  const [showSources, setShowSources] = useState(false);

  const signals = useMemo(() => account.signals.filter((s) => !s.evidenceId || ev([s.evidenceId]).length > 0).slice(0, 6), [account.signals, ev]);
  const people = ws?.people ?? {};
  const recommended = d.recommendation.personId ? people[d.recommendation.personId] : undefined;
  const bestAngle = d.angles[0];
  const sourceIds = useMemo(
    () => [
      ...new Set([
        ...(d.snapshot.descriptionEvidenceIds ?? []),
        ...d.facts.flatMap((f) => f.evidenceIds),
        ...signals.map((s) => s.evidenceId).filter((x): x is string => !!x),
        ...d.painHypotheses.flatMap((p) => p.evidenceIds),
        ...d.angles.flatMap((a) => a.evidenceIds),
        ...(d.snapshot.funding?.evidenceId ? [d.snapshot.funding.evidenceId] : []),
      ]),
    ],
    [d, signals],
  );
  const sources = ev(sourceIds);
  const funding = d.snapshot.funding;

  return (
    <div className="space-y-9">
      {/* Lede */}
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11.5px] text-fg-3">
          <span className="inline-flex items-center gap-1.5">
            <AiBadge /> Researched {shortDate(d.generatedAt)}
          </span>
          {stale ? (
            <span className="inline-flex items-center gap-2">
              <Badge tone="warning">Stale</Badge>
              <button onClick={onRefresh} disabled={refreshing} className="font-sans text-[12px] text-fg-2 underline-offset-2 hover:text-fg hover:underline disabled:opacity-50">
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
            </span>
          ) : (
            <span>fresh until {shortDate(d.staleAfter)}</span>
          )}
          {lastRun && lastRun.status !== "running" && lastRun.status !== "queued" && lastRun.workflow === "dossier" && <Receipt run={lastRun} />}
        </div>
        <Cited evidence={ev(d.snapshot.descriptionEvidenceIds)}>
          <p className="font-serif text-[21px] leading-[30px] tracking-[-0.005em] text-fg text-pretty">{d.snapshot.plainDescription}</p>
        </Cited>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-4">
          <Meta label="Stage" value={d.snapshot.stage} />
          <Meta
            label="Funding"
            value={funding ? `${funding.round}${funding.amountUsd ? ` · $${funding.amountUsd >= 1e6 ? `${Math.round(funding.amountUsd / 1e5) / 10}M` : `${Math.round(funding.amountUsd / 1e3)}K`}` : ""}` : "Unknown"}
            sub={funding ? shortDate(funding.date) : undefined}
            evidenceId={funding?.evidenceId}
          />
          <Meta label="Headcount" value={d.snapshot.headcount ? d.snapshot.headcount.value : "Unknown"} sub={d.snapshot.headcount ? `from ${d.snapshot.headcount.method.replace("_", " ")}` : undefined} />
          <Meta label="HQ" value={d.snapshot.hq ?? "Unknown"} />
        </dl>
        {funding?.useOfFunds && <p className="mt-3 text-[13px] text-fg-2">Said the money goes to: {funding.useOfFunds}</p>}
      </div>

      {/* The one move */}
      <div className="rounded-lg bg-surface p-4 ring-1 ring-border">
        <p className="text-[12px] font-medium text-fg-3">My recommendation</p>
        <p className="mt-1 font-serif text-[19px] leading-[27px] text-fg">
          {MOVE_COPY[d.recommendation.move]}
          {recommended && (
            <>
              {" "}
              with <span className="whitespace-nowrap">{recommended.name}</span>
            </>
          )}
          .
        </p>
        <p className="mt-1 font-serif text-[16px] leading-[24px] text-fg-2">{d.recommendation.why}</p>
        <div className="mt-3">
          <RecommendationAction account={account} angle={bestAngle} personId={recommended?.id} move={d.recommendation.move} signals={signals} />
        </div>
      </div>

      {signals.length > 0 && (
        <Section label="Why now">
          <ul className="space-y-4">
            {signals.map((s, i) => (
              <motion.li key={s.id} variants={listItem} initial="hidden" animate="show" custom={i}>
                <SignalRow signal={s} today={today} />
              </motion.li>
            ))}
          </ul>
        </Section>
      )}
      {signals.length === 0 && (
        <Section label="Why now">
          <p className="font-serif text-[16px] leading-[24px] text-fg-2">Nothing dated and relevant in the last 90 days. That&apos;s a reason to watch, not to write.</p>
        </Section>
      )}

      <WaysIn account={account} />

      <PeopleSection account={account} committee={d.committee} topAngleId={bestAngle?.id} />

      {d.angles.length > 0 && (
        <Section label="Angles">
          <ul className="space-y-4">
            {d.angles.map((a, i) => (
              <motion.li key={a.id} variants={listItem} initial="hidden" animate="show" custom={i}>
                <AngleCard angle={a} account={account} committee={d.committee} needsRewrite={flagged(a.evidenceIds)} />
              </motion.li>
            ))}
          </ul>
        </Section>
      )}

      {d.painHypotheses.length > 0 && (
        <Section label="Pain hypotheses">
          <ul className="space-y-3">
            {d.painHypotheses.map((p, i) => {
              const items = ev(p.evidenceIds);
              if (!items.length) return null;
              const theme = ws?.foundation?.positioning.valueThemes.find((t) => t.id === p.valueThemeId);
              return (
                <li key={i}>
                  <Cited evidence={items}>
                    <p className="prose-agent">{p.pain}</p>
                    <p className="mt-0.5 text-[12px] text-fg-3">
                      {p.confidence} confidence{theme ? ` · maps to “${theme.theme}”` : ""}
                    </p>
                  </Cited>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {d.discoveryOpeners.length > 0 && (
        <Section label="Discovery openers">
          <ol className="space-y-3">
            {d.discoveryOpeners.map((o, i) => (
              <li key={i}>
                <Cited evidence={ev([o.evidenceId])}>
                  <p className="prose-agent">“{o.q}”</p>
                </Cited>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {(d.risks.length > 0 || d.unknowns.length > 0) && (
        <div className="grid gap-8 sm:grid-cols-2">
          {d.risks.length > 0 && (
            <Section label="Risks">
              <ul className="space-y-2 font-serif text-[16px] leading-[24px] text-fg">
                {d.risks.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden className="mt-[11px] size-1 shrink-0 rounded-full bg-warning" />
                    {r}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {d.unknowns.length > 0 && (
            <Section label="What I couldn't verify">
              <ul className="space-y-2 font-serif text-[16px] italic leading-[24px] text-fg-2">
                {d.unknowns.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}

      {d.facts.length > 0 && (
        <Section label="What I know">
          <ul className="space-y-2.5">
            {d.facts.map((f, i) => {
              const items = ev(f.evidenceIds);
              if (!items.length) return null;
              return (
                <li key={i}>
                  <Cited evidence={items}>
                    <p className="font-serif text-[16px] leading-[24px] text-fg">{f.text}</p>
                  </Cited>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {sources.length > 0 && (
        <section>
          <button
            onClick={() => setShowSources((s) => !s)}
            aria-expanded={showSources}
            className="flex items-center gap-1.5 text-[12px] font-medium text-fg-3 transition-colors hover:text-fg-2"
          >
            Sources · {sources.length}
            <ChevronDown className={cn("size-3.5 transition-transform duration-200", showSources && "rotate-180")} />
          </button>
          {showSources && <SourceList ids={sources.map((s) => s.id)} />}
        </section>
      )}
    </div>
  );
}

function Meta({ label, value, sub, evidenceId }: { label: string; value: string; sub?: string; evidenceId?: string }) {
  const ev = useEvidence();
  const flag = useFlagWrong();
  const e = ev([evidenceId])[0];
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-fg-3">{label}</dt>
      <dd className={cn("mt-0.5 truncate font-medium", value === "Unknown" ? "text-fg-3" : "text-fg")}>{value}</dd>
      {(sub || e) && (
        <dd className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-3">
          {sub && <span className="whitespace-nowrap">{sub}</span>}
          {e && <SourceChip url={e.url} publishedAt={e.publishedAt} quote={e.quote} claim={e.claim} confidence={e.confidence} onFlagWrong={() => flag(e.id)} />}
        </dd>
      )}
    </div>
  );
}

function SignalRow({ signal, today }: { signal: Signal; today: string }) {
  const ev = useEvidence();
  const items = ev([signal.evidenceId]);
  const old = daysBetween(signal.date, today) > 90;
  return (
    <Cited evidence={items} chips="below">
      <p className="font-serif text-[17px] leading-[26px] text-fg">{signal.headline}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-3">
        <span>{SIGNAL_LABEL[signal.type]}</span>
        <span aria-hidden>·</span>
        <span className="font-mono">{shortDate(signal.date)}</span>
        <StrengthDots value={signal.strength} max={3} label="Strength" />
        {old && <Badge tone="neutral">Older than 90 days</Badge>}
        {!signal.usableInOutreach && <Badge tone="outline">Context only</Badge>}
        {!items.length && signal.url && <SourceChip url={signal.url} publishedAt={signal.date} />}
      </p>
      <p className="mt-1 font-serif text-[15px] italic leading-[22px] text-fg-2">{signal.implication}</p>
    </Cited>
  );
}

function AngleCard({ angle, account, committee, needsRewrite }: { angle: Angle; account: Account; committee: Dossier["committee"]; needsRewrite: boolean }) {
  const { ws } = useWorkspace();
  const ev = useEvidence();
  const claim = angle.proof?.claimId ? ws?.claims.find((c) => c.id === angle.proof?.claimId) : undefined;
  const personId = committee.find((c) => c.role === angle.bestFor && c.personIds.length)?.personIds[0] ?? account.dossier?.recommendation.personId;
  const person = personId ? ws?.people[personId] : undefined;
  const steps: [string, string | undefined][] = [
    ["Signal", angle.signal],
    ["Means", angle.interpretation],
    ["Pressure", angle.pressure],
    ["Point of view", angle.pov],
    ["Proof", claim?.text ?? angle.proof?.credential],
    ["Ask", angle.ask],
  ];
  return (
    <article className="rounded-lg bg-surface p-4 ring-1 ring-border">
      <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h4 className="min-w-0 flex-1 text-[14px] font-semibold text-fg">{angle.title}</h4>
        {needsRewrite && <Badge tone="warning">Needs rewrite · a source was wrong</Badge>}
        {angle.povId && <Badge tone="outline">Your POV</Badge>}
        <span className="text-[12px] text-fg-3">for the {ROLE_LABEL[angle.bestFor].toLowerCase()}</span>
        <StrengthDots value={angle.strength} max={5} label="Angle strength" />
      </header>
      <Cited evidence={ev(angle.evidenceIds)} chips="below">
        <dl className="space-y-2">
          {steps.map(([label, text]) => (
            <div key={label} className="grid gap-x-4 sm:grid-cols-[92px_minmax(0,1fr)]">
              <dt className="pt-[3px] text-[12px] text-fg-3">{label}</dt>
              <dd className={cn("font-serif text-[16px] leading-[24px]", text ? "text-fg" : "italic text-fg-3")}>{text ?? "None yet. Lead with the point of view, not a claim."}</dd>
            </div>
          ))}
        </dl>
      </Cited>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <ComposeButton domain={account.domain} personId={person?.id} angleId={angle.id} label={person ? `Write to ${person.name.split(" ")[0]}` : "Write outreach"} />
        {!person && <span className="text-[12px] text-fg-3">No named {ROLE_LABEL[angle.bestFor].toLowerCase()} yet; the draft will use the title.</span>}
      </div>
    </article>
  );
}

function RecommendationAction({ account, angle, personId, move, signals }: { account: Account; angle?: Angle; personId?: string; move: Dossier["recommendation"]["move"]; signals: Signal[] }) {
  const { dispatch } = useWorkspace();
  if (move === "reply_in_thread") {
    const thread = signals.find((s) => s.type === "community_request" || s.type === "persona_post") ?? signals[0];
    return thread ? (
      <a href={thread.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-fg shadow-btn transition-transform active:scale-[0.97]">
        Open the thread on {hostOf(thread.url)} <ArrowUpRight className="size-3.5" />
      </a>
    ) : null;
  }
  if (move === "watch") {
    return account.watch ? (
      <p className="text-[13px] text-fg-2">Tracking. I&apos;ll flag the next signal.</p>
    ) : (
      <Button variant="primary" onClick={() => void dispatch({ type: "account.track", domain: account.domain, watch: true })}>
        Track {account.name}
      </Button>
    );
  }
  if (move === "disqualify") return <p className="text-[13px] text-fg-2">Use Disqualify above if you agree.</p>;
  const mode = move === "warm_intro" ? "warm_intro" : move === "linkedin_first" ? "linkedin" : "cold";
  const label = move === "warm_intro" ? "Draft the intro ask" : move === "linkedin_first" ? "Draft a LinkedIn note" : "Write the first email";
  return <ComposeButton domain={account.domain} personId={personId} angleId={angle?.id} mode={mode} label={label} />;
}

function SourceList({ ids }: { ids: string[] }) {
  const ev = useEvidence();
  const flag = useFlagWrong();
  return (
    <ul className="mt-3 divide-y divide-border rounded-md ring-1 ring-border">
      {ev(ids).map((e) => (
        <li key={e.id} className="flex items-start gap-3 px-3 py-2.5 text-[13px]">
          <div className="min-w-0 flex-1">
            <p className="text-fg">{e.claim}</p>
            <p className="mt-0.5 line-clamp-2 font-serif text-[14px] italic leading-[20px] text-fg-3">“{e.quote}”</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <SourceChip url={e.url} publishedAt={e.publishedAt} quote={e.quote} claim={e.claim} confidence={e.confidence} />
            <button onClick={() => flag(e.id)} className="text-[11.5px] text-fg-3 hover:text-danger">
              Wrong?
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Before a dossier: who's on file, and a free people search when Firecrawl is connected. */
function EarlyPeople({ account }: { account: Account }) {
  const { connected } = usePeopleData();
  if (!connected && account.peopleIds.length === 0) return null;
  return <PeopleSection account={account} committee={[]} />;
}
