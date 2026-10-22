"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, FileText, MoreHorizontal, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { AiBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { CopyButton, Markdown, Segmented } from "@/components/ui/misc";
import { Receipt, WorkLog } from "@/components/ui/work-log";
import { cn } from "@/lib/client/cn";
import { duration, shortDate, usd } from "@/lib/client/format";
import { useModKeys } from "@/lib/client/platform";
import { newId, nowISO } from "@/lib/domain/ids";
import { OPEN_STAGES, STAGE_LABELS, type Asset, type Deal } from "@/lib/domain/types";
import { ease, listItem, spring } from "@/lib/motion";
import { usePlaybook } from "./context";
import { ASSET_KINDS, CREATABLE_KINDS, assetGate, checkAsset, debriefCount, plural, type AssetKind } from "./model";
import { SIERRA_URL, designPartnerKit, templateFor } from "./templates";
import { DraftLabel, ResearchCite, Sub, undoable } from "./ui";

function openDeals(deals: Record<string, Deal>): Deal[] {
  return Object.values(deals)
    .filter((d) => OPEN_STAGES.includes(d.stage))
    .sort((a, b) => OPEN_STAGES.indexOf(b.stage) - OPEN_STAGES.indexOf(a.stage) || b.updatedAt.localeCompare(a.updatedAt));
}

/* ───────────────────────────── Library ───────────────────────────── */

export function AssetsBlock() {
  const { ws, assetRuns, composer, setComposer } = usePlaybook();
  const assets = ws.assets.filter((a) => a.kit !== "design_partner").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const drafting = assetRuns.filter((r) => r.status === "running" || r.status === "queued");
  const approved = assets.filter((a) => a.approved).length;

  return (
    <Sub
      id="assets"
      title="Assets"
      hint="What your emails can offer instead of a meeting. A CTA that offers a one-pager, a demo or terms must point at an approved asset here."
      right={
        <Menu
          trigger={
            <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />}>
              New
            </Button>
          }
        >
          <MenuLabel>New asset</MenuLabel>
          {CREATABLE_KINDS.map((k) => (
            <MenuItem key={k} onSelect={() => setComposer({ kind: k })}>
              {ASSET_KINDS[k].label}
            </MenuItem>
          ))}
        </Menu>
      }
    >
      <AnimatePresence initial={false}>
        {composer && (
          <motion.div
            key={`${composer.kind}-${composer.dealId ?? ""}`}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: ease.out } }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            className="mb-4"
          >
            <NewAsset kind={composer.kind} initialDealId={composer.dealId} onClose={() => setComposer(null)} />
          </motion.div>
        )}
      </AnimatePresence>

      {drafting.length > 0 && (
        <div className="mb-3 space-y-2">
          {drafting.map((r) => (
            <WorkLog key={r.id} run={r} />
          ))}
        </div>
      )}

      {assets.length === 0 && drafting.length === 0 && !composer ? (
        <div className="rounded-lg bg-surface p-5 ring-1 ring-border">
          <p className="font-serif text-[17px] leading-[26px] text-fg">Nothing to offer yet.</p>
          <p className="mt-1 max-w-[52ch] text-[13.5px] leading-5 text-fg-2">
            Founders who offer something useful get replies without asking for a meeting. Start with a one-pager; it&apos;s built from this playbook and only uses claims you approved.
          </p>
          <div className="mt-4">
            <Button size="sm" variant="primary" onClick={() => setComposer({ kind: "one_pager" })}>
              Make a one-pager
            </Button>
          </div>
        </div>
      ) : (
        assets.length > 0 && (
          <>
            <AssetList assets={assets} />
            <p className="mt-2 font-mono text-[11.5px] text-fg-3">
              {approved} of {assets.length} approved for outreach
            </p>
          </>
        )
      )}
    </Sub>
  );
}

