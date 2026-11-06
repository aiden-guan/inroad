"use client";
import Link from "next/link";
import { ArrowUpRight, Building2, MessageSquareText, X } from "lucide-react";
import type { RunState } from "@/components/providers/runs-provider";
import { AiBadge, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { CopyButton, Markdown } from "@/components/ui/misc";
import { WorkLog } from "@/components/ui/work-log";
import { cn } from "@/lib/client/cn";
import { relativeTime, shortDate } from "@/lib/client/format";
import type { Asset, Workspace } from "@/lib/domain/types";
import { whereLabel } from "@/lib/intent/feed";
import { matchAccount } from "@/lib/intent/resolve";
import { KIND_LABEL, type IntentItem, type IntentSourceId } from "@/lib/intent/types";

const MARK: Record<IntentSourceId, string> = { hn: "HN", stackexchange: "SE", github: "GH", reddit: "R", bluesky: "B" };
const KIND_TONE = { ask: "agent", compare: "info", problem: "neutral" } as const;

const BASIS: Record<NonNullable<IntentItem["company"]>["basis"], string> = {
  profile: "from their profile",
  profile_email: "from the email on their profile",
  profile_site: "from their profile",
  said_in_post: "they say so in the post",
};

/** The reply draft for a post: a founder-content asset with a derived id, so the card always finds its own. */
export const replyAssetId = (item: Pick<IntentItem, "id">) => `ast_${item.id}`.slice(0, 40);

export function IntentCard({
  item,
  ws,
  selected,
  consumer,
  now,
  replyRun,
  busy,
  onSelect,
  onDraft,
  onTrack,
  onDismiss,
}: {
  item: IntentItem;
  ws: Workspace;
  selected: boolean;
  consumer: boolean;
  now: number;
  replyRun?: RunState;
  busy?: "track" | "dismiss" | "draft" | null;
  onSelect: () => void;
  onDraft: () => void;
  onTrack: () => void;
  onDismiss: () => void;
}) {
  const asset: Asset | undefined = ws.assets.find((a) => a.id === (item.replyAssetId ?? replyAssetId(item)));
  const drafting = !!replyRun && (replyRun.status === "running" || replyRun.status === "queued");
  const known = item.company?.domain ? matchAccount(ws.accounts, { domain: item.company.domain }) : undefined;
  const account = known ? ws.accounts[known] : undefined;
  const onAccount = !!item.trackedDomain && !!ws.accounts[item.trackedDomain];
  const posted = item.postedAt ? relativeTime(item.postedAt, now) : null;

  return (
    <article
      id={`intent-${item.id}`}
      aria-current={selected || undefined}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("a,button")) onSelect();
      }}
      className={cn(
        "scroll-mt-24 rounded-xl bg-surface p-4 shadow-xs ring-1 ring-inset transition-[box-shadow] duration-150 sm:p-5",
        selected ? "ring-2 ring-accent/45" : "ring-border hover:ring-border-strong",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-4 text-fg-3">
        <span aria-hidden className="inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] bg-bg-subtle px-1 font-mono text-[12px] font-medium text-fg-2 ring-1 ring-border">
          {MARK[item.source]}
        </span>
        <span className="min-w-0 truncate">{whereLabel(item)}</span>
        <span aria-hidden>·</span>
        <time dateTime={item.postedAt} title={item.postedAt ? new Date(item.postedAt).toLocaleString() : undefined}>
          {posted ?? "Date unknown"}
        </time>
        <span aria-hidden>·</span>
        {item.author ? (
          item.authorUrl ? (
            <a href={item.authorUrl} target="_blank" rel="noreferrer" className="max-w-[16ch] truncate hover:text-fg hover:underline">
              {item.author}
            </a>
          ) : (
            <span className="max-w-[16ch] truncate">{item.author}</span>
          )
        ) : (
          <span>Author unknown</span>
        )}
        <span className="flex flex-1 flex-wrap justify-end gap-1">
          <Badge tone={KIND_TONE[item.kind]}>{KIND_LABEL[item.kind]}</Badge>
          {item.relevance === 3 && <Badge tone="success">Strong</Badge>}
          {item.byCode && <Badge tone="warning">Not checked by AI</Badge>}
        </span>
      </div>

      <a href={item.url} target="_blank" rel="noreferrer" className="group mt-2 flex items-start gap-1 text-[15px] font-medium leading-[21px] text-fg [overflow-wrap:anywhere]">
        <span className="group-hover:underline group-hover:underline-offset-2">{item.title}</span>
        <ArrowUpRight aria-hidden className="mt-[3px] size-3.5 shrink-0 text-fg-3 group-hover:text-fg" />
      </a>

      <blockquote className="mt-2.5 border-l-2 border-accent/50 pl-3 font-serif text-[15px] leading-[23px] text-fg-2 [overflow-wrap:anywhere]">“{item.quote}”</blockquote>
      {item.source === "reddit" && <p className="mt-1.5 text-[12px] text-fg-3">From your search provider&apos;s snippet. Open the thread to read it in full.</p>}

      <p className="mt-2.5 flex items-start gap-1.5 text-[12.5px] leading-[18px] text-fg-2">
        {!item.byCode && <AiBadge className="mt-px shrink-0" />}
        <span className="min-w-0">{item.why}</span>
      </p>

      {item.matched.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="What it matched">
          {item.matched.map((m) => (
            <li key={`${m.kind}:${m.label}`} className="inline-flex max-w-full items-center gap-1 rounded-xs bg-bg-subtle px-1.5 py-0.5 text-[12px] text-fg-2 ring-1 ring-inset ring-border">
              <span className="text-fg-3">{m.kind === "competitor" ? "Competitor" : m.kind === "category" ? "Category" : "Pain"}</span>
              <span className="truncate">{m.label}</span>
            </li>
          ))}
        </ul>
      )}

      {!consumer && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] leading-[18px]">
          {item.company?.domain ? (
            <>
              <Favicon domain={item.company.domain} name={account?.name ?? item.company.name} size={16} />
              <span className="min-w-0 text-fg-2 [overflow-wrap:anywhere]">
                {account ? (
                  <>
                    <span className="font-medium text-fg">{account.name}</span> is in your Companies
                  </>
                ) : (
                  <>
                    Works at <span className="font-medium text-fg">{item.company.name}</span> <span className="text-fg-3">({item.company.domain})</span>
                  </>
                )}
                <span className="text-fg-3"> · {BASIS[item.company.basis]}</span>
              </span>
              <span className="w-full text-[12px] text-fg-3 sm:w-auto" title={item.company.evidence}>
                {item.company.evidence}
              </span>
            </>
          ) : item.company ? (
            <span className="text-fg-3">
              Says they work at <span className="text-fg-2">{item.company.name}</span>. Its website isn&apos;t known, so it can&apos;t be tracked yet.
            </span>
          ) : (
            <span className="text-fg-3">Company unknown: their profile doesn&apos;t say where they work.</span>
          )}
        </div>
      )}

      {(asset || drafting || replyRun?.error) && (
        <div className="mt-4 rounded-lg bg-bg-subtle/60 p-3.5 ring-1 ring-inset ring-border">
          {drafting && replyRun ? (
            <WorkLog run={replyRun} className="shadow-none" />
          ) : asset ? (
            <>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] font-medium text-fg-2">
                  Your reply · drafted {shortDate(asset.updatedAt)} · <span className="font-normal text-fg-3">you post it, in the thread</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <CopyButton text={asset.body} label="Copy reply" />
                  <Link href={`/playbook?asset=${encodeURIComponent(asset.id)}`} className="inline-flex h-7 items-center rounded-sm px-2 text-[12px] font-medium text-fg-2 ring-1 ring-border hover:bg-bg-subtle">
                    Edit
                  </Link>
                </div>
              </div>
              <Markdown className="text-[14px] leading-[22px] [overflow-wrap:anywhere]">{asset.body}</Markdown>
              {!!asset.gaps?.length && (
                <ul className="mt-2 space-y-0.5 text-[12px] text-warning">
                  {asset.gaps.slice(0, 4).map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              )}
            </>
          ) : replyRun?.error ? (
            <WorkLog run={replyRun} className="shadow-none" />
          ) : null}
        </div>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <Button size="sm" variant={asset ? "secondary" : "agent"} icon={<MessageSquareText className="size-3.5" />} loading={busy === "draft" || drafting} disabled={drafting} onClick={onDraft}>
          {asset ? "Redraft reply" : "Draft a reply"}
        </Button>
        {!consumer &&
          (onAccount ? (
            <Link href={`/companies?c=${encodeURIComponent(item.trackedDomain!)}`} className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-fg-2 hover:bg-bg-subtle hover:text-fg">
              <Building2 aria-hidden className="size-3.5" /> On {ws.accounts[item.trackedDomain!]?.name ?? item.trackedDomain}
            </Link>
          ) : item.company?.domain ? (
            <Button size="sm" variant="secondary" icon={<Building2 className="size-3.5" />} loading={busy === "track"} onClick={onTrack}>
              {account ? `Add to ${account.name}` : "Track company"}
            </Button>
          ) : null)}
        <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} loading={busy === "dismiss"} onClick={onDismiss}>
          Not relevant
        </Button>
        <a href={item.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12.5px] text-fg-3 hover:text-fg">
          Open thread <ArrowUpRight aria-hidden className="size-3.5" />
        </a>
      </div>
    </article>
  );
}
