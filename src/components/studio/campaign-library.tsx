"use client";

import { ArrowRight, ArrowUpRight, Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Input, Label } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import {
  CAMPAIGNS,
  EVIDENCE_LABELS,
  PLAYBOOKS,
  campaignById,
  searchCampaigns,
  type Campaign,
  type CampaignPlaybook,
} from "@/lib/studio/campaigns";
import type { StudioAudience } from "@/lib/domain/types";
import type { StudyStep } from "@/lib/studio/campaign-types";
import { AUDIENCES } from "@/lib/studio/formats";
import { CampaignMediaGallery, CampaignPreview } from "./campaign-media";

const selectClass =
  "h-10 w-full rounded-md bg-surface px-3 text-[13px] text-fg ring-1 ring-border-strong/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

export function CampaignLibrary({
  onUse,
}: {
  onUse: (campaign: Campaign) => void;
}) {
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [audience, setAudience] = useState<StudioAudience | "">("");
  const [playbook, setPlaybook] = useState<CampaignPlaybook | "">("");
  const [reportedOnly, setReportedOnly] = useState(false);
  const selected =
    params.get("view") === "campaigns" && !params.get("piece")
      ? params.get("campaign")
      : null;
  const detail = selected ? (campaignById(selected) ?? null) : null;
  const campaigns = searchCampaigns(query, audience || undefined).filter(
    (campaign) =>
      (!playbook || campaign.study?.playbooks.includes(playbook)) &&
      (!reportedOnly || campaign.evidence !== "reference"),
  );
  const open = (campaign: Campaign) =>
    window.history.pushState(
      null,
      "",
      `/studio?view=campaigns&campaign=${encodeURIComponent(campaign.id)}`,
    );
  const reset = () => {
    setQuery("");
    setAudience("");
    setPlaybook("");
    setReportedOnly(false);
  };

  return (
    <section aria-labelledby="campaign-library-title">
      <div className="mb-7 max-w-[70ch]">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-fg-3">
          The campaign playbook
        </p>
        <h2
          id="campaign-library-title"
          className="font-serif text-[30px] leading-9 text-fg"
        >
          Good work. Explained.
        </h2>
        <p className="mt-3 text-[14px] leading-6 text-fg-2">
          What happened, why the idea worked and how to adapt it. Study the
          original creative alongside the results, the context and the limits of
          the evidence.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_190px_170px]">
        <div>
          <Label htmlFor="campaign-search">Find a campaign</Label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-3 size-4 text-fg-3"
            />
            <Input
              id="campaign-search"
              type="search"
              placeholder="Brand, idea or problem to solve…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-10 pl-9"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="campaign-playbook">What do you want to do?</Label>
          <select
            id="campaign-playbook"
            value={playbook}
            onChange={(event) =>
              setPlaybook(event.target.value as CampaignPlaybook | "")
            }
            className={selectClass}
          >
            <option value="">Explore every approach</option>
            {Object.entries(PLAYBOOKS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="campaign-audience">Audience</Label>
          <select
            id="campaign-audience"
            value={audience}
            onChange={(event) =>
              setAudience(event.target.value as StudioAudience | "")
            }
            className={selectClass}
          >
            <option value="">All audiences</option>
            {Object.entries(AUDIENCES).map(([id, value]) => (
              <option key={id} value={id}>
                {value.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mb-5 mt-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4 text-[12px] text-fg-3">
        <p role="status">
          {campaigns.length} of {CAMPAIGNS.length} case studies
        </p>
        <label className="flex cursor-pointer items-center gap-2 text-fg-2">
          <input
            type="checkbox"
            checked={reportedOnly}
            onChange={(event) => setReportedOnly(event.target.checked)}
            className="size-4 accent-accent"
          />
          With reported outcomes
        </label>
      </div>
      {campaigns.length ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((campaign) => (
            <article
              key={campaign.id}
              aria-label={`${campaign.brand}: ${campaign.title}`}
              className="group flex min-w-0 flex-col overflow-hidden rounded-lg bg-surface ring-1 ring-border transition-[box-shadow] hover:ring-border-strong"
            >
              <CampaignPreview
                id={campaign.id}
                brand={campaign.brand}
                title={campaign.title}
                onOpen={() => open(campaign)}
              />
              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-baseline justify-between gap-3 text-[11px]">
                  <p className="font-semibold text-fg">{campaign.brand}</p>
                  <p className="shrink-0 text-fg-3">
                    {campaign.study?.year ?? "Current reference"}
                  </p>
                </div>
                <h3 className="mt-2 font-serif text-[23px] leading-7 text-fg">
                  {campaign.title}
                </h3>
                <p className="mt-2 line-clamp-3 text-[13px] leading-[21px] text-fg-2">
                  {campaign.approach}
                </p>
                <div className="mt-auto pt-5">
                  <div className="mb-4 border-y border-border py-3">
                    <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.06em] text-fg-3">
                      {EVIDENCE_LABELS[campaign.evidence]}
                    </p>
                    <p className="text-[13px] leading-5 text-fg">
                      <span className="mr-1.5 text-[18px] font-semibold tracking-tight">
                        {campaign.result.value}
                      </span>
                      {campaign.evidence === "reference"
                        ? "Public performance not available"
                        : campaign.result.label}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] text-fg-3">
                      {campaign.study?.playbooks[0] &&
                        PLAYBOOKS[campaign.study.playbooks[0]]}
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="-mr-2.5 shrink-0"
                      onClick={() => open(campaign)}
                      aria-label={`View ${campaign.brand} campaign details`}
                    >
                      Read study <ArrowRight aria-hidden className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No campaigns match"
          body="Try a different brand, audience or approach."
          action={<Button onClick={reset}>Clear filters</Button>}
        />
      )}
      <p className="mt-6 max-w-[78ch] text-[11px] leading-[18px] text-fg-3">
        Reported outcomes retain their source and measurement window. The
        explanations are our creative analysis, not controlled tests of
        individual techniques. Older launches and incomplete records are
        excluded from this collection.
      </p>
      <CampaignDetails
        campaign={detail}
        onClose={() =>
          window.history.replaceState(null, "", "/studio?view=campaigns")
        }
        onUse={onUse}
      />
    </section>
  );
}

function StudySteps({
  steps,
  label,
  numbered = false,
}: {
  steps: StudyStep[];
  label: string;
  numbered?: boolean;
}) {
  return (
    <ol aria-label={label} className="space-y-5">
      {steps.map((step, index) => (
        <li
          key={step.title}
          className={cn(
            "flex gap-4",
            numbered &&
              "border-t border-border pt-5 first:border-t-0 first:pt-0",
          )}
        >
          {numbered && (
            <span
              aria-hidden
              className="w-6 shrink-0 font-serif text-[25px] leading-7 text-fg-3"
            >
              {String(index + 1).padStart(2, "0")}
            </span>
          )}
          <div>
            <h4 className="text-[14px] font-semibold leading-6 text-fg">
              {step.title}
            </h4>
            <p className="mt-1 text-[14px] leading-6 text-fg-2">
              {step.detail}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Evidence({ campaign }: { campaign: Campaign }) {
  return (
    <section
      aria-label="Results and evidence"
      className="rounded-lg bg-bg-subtle p-5"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-3">
        {EVIDENCE_LABELS[campaign.evidence]}
      </p>
      {campaign.evidence !== "reference" && (
        <p className="mt-2 font-serif text-[36px] leading-10 text-fg">
          {campaign.result.value}
        </p>
      )}
      <h3 className="mt-2 text-[14px] font-semibold leading-5 text-fg">
        {campaign.result.label}
      </h3>
      <p className="mt-2 text-[12px] leading-5 text-fg-2">
        {campaign.study?.resultScope ?? campaign.result.detail}
      </p>
      <div className="mt-4 border-t border-border pt-4">
        <p className="text-[11px] font-semibold text-fg">What this tells us</p>
        <p className="mt-1 text-[12px] leading-5 text-fg-2">
          {campaign.caveat}
        </p>
      </div>
      <a
        href={campaign.source.url}
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex items-center gap-1 text-[12px] text-accent-text underline underline-offset-4"
      >
        Read the evidence <ArrowUpRight aria-hidden className="size-3" />
      </a>
    </section>
  );
}

function StudyBody({
  campaign,
  onUse,
}: {
  campaign: Campaign;
  onUse?: (campaign: Campaign) => void;
}) {
  const [tab, setTab] = useState("campaign");
  const study = campaign.study;
  if (!study)
    return (
      <div className="p-6">
        <p className="rounded-md bg-bg-subtle p-4 text-[13px] leading-6 text-fg-2">
          Archived reference. Kept for previously saved pieces; this record is
          excluded from the current library and automatic recommendations.
        </p>
        <h2 className="mt-6 font-serif text-[26px] text-fg">
          {campaign.title}
        </h2>
        <p className="mt-3 text-[14px] leading-6 text-fg-2">
          {campaign.approach}
        </p>
        <a
          href={campaign.source.url}
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-flex items-center gap-1 text-accent-text underline"
        >
          {campaign.source.label}
          <ArrowUpRight aria-hidden className="size-3.5" />
        </a>
      </div>
    );
  const tabs = [
    { id: "campaign", label: "The campaign" },
    {
      id: "why",
      label:
        campaign.evidence === "reference" ? "Creative logic" : "Why it worked",
    },
    { id: "adapt", label: "Make it yours" },
  ];
  return (
    <>
      <div
        className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-border bg-surface-raised px-4 py-2"
        role="tablist"
        aria-label="Campaign study sections"
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            id={`study-tab-${item.id}`}
            role="tab"
            aria-controls={`study-panel-${item.id}`}
            aria-selected={tab === item.id}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const index = tabs.findIndex((t) => t.id === tab);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (index +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        tabs.length) %
                      tabs.length;
              setTab(tabs[next].id);
              document.getElementById(`study-tab-${tabs[next].id}`)?.focus();
            }}
            className={cn(
              "shrink-0 rounded-md px-3 py-2 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
              tab === item.id
                ? "bg-bg-subtle text-fg"
                : "text-fg-3 hover:text-fg",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="p-5 sm:p-7">
        <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-3">
          <span>{study.year ?? "Date not published"}</span>
          <span aria-hidden>·</span>
          <span>{study.market}</span>
          <span aria-hidden>·</span>
          <span>{campaign.channel}</span>
        </div>
        <section
          id={`study-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`study-tab-${tab}`}
        >
          {tab === "campaign" && (
            <>
              <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                <CampaignMediaGallery key={campaign.id} id={campaign.id} />
                <Evidence campaign={campaign} />
              </div>
              <div className="my-7 grid gap-5 border-y border-border py-5 sm:grid-cols-2">
                <div>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">
                    The objective
                  </h3>
                  <p className="mt-2 text-[14px] leading-6 text-fg">
                    {study.objective}
                  </p>
                </div>
                <div>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">
                    The audience
                  </h3>
                  <p className="mt-2 text-[14px] leading-6 text-fg">
                    {study.audience}
                  </p>
                </div>
              </div>
              <h3 className="mb-3 font-serif text-[24px] leading-8 text-fg">
                The idea in context
              </h3>
              <p className="mb-7 max-w-[78ch] text-[14px] leading-6 text-fg-2">
                {study.setup}
              </p>
              <h3 className="mb-5 font-serif text-[24px] leading-8 text-fg">
                How it unfolded
              </h3>
              <StudySteps
                steps={study.execution}
                label="Campaign execution"
                numbered
              />
              <Button
                variant="ghost"
                className="-ml-3 mt-6"
                onClick={() => setTab("why")}
              >
                {campaign.evidence === "reference"
                  ? "Understand the creative logic"
                  : "Understand why it worked"}
                <ArrowRight aria-hidden className="size-4" />
              </Button>
            </>
          )}
          {tab === "why" && (
            <>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-3">
                The strategic breakdown
              </p>
              <h3 className="font-serif text-[28px] leading-9 text-fg">
                {campaign.approach}
              </h3>
              <p className="mb-7 mt-3 text-[12px] leading-5 text-fg-3">
                {campaign.evidence === "reference"
                  ? "Creative interpretation. Campaign-level performance has not been verified."
                  : "Our interpretation of the creative and distribution. The public reporting does not isolate these mechanisms as individual causes."}
              </p>
              <StudySteps
                steps={study.mechanisms}
                label="Creative mechanisms"
                numbered
              />
              <div className="my-7 border-y border-border py-5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">
                  Look for this in the creative
                </p>
                <p className="mt-2 text-[14px] leading-6 text-fg">
                  {study.lookFor}
                </p>
              </div>
              <div className="max-w-[620px]">
                <CampaignMediaGallery
                  key={`${campaign.id}-why`}
                  id={campaign.id}
                />
              </div>
              <Button
                variant="ghost"
                className="-ml-3 mt-6"
                onClick={() => setTab("adapt")}
              >
                Build your own brief
                <ArrowRight aria-hidden className="size-4" />
              </Button>
            </>
          )}
          {tab === "adapt" && (
            <>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-3">
                Borrow the structure
              </p>
              <h3 className="font-serif text-[28px] leading-9 text-fg">
                A starting point for your brief.
              </h3>
              <p className="mb-7 mt-3 max-w-[72ch] text-[14px] leading-6 text-fg-2">
                Use the mechanism with your own product, evidence and audience.
                The original campaign&apos;s results are not a forecast for
                yours.
              </p>
              <StudySteps
                steps={study.blueprint}
                label="Adaptation framework"
                numbered
              />
              <div className="my-7 grid gap-5 rounded-lg bg-bg-subtle p-5 sm:grid-cols-2">
                <div>
                  <h4 className="text-[12px] font-semibold text-fg">
                    A good fit when
                  </h4>
                  <p className="mt-2 text-[13px] leading-6 text-fg-2">
                    {study.useWhen}
                  </p>
                </div>
                <div>
                  <h4 className="text-[12px] font-semibold text-fg">
                    Where it breaks
                  </h4>
                  <p className="mt-2 text-[13px] leading-6 text-fg-2">
                    {study.avoidWhen}
                  </p>
                </div>
              </div>
              <h4 className="text-[12px] font-semibold text-fg">
                What to measure
              </h4>
              <p className="mt-2 text-[14px] leading-6 text-fg-2">
                {study.measure}
              </p>
              {onUse && (
                <p className="mt-6 border-t border-border pt-5 text-[12px] leading-5 text-fg-3">
                  Use this approach to carry the framework and fit guidance into
                  Studio. Your unfinished brief stays intact; factual claims
                  still come from your own material.
                </p>
              )}
            </>
          )}
        </section>
        <details className="mt-8 border-t border-border pt-4">
          <summary className="cursor-pointer text-[12px] font-semibold text-fg">
            Sources & measurement · {study.sources.length}
          </summary>
          <p className="mt-4 text-[13px] leading-6 text-fg-2">
            {campaign.result.detail}
          </p>
          <p className="mt-2 text-[12px] leading-5 text-fg-3">
            {study.resultScope}. {campaign.caveat}
          </p>
          <ol className="mt-4 space-y-4">
            {study.sources.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[13px] text-accent-text underline underline-offset-4"
                >
                  {source.label}
                  <ArrowUpRight aria-hidden className="size-3.5" />
                </a>
                <p className="mt-1 text-[12px] leading-5 text-fg-3">
                  {source.note}
                </p>
              </li>
            ))}
          </ol>
          <p className="mt-5 text-[11px] text-fg-3">
            Sources reviewed {campaign.reviewedAt}. Original media remains
            subject to publisher availability.
          </p>
        </details>
      </div>
    </>
  );
}

export function CampaignDetails({
  campaign,
  onClose,
  onUse,
}: {
  campaign: Campaign | null;
  onClose: () => void;
  onUse?: (campaign: Campaign) => void;
}) {
  return (
    <Sheet
      open={!!campaign}
      onOpenChange={(open) => !open && onClose()}
      title={
        campaign ? `${campaign.brand} · ${campaign.title}` : "Campaign study"
      }
      width={1040}
      header={
        campaign ? (
          <div className="flex min-w-0 items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-wide text-fg-3">
                {campaign.brand} · Case study
              </p>
              <h2 className="mt-1 truncate font-serif text-[20px] leading-6 text-fg">
                {campaign.title}
              </h2>
            </div>
            {onUse && campaign.study && (
              <Button
                variant="primary"
                size="sm"
                className="shrink-0"
                onClick={() => onUse(campaign)}
                aria-label="Create with this approach"
              >
                <span className="hidden sm:inline">Use this approach</span>
                <span className="sm:hidden">Use approach</span>
                <ArrowRight aria-hidden className="size-3.5" />
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {campaign && (
        <StudyBody key={campaign.id} campaign={campaign} onUse={onUse} />
      )}
    </Sheet>
  );
}