function AssetList({ assets }: { assets: Asset[] }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg bg-surface ring-1 ring-border">
      <AnimatePresence initial={false}>
        {assets.map((a, i) => (
          <motion.li key={a.id} layout="position" variants={listItem} initial="hidden" animate="show" exit={{ opacity: 0, transition: { duration: 0.1 } }} custom={i}>
            <AssetRow asset={a} />
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function AssetRow({ asset }: { asset: Asset }) {
  const { ws, openAsset, setOpenAsset } = usePlaybook();
  const open = openAsset === asset.id;
  const deal = asset.dealId ? ws.deals[asset.dealId] : undefined;
  const gaps = checkAsset(ws, asset).placeholders.length;
  return (
    <div id={`asset-${asset.id}`} className="scroll-mt-28">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpenAsset(open ? null : asset.id)}
        className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-150 hover:bg-bg-subtle focus-visible:bg-bg-subtle sm:px-4"
      >
        <FileText className="size-4 shrink-0 text-fg-3" aria-hidden />
        <span className="min-w-0 flex-1">
          {/* Open: the editor below carries the (editable) title, so the row shrinks to its metadata. */}
          <span className={cn("block truncate text-[14px] font-medium text-fg", open && "sr-only")}>{asset.title || "Untitled"}</span>
          <span className="block truncate text-[12px] text-fg-3">
            {ASSET_KINDS[asset.kind].label}
            {deal && ` · ${deal.name}`}
            {asset.url && " · hosted"}
          </span>
        </span>
        {!asset.approved && gaps > 0 && <span className="hidden text-[12px] text-warning sm:inline">{plural(gaps, "gap")}</span>}
        {asset.approved ? (
          <span className="inline-flex items-center gap-1 text-[12px] text-fg-2">
            <Check className="size-3.5" aria-hidden /> Approved
          </span>
        ) : (
          <DraftLabel />
        )}
        <span className="hidden w-12 text-right font-mono text-[11.5px] text-fg-3 sm:inline">{shortDate(asset.updatedAt)}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-fg-3 transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.15 } }}
            transition={spring.smooth}
            className="overflow-hidden"
          >
            <AssetEditor asset={asset} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ───────────────────────────── New asset ───────────────────────────── */

function NewAsset({ kind, initialDealId, onClose }: { kind: AssetKind; initialDealId?: string; onClose: () => void }) {
  const { ws, dispatch, draftAsset, setOpenAsset } = usePlaybook();
  const deals = openDeals(ws.deals);
  const meta = ASSET_KINDS[kind];
  const needsDeal = kind === "pilot_proposal";
  const [dealId, setDealId] = useState<string | undefined>(initialDealId && ws.deals[initialDealId] ? initialDealId : needsDeal ? deals[0]?.id : undefined);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const gate = assetGate(ws, { kind, dealId });
  const deal = dealId ? ws.deals[dealId] : undefined;

  const fromTemplate = () => {
    const t = templateFor(kind, ws, { deal, calls: debriefCount(ws) });
    const at = nowISO();
    const asset: Asset = { id: newId("ast"), kind, title: t.title, body: t.body, createdAt: at, updatedAt: at, approved: false, dealId, gaps: [], origin: "template" };
    void dispatch({ type: "asset.upsert", asset });
    setOpenAsset(asset.id);
    onClose();
  };

  const draft = async () => {
    setBusy(true);
    const ok = await draftAsset({ kind, dealId, brief: brief.trim() || undefined, assetId: newId("ast") });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <div className="rounded-lg bg-surface p-4 shadow-sm ring-1 ring-border sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[14.5px] font-semibold">New {meta.label.toLowerCase()}</p>
          <p className="mt-0.5 text-[13px] leading-5 text-fg-3">{meta.description}</p>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="inline-flex size-7 items-center justify-center rounded-sm text-fg-3 transition-colors hover:bg-bg-subtle hover:text-fg">
          <X className="size-4" />
        </button>
      </div>

      {needsDeal && (
        <div className="mt-4">
          <p className="mb-1.5 text-[12px] font-medium text-fg-2">For which deal?</p>
          {deals.length ? (
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Deal">
              {deals.slice(0, 8).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={dealId === d.id}
                  onClick={() => setDealId(d.id)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-[13px] ring-1 ring-inset transition-colors duration-150",
                    dealId === d.id ? "bg-fg text-bg ring-fg" : "text-fg-2 ring-border hover:bg-bg-subtle hover:text-fg",
                  )}
                >
                  {d.name}
                  <span className={cn("text-[11.5px]", dealId === d.id ? "text-bg/70" : "text-fg-3")}>{STAGE_LABELS[d.stage]}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-fg-3">
              No open deals yet. A pilot proposal is written from a deal&apos;s qualification card.{" "}
              <Link href="/companies?view=talking&log=1" className="text-fg-2 underline underline-offset-2 hover:text-fg">
                Log a call
              </Link>{" "}
              first.
            </p>
          )}
          {deal && !deal.card && <p className="mt-2 text-[12.5px] text-warning">{deal.name} has no debriefed call yet, so most of the proposal will be gaps.</p>}
        </div>
      )}

      <div className="mt-4">
        <label htmlFor="asset-brief" className="mb-1.5 block text-[12px] font-medium text-fg-2">
          Anything I should know? <span className="font-normal text-fg-3">Optional</span>
        </label>
        <Textarea
          id="asset-brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder={needsDeal ? "e.g. They want to start with one region's data." : "e.g. For CFOs who weren't on the first call."}
          className="min-h-16 text-[13.5px]"
          maxLength={2000}
        />
      </div>

      {gate && <p className="mt-3 text-[13px] leading-5 text-warning">{gate}</p>}

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button size="sm" variant="ghost" onClick={fromTemplate} disabled={needsDeal && !dealId && deals.length > 0}>
          Use the template instead · free
        </Button>
        <div className="flex items-center gap-3">
          <span className="hidden font-mono text-[11.5px] text-fg-3 sm:inline">about $0.05 · no web</span>
          <Button size="sm" variant="agent" onClick={() => void draft()} loading={busy} disabled={!!gate}>
            Draft {meta.noun.replace(/^an? /, "the ")}
            <AiBadge className="ml-0.5 text-accent-fg ring-accent-fg/30" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── Editor ───────────────────────────── */

function AssetEditor({ asset }: { asset: Asset }) {
  const { ws, dispatch, draftAsset, assetRuns, setOpenAsset } = usePlaybook();
  const [mode, setMode] = useState<"preview" | "write">(asset.body.trim() ? "preview" : "write");
  const [draft, setDraft] = useState(asset.body);
  const [title, setTitle] = useState(asset.title);
  const [url, setUrl] = useState(asset.url ?? "");
  // A new agent version (Ask, the company sheet, another tab) replaces the local copy, so a later
  // blur or approve can't write the old text back over it. Local saves keep the runId.
  const [source, setSource] = useState(asset.runId);
  if (asset.runId !== source) {
    setSource(asset.runId);
    setDraft(asset.body);
    setTitle(asset.title);
    setUrl(asset.url ?? "");
    setMode(asset.body.trim() ? "preview" : "write");
  }
  const area = useRef<HTMLTextAreaElement>(null);
  const keys = useModKeys();
  const dirty = draft !== asset.body;
  const check = checkAsset(ws, { body: draft, dealId: asset.dealId });
  const deal = asset.dealId ? ws.deals[asset.dealId] : undefined;
  const liveRun = assetRuns.find((r) => r.id === asset.runId);
  const summary = asset.runId ? ws.runs.find((r) => r.id === asset.runId) : undefined;
  const advisory = (asset.gaps ?? []).filter((g) => !check.placeholders.some((p) => p.toLowerCase() === g.toLowerCase()));

  const upsert = (patch: Partial<Asset>) => void dispatch({ type: "asset.upsert", asset: { ...asset, body: draft, ...patch, updatedAt: nowISO() } });
  const save = () => {
    if (dirty) upsert({});
  };

  /** Jump to a gap in the source so the founder can type over it. */
  const goTo = (placeholder: string) => {
    const select = () => {
      const el = area.current;
      if (!el) return;
      const i = el.value.indexOf(`[[${placeholder}]]`);
      el.focus();
      if (i >= 0) el.setSelectionRange(i, i + placeholder.length + 4);
    };
    if (mode === "write") select();
    else {
      setMode("write");
      requestAnimationFrame(select);
    }
  };

  const approve = () => {
    upsert({ approved: true });
    toast("Approved. Emails can offer it now.");
  };

  const remove = () => {
    void dispatch({ type: "asset.remove", id: asset.id });
    setOpenAsset(null);
    undoable(`“${asset.title}” deleted`, () => void dispatch({ type: "asset.upsert", asset }));
  };

  const redraft = async () => {
    const ok = await draftAsset({ kind: asset.kind, dealId: asset.dealId, assetId: newId("ast"), title: asset.title });
    if (ok) toast("Writing a fresh version. This one stays as it is.");
  };

  return (
    <div className="bg-bg-subtle/40 px-3 pb-4 pt-1 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== asset.title && upsert({ title: title.trim() })}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="h-8 min-w-0 flex-1 basis-full rounded-xs bg-transparent px-1 -mx-1 text-[16px] sm:basis-auto font-semibold tracking-[-0.005em] text-fg outline-none transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:ring-1 focus-visible:ring-border-strong"
        />
        <Segmented
          value={mode}
          layoutId={`asset-mode-${asset.id}`}
          onChange={(m) => {
            if (m === "preview") save();
            setMode(m);
          }}
          options={[
            { value: "preview", label: "Preview" },
            { value: "write", label: "Write" },
          ]}
        />
        <CopyButton text={draft} label="Copy" />
        <Menu
          trigger={
            <button type="button" aria-label="More for this asset" className="inline-flex size-7 items-center justify-center rounded-sm text-fg-3 transition-colors hover:bg-surface hover:text-fg">
              <MoreHorizontal className="size-4" />
            </button>
          }
        >
          {asset.kind !== "other" && <MenuItem onSelect={() => void redraft()}>Write a fresh version</MenuItem>}
          {asset.approved && <MenuItem onSelect={() => upsert({ approved: false })}>Back to draft</MenuItem>}
          <MenuSeparator />
          <MenuItem danger onSelect={remove}>
            Delete
          </MenuItem>
        </Menu>
      </div>

      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-fg-3">
        <span>Updated {shortDate(asset.updatedAt)}</span>
        {deal && (
          <>
            <span aria-hidden>·</span>
            <Link href={`/companies?c=${encodeURIComponent(deal.accountDomain)}`} className="underline-offset-2 hover:text-fg hover:underline">
              for {deal.name}
            </Link>
          </>
        )}
        {asset.origin === "template" && (
          <>
            <span aria-hidden>·</span>
            <span>built from your playbook, no AI</span>
          </>
        )}
        {asset.origin === "agent" && liveRun && <Receipt run={liveRun} />}
        {asset.origin === "agent" && !liveRun && summary?.receipt && (
          <>
            <span aria-hidden>·</span>
            <span className="font-mono text-[11.5px]">
              drafted in {duration(summary.receipt.durationMs)} · {usd(summary.receipt.costUsd)}
            </span>
          </>
        )}
      </p>

      {(check.placeholders.length > 0 || advisory.length > 0) && (
        <div className="mt-3 rounded-md bg-warning-subtle/60 px-3 py-2.5 ring-1 ring-inset ring-warning/15">
          {check.placeholders.length > 0 && (
            <>
              <p className="text-[12.5px] font-medium text-fg">Only you can fill these</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {check.placeholders.map((ph) => (
                  <button
                    key={ph}
                    type="button"
                    onClick={() => goTo(ph)}
                    className="inline-flex h-6 items-center rounded-xs bg-surface px-2 font-mono text-[11.5px] text-fg-2 ring-1 ring-border transition-colors hover:text-fg"
                  >
                    {ph}
                  </button>
                ))}
              </div>
            </>
          )}
          {advisory.length > 0 && (
            <ul className={cn("space-y-1", check.placeholders.length > 0 && "mt-2.5")}>
              {advisory.map((g) => (
                <li key={g} className="flex items-start gap-2 text-[12.5px] leading-[18px] text-fg-2">
                  <span className="min-w-0 flex-1">{g}</span>
                  <button
                    type="button"
                    aria-label={`Dismiss: ${g}`}
                    onClick={() => upsert({ gaps: (asset.gaps ?? []).filter((x) => x !== g) })}
                    className="inline-flex size-5 shrink-0 items-center justify-center rounded-[3px] text-fg-3 hover:bg-surface hover:text-fg"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-3">
        {mode === "preview" ? (
          <div className="overflow-x-auto rounded-md bg-surface px-4 py-5 ring-1 ring-border [overflow-wrap:anywhere] sm:px-7 sm:py-6">
            {draft.trim() ? <Markdown className="[&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:pl-3 [&_blockquote]:text-fg-2">{draft}</Markdown> : <p className="text-[13px] text-fg-3">Empty. Switch to Write.</p>}
          </div>
        ) : (
          <textarea
            ref={area}
            aria-label="Asset text, in Markdown"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "Enter")) {
                e.preventDefault();
                save();
              }
            }}
            spellCheck
            className="block min-h-[360px] w-full resize-none rounded-md bg-surface px-4 py-3.5 font-mono text-[13px] leading-[21px] text-fg ring-1 ring-border outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <Input
          aria-label="Where you host it"
          value={url}
          placeholder="Link, if you host it in Notion or Docs (optional)"
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => {
            const v = url.trim();
            if (v === (asset.url ?? "")) return;
            if (v && !/^https?:\/\//i.test(v)) {
              toast.error("Links need to start with https://");
              return;
            }
            upsert({ url: v || undefined });
          }}
          className="h-8 font-mono text-[12.5px]"
        />
        <span className="font-mono text-[11.5px] text-fg-3 sm:text-right">{dirty ? (mode === "write" ? `Unsaved · ${keys("⌘S")}` : "Unsaved") : "Saved"}</span>
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className={cn("text-[13px] leading-5 transition-colors duration-150", check.blocking ? "text-fg-2" : check.unsourced.length ? "text-warning" : "text-fg-2")}>
          {asset.approved && !dirty ? "Approved. Emails can offer this." : check.line}
        </p>
        {asset.approved && !dirty ? (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-2">
            <Check className="size-4" aria-hidden /> In use
          </span>
        ) : (
          <Button size="sm" variant="primary" disabled={check.blocking} onClick={approve}>
            {asset.approved ? "Save and keep approved" : "Approve for outreach"}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── Design-partner kit ───────────────────────────── */

export function DesignPartnerBlock() {
  const { ws, dispatch, setOpenAsset } = usePlaybook();
  const kit = ws.assets.filter((a) => a.kit === "design_partner");
  const preLaunch = ws.company?.stage === "pre_launch" || ws.company?.stage === "design_partners";

  const setUp = () => {
    const assets = designPartnerKit(ws, () => newId("ast"), nowISO());
    void dispatch(assets.map((asset) => ({ type: "asset.upsert" as const, asset })));
    setOpenAsset(assets[1]?.id ?? null);
    toast("Four templates added. Fill the gaps in the terms, then approve them.");
  };

  return (
    <Sub id="design-partners" title="Design-partner program">
      <div className="relative">
        <p className="max-w-[60ch] font-serif text-[16px] leading-[25px] text-fg-2">
          {preLaunch ? "Before launch, this is the motion. " : ""}Paid partners, 10–20% of the first-year contract upfront, about three months, with a conversion date and price in writing. Sierra screened about 40 candidates and signed 6, all paying.
          <ResearchCite url={SIERRA_URL} quote="Payment of about 10–20% of total contract value up front, a fixed window of 2–6 months, and a written conversion date." />
        </p>
        <p className="mt-2 max-w-[60ch] text-[13px] leading-5 text-fg-3">Free only for your first one or two partners, and never past 60–90 days. I flag anything unpaid after 30.</p>
      </div>
      {kit.length === 0 ? (
        <div className="mt-4 flex flex-col gap-3 rounded-lg bg-surface p-4 ring-1 ring-border sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <p className="max-w-[46ch] text-[13.5px] leading-5 text-fg-2">Four templates built from your playbook: a selection scorecard, the terms, a kickoff agenda and a weekly standup. Instant, no AI cost.</p>
          <Button size="sm" variant="primary" onClick={setUp}>
            Set up the kit
          </Button>
        </div>
      ) : (
        <div className="mt-4">
          <AssetList assets={kit} />
        </div>
      )}
    </Sub>
  );
}
