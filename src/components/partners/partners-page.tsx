"use client";

import { Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useToday } from "@/components/companies/list/lib";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { RunInline } from "@/components/today/parts";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/misc";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { marketOf } from "@/lib/consumer/market";
import { PLATFORM_LABELS, normalizeHandle, partnerCopy, partnerKey, partnerNext, type PartnerCopy } from "@/lib/consumer/partners";
import { newId, nowISO } from "@/lib/domain/ids";
import { parseAmount } from "@/lib/domain/money";
import type { Market, Partner, PartnerKind, PartnerPlatform } from "@/lib/domain/types";
import { ChipRadios, PartnerCard } from "./partner-card";

const FIND_ARGS = { mode: "find", count: 8, source: "founder" } as const;
const FIND_REF = { kind: "playbook", id: "partners" } as const;

/**
 * Who the company reaches its users or buyers through: creators and communities for a consumer company, newsletters,
 * podcasts, communities and partner companies for a business. Grouped by whose move it is, like Intros, with what's
 * live on its own. One note and one follow-up per partner, paid or sponsored posts checked for disclosure, results
 * logged per partner.
 */
export function PartnersPage() {
  const { ws } = useWorkspace();
  const today = useToday();
  const params = useSearchParams();
  const focus = params.get("p");
  const [adding, setAdding] = useState(params.get("new") === "1");
  // null follows the link: a closed partner opened from Today or Ask shows, instead of staying folded away.
  const [showClosed, setShowClosed] = useState<boolean | null>(null);

  const groups = useMemo(() => {
    if (!ws || !today) return null;
    const all = Object.values(ws.partners ?? {});
    const closed = all.filter((p) => p.stage === "done" || p.stage === "passed");
    const open = all.filter((p) => !closed.includes(p));
    const yours = open.filter((p) => partnerNext(p, today).action);
    const live = open.filter((p) => !yours.includes(p) && p.stage === "live");
    const waiting = open.filter((p) => !yours.includes(p) && !live.includes(p));
    const byAge = (a: Partner, b: Partner) => a.createdAt.localeCompare(b.createdAt);
    return {
      yours: yours.sort(byAge),
      waiting: waiting.sort(byAge),
      live: live.sort(byAge),
      closed: closed.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      total: all.length,
    };
  }, [ws, today]);

  // Bring ?p= into view once per arrival. Every save rebuilds the groups, and scrolling again on each one made the
  // page jump while the founder edited an offer or a note. Leaving the page clears the mark.
  const scrolledTo = useRef<string | null>(null);
  useEffect(
    () => () => {
      scrolledTo.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!focus || !groups || scrolledTo.current === focus) return;
    const el = document.getElementById(`partner-${focus}`);
    if (!el) return;
    scrolledTo.current = focus;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus, groups]);

  if (!ws || !groups || !today) return <PageSkeleton />;
  const market = marketOf(ws);
  const copy = partnerCopy(market);
  const addLabel = market === "consumer" ? "Add a creator" : "Add a partner";
  const closedShown = showClosed ?? (!!focus && groups.closed.some((p) => p.id === focus));

  return (
    <PageContainer>
      <PageHeader
        title={copy.title}
        eyebrow={copy.eyebrow}
        description={copy.intro}
        actions={
          <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
            {addLabel}
          </Button>
        }
      >
        {groups.total > 0 && (
          <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-3">
            <span>
              <span className="font-mono tnum text-fg-2">{groups.yours.length}</span> your move
            </span>
            <span aria-hidden>·</span>
            <span>
              <span className="font-mono tnum text-fg-2">{groups.waiting.length}</span> waiting on them
            </span>
            <span aria-hidden>·</span>
            <span>
              <span className="font-mono tnum text-fg-2">{groups.live.length}</span> live
            </span>
          </p>
        )}
      </PageHeader>

      {adding && <AddPartner copy={copy} onDone={() => setAdding(false)} />}

      {groups.total === 0 ? (
        <EmptyPartners copy={copy} market={market} onAdd={() => setAdding(true)} adding={adding} />
      ) : (
        <>
          <div className="mt-6">
            <RunInline workflow="partners" args={FIND_ARGS} runRef={FIND_REF} label="Find more" hint={copy.findHint} variant="secondary" />
          </div>
          <div className="mt-10 space-y-10">
            <Group title="Your move" list={groups.yours} today={today} focus={focus} empty="Nothing waiting on you." />
            <Group title="Waiting on them" list={groups.waiting} today={today} focus={focus} empty="No notes out right now." />
            {groups.live.length > 0 && <Group title="Live" list={groups.live} today={today} focus={focus} />}
            {groups.closed.length > 0 && (
              <section aria-label="Done and passed">
                <button
                  type="button"
                  onClick={() => setShowClosed(!closedShown)}
                  aria-expanded={closedShown}
                  className="rounded-xs px-1 text-[12px] font-medium text-fg-3 transition-colors hover:text-fg-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                >
                  {closedShown ? "Hide" : "Show"} done and passed · {groups.closed.length}
                </button>
                {closedShown && (
                  <div className="mt-3 space-y-2.5">
                    {groups.closed.map((p) => (
                      <PartnerCard key={p.id} p={p} today={today} focused={focus === p.id} />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </>
      )}
    </PageContainer>
  );
}

function Group({ title, list, today, focus, empty }: { title: string; list: Partner[]; today: string; focus: string | null; empty?: string }) {
  if (!list.length && !empty) return null;
  return (
    <section aria-label={title}>
      <SectionLabel>
        {title}
        {list.length > 0 && <span className="ml-1.5 font-mono text-[12px] tnum text-fg-3">{list.length}</span>}
      </SectionLabel>
      {list.length ? (
        <div className="space-y-2.5">
          {list.map((p) => (
            <PartnerCard key={p.id} p={p} today={today} focused={focus === p.id} />
          ))}
        </div>
      ) : (
        <p className="px-1 text-[13px] text-fg-3">{empty}</p>
      )}
    </section>
  );
}

/* ───────────────────────────── Empty: one action that fills the page ───────────────────────────── */

interface Example {
  name: string;
  meta: string;
  fit: string;
  line: string;
}

/** A ghost of the filled page, so the founder sees what the search brings back before running it. */
const EXAMPLES: Record<Market, Example[]> = {
  b2b: [
    { name: "A newsletter your buyers read", meta: "Newsletter · Substack", fit: "A weekly issue for controllers at mid-market SaaS companies", line: "Shortlist · Draft the first note" },
    { name: "A podcast they listen to", meta: "Podcast", fit: "Interviews with the RevOps and finance leads you sell to", line: "Contacted · Waiting on them · follow-up next week" },
    { name: "A community where they ask peers", meta: "Community · Slack", fit: "A channel where finance ops people ask each other how they close", line: "Live · 3 leads from one post" },
  ],
  consumer: [
    { name: "A creator your users watch", meta: "Creator · TikTok", fit: "Weekly videos for people just getting started", line: "Shortlist · Draft the first note" },
    { name: "A community where they ask for help", meta: "Community · Reddit", fit: "Where your users trade tips and recommendations", line: "Contacted · Waiting on them · follow-up next week" },
    { name: "A newsletter they open", meta: "Newsletter", fit: "A Sunday email your users already subscribe to", line: "Live · 12 signups from one issue" },
  ],
};

function EmptyPartners({ copy, market, onAdd, adding }: { copy: PartnerCopy; market: Market; onAdd: () => void; adding: boolean }) {
  return (
    // A card from md up; on a phone the action gets the page's full width, so the long button label still fits.
    <section aria-labelledby="partners-empty-title" className="mt-8 grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:gap-10 md:rounded-xl md:bg-surface md:p-8 md:shadow-sm md:ring-1 md:ring-inset md:ring-border">
      <div className="min-w-0">
        <h2 id="partners-empty-title" className="max-w-[26ch] text-balance font-serif text-[26px] leading-[32px] tracking-[-0.015em] text-fg">
          {copy.emptyTitle}
        </h2>
        <p className="mt-3 max-w-[50ch] text-pretty text-[14px] leading-[22px] text-fg-2">{copy.emptyBody}</p>
        <div className="mt-6">
          <RunInline workflow="partners" args={FIND_ARGS} runRef={FIND_REF} label={copy.find} hint={copy.findHint} />
        </div>
        {!adding && (
          <p className="mt-5 text-[13px] leading-5 text-fg-3">
            Already follow one?{" "}
            <button type="button" onClick={onAdd} className="font-medium text-fg-2 underline-offset-4 hover:text-fg hover:underline">
              Add it yourself
            </button>
          </p>
        )}
      </div>
      <div aria-hidden className="min-w-0 select-none">
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-3">What comes back</p>
        <ul className="space-y-2 opacity-70">
          {EXAMPLES[market].map((e) => (
            <li key={e.name} className="rounded-lg bg-bg-subtle/60 px-4 py-3 ring-1 ring-inset ring-border [border-style:dashed]">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[13.5px] font-medium text-fg-2">{e.name}</span>
                <span className="font-mono text-[12px] text-fg-3">{e.meta}</span>
              </p>
              <p className="mt-0.5 text-[12.5px] leading-[18px] text-fg-3">{e.fit}</p>
              <p className="mt-1.5 text-[12px] text-fg-3">{e.line}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ───────────────────────────── Add one by hand ───────────────────────────── */

const KINDS: PartnerKind[] = ["creator", "community", "newsletter", "podcast", "press", "brand"];

function AddPartner({ copy, onDone }: { copy: PartnerCopy; onDone: () => void }) {
  const { ws, dispatch } = useWorkspace();
  const [kind, setKind] = useState<PartnerKind>("creator");
  const [platform, setPlatform] = useState<PartnerPlatform>(copy.platforms[0]);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [url, setUrl] = useState("");
  const [fit, setFit] = useState("");
  const [followers, setFollowers] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || fit.trim().length < 5) {
      setError("A name and one line on why their audience is yours.");
      return;
    }
    const cleanUrl = url.trim() && !/^https?:\/\//i.test(url.trim()) ? `https://${url.trim()}` : url.trim();
    const candidate = { name: name.trim(), handle: handle.trim() ? normalizeHandle(handle) : undefined, url: cleanUrl || undefined, platform };
    if (Object.values(ws?.partners ?? {}).some((p) => partnerKey(p) === partnerKey(candidate))) {
      setError("They're already on your list.");
      return;
    }
    const at = nowISO();
    // As profiles show it: "18.2K" is 18,200 followers.
    const f = parseAmount(followers);
    const partner: Partner = {
      id: newId("ptn"),
      kind,
      ...candidate,
      followers: f !== null && followers.trim() ? Math.round(f) : undefined,
      fit: fit.trim().slice(0, 160),
      source: "founder",
      stage: "shortlist",
      stageHistory: [{ stage: "shortlist", at }],
      createdAt: at,
      updatedAt: at,
    };
    if (await dispatch({ type: "partner.upsert", partner })) {
      toast(`Added ${partner.name}.`);
      onDone();
    }
  };

  return (
    <form onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && onDone()} aria-label="Add to the list" className="mt-6 space-y-4 rounded-xl bg-surface p-4 shadow-sm ring-1 ring-inset ring-border sm:p-5">
      <div className="space-y-2">
        <ChipRadios label="Kind" value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: copy.kinds[k] }))} />
        <ChipRadios label="Platform" value={platform} onChange={setPlatform} options={copy.platforms.map((p) => ({ value: p, label: PLATFORM_LABELS[p] }))} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="pt-name">Name</Label>
          <Input id="pt-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="text-[16px] sm:text-[13px]" />
        </div>
        <div>
          <Label htmlFor="pt-handle" hint="Optional">
            Handle
          </Label>
          <Input id="pt-handle" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder={copy.handlePlaceholder} maxLength={60} className="text-[16px] sm:text-[13px]" />
        </div>
        <div>
          <Label htmlFor="pt-url" hint="Optional">
            Link
          </Label>
          <Input id="pt-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={copy.urlPlaceholder} maxLength={300} className="text-[16px] sm:text-[13px]" />
        </div>
        <div>
          <Label htmlFor="pt-followers" hint="Optional, from their profile">
            Followers
          </Label>
          <Input id="pt-followers" inputMode="numeric" value={followers} onChange={(e) => setFollowers(e.target.value)} className="font-mono text-[16px] sm:text-[13px]" />
        </div>
      </div>
      <div>
        <Label htmlFor="pt-fit">Why their audience is yours</Label>
        <Input id="pt-fit" value={fit} onChange={(e) => setFit(e.target.value)} placeholder={copy.fitPlaceholder} maxLength={160} aria-invalid={!!error} className="text-[16px] sm:text-[13px]" />
      </div>
      {error && (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm">
          Add to the list
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function PageSkeleton() {
  return (
    <PageContainer aria-busy="true">
      <Skeleton className="h-9 w-72" />
      <Skeleton className="mt-3 h-4 w-[70%]" />
      <div className="mt-10 space-y-2.5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    </PageContainer>
  );
}
