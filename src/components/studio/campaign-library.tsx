"use client";

import { ArrowRight, ArrowUpRight, Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/misc";
import {
  EVIDENCE_LABELS,
  searchCampaigns,
  type Campaign,
  type CampaignEvidence,
} from "@/lib/studio/campaigns";
import type { StudioAudience } from "@/lib/domain/types";
import { AUDIENCES, FORMATS } from "@/lib/studio/formats";
import { campaignMedia } from "@/lib/studio/campaign-media";
import { CampaignMediaGallery, CampaignPreview } from "./campaign-media";

const selectClass =
  "h-9 w-full rounded-sm bg-surface px-3 text-[13px] text-fg ring-1 ring-border-strong/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";
const FEATURED = [
  "wispr-old-way",
  "cider-shorts",
  "spotify-wrapped",
  "ramp-time-money",
];

export function CampaignLibrary({
  onUse,
}: {
  onUse: (campaign: Campaign) => void;
}) {
  const [query, setQuery] = useState("");
  const [audience, setAudience] = useState<StudioAudience | "">("");
  const [evidence, setEvidence] = useState<CampaignEvidence | "">("");
  const [detail, setDetail] = useState<Campaign | null>(null);
  const campaigns = searchCampaigns(
    query,
    audience || undefined,
    evidence || undefined,
  ).sort((left, right) => {
    const rank = (campaign: Campaign) => {
      const index = FEATURED.indexOf(campaign.id);
      return index < 0 ? FEATURED.length : index;
    };
    return rank(left) - rank(right);
  });
  const visualCampaigns = campaigns.filter(
    (campaign) => campaignMedia(campaign.id).length,
  );
  const research = campaigns.filter(
    (campaign) => !campaignMedia(campaign.id).length,
  );

  return (
    <section aria-labelledby="campaign-library-title">
      <div className="mb-6 max-w-[65ch]">
        <h2
          id="campaign-library-title"
          className="font-serif text-[26px] leading-8 text-fg"
        >
          See the creative. Find your direction.
        </h2>
        <p className="mt-2 text-[14px] leading-6 text-fg-2">
          Watch original campaign films, inspect the artwork and see the idea in
          action. Then adapt the approach to your own product.
        </p>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_180px]">
        <div>
          <Label htmlFor="campaign-search">Find a campaign</Label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-fg-3"
            />
            <Input
              id="campaign-search"
              type="search"
              placeholder="Brand, channel or approach…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 pl-9"
            />
          </div>
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
        <div>
          <Label htmlFor="campaign-evidence">Evidence</Label>
          <select
            id="campaign-evidence"
            value={evidence}
            onChange={(event) =>
              setEvidence(event.target.value as CampaignEvidence | "")
            }
            className={selectClass}
          >
            <option value="">All evidence</option>
            {Object.entries(EVIDENCE_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3 text-[12px] text-fg-3">
        <p role="status">
          {visualCampaigns.length} campaign examples · {research.length}{" "}
          research records
        </p>
        <p>Results and reach are reported by the linked sources.</p>
      </div>

      {visualCampaigns.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visualCampaigns.map((campaign) => (
            <article
              key={campaign.id}
              aria-label={`${campaign.brand}: ${campaign.title}`}
              className="flex min-w-0 flex-col rounded-lg bg-surface p-5 ring-1 ring-border"
            >
              <CampaignPreview
                id={campaign.id}
                brand={campaign.brand}
                onOpen={() => setDetail(campaign)}
              />
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[14px] font-semibold text-fg">
                  {campaign.brand}
                </p>
                <p className="text-[11px] text-fg-3">{campaign.channel}</p>
              </div>
              <h3 className="mt-3 font-serif text-[21px] leading-7 text-fg">
                {campaign.title}
              </h3>
              <p className="mt-2 text-[13px] leading-5 text-fg-2">
                {campaign.approach}
              </p>
              <div className="my-5 border-y border-border py-4">
                <p className="text-[11px] font-medium text-fg-3">
                  {EVIDENCE_LABELS[campaign.evidence]}
                </p>
                <p className="mt-1 font-serif text-[26px] leading-8 text-fg">
                  {campaign.result.value}
                </p>
                <p className="mt-1 text-[12px] leading-[18px] text-fg-2">
                  {campaign.result.label}
                </p>
              </div>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="-ml-2.5"
                  onClick={() => setDetail(campaign)}
                  aria-label={`View ${campaign.brand} campaign details`}
                >
                  View creative
                </Button>
                <Button
                  size="sm"
                  onClick={() => onUse(campaign)}
                  aria-label={`Use ${campaign.brand} approach`}
                >
                  Use approach <ArrowRight aria-hidden className="size-3.5" />
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : !research.length ? (
        <EmptyState
          title="No campaigns match"
          body="Try a brand, a channel like LinkedIn, or a broader audience."
          action={
            <Button
              onClick={() => {
                setQuery("");
                setAudience("");
                setEvidence("");
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <p className="mb-5 text-[13px] text-fg-2">
          No published creative matches these filters. Supporting research is
          below.
        </p>
      )}

      {!!research.length && (
        <details
          key={`${query}:${audience}:${evidence}`}
          open={!!(query || audience || evidence)}
          className="mt-8 rounded-lg border border-border bg-surface"
        >
          <summary className="cursor-pointer px-5 py-4 text-[13px] font-semibold text-fg">
            Supporting research · {research.length} records
          </summary>
          <div className="border-t border-border px-5 pb-3 pt-4">
            <p className="mb-3 text-[12px] leading-5 text-fg-3">
              Useful case studies and positioning references. Original campaign
              creative has not been verified for these records.
            </p>
            {research.map((campaign) => (
              <article
                key={campaign.id}
                aria-label={`${campaign.brand}: ${campaign.title}`}
                className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-4"
              >
                <div className="min-w-0 flex-1">
                  <h3 className="text-[13px] font-semibold text-fg">
                    {campaign.brand} · {campaign.title}
                  </h3>
                  <p className="mt-1 text-[12px] text-fg-3">
                    {campaign.channel} · {EVIDENCE_LABELS[campaign.evidence]}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDetail(campaign)}
                  aria-label={`View ${campaign.brand} campaign details`}
                >
                  Read research{" "}
                  <ArrowUpRight aria-hidden className="size-3.5" />
                </Button>
              </article>
            ))}
          </div>
        </details>
      )}

      <CampaignDetails
        campaign={detail}
        onClose={() => setDetail(null)}
        onUse={(campaign) => {
          setDetail(null);
          onUse(campaign);
        }}
      />
    </section>
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
    <Dialog
      open={!!campaign}
      onOpenChange={(open) => !open && onClose()}
      title={
        campaign ? `${campaign.brand} · ${campaign.title}` : "Campaign record"
      }
      description={
        campaign ? `${campaign.channel} · ${campaign.period}` : undefined
      }
      className="top-[6vh] flex max-h-[88vh] max-w-[760px] flex-col"
    >
      {campaign && (
        <div className="min-h-0 overflow-y-auto px-5 pb-5 pt-5">
          <CampaignMediaGallery key={campaign.id} id={campaign.id} />
          <div className="rounded-md bg-bg-subtle p-4">
            <p className="text-[11px] font-medium text-fg-3">
              {EVIDENCE_LABELS[campaign.evidence]}
            </p>
            <p className="mt-1 font-serif text-[30px] leading-9 text-fg">
              {campaign.result.value}
            </p>
            <p className="mt-1 text-[13px] font-medium text-fg">
              {campaign.result.label}
            </p>
            <p className="mt-2 text-[13px] leading-5 text-fg-2">
              {campaign.result.detail}
            </p>
          </div>
          <div className="mt-5 space-y-5 text-[13px] leading-5">
            <div>
              <h3 className="font-semibold text-fg">The creative approach</h3>
              <p className="mt-1 text-fg-2">{campaign.approach}</p>
            </div>
            <div>
              <h3 className="font-semibold text-fg">Make it yours</h3>
              <p className="mt-1 text-fg-2">{campaign.adaptation}</p>
            </div>
            <div>
              <h3 className="font-semibold text-fg">
                What the evidence can tell you
              </h3>
              <p className="mt-1 text-fg-2">{campaign.caveat}</p>
            </div>
            <div>
              <h3 className="font-semibold text-fg">Source</h3>
              <a
                href={campaign.source.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-accent-text underline underline-offset-4"
              >
                {campaign.source.label}
                <ArrowUpRight aria-hidden className="size-3.5" />
              </a>
              {campaign.creativeUrl && (
                <a
                  href={campaign.creativeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 flex items-center gap-1 text-accent-text underline underline-offset-4"
                >
                  See the campaign
                  <ArrowUpRight aria-hidden className="size-3.5" />
                </a>
              )}
              <p className="mt-2 text-[11px] text-fg-3">
                Record reviewed {campaign.reviewedAt}. Suggested format:{" "}
                {FORMATS[campaign.preferredFormat].label}.
              </p>
            </div>
          </div>
          {onUse && (
            <Button
              variant="primary"
              className="mt-6 w-full"
              onClick={() => onUse(campaign)}
            >
              Create with this approach
              <ArrowRight aria-hidden className="size-3.5" />
            </Button>
          )}
        </div>
      )}
    </Dialog>
  );
}
