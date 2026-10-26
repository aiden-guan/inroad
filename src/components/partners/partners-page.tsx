"use client";

import { Megaphone, Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useToday } from "@/components/companies/list/lib";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { RunInline } from "@/components/today/parts";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { isConsumer } from "@/lib/consumer/market";
import { PARTNER_KIND_LABELS, PLATFORM_LABELS, normalizeHandle, partnerKey, partnerNext } from "@/lib/consumer/partners";
import { newId, nowISO } from "@/lib/domain/ids";
import type { Partner, PartnerKind, PartnerPlatform } from "@/lib/domain/types";
import { PartnerCard } from "./partner-card";

/**
 * Creators and communities: who a consumer company reaches its users through. Grouped by whose move it is, like
 * Intros. One note and one follow-up per partner, paid or gifted posts checked for #ad, results logged per partner.
 */
export function PartnersPage() {
  const { ws } = useWorkspace();
  const today = useToday();
  const params = useSearchParams();
  const focus = params.get("p");
  const [adding, setAdding] = useState(params.get("new") === "1");
  const [showClosed, setShowClosed] = useState(false);

  const groups = useMemo(() => {
    if (!ws || !today) return null;
    const all = Object.values(ws.partners ?? {});
    const closed = all.filter((p) => p.stage === "done" || p.stage === "passed");
    const open = all.filter((p) => !closed.includes(p));
    const yours = open.filter((p) => partnerNext(p, today).action);
    const waiting = open.filter((p) => !yours.includes(p));
    const byAge = (a: Partner, b: Partner) => a.createdAt.localeCompare(b.createdAt);
    return { yours: yours.sort(byAge), waiting: waiting.sort(byAge), closed: closed.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), total: all.length };
  }, [ws, today]);

  useEffect(() => {
    if (!focus || !groups) return;
    document.getElementById(`partner-${focus}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus, groups]);

  if (!ws || !groups || !today) return <PageSkeleton />;
  const live = Object.values(ws.partners ?? {}).filter((p) => p.stage === "live").length;

  return (
    <div className="mx-auto w-full max-w-[860px] px-6 pb-28 pt-8 md:px-10 md:pt-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-[32px] leading-[36px] tracking-[-0.02em]">Creators and communities</h1>
          <p className="mt-1.5 max-w-[58ch] text-[14px] leading-[21px] text-fg-2">
            The people your users already listen to. Audience fit beats size. One note and one follow-up each, paid or gifted posts say #ad, and every result is counted.
          </p>
          {groups.total > 0 && (
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-3">
              <span>
                <span className="font-mono tnum text-fg-2">{groups.yours.length}</span> your move
              </span>
              <span aria-hidden>·</span>
              <span>
                <span className="font-mono tnum text-fg-2">{groups.waiting.length}</span> waiting on them
              </span>
              <span aria-hidden>·</span>
              <span>
                <span className="font-mono tnum text-fg-2">{live}</span> live
              </span>
            </p>
          )}
        </div>
        <Button variant="ghost" icon={<Plus className="size-4" />} onClick={() => setAdding((a) => !a)}>
          Add one
        </Button>
      </header>

      {!isConsumer(ws) && (
        <p className="mt-6 rounded-md bg-bg-subtle px-3 py-2.5 text-[13px] leading-5 text-fg-2">
          This list is built for companies that sell to consumers. You can switch in Settings → General.
        </p>
      )}

      {adding && <AddPartner onDone={() => setAdding(false)} />}

      <div className="mt-6">
        <RunInline
          workflow="partners"
          args={{ mode: "find", count: 8, source: "founder" }}
          runRef={{ kind: "playbook", id: "partners" }}
          label={groups.total ? "Find more" : "Find creators and communities"}
          hint="Up to 5 web searches · about $0.10 · only links I can show you"
        />
      </div>

      {groups.total === 0 ? (
        <div className="mt-10 rounded-lg bg-surface px-6 py-10 text-center ring-1 ring-border">
          <Megaphone className="mx-auto size-6 text-fg-4" aria-hidden />
          <p className="mt-3 font-serif text-[24px] leading-[30px] tracking-[-0.01em] text-fg">Most consumer startups found their first users where they already gathered.</p>
          <p className="mx-auto mt-2 max-w-[52ch] text-[14px] leading-[21px] text-fg-2">
            I&apos;ll look where your segments spend time: the creators they watch, the communities where they ask for help, the newsletters they read.
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          <Group title="Your move" list={groups.yours} today={today} focus={focus} />
          <Group title="Waiting on them" list={groups.waiting} today={today} focus={focus} />
          {groups.closed.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowClosed((s) => !s)} className="text-[13px] text-fg-3 underline-offset-4 hover:text-fg-2 hover:underline">
                {showClosed ? "Hide" : "Show"} done and passed ({groups.closed.length})
              </button>
              {showClosed && <Group title="Done and passed" list={groups.closed} today={today} focus={focus} className="mt-4" />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ title, list, today, focus, className }: { title: string; list: Partner[]; today: string; focus: string | null; className?: string }) {
  if (!list.length) return null;
  return (
    <section className={className} aria-label={title}>
      <SectionLabel>{title}</SectionLabel>
      <div className="space-y-2.5">
        {list.map((p) => (
          <PartnerCard key={p.id} p={p} today={today} focused={focus === p.id} />
        ))}
      </div>
    </section>
  );
}

const KINDS: PartnerKind[] = ["creator", "community", "newsletter", "podcast", "press", "brand"];
const PLATFORMS: PartnerPlatform[] = ["tiktok", "instagram", "youtube", "x", "reddit", "discord", "facebook", "substack", "podcast", "web", "other"];

function AddPartner({ onDone }: { onDone: () => void }) {
  const { ws, dispatch } = useWorkspace();
  const [kind, setKind] = useState<PartnerKind>("creator");
  const [platform, setPlatform] = useState<PartnerPlatform>("tiktok");
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
    const f = Number(followers.replace(/[,\s]/g, ""));
    const partner: Partner = {
      id: newId("ptn"),
      kind,
      ...candidate,
      followers: followers.trim() && Number.isFinite(f) ? f : undefined,
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

  const chip = (active: boolean) => cn("inline-flex h-7 items-center rounded-sm px-2.5 text-[12.5px] ring-1 ring-inset transition-colors duration-150", active ? "bg-fg text-bg ring-fg" : "text-fg-2 ring-border hover:bg-bg-subtle");

  return (
    <form onSubmit={submit} className="mt-6 space-y-3 rounded-lg bg-surface p-4 ring-1 ring-border sm:p-5">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind">
        {KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={chip(kind === k)}>
            {PARTNER_KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Platform">
        {PLATFORMS.map((p) => (
          <button key={p} type="button" role="radio" aria-checked={platform === p} onClick={() => setPlatform(p)} className={chip(platform === p)}>
            {PLATFORM_LABELS[p]}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="pt-name">Name</Label>
          <Input id="pt-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="text-[16px] sm:text-[13px]" />
        </div>
        <div>
          <Label htmlFor="pt-handle" hint="optional">
            Handle
          </Label>
          <Input id="pt-handle" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@maya.runs or r/running" maxLength={60} className="text-[16px] sm:text-[13px]" />
        </div>
        <div>
          <Label htmlFor="pt-url" hint="optional">
            Link
          </Label>
          <Input id="pt-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="tiktok.com/@maya.runs" maxLength={300} className="text-[16px] sm:text-[13px]" />
        </div>
        <div>
          <Label htmlFor="pt-followers" hint="optional, from their profile">
            Followers
          </Label>
          <Input id="pt-followers" inputMode="numeric" value={followers} onChange={(e) => setFollowers(e.target.value)} className="font-mono text-[16px] sm:text-[13px]" />
        </div>
      </div>
      <div>
        <Label htmlFor="pt-fit">Why their audience is yours</Label>
        <Input id="pt-fit" value={fit} onChange={(e) => setFit(e.target.value)} placeholder="Beginner runners, weekly training vlogs, mostly US" maxLength={160} className="text-[16px] sm:text-[13px]" />
      </div>
      {error && <p className="text-[12px] text-danger">{error}</p>}
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
    <div className="mx-auto w-full max-w-[860px] px-6 pt-8 md:px-10 md:pt-12" aria-busy="true">
      <Skeleton className="h-9 w-72" />
      <Skeleton className="mt-3 h-4 w-[70%]" />
      <div className="mt-10 space-y-2.5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
